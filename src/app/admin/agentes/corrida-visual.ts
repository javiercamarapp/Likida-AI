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
