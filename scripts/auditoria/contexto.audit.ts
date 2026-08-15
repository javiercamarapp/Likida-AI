// ═══════════════════════════════════════════════════════════════════════════
// CONTEXTO — lo que cada agente necesita antes de pensar.
//
//  · MAPA previo (docs/auditoria-K/MAPA.md, K = última ronda completa).
//  · Sección del rubro (references/rubros.md del skill — caída: vendored).
//  · Nota previa y hallazgos abiertos del rubro en esa ronda.
//  · Síntesis previa (00-SINTESIS.md) — las notas vienen de ahí.
//  · Evidencia de baseline (corrida real, no suposición).
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dirRonda, SKILL_REF } from './config.audit';
import type { Rubro } from './config.audit';

const MAPA_INDICES: Record<Rubro, string> = {
  frontend: '1 · Frontend',
  backend: '2 · Backend y API',
  agentico: '3 · Sistema agéntico y orquestación',
  'tool-calling': '4 · Tool calling',
  seguridad: '5 · Seguridad',
  fiscal: '6 · Cumplimiento fiscal',
  legal: '7 · Cumplimiento legal',
  arquitectura: '8 · Arquitectura y mantenibilidad',
  pruebas: '9 · Pruebas',
  operabilidad: '10 · Operabilidad y DX',
  rendimiento: '11 · Rendimiento y costo',
  datos: '12 · Modelo de datos y esquema',
};

export function seccionRubro(r: Rubro): string {
  const canónica = `${SKILL_REF}/rubros.md`;
  const vendored = join(__dirname, 'rubros.md');
  const fuente = existsSync(canónica) ? canónica : existsSync(vendored) ? vendored : '';
  if (!fuente) return '(sección de rubros no disponible)';
  const t = readFileSync(fuente, 'utf8');
  const titulo = MAPA_INDICES[r];
  const idx = t.indexOf(titulo);
  if (idx < 0) return '(sección no encontrada en rubros.md)';
  const resto = t.slice(idx + titulo.length);
  const next = resto.search(/^## /m);
  return (titulo + (next >= 0 ? resto.slice(0, next) : resto)).slice(0, 14_000);
}

export function reporteAnterior(r: Rubro, k: number): string {
  return leerArchivo(`${dirRonda(k)}/${r}.md`);
}
function leerArchivo(p: string, max = 24_000): string {
  if (!existsSync(p)) return '';
  const t = readFileSync(p, 'utf8');
  return t.length > max ? t.slice(0, max) + '\n…[truncado]' : t;
}

export function sintesisPrevia(k: number): string {
  return leerArchivo(`${dirRonda(k)}/00-SINTESIS.md`, 18_000);
}

export function hallazgosAbiertos(r: Rubro, k: number): string {
  const prev = reporteAnterior(r, k);
  if (!prev) return 'ninguno (primera ronda en este archivo)';
  const lineas = prev.split('\n').filter((l) => /^###\s*\[(CRITICO|ALTO|MEDIO|BAJO)\]/.test(l));
  return lineas.length === 0 ? 'ninguno' : lineas.map((l) => l.replace(/^###\s*/, '- ')).join('\n');
}

export function ultimaRondaCompleta(n: number): number {
  for (let k = n - 1; k >= 1; k--) {
    if (existsSync(`${dirRonda(k)}/00-SINTESIS.md`)) return k;
  }
  return 0;
}

export function evidenciaBaseline(n: number): string {
  const d = `${dirRonda(n)}/evidencia`;
  if (!existsSync(d)) return '(baseline no corrido aún)';
  return readdirSync(d)
    .filter((f) => /\.log$/.test(f))
    .map((f) => `- ${f}: ${leerArchivo(join(d, f), 300).split('\n')[0] ?? ''}`)
    .join('\n');
}

export interface ContextoAgente {
  k: number; // ronda completa anterior (anclaje)
  mapa: string;
  seccion: string;
  previa: string;
  sintesisPrev: string;
  abiertos: string;
}

export function contextoAgente(n: number, r: Rubro): ContextoAgente {
  const k = ultimaRondaCompleta(n);
  return {
    k,
    mapa: k > 0 ? leerArchivo(`${dirRonda(k)}/MAPA.md`) : '(sin MAPA previo)',
    seccion: seccionRubro(r),
    previa: k > 0 ? reporteAnterior(r, k) : '',
    sintesisPrev: k > 0 ? sintesisPrevia(k) : '',
    abiertos: k > 0 ? hallazgosAbiertos(r, k) : 'ninguno',
  };
}