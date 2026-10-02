import { createHash } from 'node:crypto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { leerExportWhatsapp, type MensajeHistorial } from './export_whatsapp';
import { esZip, textoDeZip } from './zip_lector';
import { borrarGrupo, crearGrupo, grupoDeFlota, guardarImportacion, marcarGrupoCritico } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DE LA PANTALLA «GRUPOS E HISTÓRICO» DEL VIGÍA — con puertos para probarlas.
//
// Permiso: dar de alta grupos, marcarlos críticos y subir histórico es decidir sobre datos de clientes finales → el dueño
// (`puedeAdministrar`), comprobado AQUÍ además de en la página (una acción de servidor es un endpoint). El tenant sale de la
// sesión, nunca del formulario. La bitácora lleva ids y conteos: nunca nombres de personas, teléfonos ni texto del chat.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoGrupos = { ok: true; mensaje: string } | { ok: false; error: string };

export interface ContextoGrupos { tenantId: string; rol: string; usuarioId: string | null; email: string | null }

export interface DepsGrupos {
  crearGrupo: typeof crearGrupo;
  marcarCritico: typeof marcarGrupoCritico;
  grupoDeFlota: typeof grupoDeFlota;
  guardarImportacion: typeof guardarImportacion;
  borrarGrupo: typeof borrarGrupo;
  bitacora: typeof anotarBitacora;
}
export const depsGruposReales: DepsGrupos = {
  crearGrupo, marcarCritico: marcarGrupoCritico, grupoDeFlota, guardarImportacion, borrarGrupo, bitacora: anotarBitacora,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIN_PERMISO: ResultadoGrupos = { ok: false, error: 'Solo el dueño de la flota administra los grupos y el histórico de sus clientes.' };

/** El archivo más grande que se acepta desde el formulario (el límite de las acciones de servidor es 10 MB). */
export const MAX_ARCHIVO_BYTES = 9 * 1024 * 1024;

const texto = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function altaGrupoPanel(ctx: ContextoGrupos, fd: FormData, d: DepsGrupos = depsGruposReales): Promise<ResultadoGrupos> {
  if (!puedeAdministrar(ctx.rol)) return SIN_PERMISO;
  const clienteId = texto(fd, 'clienteId');
  const nombre = texto(fd, 'nombre').replace(/\s+/g, ' ');
  if (!UUID.test(clienteId)) return { ok: false, error: 'Elige el cliente del grupo.' };
  if (nombre.length < 1 || nombre.length > 120) return { ok: false, error: 'Escribe el nombre del grupo tal como aparece en WhatsApp (hasta 120 letras).' };
  try {
    const r = await d.crearGrupo(ctx.tenantId, { clienteId, nombre, critico: fd.get('critico') === 'on' });
    if (!r.ok) return r;
    await d.bitacora({ tenantId: ctx.tenantId, actor: { id: ctx.usuarioId, email: ctx.email }, accion: 'vigia.grupo_creado', entidad: 'vigia_grupo', entidadId: r.id, detalle: { critico: fd.get('critico') === 'on' } });
    return { ok: true, mensaje: 'Grupo agregado.' };
  } catch (e) {
    logger.error('vigia.grupo_alta_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'agregar el grupo') };
  }
}

export async function criticoGrupoPanel(ctx: ContextoGrupos, fd: FormData, d: DepsGrupos = depsGruposReales): Promise<ResultadoGrupos> {
  if (!puedeAdministrar(ctx.rol)) return SIN_PERMISO;
  const id = texto(fd, 'grupoId');
  if (!UUID.test(id)) return { ok: false, error: 'Grupo no válido.' };
  const critico = texto(fd, 'critico') === 'si';
  try {
    if (!(await d.marcarCritico(ctx.tenantId, id, critico))) return { ok: false, error: 'No encuentro ese grupo en tu flota.' };
    await d.bitacora({ tenantId: ctx.tenantId, actor: { id: ctx.usuarioId, email: ctx.email }, accion: 'vigia.grupo_critico', entidad: 'vigia_grupo', entidadId: id, detalle: { critico } });
    return { ok: true, mensaje: critico ? 'Grupo marcado como crítico: ese cliente se atiende con el plazo corto.' : 'Grupo desmarcado como crítico.' };
  } catch (e) {
    logger.error('vigia.grupo_critico_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'cambiar el grupo') };
  }
}

export async function borrarGrupoPanel(ctx: ContextoGrupos, fd: FormData, d: DepsGrupos = depsGruposReales): Promise<ResultadoGrupos> {
  if (!puedeAdministrar(ctx.rol)) return SIN_PERMISO;
  const id = texto(fd, 'grupoId');
  if (!UUID.test(id)) return { ok: false, error: 'Grupo no válido.' };
  try {
    if (!(await d.borrarGrupo(ctx.tenantId, id))) return { ok: false, error: 'No encuentro ese grupo en tu flota.' };
    await d.bitacora({ tenantId: ctx.tenantId, actor: { id: ctx.usuarioId, email: ctx.email }, accion: 'vigia.grupo_borrado', entidad: 'vigia_grupo', entidadId: id, detalle: {} });
    return { ok: true, mensaje: 'Grupo borrado con todo su histórico.' };
  } catch (e) {
    logger.error('vigia.grupo_borrar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'borrar el grupo') };
  }
}

/** Los nombres del equipo, separados por coma o salto de línea, sin duplicados ni vacíos. */
export function nombresDelEquipo(crudo: string): string[] {
  return [...new Set(crudo.split(/[,\n;]/).map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 100);
}

export interface ArchivoSubido { nombre: string; bytes: Uint8Array }

/**
 * Importa el chat exportado de un grupo. El equipo se declara POR NOMBRE (como sale en el chat): todo otro autor es cliente; si
 * no se declara ninguno, se rechaza (sin saber quién es la flota, «respuestas del equipo» y «tiempos de respuesta» serían inventados).
 */
export async function importarHistorialPanel(ctx: ContextoGrupos, fd: FormData, archivo: ArchivoSubido | null, d: DepsGrupos = depsGruposReales): Promise<ResultadoGrupos> {
  if (!puedeAdministrar(ctx.rol)) return SIN_PERMISO;
  const grupoId = texto(fd, 'grupoId');
  if (!UUID.test(grupoId)) return { ok: false, error: 'Elige el grupo al que pertenece el chat.' };
  const equipo = nombresDelEquipo(String(fd.get('equipo') ?? ''));
  if (equipo.length === 0) return { ok: false, error: 'Escribe los nombres de tu equipo tal como salen en el chat (separados por coma). Sin eso no se puede distinguir lo que contestó tu gente de lo que escribió el cliente.' };
  if (!archivo || archivo.bytes.length === 0) return { ok: false, error: 'Adjunta el archivo del chat exportado (.txt o .zip).' };
  if (archivo.bytes.length > MAX_ARCHIVO_BYTES) return { ok: false, error: 'El archivo pesa más de 9 MB. Exporta el chat «sin multimedia» o divídelo por periodos.' };

  let crudo: string;
  if (esZip(archivo.bytes)) {
    const z = textoDeZip(archivo.bytes);
    if (!z.ok) return { ok: false, error: z.error };
    crudo = z.texto;
  } else if (/\.txt$/i.test(archivo.nombre)) {
    crudo = new TextDecoder('utf-8').decode(archivo.bytes);
  } else {
    return { ok: false, error: 'El archivo debe ser el .txt de «Exportar chat» o el .zip que lo trae.' };
  }

  try {
    const grupo = await d.grupoDeFlota(ctx.tenantId, grupoId);
    if (!grupo) return { ok: false, error: 'No encuentro ese grupo en tu flota.' };
    const lectura = leerExportWhatsapp(crudo, { equipo, sal: ctx.tenantId });
    if (lectura.mensajes.length === 0) {
      return { ok: false, error: 'No pude leer ningún mensaje en ese archivo. Revisa que sea el chat exportado de WhatsApp (en iPhone o Android) y no una captura ni otro documento.' };
    }
    const hayCliente = lectura.mensajes.some((m: MensajeHistorial) => m.rol === 'cliente');
    const hayEquipo = lectura.mensajes.some((m: MensajeHistorial) => m.rol === 'equipo');
    if (!hayCliente || !hayEquipo) {
      return { ok: false, error: hayEquipo
        ? 'Todos los mensajes salieron como de tu equipo: revisa que los nombres que escribiste sean solo los de tu gente.'
        : 'Ningún mensaje coincide con los nombres de tu equipo: escríbelos exactamente como salen en el chat.' };
    }
    const sha256 = createHash('sha256').update(crudo).digest('hex');
    const r = await d.guardarImportacion(ctx.tenantId, { grupoId, sha256, usuarioId: ctx.usuarioId, mensajes: lectura.mensajes });
    if (!r.ok) return { ok: false, error: 'Ese mismo chat ya se había subido a este grupo: no se duplicó nada.' };
    await d.bitacora({
      tenantId: ctx.tenantId, actor: { id: ctx.usuarioId, email: ctx.email }, accion: 'vigia.historial_importado', entidad: 'vigia_historial', entidadId: r.id,
      detalle: { grupo: grupoId, mensajes: lectura.mensajes.length, descartados: lectura.descartados, autores: lectura.autores, fechasInvalidas: lectura.fechasInvalidas },
    });
    const notas = [`${lectura.mensajes.length} mensajes de ${lectura.autores} personas`];
    if (lectura.descartados > 0) notas.push(`${lectura.descartados} líneas de sistema o multimedia omitidas`);
    if (lectura.fechasInvalidas > 0) notas.push(`${lectura.fechasInvalidas} con fecha ilegible`);
    return { ok: true, mensaje: `Histórico guardado en «${grupo.nombre}»: ${notas.join(' · ')}. Teléfonos, correos y nombres de autores no se guardaron.` };
  } catch (e) {
    logger.error('vigia.historial_importar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'guardar el histórico') };
  }
}
