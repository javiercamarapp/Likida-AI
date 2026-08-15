// ═══════════════════════════════════════════════════════════════════════════
// FASE 3 — TABLERO. Un HTML auto-contenido con la serie histórica.
// Se abre y se mira; un tablero que nunca se renderizó no es evidencia.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirRonda, RUBROS, NOTAS_PREVIAS } from './config.audit';
import { leerReporte } from './agente.audit';
import { leerLedger, totalLedger } from './ledger.audit';
import type { Rubro } from './config.audit';

export function correrTablero(n: number): string {
  const notas = RUBROS.map((r: Rubro) => {
    const reporte = leerReporte(n, r);
    const matchNota = reporte.match(/\*\*Nota:?\*\*\s*(\d+(?:\.\d+)?)\/10/i)
      ?? reporte.match(/Nota:?\s*(\d+(?:\.\d+)?)\/10/i);
    const nota = matchNota ? Number(matchNota[1]) : (NOTAS_PREVIAS[r] ?? 0);
    const antes = NOTAS_PREVIAS[r] ?? 0;
    const conteo: Record<string, number> = {};
    for (const m of reporte.matchAll(/^###\s*\[(CRITICO|ALTO|MEDIO|BAJO)\]/gm)) {
      conteo[m[1]] = (conteo[m[1]] ?? 0) + 1;
    }
    const severidad = ['CRITICO', 'ALTO', 'MEDIO', 'BAJO'].map((s) => `${s}: ${conteo[s] ?? 0}`).join(' · ');
    return { rubro: r, nota, antes, severidad };
  });
  const global = notas.reduce((a, b) => a + b.nota, 0) / notas.length;
  const antesGlobal = notas.reduce((a, b) => a + b.antes, 0) / notas.length;
  const l = leerLedger(n);
  const gasto = totalLedger(l).toFixed(4);

  const filas = notas
    .map((x) => {
      const delta = x.nota - x.antes;
      const flecha = delta > 0 ? `▲ +${delta.toFixed(1)}` : delta < 0 ? `▼ ${delta.toFixed(1)}` : '—';
      return `<tr><td>${x.rubro}</td><td>${x.antes}</td><td><b>${x.nota.toFixed(1)}</b></td><td>${flecha}</td><td class="small">${x.severidad}</td></tr>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Auditoría ${n}</title>
<style>
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:2rem;background:#0f1226;color:#e8eaf6}
h1{font-size:1.4rem}.card{background:#1a1f3d;border:1px solid #2a3160;border-radius:12px;padding:1.2rem;margin-bottom:1rem}
.num{font-size:2.2rem;font-weight:800;color:#7c9cff}
table{border-collapse:collapse;width:100%}td,th{padding:.45rem .6rem;border-bottom:1px solid #2a3160;text-align:left}
th{color:#9aa3cf;font-weight:600}.small{font-size:.78rem;color:#aab2e0;white-space:nowrap}
</style></head><body>
<h1>Auditoría ${n} — Tablero</h1>
<div class="card"><span class="num">${global.toFixed(1)}</span> global <span class="small">(anterior ${antesGlobal.toFixed(1)})</span>
<br><span class="small">Gasto ronda: $${gasto} de $${l.tope} · ledger: <code>docs/auditoria-${n}/ledger.json</code></span></div>
<div class="card"><table><thead><tr><th>Rubro</th><th>Antes</th><th>Hoy</th><th>Δ</th><th>Hallazgos</th></tr></thead>
<tbody>${filas}</tbody></table></div>
</body></html>`;

  mkdirSync(dirRonda(n), { recursive: true });
  writeFileSync(`${dirRonda(n)}/tablero.html`, html, 'utf8');
  return `${dirRonda(n)}/tablero.html`;
}