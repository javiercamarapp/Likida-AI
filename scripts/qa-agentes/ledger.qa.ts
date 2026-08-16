// ═══════════════════════════════════════════════════════════════════════════
// LEDGER DE GASTO DEL QA — calca de scripts/auditoria/ledger.audit.ts.
//
// Cada llamada de costo REAL (el costo_usd que el proveedor cobró, leído de
// `llm_costo` — no una tabla de precios) se registra en
// docs/qa/<fecha>/ledger.json. Si la corrida pasa su tope, se ABORTA con un
// error que dice cuánto gastó y en qué. Los mensajes de WhatsApp NO entran:
// van por el cliente Meta FALSO del arnés y no cuestan dinero real.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirCorrida, TOPE_CORRIDA_USD } from './config.qa';

export interface LedgerRowQA {
  t: string;
  corrida: string;   // fecha YYYY-MM-DD
  quien: string;     // "<ataque>#rep<r>/<fase>"
  modelo: string;
  tokIn: number;
  tokOut: number;
  cost: number;
}

export interface LedgerQA {
  corrida: string;
  tope: number;
  filas: LedgerRowQA[];
}

export function ledgerPathQA(fecha: string): string {
  return `${dirCorrida(fecha)}/ledger.json`;
}

export function leerLedgerQA(fecha: string): LedgerQA {
  const p = ledgerPathQA(fecha);
  if (!existsSync(p)) return { corrida: fecha, tope: TOPE_CORRIDA_USD, filas: [] };
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as LedgerQA;
  } catch {
    return { corrida: fecha, tope: TOPE_CORRIDA_USD, filas: [] };
  }
}

export function totalLedgerQA(l: LedgerQA): number {
  return l.filas.reduce((a, f) => a + f.cost, 0);
}

/** Registra una llamada y valida el tope de la corrida. Lanza si se rebasa. */
export function registrarUso(
  fecha: string, quien: string, modelo: string, tokIn: number, tokOut: number, cost: number,
): void {
  const l = leerLedgerQA(fecha);
  l.filas.push({ t: new Date().toISOString(), corrida: fecha, quien, modelo, tokIn, tokOut, cost });
  mkdirSync(dirCorrida(fecha), { recursive: true });
  writeFileSync(ledgerPathQA(fecha), JSON.stringify(l, null, 2));
  const total = totalLedgerQA(l);
  if (total > l.tope) {
    throw new Error(
      `TOPE DE CORRIDA QA EXCEDIDO: $${total.toFixed(4)} > $${l.tope} (última: ${quien} @ ${modelo})`,
    );
  }
}

export function resumenLedgerQA(fecha: string): string {
  const l = leerLedgerQA(fecha);
  const por = new Map<string, number>();
  for (const f of l.filas) por.set(f.modelo, (por.get(f.modelo) ?? 0) + f.cost);
  const detalle = [...por.entries()]
    .map(([m, c]) => `    ${m.padEnd(40)} $${c.toFixed(4)}`)
    .join('\n');
  return `Corrida ${l.corrida}: $${totalLedgerQA(l).toFixed(4)} de $${l.tope} tope\n${detalle}`;
}
