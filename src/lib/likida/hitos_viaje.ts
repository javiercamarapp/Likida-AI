import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { strip_accents } from './cuadre/util';
import { TZ_MX } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// LOS HITOS DEL CHOFER (0090, F4 del plan): "ya llegué", "estoy descargando",
// "voy de regreso" — el aviso que hoy da por teléfono y nadie anota.
//
// ── POR QUÉ LISTA CERRADA Y ANCLADA, COMO consulta_chofer ──────────────────
// El daño del falso positivo es asimétrico: un mensaje que este módulo se
// come por error NUNCA llega al agente de liquidación, y "llegué a cargar
// diésel en Querétaro" no es un hito. Por eso las frases se comparan
// COMPLETAS contra una lista cerrada — lo que no esté ahí sigue su camino.
//
// ── DÓNDE SE CABLEA Y POR QUÉ AHÍ ──────────────────────────────────────────
// En el processor va ANTES del freno de cierre: el regex de `pareceCierre`
// arranca con ^(listo|ya|...) y se comería "ya llegué" como intento de
// cerrar el viaje. También va después de botones y consultas: esos son
// respuestas a preguntas nuestras y tienen precedencia.
//
// ── LA HORA ES LA DEL MENSAJE, Y ESO SE DICE ───────────────────────────────
// El sello guarda la hora en que el mensaje llegó, no la del evento físico
// (el chofer puede avisar tarde). El acuse dice "anotado: llegaste a las
// 14:32" porque esa ES la anotación; el producto nunca la presenta como
// telemetría.
// ═══════════════════════════════════════════════════════════════════════════

export type Hito = 'llegada' | 'descarga' | 'regreso';

const MAX_LARGO = 40;

/** minúsculas, sin acentos, sin puntuación/emoji, espacios colapsados. */
function limpiar(texto: string): string {
  return strip_accents(texto.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Las formas reales de cada hito, ya normalizadas (sin acentos). Cerradas:
 *  agregar una frase = una línea, y un test que la fije. */
const FRASES: Readonly<Record<Hito, readonly string[]>> = {
  llegada: [
    'llegue', 'llegamos', 'ya llegue', 'ya llegamos',
    'ya estoy aqui', 'estoy aqui', 'en destino', 'ya en destino',
    'ya estoy en destino', 'llegue al destino',
  ],
  descarga: [
    'descargando', 'estoy descargando', 'ya estoy descargando',
    'en descarga', 'ya descargando', 'empezamos a descargar',
  ],
  regreso: [
    'de regreso', 'ya de regreso', 'voy de regreso', 'ya voy de regreso',
    'regresando', 'de vuelta', 'ya de vuelta', 'vengo de regreso',
    'voy de vuelta',
  ],
};

const INDICE = new Map<string, Hito>();
for (const hito of Object.keys(FRASES) as Hito[]) {
  for (const f of FRASES[hito]) INDICE.set(f, hito);
}

/**
 * ¿El mensaje es un hito? `null` = no lo es y sigue su camino.
 *
 * Una PREGUNTA nunca sella: "¿ya llegué?" es alguien más preguntando por el
 * chofer desde su teléfono, o el chofer bromeando — y `limpiar` le quitaría
 * los signos y lo volvería indistinguible de la afirmación.
 */
export function interpretarHito(texto: string | undefined): Hito | null {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  if (texto.length > MAX_LARGO) return null;
  if (/[?¿]/.test(texto)) return null;
  return INDICE.get(limpiar(texto)) ?? null;
}

const COLUMNA: Readonly<Record<Hito, string>> = {
  llegada: 'llegada_en',
  descarga: 'descarga_en',
  regreso: 'regreso_en',
};

export type ResultadoSello = 'sellado' | 'ya_estaba' | 'fallo';

/**
 * Sella el hito UNA vez (patrón 0058/0087: el WHERE <col> IS NULL es el
 * candado — el mensaje repetido no mueve la hora). Anclado al tenant.
 */
export async function sellarHito(
  tenantId: string,
  viajeId: string,
  hito: Hito,
  ahora: Date = new Date(),
): Promise<ResultadoSello> {
  const col = COLUMNA[hito];
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje')
    .update({ [col]: ahora.toISOString() })
    .eq('id', viajeId)
    .eq('tenant_id', tenantId)
    .is(col, null)
    .select('id'), 'sellarHito');
  if (error) {
    logger.error('hito.sello_fallo', { viaje: viajeId, hito, err: error.message });
    return 'fallo';
  }
  return data && data.length > 0 ? 'sellado' : 'ya_estaba';
}

function horaMx(ahora: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ_MX, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(ahora);
}

/** El acuse al chofer. Corto, con la hora anotada, y sin regañar. */
export function mensajeHito(hito: Hito, resultado: ResultadoSello, ahora: Date = new Date()): string {
  if (resultado === 'fallo') return 'No pude anotarlo ahorita — mándamelo de nuevo en un momento. 🙏';
  if (resultado === 'ya_estaba') return 'Ya lo tenía anotado. 👍';
  const hora = horaMx(ahora);
  switch (hito) {
    case 'llegada':
      return `Anotado: llegaste a las ${hora}. 📍 Cuando estés descargando me dices, y ve mandando las fotos de tus recibos.`;
    case 'descarga':
      return `Anotado: descargando desde las ${hora}. 📦 Avísame cuando vayas de regreso.`;
    case 'regreso':
      return `Anotado: vas de regreso desde las ${hora}. 🚛 Si traes recibos pendientes, mándalos cuando puedas.`;
  }
}
