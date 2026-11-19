#!/usr/bin/env node
/**
 * Clasifica el JSON de `npm audit --omit=dev` sin confundir una vulnerabilidad
 * real con una caída del registry. Exit 0 = runtime limpio, 1 = high/critical,
 * 2 = reporte no concluyente (red, timeout o JSON inválido; el workflow reintenta).
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Avisos aceptados de forma explícita y TEMPORAL (autorizado por el dueño el 18-nov-2026). Cada uno nombra el aviso exacto (GHSA),
 * por qué se acepta y hasta cuándo. Vencida la fecha, el aviso vuelve a bloquear solo. Un aviso NUEVO nunca queda cubierto: se
 * compara el GHSA, no el paquete.
 *
 * GHSA-fc5q-39xc-vjpf (picomatch): rango `*` y SIN versión corregida publicada. Entra solo por la cadena de `@sentry/nextjs`
 * (@rollup/plugin-commonjs, @rollup/pluginutils, fdir): herramientas del empaquetado del reporte de errores. Pendiente: subir
 * @sentry/nextjs a 11.x en un PR aparte.
 */
export const AVISOS_ACEPTADOS = [
  { ghsa: 'GHSA-fc5q-39xc-vjpf', vence: '2026-12-18' },
];

function avisosVigentes(ahora) {
  return new Set(AVISOS_ACEPTADOS.filter((a) => ahora < new Date(`${a.vence}T23:59:59Z`)).map((a) => a.ghsa));
}

/**
 * Cuenta high/critical que NO estén cubiertos por un aviso aceptado y vigente. Un paquete queda cubierto solo si TODOS sus avisos
 * directos (via con objeto) son aceptados y todo lo high/critical que arrastra de otros paquetes (via con texto) también está cubierto.
 * Sin detalle de paquetes no se cubre nada: falla cerrado (devuelve null).
 */
function contarSinAceptados(reporte, ahora) {
  const detalle = reporte?.vulnerabilities;
  const vigentes = avisosVigentes(ahora);
  if (!detalle || typeof detalle !== 'object' || Array.isArray(detalle) || vigentes.size === 0) return null;
  const memo = new Map();
  const cubierto = (nombre, visitando = new Set()) => {
    if (memo.has(nombre)) return memo.get(nombre);
    const v = detalle[nombre];
    if (!v || !Array.isArray(v.via) || v.via.length === 0 || visitando.has(nombre)) return false;
    visitando.add(nombre);
    // Un paquete arrastrado que NO es high/critical no aporta a la severidad de este: no hace falta cubrirlo (el umbral es high).
    const ok = v.via.every((x) => (typeof x === 'string'
      ? (detalle[x]?.severity !== 'high' && detalle[x]?.severity !== 'critical') || cubierto(x, visitando)
      : x && typeof x === 'object' && typeof x.url === 'string' && [...vigentes].some((g) => x.url.endsWith(`/${g}`))));
    visitando.delete(nombre);
    memo.set(nombre, ok);
    return ok;
  };
  let high = 0;
  let critical = 0;
  for (const [nombre, v] of Object.entries(detalle)) {
    if (v?.severity !== 'high' && v?.severity !== 'critical') continue;
    if (cubierto(nombre)) continue;
    if (v.severity === 'critical') critical += 1; else high += 1;
  }
  return { high, critical };
}

export function clasificarAuditoriaRuntime(reporte, ahora = new Date()) {
  const conteos = reporte?.metadata?.vulnerabilities;
  if (!conteos || typeof conteos !== 'object' || Array.isArray(conteos)) {
    const codigo = reporte?.error?.code ?? reporte?.code ?? 'sin-codigo';
    const resumen = reporte?.error?.summary ?? reporte?.error?.detail ?? reporte?.message ?? 'reporte sin metadata.vulnerabilities';
    return { tipo: 'inconclusa', codigo: String(codigo), resumen: String(resumen) };
  }

  // npm audit entrega números para las cinco severidades y el total.
  // Nunca convertir ausencias, strings, negativos o NaN en un cero limpio.
  const esperados = ['info', 'low', 'moderate', 'high', 'critical', 'total'];
  const invalidos = esperados.filter((clave) =>
    !Object.hasOwn(conteos, clave)
    || !Number.isSafeInteger(conteos[clave])
    || conteos[clave] < 0);
  if (invalidos.length > 0) {
    return {
      tipo: 'inconclusa',
      codigo: 'AUDIT_COUNTS_INVALID',
      resumen: `Conteos ausentes o inválidos en metadata.vulnerabilities: ${invalidos.join(', ')}`,
    };
  }

  const { high, critical } = conteos;
  if (high + critical > 0) {
    // Los conteos de npm cuentan PAQUETES; se recalculan sin los cubiertos por un aviso aceptado y vigente.
    const restante = contarSinAceptados(reporte, ahora);
    if (restante === null || restante.high + restante.critical > high + critical) return { tipo: 'vulnerable', high, critical };
    if (restante.high + restante.critical > 0) return { tipo: 'vulnerable', high: restante.high, critical: restante.critical };
    return { tipo: 'limpia', high: 0, critical: 0 };
  }
  return { tipo: 'limpia', high: 0, critical: 0 };
}

function main() {
  const archivo = process.argv[2];
  if (!archivo) {
    console.error('Uso: node scripts/ci/audit-runtime.mjs <npm-audit.json>');
    process.exit(2);
  }

  let reporte;
  try {
    reporte = JSON.parse(readFileSync(archivo, 'utf8'));
  } catch (error) {
    console.error(`Auditoría runtime inconclusa: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  const resultado = clasificarAuditoriaRuntime(reporte);
  if (resultado.tipo === 'limpia') {
    console.log('Auditoría runtime: 0 vulnerabilidades high/critical.');
    process.exit(0);
  }
  if (resultado.tipo === 'vulnerable') {
    console.error(`Auditoría runtime: ${resultado.high} high, ${resultado.critical} critical.`);
    process.exit(1);
  }
  console.error(`Auditoría runtime inconclusa (${resultado.codigo}): ${resultado.resumen}`);
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
