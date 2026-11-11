import { ESTADOS_PROSPECTO, type EstadoProspecto } from '@/lib/likida/vendedores';
import type { EtapaEmbudo } from '@/app/ui-v2/graficas';

/**
 * EL EMBUDO DE VENTAS a partir del conteo de prospectos por estado. Un conteo por estado dice DÓNDE ESTÁ cada prospecto, no hasta dónde
 * llegó: sumarlos tal cual y calcular «conversión» entre etapas sería inventar tasas. Aquí cada etapa cuenta los prospectos que ESTÁN en
 * ella o en una posterior de la ruta principal (nuevo → contactado → cita → demo → propuesta → piloto → ganado), así la serie nunca sube
 * y la conversión contra la etapa anterior es una razón real sobre esa definición.
 *
 * Los estados fuera de la ruta (cita cancelada, no se presentó, perdido) NO se reparten: no se sabe en qué etapa se cayeron, y asignarlos
 * a una sería un dato inventado. Se devuelven aparte (`fuera`) para decirlos.
 */
const RUTA: ReadonlyArray<{ clave: string; estados: readonly EstadoProspecto[] }> = [
  { clave: 'nuevo', estados: ['nuevo'] },
  { clave: 'contactado', estados: ['contactado'] },
  { clave: 'cita', estados: ['appointment', 'rescheduled'] },
  { clave: 'demo', estados: ['demo'] },
  { clave: 'proposal', estados: ['proposal'] },
  { clave: 'pilot', estados: ['pilot'] },
  { clave: 'won', estados: ['won'] },
];

const FUERA: readonly EstadoProspecto[] = ['cancelled', 'no-show', 'lost'];

const rotuloDe = (e: EstadoProspecto) => ESTADOS_PROSPECTO.find((x) => x.valor === e)?.rotulo ?? e;
const ROTULO_CITA = 'Cita';

export function embudoDeVentas(totales: Readonly<Record<EstadoProspecto, number>>): { etapas: EtapaEmbudo[]; fuera: number; enRuta: number } {
  const enEtapa = RUTA.map((r) => r.estados.reduce((s, e) => s + (totales[e] ?? 0), 0));
  const etapas = RUTA.map((r, i): EtapaEmbudo => ({
    etiqueta: r.estados.length === 1 ? rotuloDe(r.estados[0]) : ROTULO_CITA,
    valor: enEtapa.slice(i).reduce((s, n) => s + n, 0),
  }));
  return { etapas, fuera: FUERA.reduce((s, e) => s + (totales[e] ?? 0), 0), enRuta: enEtapa.reduce((s, n) => s + n, 0) };
}
