import type { TonoEstado } from '@/app/ui-v2/componentes';
import type { agentes } from '@/lib/i18n/es/agentes';

const HORAS = 3_600_000;

/** El traductor del namespace «agentes» (`const { t } = await getT('agentes')`): el texto sale del diccionario es/en, no de aquí. */
export type Tr = (clave: keyof typeof agentes, variables?: Readonly<Record<string, string | number>>) => string;

/** «hace 70 días» / «hace 5 h»: la antigüedad en palabras, calculada del instante real (nunca inventada). Es dato de apoyo en gris: el tono NO sale de aquí. */
export function haceTiempo(inicioIso: string, ahora: number, t: Tr): string {
  const h = Math.max(0, (ahora - Date.parse(inicioIso)) / HORAS);
  if (h < 1) return t('catalogo.corrida.hace_menos_1h');
  if (h < 48) return t('catalogo.corrida.hace_horas', { n: Math.floor(h) });
  return t('catalogo.corrida.hace_dias', { n: Math.floor(h / 24) });
}

/** El RESULTADO de la última corrida, dicho con texto. Rojo solo si de verdad falló; parcial va en ámbar; «ok» es texto llano (sin chip: no es un aviso).
 *  Antes la FECHA se pintaba en rojo por antigüedad aunque la corrida hubiera terminado bien, y parecía un error. */
export function resultadoCorrida(estado: string, t: Tr): { texto: string; tono: TonoEstado | null } {
  if (estado === 'ok') return { texto: t('catalogo.corrida.ok'), tono: null };
  if (estado === 'parcial') return { texto: t('catalogo.corrida.parcial'), tono: 'warn' };
  if (estado === 'fallo') return { texto: t('catalogo.corrida.fallo'), tono: 'bad' };
  return { texto: t('catalogo.corrida.otro', { estado }), tono: 'neutral' };
}

export type CorridaLeida = { inicio: string; estado: string } | null | 'error';

/** Lee la última corrida de cada agente. `null` = la consulta respondió y NO hay corridas (estado neutro, honesto);
 *  'error' = la consulta falló (error real, falla cerrado: nunca se oculta). Antes un `?? 'error'` confundía ambos casos. */
export async function leerCorridas(
  ids: readonly string[],
  lector: (id: string) => Promise<{ inicio: string; estado: string } | null>,
): Promise<Map<string, CorridaLeida>> {
  const mapa = new Map<string, CorridaLeida>();
  await Promise.all(ids.map(async (id) => {
    try { mapa.set(id, await lector(id)); } catch { mapa.set(id, 'error'); }
  }));
  return mapa;
}

/** Lo que dice la celda para un agente: sin consultar nada más, el mapa manda. Un agente ausente del mapa sí es lectura fallida. */
export function corridaDe(mapa: ReadonlyMap<string, CorridaLeida>, id: string): CorridaLeida {
  return mapa.has(id) ? (mapa.get(id) as CorridaLeida) : 'error';
}
