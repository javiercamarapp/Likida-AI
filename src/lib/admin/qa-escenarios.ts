// ═══════════════════════════════════════════════════════════════════════════
// PANEL DE QA — los escenarios del selector.
//
// CADA ESCENARIO ES UN GUION, no solo unos defaults. La Fase A tenía dos
// escenarios que se distinguían únicamente por el anticipo y la política: el
// motor mandaba siempre la misma secuencia (todas las fotos → «listo»), así
// que dos de los cinco oráculos del ejército quedaban importados y sin
// disparar nunca. Un oráculo que no corre no es una garantía, es un archivo.
//
// El `guion` arregla eso: es la secuencia de mensajes que el chofer sintético
// manda, y de ella se deduce qué invariantes puede juzgar la corrida. Un
// escenario NO declara un oráculo que su guion no ejercita — reportar "ok"
// sobre un invariante que nadie atacó es un veredicto inventado.
//
// Catálogo completo (11 escenarios) en escenarios-catalogo.md del diseño. Los
// defaults del "guion del demo" son los del guion REAL
// (src/app/api/demo/route.ts y src/app/demo): la pregunta que ese escenario
// responde es "¿lo que el demo le enseña a un prospecto es lo que el producto
// de verdad hace?" — por eso los valores se copian de ahí, y una prueba
// (qa-escenarios.test.ts) vigila que no deriven de la fuente.
//
// Client-safe: datos puros, sin imports de node.
// ═══════════════════════════════════════════════════════════════════════════

import type { PoliticaGasto } from '@/lib/likida/cuadre/engine';
import type { EscenarioId } from './qa-tipos';

/** La política del guion del demo — COPIA de `POLITICA` en
 *  src/app/api/demo/route.ts (no se puede importar: ese módulo solo exporta
 *  handlers). qa-escenarios.test.ts compara contra el archivo fuente. */
export const POLITICA_DEMO: PoliticaGasto[] = [
  { concepto: 'diesel', topeMonto: 4000 },
  { concepto: 'caseta', topeMonto: 1500 },
  { concepto: 'alimentacion', topeMonto: 800 },
  { concepto: 'hospedaje', topeMonto: 2500 },
  { concepto: 'transporte', topeMonto: 800 },
  { concepto: 'flete' },
  { concepto: 'factura', requiereCfdi: true },
];

/** Un paso del guion: lo que el chofer sintético hace, en orden. */
export type PasoGuion =
  /** Todas las fotos elegidas del banco, una por mensaje, en orden. */
  | { tipo: 'fotos' }
  /** LA MISMA foto otra vez, byte a byte. `comoOtroChofer` la manda desde un
   *  segundo operador del mismo tenant — que es el caso que importa: el
   *  pre-check del processor mira UN viaje, así que solo cruzando de viaje se
   *  obliga al índice `uq_gasto_img_hash` (unique por TENANT) a ser el que
   *  rechace. */
  | { tipo: 'foto_repetida'; indice: number; comoOtroChofer: boolean }
  /** «listo, ya subí todo», con UNA insistencia si el agente pidió confirmar. */
  | { tipo: 'cierre' };

export interface EscenarioQaDef {
  id: EscenarioId;
  nombre: string;
  descripcion: string;
  /** La secuencia de mensajes. Sin él no hay escenario: es lo que distingue a
   *  uno de otro, no los defaults del formulario. */
  guion: PasoGuion[];
  /** ¿La siembra necesita un SEGUNDO operador con su propio viaje abierto?
   *  Solo los guiones que cruzan de viaje. Sembrar uno que nadie usa es
   *  ensuciar el tenant sintético sin motivo. */
  segundoChofer: boolean;
  /** Cuántas fotos exige el guion como MÍNIMO. El formulario lo dice antes de
   *  lanzar; lanzar con menos daría un veredicto sobre un ataque que no
   *  ocurrió. */
  minFotos: number;
  /** null = no hay default honesto: Javier lo fija (p. ej. "feliz" exige que
   *  el anticipo sume EXACTO lo que traen sus fotos — inventarle un número
   *  sería inventar una cifra). */
  anticipoDefault: number | null;
  rfcEmpresaDefault: string | null;
  rutaDefault: { origen: string; destino: string };
  politicaDefault: PoliticaGasto[];
  /** Los invariantes que este guion DE VERDAD ejercita (rótulo del selector y
   *  contrato con qa-oraculos: solo estos se corren). */
  invariantes: string[];
}

export const ESCENARIOS_QA: EscenarioQaDef[] = [
  {
    id: 'demo_guion',
    nombre: 'El del guion del demo',
    descripcion:
      'Las fotos contra el anticipo y la política del guion real del demo ($10,600; diésel tope $4,000). ' +
      'Responde: ¿el camino real —OCR de verdad sobre fotos de verdad— llega a lo que el demo enseña?',
    anticipoDefault: 10_600,          // el anticipo del guion (escenarios-catalogo.md §2)
    rfcEmpresaDefault: 'GMX0902279I1', // el RFC de la flota demo (api/demo/route.ts, empresaRfc)
    rutaDefault: { origen: 'Silao', destino: 'Nuevo Laredo' }, // la ruta del guion ('Silao-Laredo')
    politicaDefault: POLITICA_DEMO,
    guion: [{ tipo: 'fotos' }, { tipo: 'cierre' }],
    segundoChofer: false,
    minFotos: 1,
    invariantes: ['#1', '#5', '#8'],
  },
  {
    id: 'feliz',
    nombre: 'El feliz — cuadra exacto',
    descripcion:
      'N tickets cuyo total suma EXACTO el anticipo: el viaje cierra con diferencia $0. ' +
      'Pon el anticipo que de verdad sumen tus fotos — no hay default porque inventarlo sería inventar la cifra.',
    anticipoDefault: null,
    rfcEmpresaDefault: null,
    rutaDefault: { origen: 'Silao', destino: 'Nuevo Laredo' },
    politicaDefault: POLITICA_DEMO,
    guion: [{ tipo: 'fotos' }, { tipo: 'cierre' }],
    segundoChofer: false,
    minFotos: 1,
    invariantes: ['#1', '#5', '#8'],
  },
  {
    id: 'foto_duplicada',
    nombre: 'La misma foto, dos veces',
    descripcion:
      'La primera foto se manda otra vez, byte a byte, desde un SEGUNDO chofer del mismo tenant. ' +
      'Responde: ¿se puede cobrar dos veces el mismo ticket? El pre-check del processor solo mira ' +
      'un viaje, así que cruzando de viaje el que tiene que rechazar es el índice de la base.',
    anticipoDefault: null,   // el mismo criterio que "feliz": el monto lo pone Javier
    rfcEmpresaDefault: 'GMX0902279I1',
    rutaDefault: { origen: 'Silao', destino: 'Nuevo Laredo' },
    politicaDefault: POLITICA_DEMO,
    guion: [
      { tipo: 'fotos' },
      { tipo: 'foto_repetida', indice: 0, comoOtroChofer: true },
      { tipo: 'cierre' },
    ],
    segundoChofer: true,
    minFotos: 1,
    invariantes: ['#1', '#3', '#5', '#8'],
  },
];

export function escenarioPorId(id: string): EscenarioQaDef | null {
  return ESCENARIOS_QA.find((e) => e.id === id) ?? null;
}
