// ═══════════════════════════════════════════════════════════════════════════
// EL HISTÓRICO EXPORTADO DE WHATSAPP («Exportar chat» → .txt, o el .zip que lo trae).
//
// El cliente pidió entrenar al Vigía con el histórico de sus grupos críticos. WhatsApp exporta cada chat como
// texto plano con dos familias de encabezado (según iOS o Android y el idioma del teléfono):
//
//   iOS      [12/09/2026, 10:23:45 a. m.] Nombre: texto
//   Android  12/09/2026 10:23 - Nombre: texto          (también «12/9/26, 10:23 a. m. - Nombre: texto»)
//
// Un mensaje de varias líneas continúa en las líneas siguientes (que NO traen encabezado). Las líneas de sistema
// («Los mensajes están cifrados…», «Fulano se unió») no traen «Nombre:» y se descartan; lo multimedia omitido
// («<Multimedia omitido>», «imagen omitida») no es texto y también.
//
// PRIVACIDAD (repo público, datos de clientes finales): el autor NUNCA se guarda en claro, solo un hash corto con sal
// de la flota; los teléfonos y correos que alguien escribió DENTRO del texto se tapan. Este módulo es PURO: no toca base.
// ═══════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';

export type RolHistorial = 'cliente' | 'equipo';

export interface MensajeHistorial {
  /** ISO UTC. La exportación trae hora local de México (sin horario de verano desde 2022 → UTC-6). */
  enviadoEn: string;
  rol: RolHistorial;
  /** Hash corto del autor con sal de la flota: sirve para contar «personas distintas», no para saber quién. */
  autorHash: string;
  texto: string;
}

export interface ResultadoExport {
  mensajes: MensajeHistorial[];
  /** Líneas de sistema y multimedia que se descartaron (para que el reporte sea honesto sobre lo que no entró). */
  descartados: number;
  /** Autores distintos vistos (solo el conteo; los nombres se usan para decidir el rol y se tiran). */
  autores: number;
  /** Cuántos mensajes no pudieron leerse como fecha válida. */
  fechasInvalidas: number;
  formato: 'ios' | 'android' | 'desconocido';
}

export const MAX_MENSAJES_IMPORTACION = 50_000;
export const MAX_TEXTO_MENSAJE = 1_500;

// Quita las marcas invisibles que WhatsApp mete (LRM, RLM, NNBSP, BOM) antes de comparar nada.
const INVISIBLES = /[\u200e\u200f\u202a-\u202e\ufeff]/g;
const ESPACIOS_RAROS = /[\u202f\u00a0]/g;

const FECHA = String.raw`(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})`;
const HORA = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s?m?\.?`;
const ENCABEZADO_IOS = new RegExp(String.raw`^\[${FECHA},?\s+${HORA}\]\s*(.*)$`, 'i');
const ENCABEZADO_ANDROID = new RegExp(String.raw`^${FECHA},?\s+${HORA}\s+-\s+(.*)$`, 'i');

const MULTIMEDIA = /^(<\s*multimedia omitido\s*>|<\s*media omitted\s*>|(imagen|video|audio|sticker|gif|documento|contacto|ubicaci[oó]n)( de .*)? omitid[oa]s?|<adjunto:.*>|se eliminó este mensaje|eliminaste este mensaje|este mensaje fue eliminado|mensaje eliminado|llamada (perdida|de voz|de video).*|videollamada perdida.*)\.?$/i;

function limpiar(s: string): string {
  return s.replace(INVISIBLES, '').replace(ESPACIOS_RAROS, ' ').replace(/\r/g, '');
}

/** Tapa teléfonos (7+ dígitos seguidos, con separadores) y correos del texto. */
export function taparDatosPersonales(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]')
    .replace(/(?:\+?\d[\s().-]?){7,}\d/g, '[tel]');
}

function hashAutor(sal: string, nombre: string): string {
  return createHash('sha256').update(`${sal}\u0000${nombre.trim().toLowerCase()}`).digest('hex').slice(0, 12);
}

interface Partes { d: number; m: number; a: number; h: number; mi: number; s: number; resto: string }

function partesDe(g: RegExpMatchArray, ordenDiaMes: 'dm' | 'md'): Partes | null {
  const n1 = Number(g[1]); const n2 = Number(g[2]); let a = Number(g[3]);
  if (a < 100) a += 2000;
  let h = Number(g[4]); const mi = Number(g[5]); const s = g[6] ? Number(g[6]) : 0;
  const ampm = g[7]?.toLowerCase();
  if (ampm === 'p' && h < 12) h += 12;
  if (ampm === 'a' && h === 12) h = 0;
  const [d, m] = ordenDiaMes === 'dm' ? [n1, n2] : [n2, n1];
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return { d, m, a, h, mi, s, resto: g[8] ?? '' };
}

function isoMexico(p: Partes): string | null {
  // Descarta fechas imposibles como 31/02 (Date las desborda a marzo).
  const control = new Date(Date.UTC(p.a, p.m - 1, p.d));
  if (control.getUTCMonth() !== p.m - 1 || control.getUTCDate() !== p.d) return null;
  return new Date(Date.UTC(p.a, p.m - 1, p.d, p.h + 6, p.mi, p.s)).toISOString();
}

/**
 * Lee el texto exportado. `equipo` son los NOMBRES (como salen en el chat) de la gente de la flota; todo otro autor es
 * cliente. `sal` (el id de la flota) mezcla el hash del autor para que el mismo nombre no sea el mismo hash en otra flota.
 */
export function leerExportWhatsapp(crudo: string, opciones: { equipo: readonly string[]; sal: string }): ResultadoExport {
  const equipo = new Set(opciones.equipo.map((n) => limpiar(n).trim().toLowerCase()).filter(Boolean));
  const lineas = limpiar(crudo).split('\n');

  // Pasada 1: ¿día/mes o mes/día? Si algún primer número pasa de 12 es día/mes; si algún segundo pasa de 12, mes/día.
  let formato: ResultadoExport['formato'] = 'desconocido';
  let primerMayor = false; let segundoMayor = false;
  for (const l of lineas) {
    const ios = l.match(ENCABEZADO_IOS); const and = ios ? null : l.match(ENCABEZADO_ANDROID);
    const g = ios ?? and;
    if (!g) continue;
    if (formato === 'desconocido') formato = ios ? 'ios' : 'android';
    if (Number(g[1]) > 12) primerMayor = true;
    if (Number(g[2]) > 12) segundoMayor = true;
  }
  const orden: 'dm' | 'md' = segundoMayor && !primerMayor ? 'md' : 'dm';

  const mensajes: MensajeHistorial[] = [];
  const autores = new Set<string>();
  let descartados = 0; let fechasInvalidas = 0;
  let actual: { enviadoEn: string; autor: string; texto: string } | null = null;

  const cerrar = () => {
    if (!actual) return;
    const texto = taparDatosPersonales(actual.texto.trim()).slice(0, MAX_TEXTO_MENSAJE);
    if (!texto || MULTIMEDIA.test(texto.trim())) descartados += 1;
    else {
      autores.add(actual.autor);
      mensajes.push({
        enviadoEn: actual.enviadoEn,
        rol: equipo.has(actual.autor.trim().toLowerCase()) ? 'equipo' : 'cliente',
        autorHash: hashAutor(opciones.sal, actual.autor),
        texto,
      });
    }
    actual = null;
  };

  for (const l of lineas) {
    const ios = l.match(ENCABEZADO_IOS); const and = ios ? null : l.match(ENCABEZADO_ANDROID);
    const g = ios ?? and;
    if (g) {
      cerrar();
      const p = partesDe(g, orden);
      const iso = p ? isoMexico(p) : null;
      if (!p || !iso) { fechasInvalidas += 1; continue; }
      const dos = p.resto.indexOf(': ');
      if (dos <= 0 || dos > 80) { descartados += 1; continue; } // línea de sistema: no hay «Nombre: »
      actual = { enviadoEn: iso, autor: p.resto.slice(0, dos).trim(), texto: p.resto.slice(dos + 2) };
    } else if (actual && l.length > 0) {
      actual.texto += `\n${l}`;
    }
    if (mensajes.length >= MAX_MENSAJES_IMPORTACION) break;
  }
  cerrar();
  return { mensajes, descartados, autores: autores.size, fechasInvalidas, formato };
}
