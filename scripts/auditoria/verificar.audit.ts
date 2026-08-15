// ═══════════════════════════════════════════════════════════════════════════
// FASE 2 — VERIFICACIÓN ADVERSARIAL.
//
// El orquestador NO confía: abre cada hallazgo citado (archivo:línea) y
// comprueba que el archivo exista en el repo. Los que sobreviven entran a
// síntesis con su severidad; los que no, a DESCARTADOS con razón.
// Produce docs/auditoria-N/verificacion.md.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirRonda, RUBROS } from './config.audit';
import { leerReporte } from './agente.audit';
import type { Rubro } from './config.audit';

export interface HallazgoVerificado {
  rubro: Rubro;
  severidad: string;
  titulo: string;
  archivo: string;
  linea: number;
  existe: boolean;
  estado: string;
}

const RE_HALLAZGO = /^###\s*\[(CRITICO|ALTO|MEDIO|BAJO)\]\s+(.+)$/m;
const RE_REF = /`([^`]+):(\d+)`/;

export function verificarReporte(n: number, r: Rubro, cwd = process.cwd()): HallazgoVerificado[] {
  const texto = leerReporte(n, r);
  const out: HallazgoVerificado[] = [];
  const lineas = texto.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(RE_HALLAZGO);
    if (!m) continue;
    const sev = m[1];
    const titulo = m[2].trim();
    const bloque = lineas.slice(i + 1, Math.min(i + 8, lineas.length)).join('\n');
    const ref = bloque.match(RE_REF);
    if (!ref) {
      out.push({ rubro: r, severidad: sev, titulo, archivo: '', linea: 0, existe: false, estado: 'sin `archivo:línea`' });
      continue;
    }
    const archivo = ref[1];
    const linea = Number(ref[2]);
    const lineaValida = verificaArchivo(cwd, archivo, linea);
    out.push({
      rubro: r,
      severidad: sev,
      titulo,
      archivo,
      linea,
      existe: lineaValida,
      estado: lineaValida ? 'VERIFICADO' : 'DESCARTADO: referencia inválida',
    });
  }
  return out;
}

function verificaArchivo(cwd: string, archivo: string, linea: number): boolean {
  const candidatos = [
    archivo.startsWith('/') ? `${cwd}${archivo}` : `${cwd}/${archivo}`,
    archivo.startsWith('src/') ? `${cwd}/${archivo}` : `${cwd}/src/${archivo}`,
  ];
  for (const p of candidatos) {
    try {
      if (existsSync(p)) {
        const contenido = readFileSync(p, 'utf8').split('\n');
        return linea > 0 && linea <= contenido.length;
      }
    } catch {
      /* ignorar */
    }
  }
  return false;
}

export function verificarRonda(n: number): HallazgoVerificado[] {
  const todos = RUBROS.flatMap((r) => verificarReporte(n, r));
  const verificados = todos.filter((h) => h.existe);
  const descartados = todos.filter((h) => !h.existe);
  const md = [
    `# Verificación — auditoría ${n}`,
    '',
    `**${verificados.length} VERIFICADOS** · **${descartados.length} DESCARTADOS**`,
    '',
    '## Verificados',
    ...(verificados.length ? verificados.map((h) => `- [${h.severidad}] ${h.rubro}: ${h.titulo} — \`${h.archivo}:${h.linea}\``) : ['(ninguno)']),
    '',
    '## Descartados',
    ...(descartados.length ? descartados.map((h) => `- [${h.severidad}] ${h.rubro}: ${h.titulo} — ${h.archivo}:${h.linea} (${h.estado})`) : ['(ninguno)']),
    '',
  ].join('\n');
  mkdirSync(dirRonda(n), { recursive: true });
  writeFileSync(`${dirRonda(n)}/verificacion.md`, md, 'utf8');
  return todos;
}