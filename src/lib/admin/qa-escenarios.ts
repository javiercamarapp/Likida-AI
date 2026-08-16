// ═══════════════════════════════════════════════════════════════════════════
// PANEL DE QA — Fase A: los DOS escenarios del selector.
//
// Catálogo completo (11 escenarios) en escenarios-catalogo.md del diseño; los
// otros 9 son Fase B. Los defaults del "guion del demo" son los del guion REAL
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

export interface EscenarioQaDef {
  id: EscenarioId;
  nombre: string;
  descripcion: string;
  /** null = no hay default honesto: Javier lo fija (p. ej. "feliz" exige que
   *  el anticipo sume EXACTO lo que traen sus fotos — inventarle un número
   *  sería inventar una cifra). */
  anticipoDefault: number | null;
  rfcEmpresaDefault: string | null;
  rutaDefault: { origen: string; destino: string };
  politicaDefault: PoliticaGasto[];
  /** Los invariantes que el catálogo le asigna (para el rótulo del selector). */
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
    invariantes: ['#1', '#5', '#8'],
  },
];

export function escenarioPorId(id: string): EscenarioQaDef | null {
  return ESCENARIOS_QA.find((e) => e.id === id) ?? null;
}
