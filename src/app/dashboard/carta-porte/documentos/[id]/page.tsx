import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { DatoInvalido, mensajeParaPantalla } from '@/lib/likida/errores';
import { aprobarDocumento, abrirRevision, corregirCampos, crearViajeDeDocumento, eliminarDocumento, quitarRenglon, rechazarDocumento, reabrirDocumento } from '@/lib/likida/carta_porte_docs/bandeja';
import { detectarFormato, prepararContenido } from '@/lib/likida/carta_porte_docs/contenido';
import { cambiosDeFormulario } from '@/lib/likida/carta_porte_docs/formulario';
import { revisionDe } from '@/lib/likida/carta_porte_docs/presentacion';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import { sufijoTenant } from '../../../sufijo';
import type { ResultadoAccion } from '../forma_accion';
import { VistaRevision, type OriginalVista } from './vista';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// La ruta REAL es dinámica (/dashboard/carta-porte/documentos/<uuid>); el gate usa la llave de su padre —
// misma área, mismos datos, mismo criterio que el borrador del complemento (ver visibilidad.ts).
const RUTA_PADRE = '/dashboard/carta-porte/documentos';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_FIRMA_S = 300;

async function originalDe(d: repo.DocumentoFila): Promise<OriginalVista> {
  if (d.purgadoEn || !d.storageRuta) return { tipo: 'nada', motivo: 'El archivo ya se borró por retención; solo quedan los datos leídos.' };
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

  const [original, operadores, eventos, viaje] = await Promise.all([
    originalDe(doc),
    repo.operadoresDeFlota(tenantId),
    repo.listarEventos(tenantId, id),
    doc.viajeId ? repo.viajePorId(tenantId, doc.viajeId) : Promise.resolve(null),
  ]);

  const ruta = `${RUTA_PADRE}/${id}`;

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
      const operador = UUID.test(operadorId) ? operadorId : null;

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
        await rechazarDocumento(s.tenantId, id, version, String(fd.get('motivo') ?? ''), s.userId);
        revalidatePath(ruta); revalidatePath(RUTA_PADRE);
        return { ok: true, mensaje: 'Documento rechazado.' };
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
      if (intencion === 'viaje') {
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
      operadores={operadores.filter((o) => o.activo).map((o) => ({ id: o.id, nombre: o.nombre }))}
      eventos={eventos.map((e) => ({ tipo: e.tipo, creadoEn: e.creadoEn }))}
      acciones={{ revisar }}
      sufijo={sufijoTenant(sp)}
      salida={viaje ? { folio: viaje.folio ?? viaje.id.slice(0, 8) } : null}
      puedeEliminar={puedeAdministrar(rol)}
    />
  );
}
