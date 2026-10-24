import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { DatoInvalido, mensajeParaPantalla } from '@/lib/likida/errores';
import { aprobarDocumento, abrirRevision, corregirCampos, crearViajeDeDocumento, eliminarDocumento, quitarRenglon, rechazarDocumento, reabrirDocumento, reintentarLectura } from '@/lib/likida/carta_porte_docs/bandeja';
import { flotaBajoPerfil, marcarSubidoAMano, prepararEnvioTms, MENSAJE_FUNCION_NO_DISPONIBLE } from '@/lib/likida/carta_porte_docs/envio';
import { esFlotaSimulada } from '@/lib/likida/carta_porte_docs/salida_simulada';
import { puertoSupabase } from '@/lib/likida/carta_porte_docs/catalogo_puerto';
import { proponerCatalogo, propuestaVacia, registrosDePropuesta, type LadoParte } from '@/lib/likida/carta_porte_docs/catalogo_pantalla';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { repoEnvios, type ErrorEnvio } from '@/lib/likida/carta_porte_docs/repo_envios';
import { detectarFormato, prepararContenido } from '@/lib/likida/carta_porte_docs/contenido';
import { cambiosDeFormulario } from '@/lib/likida/carta_porte_docs/formulario';
import { revisionDe } from '@/lib/likida/carta_porte_docs/presentacion';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import { reasignarRevisor } from '@/lib/likida/carta_porte_docs/revisor';
import { leerConfigSalida } from '@/lib/likida/carta_porte_docs/salida_config';
import { sufijoTenant } from '../../../sufijo';
import type { ResultadoAccion } from '../forma_accion';
import { VistaRevision, type CatalogoBanner, type OriginalVista, type RevisorVista } from './vista';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// La ruta REAL es dinámica (/dashboard/carta-porte/documentos/<uuid>); el gate usa la llave de su padre —
// misma área, mismos datos, mismo criterio que el borrador del complemento (ver visibilidad.ts).
const RUTA_PADRE = '/dashboard/carta-porte/documentos';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_FIRMA_S = 300;

/** Dónde falló el envío (hoja, fila, campo, código): el repositorio solo guarda la ubicación, nunca el valor. */
function motivoDeRechazo(e: ErrorEnvio | null): string | null {
  if (!e) return null;
  const partes = [e.hoja ? `hoja ${e.hoja}` : null, e.fila !== undefined ? `fila ${e.fila}` : null, e.campo ? `campo ${e.campo}` : null].filter(Boolean);
  const donde = partes.join(', ');
  return [donde, e.codigo ? `código ${e.codigo}` : null].filter(Boolean).join(' · ') || null;
}
async function originalDe(d: repo.DocumentoFila): Promise<OriginalVista> {
  if (d.purgadoEn || !d.storageRuta) return { tipo: 'nada', motivo: 'El archivo ya se borró por retención; solo quedan los datos leídos.' };
  if (d.estado === 'dividido') return { tipo: 'nada', motivo: 'El archivo se dividió en un documento por embarque; el contenido de cada uno está en su propia revisión.' };
  try {
    if (d.formato === 'imagen') return { tipo: 'imagen', url: await repo.firmarArchivo(d.storageRuta, TTL_FIRMA_S) };
    if (d.formato === 'pdf_escaneado') {
      // Un escaneo no tiene texto: se vuelve a renderizar a imagen para ponerlo al lado de lo leído.
      const bytes = await repo.descargarArchivo(d.storageRuta);
      const f = detectarFormato(bytes);
      if (f.ok) { const c = await prepararContenido(bytes, f.clase); if (c.imagenes.length > 0) return { tipo: 'imagenes', urls: c.imagenes }; }
      return { tipo: 'nada', motivo: 'No se pudo mostrar el escaneo.' };
    }
    if (d.textoExtracto) return { tipo: 'texto', texto: d.textoExtracto };
    return { tipo: 'nada', motivo: 'Este documento no tiene texto que mostrar.' };
  } catch (e) {
    logger.warn('carta_porte_docs.original_no_disponible', { documentoId: d.id, err: e instanceof Error ? e.message : String(e) });
    return { tipo: 'nada', motivo: 'No se pudo cargar el documento original. Los datos leídos sí están.' };
  }
}

export default async function PaginaRevision({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { tenantId, rol, userId } = await resolverTenantEfectivo(RUTA_PADRE, sp);
  if (!puedeVerRuta(rol, RUTA_PADRE)) redirect('/dashboard');
  if (!UUID.test(id)) notFound();

  // Un error de lectura LANZA (error boundary); null = no es de esta flota — 404 honesto.
  const previo = await repo.leerDocumento(tenantId, id);
  if (!previo) notFound();
  // La primera apertura arranca el tiempo de revisión medido (idempotente).
  const doc = previo.estado === 'por_revisar' ? await abrirRevision(tenantId, id, userId) : previo;

  const [original, operadores, eventos, viaje, linaje, hijos, envios, restringido] = await Promise.all([
    originalDe(doc),
    repo.operadoresDeFlota(tenantId),
    repo.listarEventos(tenantId, id),
    doc.viajeId ? repo.viajePorId(tenantId, doc.viajeId) : Promise.resolve(null),
    repo.linajeDeDocumentos(tenantId, [id]),
    doc.estado === 'dividido' ? repo.hijosDeDocumento(tenantId, id) : Promise.resolve([]),
    doc.estado === 'aprobado' ? repoEnvios.listarPorDocumento(tenantId, id) : Promise.resolve([]),
    flotaBajoPerfil(tenantId),
  ]);
  // El envío de la versión vigente (los descartados son de versiones viejas): de él depende qué botones del modo manual se ven.
  const envio = envios.find((e) => e.versionDoc === doc.version && e.estado !== 'descartado') ?? null;
  // De qué archivo nació este embarque (si nació de partir uno): su nombre para el enlace de regreso.
  const lin = linaje.get(id);
  const padre = lin?.rol === 'hijo' ? await repo.leerDocumento(tenantId, lin.padreId) : null;

  // Tras aprobar: lo que una persona tecleó y valdría la pena guardar en el catálogo del cliente. Es opcional, así que un
  // fallo al leerlo apaga el banner (y se loguea); jamás tumba la revisión.
  let catalogo: CatalogoBanner | null = null;
  if (doc.estado === 'aprobado' && doc.clienteId && doc.extraccion) {
    try {
      const [cat, clientes] = await Promise.all([repo.cargarCatalogoCliente(tenantId, doc.clienteId), repo.listarClientes(tenantId)]);
      const cliente = clientes.find((c) => c.id === doc.clienteId);
      const propuesta = proponerCatalogo(doc.extraccion, cat);
      if (cliente && !propuestaVacia(propuesta)) catalogo = { cliente: cliente.nombre, propuesta };
    } catch (e) {
      logger.warn('carta_porte_docs.catalogo_banner', { documentoId: id, err: e instanceof Error ? e.message : String(e) });
    }
  }

  // T-A3-31. Solo se pinta si la flota usa asignación; un fallo de lectura (p. ej. base sin la 0790) deja la pantalla como siempre.
  let revisor: RevisorVista | null = null;
  try {
    const [config, asignados, usuarios] = await Promise.all([leerConfigSalida(tenantId), repo.revisoresDeDocumentos(tenantId, [id]), repo.usuariosRevisores(tenantId)]);
    const actualId = asignados.get(id) ?? null;
    if (config.destinatarioRevisionUsuario !== null || actualId !== null) {
      revisor = { actualId, opciones: usuarios.map((u) => ({ id: u.id, nombre: u.nombre ?? u.email })) };
    }
  } catch (e) {
    logger.warn('carta_porte_docs.revisor_no_disponible', { documentoId: id, err: e instanceof Error ? e.message : String(e) });
  }

  const ruta = `${RUTA_PADRE}/${id}`;

  async function reasignar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA_PADRE, sp);
    if (!puedeVerRuta(s.rol, RUTA_PADRE)) return { ok: false, error: 'Tu rol no puede reasignar documentos de Carta Porte.' };
    try {
      if (String(fd.get('documentoId') ?? '') !== id) return { ok: false, error: 'La forma no corresponde a este documento. Recarga la pantalla.' };
      const crudo = String(fd.get('revisorId') ?? '');
      if (crudo !== '' && !UUID.test(crudo)) return { ok: false, error: 'No se reconoce a esa persona.' };
      const r = await reasignarRevisor(s.tenantId, id, crudo === '' ? null : crudo, { id: s.userId });
      revalidatePath(ruta); revalidatePath(RUTA_PADRE);
      return { ok: true, mensaje: r.cambio ? (r.usuarioId ? 'Caso reasignado.' : 'El caso quedó sin persona asignada: le toca a todos los revisores.') : 'Ya estaba asignado así.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'reasignar el caso') };
    }
  }

  /** Una sola acción atiende todos los botones: `intencion` dice cuál se apretó. */
  async function revisar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA_PADRE, sp);
    if (!puedeVerRuta(s.rol, RUTA_PADRE)) return { ok: false, error: 'Tu rol no puede revisar documentos de Carta Porte.' };
    try {
      const docId = String(fd.get('documentoId') ?? '');
      if (docId !== id) return { ok: false, error: 'La forma no corresponde a este documento. Recarga la pantalla.' };
      const version = Number(fd.get('version'));
      if (!Number.isInteger(version) || version < 1) return { ok: false, error: 'Falta la versión del documento. Recarga la pantalla.' };
      const intencion = String(fd.get('intencion') ?? '');
      const operadorId = String(fd.get('operadorId') ?? '');
      const actor = { id: s.userId };
      // Bajo el perfil restringido no hay operador de viaje: el campo, si llega, se ignora.
      const restringidoAccion = await flotaBajoPerfil(s.tenantId);
      const operador = !restringidoAccion && UUID.test(operadorId) ? operadorId : null;

      // Los cambios escritos viajan con CASI todas las intenciones: la forma entera es lo que la persona vio.
      const aplicarForma = async (versionVista: number): Promise<number> => {
        const d = await repo.leerDocumento(s.tenantId, id);
        if (!d) throw new DatoInvalido('Ese documento no está en tu flota, o alguien lo borró. Recarga la pantalla.');
        if (!d.extraccion) throw new DatoInvalido('El documento todavía no tiene datos leídos.');
        const { cambios } = cambiosDeFormulario(fd, d.extraccion);
        const antes = d.version;
        if (antes !== versionVista) throw new DatoInvalido('Otra persona cambió este documento mientras lo revisabas. Recarga la pantalla y vuelve a intentarlo.');
        const r = await corregirCampos(s.tenantId, id, versionVista, cambios, s.userId);
        return r.version;
      };

      if (intencion === 'guardar') {
        await aplicarForma(version);
        revalidatePath(ruta);
        return { ok: true, mensaje: 'Cambios guardados. La validación ya los refleja.' };
      }
      if (intencion.startsWith('quitar:')) {
        const i = Number(intencion.slice(7));
        const nueva = await aplicarForma(version);
        await quitarRenglon(s.tenantId, id, nueva, i, s.userId);
        revalidatePath(ruta);
        return { ok: true, mensaje: `Se quitó la mercancía ${i + 1}.` };
      }
      if (intencion === 'aprobar') {
        const nueva = await aplicarForma(version);
        const r = await aprobarDocumento(s.tenantId, id, nueva, actor, { operadorId: operador });
        revalidatePath(ruta); revalidatePath(RUTA_PADRE);
        const detalles: string[] = [];
        if (r.salida?.ok) {
          detalles.push(r.salida.accion === 'creado' ? `Viaje ${r.salida.folio} creado con ${r.salida.mercancias} mercancía(s).` : `El viaje ${r.salida.folio} ya existía: se le completaron ${r.salida.columnasCompletadas} datos y ${r.salida.mercancias} mercancía(s).`);
          detalles.push(...r.salida.advertencias);
          if (r.salida.borrador) detalles.push(r.salida.borrador.armado ? 'El borrador del complemento Carta Porte 3.1 ya se puede armar.' : `Al complemento todavía le falta: ${r.salida.borrador.faltantes.slice(0, 3).join(' · ') || 'revisar el checklist'}.`);
        } else if (r.salida) detalles.push(`Sin viaje todavía: ${r.salida.mensaje}`);
        if (r.perfil.accion === 'creado') detalles.push('Likida recordó el formato de este cliente: la próxima vez lo lee sin modelo.');
        else if (r.perfil.accion === 'nueva_version') detalles.push(`El perfil del cliente aprendió de tus correcciones (versión ${r.perfil.version}).`);
        return { ok: true, mensaje: 'Documento aprobado.', detalles };
      }
      if (intencion === 'rechazar') {
        await rechazarDocumento(s.tenantId, id, version, String(fd.get('motivo') ?? ''), s.userId, new Date(), String(fd.get('causa') ?? ''));
        revalidatePath(ruta); revalidatePath(RUTA_PADRE);
        return { ok: true, mensaje: 'Documento rechazado.' };
      }
      if (intencion === 'reintentar') {
        await reintentarLectura(s.tenantId, id, version, s.userId);
        revalidatePath(ruta); revalidatePath(RUTA_PADRE);
        return { ok: true, mensaje: 'Listo: el documento volvió a la cola y se vuelve a leer en unos minutos.' };
      }
      if (intencion === 'reabrir') {
        await reabrirDocumento(s.tenantId, id, version, s.userId);
        revalidatePath(ruta); revalidatePath(RUTA_PADRE);
        return { ok: true, mensaje: 'Documento reabierto: ya se puede corregir.' };
      }
      if (intencion === 'eliminar') {
        // Borrar datos personales de terceros es un acto de administración, no de revisión.
        if (!puedeAdministrar(s.rol)) return { ok: false, error: 'Solo quien administra la flota puede eliminar un documento.' };
        await eliminarDocumento(s.tenantId, id, actor);
        revalidatePath(RUTA_PADRE);
        return { ok: true, mensaje: 'Documento y archivo eliminados. Vuelve a la bandeja.' };
      }
      if (intencion === 'subido_a_mano') {
        const d = await repo.leerDocumento(s.tenantId, id);
        if (!d) throw new DatoInvalido('Ese documento no está en tu flota, o alguien lo borró. Recarga la pantalla.');
        const r = await marcarSubidoAMano(s.tenantId, d, version, actor, String(fd.get('referenciaTms') ?? ''));
        revalidatePath(ruta); revalidatePath(RUTA_PADRE);
        return r.ok
          ? { ok: true, mensaje: r.yaEstaba ? 'Ya estaba marcada como subida a mano.' : 'Listo: quedó registrado que la plantilla se subió a mano. Likida no la volverá a enviar.' }
          : { ok: false, error: r.mensaje };
      }
      if (intencion === 'preparar_envio') {
        // A37-A3-18: un fallo de base entre aprobar y preparar el envío dejaba el documento aprobado sin envío y sin acción.
        if (!restringidoAccion) return { ok: false, error: MENSAJE_FUNCION_NO_DISPONIBLE };
        const d = await repo.leerDocumento(s.tenantId, id);
        if (!d) throw new DatoInvalido('Ese documento no está en tu flota, o alguien lo borró. Recarga la pantalla.');
        if (d.version !== version) return { ok: false, error: 'Otra persona cambió este documento mientras lo revisabas. Recarga la pantalla y vuelve a intentarlo.' };
        const r = await prepararEnvioTms(s.tenantId, d, actor);
        revalidatePath(ruta); revalidatePath(RUTA_PADRE);
        return r.ok ? { ok: true, mensaje: r.creado ? 'Envío preparado: el sistema lo enviará al TMS.' : 'El envío ya estaba preparado.' } : { ok: false, error: r.mensaje };
      }
      if (intencion === 'guardar_catalogo') {
        // Se recalcula con lo que hay en la base (no con lo que dice el navegador): del formulario solo salen qué filas se
        // marcaron y el SKU que la persona confirmó.
        const d = await repo.leerDocumento(s.tenantId, id);
        if (!d) throw new DatoInvalido('Ese documento no está en tu flota, o alguien lo borró. Recarga la pantalla.');
        if (d.estado !== 'aprobado' || !d.clienteId || !d.extraccion) return { ok: false, error: 'Solo se guarda en el catálogo lo de un documento aprobado y ligado a un cliente.' };
        if (d.version !== version) throw new DatoInvalido('Otra persona cambió este documento mientras lo revisabas. Recarga la pantalla y vuelve a intentarlo.');
        const propuesta = proponerCatalogo(d.extraccion, await repo.cargarCatalogoCliente(s.tenantId, d.clienteId));
        const productos = fd.getAll('cat_prod').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 0)
          .map((indice) => ({ indice, sku: String(fd.get(`cat_sku_${indice}`) ?? '') }));
        const partes = fd.getAll('cat_parte').map(String).filter((v): v is LadoParte => v === 'origen' || v === 'destino');
        const r = registrosDePropuesta(propuesta, d.clienteId, { productos, partes });
        if (!r.ok) return { ok: false, error: r.errores.join(' ') };
        const puerto = puertoSupabase();
        if (r.productos.length > 0) await puerto.aplicarLote(s.tenantId, 'producto', r.productos, s.userId);
        if (r.partes.length > 0) await puerto.aplicarLote(s.tenantId, 'parte', r.partes, s.userId);
        // Solo conteos: la bitácora sobrevive a un borrado ARCO y no lleva datos de terceros.
        await anotarBitacora(
          { tenantId: s.tenantId, actor: actor, accion: 'ccp.catalogo_desde_documento', entidad: 'tenant', entidadId: s.tenantId, detalle: { productos: r.productos.length, partes: r.partes.length } },
          { evento: 'carta_porte_docs.bitacora_no_escribio' },
        );
        revalidatePath(ruta);
        return { ok: true, mensaje: `Guardado en el catálogo: ${r.productos.length} producto(s) y ${r.partes.length} remitente(s) o destinatario(s). El próximo documento igual saldrá con estos datos.` };
      }
      if (intencion === 'viaje') {
        // Doble defensa: aunque la pantalla no ofrezca el botón, la acción se niega bajo el perfil (y `crearViajeDeDocumento` también).
        if (restringidoAccion) return { ok: false, error: MENSAJE_FUNCION_NO_DISPONIBLE };
        const r = await crearViajeDeDocumento(s.tenantId, id, actor, operador);
        revalidatePath(ruta);
        return r.ok
          ? { ok: true, mensaje: r.accion === 'creado' ? `Viaje ${r.folio} creado.` : `Viaje ${r.folio} actualizado.`, detalles: r.advertencias }
          : { ok: false, error: r.mensaje };
      }
      return { ok: false, error: 'No reconozco esa acción.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar la revisión') };
    }
  }

  return (
    <VistaRevision
      doc={doc}
      revision={revisionDe(doc)}
      original={original}
      operadores={restringido ? [] : operadores.filter((o) => o.activo).map((o) => ({ id: o.id, nombre: o.nombre }))}
      eventos={eventos.map((e) => ({ tipo: e.tipo, creadoEn: e.creadoEn }))}
      acciones={{ revisar, reasignar }}
      revisor={revisor}
      sufijo={sufijoTenant(sp)}
      envio={envio ? { estado: envio.estado, proximaRevision: envio.proximaRevision, motivo: motivoDeRechazo(envio.ultimoError), ...(esFlotaSimulada(tenantId) ? { simulado: true } : {}) } : null}
      perfilRestringido={restringido}
      catalogo={catalogo}
      salida={viaje ? { folio: viaje.folio ?? viaje.id.slice(0, 8) } : null}
      puedeEliminar={puedeAdministrar(rol)}
      embarque={lin?.rol === 'hijo' && padre ? { indice: lin.indice ?? 0, total: lin.total, clave: lin.clave, padreId: padre.id, padreNombre: padre.nombreArchivo } : null}
      hijos={hijos.map((h) => ({ id: h.documento.id, indice: h.indice, clave: h.clave, estado: h.documento.estado, nombre: h.documento.nombreArchivo, bloqueos: h.documento.validacion?.bloqueos ?? 0, porConfirmar: h.documento.validacion?.porConfirmar ?? 0 }))}
    />
  );
}
