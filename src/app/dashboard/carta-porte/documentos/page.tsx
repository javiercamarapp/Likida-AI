import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { dominioBuzon } from '@/lib/correo/buzon';
import { MAX_BYTES_DOC } from '@/lib/likida/carta_porte_docs/contenido';
import { direccionCp, generarTokenCp } from '@/lib/likida/carta_porte_docs/correo_entrante';
import { validarConfigExport } from '@/lib/likida/carta_porte_docs/exportacion';
import { calcularMetricas } from '@/lib/likida/carta_porte_docs/metricas';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import { procesarDocumento, recibirDocumento } from '@/lib/likida/carta_porte_docs/servicio';
import { sufijoTenant } from '../../sufijo';
import { VistaDocumentos, type DatosDocumentos } from './vista';
import type { ResultadoAccion } from './forma_accion';

export const dynamic = 'force-dynamic';
// Subir un documento lo lee en la misma petición (visión + posible escalamiento): puede tardar.
export const maxDuration = 120;

const RUTA = '/dashboard/carta-porte/documentos';
const DIAS_VENTANA = 90;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La sesión y el área, DE NUEVO, dentro de cada acción. A nivel de módulo a propósito: una función declarada en el
 * cuerpo del componente y usada dentro de un `'use server'` se captura por closure y Next no puede serializarla.
 */
async function sesionDeAccion(sp: { tenant?: string; rol?: string; vista?: string }): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede administrar los documentos de Carta Porte.' };
  return { tenantId: s.tenantId, userId: s.userId };
}

/** La lectura de la bandeja. Fuera del componente: «hace 90 días» depende del reloj y un render no debe leerlo. */
async function cargarDatos(tenantId: string): Promise<DatosDocumentos | null> {
  try {
    const desde = new Date(Date.now() - DIAS_VENTANA * 86_400_000).toISOString();
    const [lista, perfiles, clientes, buzon, configs] = await Promise.all([
      repo.listarDocumentos(tenantId, { limite: 200 }),
      repo.listarPerfiles(tenantId),
      repo.listarClientes(tenantId),
      repo.buzonDeFlota(tenantId),
      repo.listarExportConfigs(tenantId),
    ]);
    const recientes = (await repo.listarDocumentos(tenantId, { desde, limite: 500 })).filas;
    const correcciones = await repo.contarCorreccionesPorDocumento(tenantId, recientes.filter((d) => d.estado === 'aprobado').map((d) => d.id));
    const versiones = await Promise.all(perfiles.map((p) => repo.listarVersionesPerfil(tenantId, p.id)));
    const dominio = dominioBuzon();
    return {
      filas: lista.filas, total: lista.total, metricas: calcularMetricas(recientes, correcciones), clientes,
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
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // Una base que no contesta NO se pinta como bandeja vacía.
  const datos = await cargarDatos(tenantId);

  async function subir(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await sesionDeAccion(sp);
    if ('error' in s) return { ok: false, error: s.error };
    try {
      if (!(await rateLimit(`cp-docs-subir:${s.tenantId}`, 30, 60_000))) return { ok: false, error: 'Demasiados documentos en poco tiempo. Espera un minuto.' };
      const archivo = fd.get('archivo');
      if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Elige un archivo.' };
      if (archivo.size > MAX_BYTES_DOC) return { ok: false, error: 'El archivo pesa más de 12 MB.' };
      const clienteId = String(fd.get('clienteId') ?? '');
      const r = await recibirDocumento(s.tenantId, {
        canal: 'manual', nombre: archivo.name, bytes: new Uint8Array(await archivo.arrayBuffer()), clienteId: UUID.test(clienteId) ? clienteId : null, actorId: s.userId,
      });
      if (!r.ok) return { ok: false, error: r.mensaje };
      if (r.duplicado) { revalidatePath(RUTA); return { ok: true, mensaje: 'Ese archivo ya estaba en la bandeja: no se duplicó.' }; }
      const p = r.estado === 'recibido' ? await procesarDocumento(s.tenantId, r.documentoId, {}) : null;
      revalidatePath(RUTA);
      if (p && !p.ok) return { ok: false, error: `Se guardó, pero no se pudo leer: ${p.mensaje} Queda en la bandeja para reintentar.` };
      return { ok: true, mensaje: 'Documento leído. Ya está en la bandeja para revisar.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'subir el documento') };
    }
  }

  async function procesar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await sesionDeAccion(sp);
    if ('error' in s) return { ok: false, error: s.error };
    try {
      const id = String(fd.get('documentoId') ?? '');
      if (!UUID.test(id)) return { ok: false, error: 'No se reconoce ese documento.' };
      if (!(await repo.leerDocumento(s.tenantId, id))) return { ok: false, error: 'Ese documento no está en tu flota.' };
      if (!(await rateLimit(`cp-docs-subir:${s.tenantId}`, 30, 60_000))) return { ok: false, error: 'Demasiadas lecturas en poco tiempo. Espera un minuto.' };
      const p = await procesarDocumento(s.tenantId, id, {});
      revalidatePath(RUTA);
      return p.ok ? { ok: true, mensaje: 'Documento leído.' } : { ok: false, error: p.mensaje };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'leer el documento') };
    }
  }

  async function activarBuzon(): Promise<ResultadoAccion> {
    'use server';
    const s = await sesionDeAccion(sp);
    if ('error' in s) return { ok: false, error: s.error };
    try {
      await repo.crearBuzon(s.tenantId, generarTokenCp());
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Buzón activado.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'activar el buzón') };
    }
  }

  async function guardarRemitentes(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await sesionDeAccion(sp);
    if ('error' in s) return { ok: false, error: s.error };
    try {
      const lista = String(fd.get('remitentes') ?? '').split(/\r?\n/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (lista.length > 50) return { ok: false, error: 'Máximo 50 remitentes.' };
      const mala = lista.find((x) => !/^@?[a-z0-9._%+-]*@?[a-z0-9.-]+\.[a-z]{2,}$/.test(x) || x.length > 120);
      if (mala) return { ok: false, error: `«${mala.slice(0, 60)}» no parece un correo ni un dominio.` };
      await repo.configurarBuzon(s.tenantId, { remitentesPermitidos: [...new Set(lista)] });
      revalidatePath(RUTA);
      return { ok: true, mensaje: lista.length === 0 ? 'Sin lista: se aceptan correos de cualquier remitente (todos pasan por revisión).' : `Guardados ${lista.length} remitentes.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar los remitentes') };
    }
  }

  async function guardarExport(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await sesionDeAccion(sp);
    if ('error' in s) return { ok: false, error: s.error };
    try {
      const nombre = String(fd.get('nombre') ?? '').trim();
      const formato = String(fd.get('formato') ?? '');
      if (nombre === '' || nombre.length > 80) return { ok: false, error: 'El nombre es obligatorio (hasta 80 caracteres).' };
      if (formato !== 'csv' && formato !== 'json') return { ok: false, error: 'El formato es CSV o JSON.' };
      let crudo: unknown;
      try { crudo = JSON.parse(String(fd.get('config') ?? '')); } catch { return { ok: false, error: 'El mapeo no es un JSON válido.' }; }
      const v = validarConfigExport(crudo);
      if (!v.ok) return { ok: false, error: `El mapeo no es válido: ${v.errores.slice(0, 4).join(' · ')}` };
      await repo.guardarExportConfig(s.tenantId, { nombre, formato, config: v.config as unknown as Record<string, unknown> });
      revalidatePath(RUTA);
      return { ok: true, mensaje: `Formato «${nombre}» guardado. Ya aparece en las descargas.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar el formato') };
    }
  }

  async function borrarExport(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await sesionDeAccion(sp);
    if ('error' in s) return { ok: false, error: s.error };
    try {
      const id = String(fd.get('id') ?? '');
      if (!UUID.test(id)) return { ok: false, error: 'No se reconoce ese formato.' };
      await repo.borrarExportConfig(s.tenantId, id);
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Formato quitado.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'quitar el formato') };
    }
  }

  async function volverVersion(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await sesionDeAccion(sp);
    if ('error' in s) return { ok: false, error: s.error };
    try {
      const perfilId = String(fd.get('perfilId') ?? '');
      const version = Number(fd.get('version'));
      if (!UUID.test(perfilId) || !Number.isInteger(version) || version < 1) return { ok: false, error: 'No se reconoce esa versión.' };
      const ok = await repo.activarVersionPerfil(s.tenantId, perfilId, version);
      if (!ok) return { ok: false, error: 'Esa versión no existe en tu flota.' };
      revalidatePath(RUTA);
      return { ok: true, mensaje: `El perfil volvió a la versión ${version}. Las versiones nuevas no se borran.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'cambiar la versión') };
    }
  }

  return (
    <VistaDocumentos
      datos={datos}
      sufijo={sufijoTenant(sp)}
      apiSufijo={sufijoTenant(sp) ? `&${sufijoTenant(sp).slice(1)}` : ''}
      acciones={{ subir, procesar, activarBuzon, guardarRemitentes, guardarExport, borrarExport, volverVersion }}
    />
  );
}
