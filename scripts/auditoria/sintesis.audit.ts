// ═══════════════════════════════════════════════════════════════════════════
// FASE 5 — SÍNTESIS Y RECALIFICACIÓN. El criterio del delta, con GROK.
//
// Lee los 12 reportes + verificación, y escribe 00-SINTESIS.md: notas con
// su PORQUÉ, delta contra la ronda anterior, críticos/altos a cerrar,
// falsos descartados y presupuesto real gastado. Grok solo escribe; no toca.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirRonda, RUBROS } from './config.audit';
import { leerReporte } from './agente.audit';
import { leerLedger, totalLedger } from './ledger.audit';
import { MODELO_SINTESIS } from './modelos.audit';
import { llamada } from './llamada.audit';

function leerSiExiste(p: string, max = 12_000): string {
  if (!existsSync(p)) return '';
  const t = readFileSync(p, 'utf8');
  return t.length > max ? t.slice(0, max) + '\n…[truncado]' : t;
}

export async function correrSintesis(n: number): Promise<string> {
  const previa = n > 1 ? leerSiExiste(`${dirRonda(n - 1)}/00-SINTESIS.md`) : '';
  const anterior = extraerGlobal(previa);
  const cuerpo = RUBROS.map((r) => `### ${r}\n${leerReporte(n, r).slice(0, 9000)}`).join('\n\n');
  const verificacion = leerSiExiste(`${dirRonda(n)}/verificacion.md`, 20_000) || '(sin verificación)';
  const gasto = totalLedger(leerLedger(n)).toFixed(4);

  const prompt = `Eres el orquestador de la auditoría ${n} de Likida. Leíste los 12 reportes y la verificación adversarial. Escribe docs/auditoria-${n}/00-SINTESIS.md — la síntesis oficial.

Reglas:
- Global con UN decimal; la nota de cada rubro es la que SU reporte declara (si falta, usa la previa — y se dice en el porqué).
- El porqué de cada movimiento es obligatorio y pesa más que la nota.
- Los falsos van en su sección, CON razón (fue lo que mantiene honestos a los auditores de mañana).

${previa ? `## Síntesis previa (para el delta)\n${previa}` : '(no hay síntesis previa)'}

## Los 12 reportes de esta ronda
${cuerpo}

## Verificación adversarial
${verificacion}

## Presupuesto de la ronda
Gastado: $${gasto} · ledger: docs/auditoria-${n}/ledger.json

## Formato de salida (mismo esqueleto de siempre)
# Auditoría ${n} — Síntesis y recalificación

**Global: «X.X»** (anterior: «${anterior}»).

Una línea con la lectura de la ronda.

## Las 12 notas
| Rubro | Anterior | Hoy | Porqué del movimiento |

## Críticos y altos a cerrar (ID + archivo:línea)

## Falsos y descartados (con razón)

## Propuestos (medios y bajos que esperan)

## Presupuesto de la ronda (gasto vs tope)

Responde SOLO con el contenido del archivo 00-SINTESIS.md.`;
  const out = await llamada({
    modelo: MODELO_SINTESIS,
    quien: 'sintesis',
    mensajes: [{ role: 'user', content: prompt }],
    maxTokens: 8000,
    temperatura: 0.2,
  });
  mkdirSync(dirRonda(n), { recursive: true });
  writeFileSync(`${dirRonda(n)}/00-SINTESIS.md`, out.text, 'utf8');
  return out.text;
}

function extraerGlobal(t: string): string {
  const m = t.match(/Global:\s*(\d+(?:\.\d+)?)/);
  return m ? m[1] : '—';
}