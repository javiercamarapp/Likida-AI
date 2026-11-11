import { getT } from '@/lib/i18n/servidor';
import { type Tr } from '@/lib/i18n/dinero_tr';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { dominioBuzon } from '@/lib/correo/buzon';
import { direccionCp, generarTokenCp } from '@/lib/likida/carta_porte_docs/correo_entrante';
import { validarConfigExport } from '@/lib/likida/carta_porte_docs/exportacion';
import { salidaDeFlota } from '@/lib/likida/carta_porte_docs/worker_envios_deps';
import { estadoConexionTms } from '@/lib/likida/carta_porte_docs/tms_puerto';
import { flotaBajoPerfil } from '@/lib/likida/carta_porte_docs/envio';
import { leerConfigSalida } from '@/lib/likida/carta_porte_docs/salida_config';
import { calcularMetricas } from '@/lib/likida/carta_porte_docs/metricas';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import { procesarDocumento, recibirDocumento } from '@/lib/likida/carta_porte_docs/servicio';
import { sufijoTenant } from '../../sufijo';
import { VistaDocumentos, filtroEnvioDe, type DatosDocumentos } from './vista';
import type { ResultadoAccion } from './forma_accion';
import type { Metadata } from 'next';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.cartaPorte.documentos') };
}

export const dynamic = 'force-dynamic';
// Subir un documento lo lee en la misma petición (visión + posible escalamiento): puede tardar.
export const maxDuration = 120;

const RUTA = '/dashboard/carta-porte/documentos';
const DIAS_VENTANA = 90;
/** Las server actions de Next aceptan hasta 10 MB de cuerpo (next.config.ts): 9 MB deja lugar al multipart. */
const MAX_BYTES_SUBIDA = 9 * 1024 * 1024;
/** Lo que se le dice a quien subió un archivo que traía varios embarques. */
const mensajeDeDivision = (tr: Tr, n: number): string =>
  tr('cartaPorte.documentos.page.divisionEmbarques', { n });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La sesión y el área, DE NUEVO, dentro de cada acción. A nivel de módulo a propósito: una función declarada en el
 * cuerpo del componente y usada dentro de un `'use server'` se captura por closure y Next no puede serializarla.
 */
async function sesionDeAccion(
  tr: Tr, sp: { tenant?: string; rol?: string; vista?: string }, tenantId: string, opts: { configuracion?: boolean } = {},
): Promise<{ tenantId: string; userId: string } | { error: string }> {
  // MX-002: la flota que se pintó es la que escribe.
  const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('cartaPorte.documentos.page.tuRolNoPuede') };
  // A37-S16-03: la configuración (buzón, remitentes, formatos de exportación, versión del perfil que lee los documentos de cada
  // cliente) es del dueño de la cuenta, no de quien solo ve la ruta (el encargado). Mismo criterio que /dashboard/arco.
  if (opts.configuracion && !puedeAdministrar(s.rol)) return { error: tr('cartaPorte.documentos.page.configurarLosDocumentosDe') };
  return { tenantId: s.tenantId, userId: s.userId };
}

/** La lectura de la bandeja. Fuera del componente: «hace 90 días» depende del reloj y un render no debe leerlo. */
async function cargarAsignacion(tenantId: string, ids: string[]): Promise<Pick<DatosDocumentos, 'asignados' | 'revisores' | 'asignacionActiva'>> {
  // T-A3-31. Es un adorno de la bandeja: si la base aún no tiene la 0790 (o la lectura falla) la bandeja sale como siempre.
  try {
    const [config, asignados, revisores] = await Promise.all([leerConfigSalida(tenantId), repo.revisoresDeDocumentos(tenantId, ids), repo.usuariosRevisores(tenantId)]);
    const hay = config.destinatarioRevisionUsuario !== null || asignados.size > 0;
    if (!hay) return {};
    return { asignacionActiva: true, asignados: Object.fromEntries(asignados), revisores: revisores.map((r) => ({ id: r.id, nombre: r.nombre ?? r.email })) };
  } catch (e) {
    logger.warn('carta_porte_docs.asignacion_no_disponible', { error: e instanceof Error ? e.message : String(e) });
    return {};
  }
}

async function cargarDatos(tenantId: string): Promise<DatosDocumentos | null> {
  try {
    const desde = new Date(Date.now() - DIAS_VENTANA * 86_400_000).toISOString();
    const [lista0, pendientesViejos, perfiles, clientes, buzon, configs] = await Promise.all([
      repo.listarDocumentos(tenantId, { limite: 200 }),
      // A37-A3-14: lo que sigue esperando a una persona (por revisar, sin poder leer) se muestra SIEMPRE, sin importar su antigüedad.
      repo.listarDocumentos(tenantId, { estados: ['por_revisar', 'fallido'], limite: 500 }),
      repo.listarPerfiles(tenantId),
      repo.listarClientes(tenantId),
      repo.buzonDeFlota(tenantId),
      repo.listarExportConfigs(tenantId),
    ]);
    const ventana = await repo.listarDocumentos(tenantId, { desde, limite: 500 });
    const recientes = ventana.filas;
    const vistos = new Set(lista0.filas.map((d) => d.id));
    const lista = {
      total: lista0.total,
      filas: [...lista0.filas, ...pendientesViejos.filas.filter((d) => !vistos.has(d.id))].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    };
    const correcciones = await repo.contarCorreccionesPorDocumento(tenantId, recientes.filter((d) => d.estado === 'aprobado').map((d) => d.id));
    const versiones = await Promise.all(perfiles.map((p) => repo.listarVersionesPerfil(tenantId, p.id)));
    const dominio = dominioBuzon();
    const linaje = await repo.linajeDeDocumentos(tenantId, lista.filas.map((d) => d.id));
    const envios = await repo.estadoEnvioPorDocumento(tenantId, lista.filas.filter((d) => d.estado === 'aprobado').map((d) => d.id));
    // Solo se consulta al proveedor si hay envíos que rotular; una vez por carga de la bandeja.
    const sinConexion = Object.keys(envios).length > 0 ? estadoConexionTms(await salidaDeFlota(tenantId)) === 'por_conectar' : false;
    const asignacion = await cargarAsignacion(tenantId, lista.filas.map((d) => d.id));
    return {
      filas: lista.filas, total: lista.total, envios, ...(sinConexion ? { sinConexion: true } : {}), ...asignacion,
      linaje: Object.fromEntries([...linaje].map(([id, l]) => [id, { rol: l.rol, indice: l.indice, total: l.total, clave: l.clave }])), metricas: calcularMetricas(recientes, correcciones, ventana.total), clientes,
      perfiles: perfiles.map((p, i) => ({ id: p.id, nombre: p.nombre, formato: p.formato, versionActiva: p.versionActiva, mapeos: p.activa.mapeos.length, versiones: versiones[i].map((v) => ({ version: v.version, nota: v.nota, mapeos: v.mapeos })) })),
      buzon: buzon ? { direccion: direccionCp(buzon.token, dominio), activo: buzon.activo, remitentes: buzon.remitentesPermitidos, dominioConfigurado: dominio !== null } : null,
      configs: configs.map((c) => ({ id: c.id, nombre: c.nombre, formato: c.formato, config: c.config })),
    };
  } catch (e) {
    logger.error('carta_porte_docs.pagina_lectura', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * DOCUMENTOS DE TUS CLIENTES — área `operacion` a propósito (igual que /dashboard/carta-porte): no enseña un
 * peso de dinero del negocio y su usuario diario es el jefe de tráfico, que conoce al cliente y la ruta.
 * Cada server action vuelve a resolver la sesión y a exigir el área: la forma de la página no es una puerta.
 */
export default async function PaginaDocumentos({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string; envio?: string; mios?: string }>;
}) {
  const { t: tr } = await getT('dinero');
  const sp = await searchParams;
  const { tenantId, rol, userId } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // Una base que no contesta NO se pinta como bandeja vacía.
  const [datos, restringido] = await Promise.all([cargarDatos(tenantId), flotaBajoPerfil(tenantId)]);

  async function subir(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionDeAccion(tr, sp, tenantId);
    if ('error' in s) return { ok: false, error: s.error };
    try {
      if (!(await rateLimit(`cp-docs-subir:${s.tenantId}`, 30, 60_000))) return { ok: false, error: tr('cartaPorte.documentos.page.demasiadosDocumentosEnPoco') };
      const archivo = fd.get('archivo');
      if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: tr('cartaPorte.documentos.page.eligeUnArchivo') };
      if (archivo.size > MAX_BYTES_SUBIDA) return { ok: false, error: tr('cartaPorte.documentos.page.elArchivoPesaMas') };
      const clienteId = String(fd.get('clienteId') ?? '');
      const r = await recibirDocumento(s.tenantId, {
        canal: 'manual', nombre: archivo.name, bytes: new Uint8Array(await archivo.arrayBuffer()), clienteId: UUID.test(clienteId) ? clienteId : null, actorId: s.userId,
      });
      if (!r.ok) return { ok: false, error: r.mensaje };
      if (r.duplicado && r.archivoPurgado) { revalidatePath(RUTA); return { ok: false, error: tr('cartaPorte.documentos.page.eseArchivoYaSe') }; }
      if (r.duplicado) { revalidatePath(RUTA); return { ok: true, mensaje: tr('cartaPorte.documentos.page.eseArchivoYaEstaba') }; }
      const p = r.estado === 'recibido' ? await procesarDocumento(s.tenantId, r.documentoId, {}) : null;
      revalidatePath(RUTA);
      if (p && !p.ok) return { ok: false, error: tr('cartaPorte.documentos.page.seGuardoPeroNo', { mensaje: p.mensaje }) };
      if (p && p.ok && p.estado === 'dividido') return { ok: true, mensaje: mensajeDeDivision(tr, p.embarques) };
      return { ok: true, mensaje: tr('cartaPorte.documentos.page.documentoLeidoYaEsta') };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'subir el documento') };
    }
  }

  async function procesar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionDeAccion(tr, sp, tenantId);
    if ('error' in s) return { ok: false, error: s.error };
    try {
      const id = String(fd.get('documentoId') ?? '');
      if (!UUID.test(id)) return { ok: false, error: tr('cartaPorte.documentos.page.noSeReconoceEse') };
      if (!(await repo.leerDocumento(s.tenantId, id))) return { ok: false, error: tr('cartaPorte.documentos.page.eseDocumentoNoEsta') };
      if (!(await rateLimit(`cp-docs-subir:${s.tenantId}`, 30, 60_000))) return { ok: false, error: tr('cartaPorte.documentos.page.demasiadasLecturasEnPoco') };
      const p = await procesarDocumento(s.tenantId, id, {});
      revalidatePath(RUTA);
      if (p.ok && p.estado === 'dividido') return { ok: true, mensaje: mensajeDeDivision(tr, p.embarques) };
      return p.ok ? { ok: true, mensaje: tr('cartaPorte.documentos.page.documentoLeido') } : { ok: false, error: p.mensaje };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'leer el documento') };
    }
  }

  async function activarBuzon(): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionDeAccion(tr, sp, tenantId, { configuracion: true });
    if ('error' in s) return { ok: false, error: s.error };
    try {
      await repo.crearBuzon(s.tenantId, generarTokenCp());
      revalidatePath(RUTA);
      return { ok: true, mensaje: tr('cartaPorte.documentos.page.buzonActivado') };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'activar el buzón') };
    }
  }

  async function guardarRemitentes(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionDeAccion(tr, sp, tenantId, { configuracion: true });
    if ('error' in s) return { ok: false, error: s.error };
    try {
      const lista = String(fd.get('remitentes') ?? '').split(/\r?\n/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (lista.length > 50) return { ok: false, error: tr('cartaPorte.documentos.page.maximo50Remitentes') };
      const mala = lista.find((x) => !/^@?[a-z0-9._%+-]*@?[a-z0-9.-]+\.[a-z]{2,}$/.test(x) || x.length > 120);
      if (mala) return { ok: false, error: tr('cartaPorte.documentos.page.noPareceUnCorreo', { v: mala.slice(0, 60) }) };
      await repo.configurarBuzon(s.tenantId, { remitentesPermitidos: [...new Set(lista)] });
      revalidatePath(RUTA);
      return { ok: true, mensaje: lista.length === 0 ? tr('cartaPorte.documentos.page.sinListaElBuzon') : `Guardados ${lista.length} remitentes.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar los remitentes') };
    }
  }

  async function guardarExport(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionDeAccion(tr, sp, tenantId, { configuracion: true });
    if ('error' in s) return { ok: false, error: s.error };
    try {
      const nombre = String(fd.get('nombre') ?? '').trim();
      const formato = String(fd.get('formato') ?? '');
      if (nombre === '' || nombre.length > 80) return { ok: false, error: tr('cartaPorte.documentos.page.elNombreEsObligatorio') };
      if (formato !== 'csv' && formato !== 'json') return { ok: false, error: tr('cartaPorte.documentos.page.elFormatoEsCsv') };
      let crudo: unknown;
      try { crudo = JSON.parse(String(fd.get('config') ?? '')); } catch { return { ok: false, error: tr('cartaPorte.documentos.page.elMapeoNoEs') }; }
      const v = validarConfigExport(crudo);
      if (!v.ok) return { ok: false, error: tr('cartaPorte.documentos.page.elMapeoNoEs2', { v: v.errores.slice(0, 4).join(' · ') }) };
      await repo.guardarExportConfig(s.tenantId, { nombre, formato, config: v.config as unknown as Record<string, unknown> });
      revalidatePath(RUTA);
      return { ok: true, mensaje: tr('cartaPorte.documentos.page.formatoGuardadoYaAparece', { nombre }) };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar el formato') };
    }
  }

  async function borrarExport(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionDeAccion(tr, sp, tenantId, { configuracion: true });
    if ('error' in s) return { ok: false, error: s.error };
    try {
      const id = String(fd.get('id') ?? '');
      if (!UUID.test(id)) return { ok: false, error: tr('cartaPorte.documentos.page.noSeReconoceEse2') };
      await repo.borrarExportConfig(s.tenantId, id);
      revalidatePath(RUTA);
      return { ok: true, mensaje: tr('cartaPorte.documentos.page.formatoQuitado') };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'quitar el formato') };
    }
  }

  async function volverVersion(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionDeAccion(tr, sp, tenantId, { configuracion: true });
    if ('error' in s) return { ok: false, error: s.error };
    try {
      const perfilId = String(fd.get('perfilId') ?? '');
      const version = Number(fd.get('version'));
      if (!UUID.test(perfilId) || !Number.isInteger(version) || version < 1) return { ok: false, error: tr('cartaPorte.documentos.page.noSeReconoceEsa') };
      const ok = await repo.activarVersionPerfil(s.tenantId, perfilId, version);
      if (!ok) return { ok: false, error: tr('cartaPorte.documentos.page.esaVersionNoExiste') };
      revalidatePath(RUTA);
      return { ok: true, mensaje: tr('cartaPorte.documentos.page.elPerfilVolvioA', { version }) };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'cambiar la versión') };
    }
  }

  return (
    <VistaDocumentos tr={tr}
      datos={datos}
      sufijo={sufijoTenant(sp)}
      filtroEnvio={filtroEnvioDe(sp.envio)}
      soloMios={sp.mios === '1'}
      usuarioId={userId}
      perfilRestringido={restringido}
      apiSufijo={sufijoTenant(sp) ? `&${sufijoTenant(sp).slice(1)}` : ''}
      acciones={{ subir, procesar, activarBuzon, guardarRemitentes, guardarExport, borrarExport, volverVersion }}
    />
  );
}
