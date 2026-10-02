import { puedeAsignar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { avisoDeTope, matrizDeArchivo, MAX_ARCHIVO_BYTES } from '../importacion/archivo';
import { parsearMatrizConvenios } from './importador';
import { despacharInstrucciones, type ResultadoEnvioInstrucciones } from './envio';
import { validarEntradaConvenio, type EntradaConvenio } from './edicion';
import {
  cambiarEstadoConvenio, ConveniosNoDisponibles, corregirConvenioDelViaje, EdicionNoDisponible, guardarConvenio, importarConvenios,
  refrescarViajesDeConvenio, type ResultadoCorregir,
} from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DE LA PANTALLA DE CONVENIOS — la lógica de las acciones de servidor, con puertos para poder probarla:
// el permiso, el archivo, el todo-o-nada y los mensajes en palabras.
//
// El permiso se comprueba AQUÍ (una acción de servidor es un endpoint): dueño, jefe de tráfico y superadmin importan y
// archivan. La tarifa y los requisitos de cobro son DINERO: solo quien ve el área de dinero los puede importar (el
// archivo con esas columnas se rechaza entero para los demás, no se descartan en silencio). El `tenantId` sale de la
// SESIÓN, nunca del formulario.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoAccionConvenio =
  | { ok: true; mensaje: string }
  | { ok: false; error: string; detalles?: string[] };

export interface DepsConvenios {
  importar: typeof importarConvenios;
  estado: typeof cambiarEstadoConvenio;
}
export const depsConveniosReales: DepsConvenios = { importar: importarConvenios, estado: cambiarEstadoConvenio };

export interface ContextoConvenios { tenantId: string; rol: string }

const SIN_PERMISO = 'Solo el dueño de la flota o el jefe de tráfico editan los convenios.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DETALLES = 30;
const NO_DISPONIBLE = 'Los convenios todavía no están disponibles en tu cuenta: falta aplicar la actualización de la base (0580). Avísanos.';

/**
 * SheetJS decodifica un CSV sin BOM como Latin-1: un archivo UTF-8 («Categoría», «señal») llegaba como «CategorÃ­a» y la
 * columna no se reconocía. Si los bytes son texto UTF-8 válido se les pone el BOM (que SheetJS sí respeta); si no lo son
 * (el «CSV» legado de Excel, Windows-1252) se dejan como están, que es justo como SheetJS los lee bien. Un Excel real
 * (.xlsx es un zip «PK», .xls un compuesto «D0CF») no se toca.
 */
export function bytesParaLector(bytes: ArrayBuffer): ArrayBuffer {
  const v = new Uint8Array(bytes);
  const esZip = v[0] === 0x50 && v[1] === 0x4b;
  const esXls = v[0] === 0xd0 && v[1] === 0xcf;
  if (esZip || esXls) return bytes;
  if (v[0] === 0xef && v[1] === 0xbb && v[2] === 0xbf) return bytes; // ya trae BOM
  try {
    const texto = new TextDecoder('utf-8', { fatal: true }).decode(v);
    return new TextEncoder().encode(`\uFEFF${texto}`).buffer as ArrayBuffer;
  } catch {
    return bytes;
  }
}

export async function importarArchivoDelPanel(
  ctx: ContextoConvenios,
  entrada: { bytes: ArrayBuffer | null; texto: string },
  d: DepsConvenios = depsConveniosReales,
): Promise<ResultadoAccionConvenio> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  const bytes = entrada.bytes && entrada.bytes.byteLength > 0 ? entrada.bytes : entrada.texto.trim() !== '' ? new TextEncoder().encode(entrada.texto).buffer as ArrayBuffer : null;
  if (!bytes) return { ok: false, error: 'Sube un archivo (CSV o Excel) o pega su contenido.' };
  if (bytes.byteLength > MAX_ARCHIVO_BYTES) return { ok: false, error: 'El archivo pesa más de 4 MB: divídelo en partes.' };

  let matriz: unknown[][];
  try {
    matriz = matrizDeArchivo(bytesParaLector(bytes));
  } catch {
    return { ok: false, error: 'No pude leer el archivo. Guárdalo como CSV o como Excel (.xlsx) y vuelve a subirlo.' };
  }
  const tope = avisoDeTope(matriz);
  if (tope) return { ok: false, error: tope.motivo };

  const conFinanzas = puedeVerArea(ctx.rol, 'dinero');
  const parseado = parsearMatrizConvenios(matriz, { puedeVerFinanzas: conFinanzas });
  if (parseado.errores.length > 0) {
    const n = parseado.errores.length;
    return {
      ok: false, error: `No se importó nada: ${n} problema${n === 1 ? '' : 's'} en el archivo.`,
      detalles: parseado.errores.slice(0, MAX_DETALLES).map((e) => (e.fila > 0 ? `Fila ${e.fila}: ${e.motivo}` : e.motivo)),
    };
  }
  try {
    const r = await d.importar(ctx.tenantId, parseado.convenios, { conFinanzas });
    if (!r.ok) return { ok: false, error: 'No se importó nada: revisa estos puntos.', detalles: r.errores.slice(0, MAX_DETALLES).map((e) => `Fila ${e.fila}: ${e.motivo}`) };
    return {
      ok: true,
      mensaje: `Importado: ${r.creados} convenio${r.creados === 1 ? '' : 's'} nuevo${r.creados === 1 ? '' : 's'}, ${r.actualizados} actualizado${r.actualizados === 1 ? '' : 's'} y ${r.instrucciones} instrucci${r.instrucciones === 1 ? 'ón' : 'ones'}.`,
    };
  } catch (e) {
    if (e instanceof ConveniosNoDisponibles) return { ok: false, error: NO_DISPONIBLE };
    logger.error('convenios.importar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude importar ahorita. Lo ya guardado se conserva; vuelve a subir el mismo archivo en un momento (no duplica nada).' };
  }
}

export async function archivarConvenioDelPanel(ctx: ContextoConvenios, id: string, activo: boolean, d: DepsConvenios = depsConveniosReales): Promise<ResultadoAccionConvenio> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  if (!UUID.test(id)) return { ok: false, error: 'No reconozco el convenio.' };
  try {
    const hecho = await d.estado(ctx.tenantId, id.toLowerCase(), activo);
    return hecho
      ? { ok: true, mensaje: activo ? 'Convenio reactivado.' : 'Convenio archivado: los viajes nuevos ya no lo usan; los ya despachados conservan sus instrucciones.' }
      : { ok: false, error: 'Ese convenio ya no existe.' };
  } catch (e) {
    if (e instanceof ConveniosNoDisponibles) return { ok: false, error: NO_DISPONIBLE };
    logger.error('convenios.estado_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude guardarlo ahorita. Intenta de nuevo en un momento.' };
  }
}

// ── CORREGIR A MANO EL CONVENIO DE UN VIAJE ─────────────────────────────────

export interface DepsCorregirConvenio {
  corregir: typeof corregirConvenioDelViaje;
  enviar: (tenantId: string, viajeId: string) => Promise<ResultadoEnvioInstrucciones>;
}
export const depsCorregirReales: DepsCorregirConvenio = { corregir: corregirConvenioDelViaje, enviar: (t, v) => despacharInstrucciones(t, v) };

const FRASE_ENVIO: Partial<Record<ResultadoEnvioInstrucciones['estado'], string>> = {
  enviado: 'Ya se le mandaron al operador.',
  sin_instrucciones: 'Ese convenio no trae instrucciones para mandar al despachar; las de acercamiento le llegarán al acercarse a la planta.',
  sin_destinatario: 'El viaje no tiene operador con teléfono: no se mandó nada.',
  viaje_cerrado: 'El viaje ya está liquidado: no se mandó nada.',
  rechazado: 'WhatsApp no aceptó el mensaje; revisa las plantillas de Meta y vuelve a intentarlo desde aquí.',
  fallo: 'No pude mandárselas ahorita; vuelve a intentarlo en un momento.',
  ya_enviado: 'Ya se le habían mandado.',
  perdido: 'Otro proceso ya las estaba mandando.',
};

const MENSAJE_CORREGIR: Record<Exclude<ResultadoCorregir['estado'], 'ok'>, string> = {
  viaje_no_encontrado: 'Ese viaje ya no existe.',
  viaje_cerrado: 'Ese viaje ya está liquidado: su convenio ya no se corrige.',
  sin_cliente: 'Ese viaje no tiene cliente: sin cliente no hay convenio que elegir. Asígnale uno primero.',
  convenio_no_valido: 'Ese convenio no es de este cliente o está archivado. Elige uno de la lista.',
};

/**
 * La oficina corrige el convenio ligado a un viaje: `convenioId` vacío = «sin convenio». Con `reenviar`, las instrucciones del
 * convenio correcto se mandan de nuevo al operador (claim, ventana de 24 h y plantilla como siempre). El permiso es el de editar
 * convenios (dueño y jefe de tráfico) y el tenant sale de la sesión.
 */
export async function corregirConvenioDelViajeDelPanel(
  ctx: ContextoConvenios, entrada: { viajeId: string; convenioId: string; reenviar: boolean }, d: DepsCorregirConvenio = depsCorregirReales,
): Promise<ResultadoAccionConvenio> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  const viajeId = entrada.viajeId.trim().toLowerCase();
  const convenioId = entrada.convenioId.trim().toLowerCase();
  if (!UUID.test(viajeId)) return { ok: false, error: 'No reconozco el viaje.' };
  if (convenioId !== '' && !UUID.test(convenioId)) return { ok: false, error: 'No reconozco el convenio.' };
  try {
    const r = await d.corregir(ctx.tenantId, viajeId, convenioId === '' ? null : convenioId, { reenviar: entrada.reenviar });
    if (r.estado !== 'ok') return { ok: false, error: MENSAJE_CORREGIR[r.estado] };
    const que = r.convenioNombre ? `Convenio del viaje: «${r.convenioNombre}» (${r.instrucciones} instrucci${r.instrucciones === 1 ? 'ón' : 'ones'}).` : 'El viaje quedó sin convenio: no se le mandarán instrucciones.';
    const manual = 'Quedó como corrección manual: el despacho automático ya no lo cambia.';
    if (!entrada.reenviar || !r.convenioNombre) return { ok: true, mensaje: `${que} ${manual}` };
    const envio = await d.enviar(ctx.tenantId, viajeId);
    return { ok: true, mensaje: `${que} ${FRASE_ENVIO[envio.estado] ?? 'Las instrucciones de acercamiento le llegarán al acercarse a la planta.'} ${manual}` };
  } catch (e) {
    if (e instanceof ConveniosNoDisponibles) return { ok: false, error: NO_DISPONIBLE };
    logger.error('convenios.corregir_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude guardar la corrección ahorita. Intenta de nuevo en un momento.' };
  }
}

// ── ALTA Y EDICIÓN EN PANTALLA ──────────────────────────────────────────────

export interface DepsGuardarConvenio {
  guardar: typeof guardarConvenio;
  refrescar: typeof refrescarViajesDeConvenio;
  /** Vuelve a mandar el despacho de UN viaje (con su claim, la ventana de 24 h y la plantilla de siempre). */
  enviar: (tenantId: string, viajeId: string) => Promise<ResultadoEnvioInstrucciones>;
}
export const depsGuardarReales: DepsGuardarConvenio = {
  guardar: guardarConvenio, refrescar: refrescarViajesDeConvenio,
  enviar: (t, v) => despacharInstrucciones(t, v, undefined, undefined, { actualizado: true }),
};

const NO_DISPONIBLE_EDICION = 'La edición de convenios en pantalla todavía no está disponible en tu cuenta: falta aplicar la actualización de la base (0656). Mientras tanto puedes importar el archivo.';
const MENSAJE_GUARDAR: Record<'conflicto' | 'no_existe' | 'duplicado' | 'referencia_invalida' | 'invalida', string> = {
  conflicto: 'Alguien más cambió este convenio mientras lo editabas (o se volvió a importar el archivo). No se guardó nada: recarga la página, revisa la versión actual y vuelve a aplicar tu cambio.',
  no_existe: 'Ese convenio ya no existe.',
  duplicado: 'Ya hay un convenio con ese nombre para ese cliente: usa otro nombre o edita el que ya existe.',
  referencia_invalida: 'El cliente o el sitio elegido no es de tu flota. Elígelo de la lista.',
  invalida: 'La base rechazó un dato del convenio: revisa las fechas y los textos.',
};

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

/**
 * Alta o edición de un convenio y de su lista de instrucciones, sin volver a subir el Excel. El permiso es el de editar convenios
 * (dueño y jefe de tráfico) y el tenant sale de la sesión. Valida TODO antes de escribir y guarda en una sola transacción: un
 * fallo no deja el convenio a medio editar. `llevarAViajes` (opt-in) retoma la foto de los viajes en curso de ESE convenio y,
 * con `reenviar`, vuelve a mandar el despacho a los operadores que ya lo habían recibido; los de acercamiento ya avisados no se
 * repiten. Un fallo al llevarlo a los viajes NO deshace lo guardado y se dice aparte.
 */
export async function guardarConvenioDelPanel(
  ctx: ContextoConvenios, entrada: EntradaConvenio, d: DepsGuardarConvenio = depsGuardarReales,
): Promise<ResultadoAccionConvenio> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  const v = validarEntradaConvenio(entrada);
  if (!v.ok) {
    const n = v.errores.length;
    return { ok: false, error: `No se guardó nada: ${n} problema${n === 1 ? '' : 's'} en el formulario.`, detalles: v.errores.slice(0, MAX_DETALLES) };
  }
  const datos = v.datos;
  let guardado;
  try {
    guardado = await d.guardar(ctx.tenantId, datos);
  } catch (e) {
    if (e instanceof EdicionNoDisponible) return { ok: false, error: NO_DISPONIBLE_EDICION };
    if (e instanceof ConveniosNoDisponibles) return { ok: false, error: NO_DISPONIBLE };
    logger.error('convenios.guardar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude guardar el convenio ahorita. No se cambió nada; intenta de nuevo en un momento.' };
  }
  if (guardado.estado !== 'ok') return { ok: false, error: MENSAJE_GUARDAR[guardado.estado] };

  const n = datos.instrucciones.length;
  const base = guardado.creado
    ? `Convenio «${datos.nombre}» creado con ${plural(n, 'instrucción', 'instrucciones')}.`
    : `Convenio «${datos.nombre}» guardado con ${plural(n, 'instrucción', 'instrucciones')}.`;
  if (guardado.creado || !entrada.llevarAViajes) {
    const aparte = !guardado.creado ? ' Los viajes en curso conservan las instrucciones que ya se les dijeron.' : '';
    return { ok: true, mensaje: `${base}${aparte}` };
  }

  try {
    const cambiados = await d.refrescar(ctx.tenantId, guardado.id, entrada.reenviar);
    if (cambiados.length === 0) return { ok: true, mensaje: `${base} Ningún viaje en curso tenía instrucciones distintas: no hubo nada que actualizar.` };
    const porReenviar = cambiados.filter((c) => c.reenviar);
    let enviados = 0;
    const sinMandar: string[] = [];
    for (const c of porReenviar) {
      const r = await d.enviar(ctx.tenantId, c.viajeId);
      if (r.estado === 'enviado') enviados++;
      else sinMandar.push(c.viajeId);
    }
    const partes = [`${base} Se actualizaron las instrucciones de ${plural(cambiados.length, 'viaje en curso', 'viajes en curso')}.`];
    if (entrada.reenviar) {
      partes.push(porReenviar.length === 0
        ? 'Ninguno había recibido ya el despacho, así que no hubo nada que reenviar (lo recibirán con las instrucciones nuevas).'
        : `Se volvieron a mandar a ${plural(enviados, 'operador', 'operadores')}.`);
      if (sinMandar.length > 0) partes.push(`${plural(sinMandar.length, 'viaje no pudo recibirlas', 'viajes no pudieron recibirlas')} ahorita (sin teléfono, sin plantilla aprobada o WhatsApp caído): ya tienen las instrucciones nuevas, pero el mensaje no salió: mándalo desde «Convenio ligado a cada viaje en curso» (elige el mismo convenio y deja marcada la casilla de reenviar).`);
    }
    return { ok: true, mensaje: partes.join(' ') };
  } catch (e) {
    if (e instanceof EdicionNoDisponible) return { ok: true, mensaje: `${base} Falta aplicar la actualización 0657 para llevar el cambio a los viajes en curso: ellos conservan las instrucciones que ya se les dijeron.` };
    logger.error('convenios.refrescar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: true, mensaje: `${base} No pude llevar el cambio a los viajes en curso ahorita: ellos conservan las instrucciones que ya se les dijeron. Corrige el convenio de cada viaje desde «Convenio ligado a cada viaje en curso».` };
  }
}
