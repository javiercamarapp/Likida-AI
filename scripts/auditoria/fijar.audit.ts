// ═══════════════════════════════════════════════════════════════════════════
// FASE 4 — FIXERS EXPERTOS POR CLASE (el catálogo de la imagen).
//
// Cada hallazgo CRÍTICO/ALTO verificado se despacha al fixer que le toca
// (Crash fuzzer, Logic bugfixer, Security sealer, …) con el modelo de su
// clase. El fixer propone el arreglo con repro; el runner guarda el plan en
// docs/auditoria-N/fixes-plan.md. El commit lo hace un humano (o un agente
// con AUDIT_FIX=1) sobre un árbol limpio — regla del repo: prueba roja
// primero, commit atómico citando el ID.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirRonda } from './config.audit';
import { verificarRonda } from './verificar.audit';
import { fixerPorSeveridad, severidadDeTexto } from './modelos.audit';
import { llamada } from './llamada.audit';
import type { HallazgoVerificado } from './verificar.audit';

export interface ResumenFix {
  hallazgoId: string;
  fixer: string;
  modelo: string;
  propuesta: string;
  cost: number;
}

export function hallazgosCriticosYAltos(n: number): HallazgoVerificado[] {
  return verificarRonda(n).filter((h) => h.existe && (h.severidad === 'CRITICO' || h.severidad === 'ALTO'));
}

export async function despacharFixers(n: number): Promise<ResumenFix[]> {
  const hallazgos = hallazgosCriticosYAltos(n);
  const out: ResumenFix[] = [];
  const plan: string[] = [`# Fixers — auditoría ${n}`, ''];
  let i = 1;
  for (const h of hallazgos) {
    const f = fixerPorSeveridad(h.rubro, severidadDeTexto(h.severidad));
    const modelo = f.modelo(h.rubro);
    const res = await llamada({
      modelo,
      quien: `fixer-${f.nombre}`,
      mensajes: [
        {
          role: 'system',
          content: `Eres ${f.nombre} en Likida. ${f.queHace}. Reglas: NO editas código todavía. Produces el plan mínimo de cierre: 1) comando/test que REPRODUCE el fallo (ro), 2) el arreglo exacto (archivo + línea + código), 3) la prueba de regresión que queda verde, 4) si el código ya lo cubre, dilo: es falso positivo y no toques nada.`,
        },
        {
          role: 'user',
          content: `Hallazgo [${h.severidad}] ${h.titulo} (rubro ${h.rubro}) en ${h.archivo}:${h.linea}.\nDevuelve el plan con la forma exacta:\nREPRODUCE: <comando>\nARCHIVO: <ruta>\nCAMBIO: <diff o código>\nREGRESION: <test>\nFALSO_POSITIVO: si/no`,
        },
      ],
      maxTokens: 3000,
      temperatura: 0.2,
    });
    const id = `${h.rubro}-${h.severidad.slice(0, 1)}${i}`;
    plan.push(`## ${id} · [${h.severidad}] ${h.titulo} — ${h.archivo}:${h.linea}`);
    plan.push(`Fixer: ${f.nombre} · Modelo: ${modelo}`);
    plan.push(res.text);
    plan.push('');
    out.push({ hallazgoId: id, fixer: f.nombre, modelo, propuesta: res.text, cost: res.cost });
    i++;
  }
  mkdirSync(dirRonda(n), { recursive: true });
  writeFileSync(`${dirRonda(n)}/fixes-plan.md`, plan.join('\n'), 'utf8');
  return out;
}