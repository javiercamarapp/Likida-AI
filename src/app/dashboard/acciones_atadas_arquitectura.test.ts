/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes fijas del propio repo. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// MX-002 / PT-02 — PRUEBA DE ARQUITECTURA. Las acciones de servidor de DINERO y de PLAZO LEGAL (emitir,
// timbrar, anular, cobrar, aprobar liquidación, llaves de API, roles) escriben SOLO en la flota que la pantalla
// pintó: cada una pasa por `resolverTenantAtadoAccion` (closure) o `resolverTenantAtadoFirmado` (módulo, con la
// flota pintada firmada en un campo oculto). Un superadmin con dos pestañas ya no puede emitir ni timbrar en la
// flota equivocada. La lista es CERRADA a propósito: agregar una pantalla de dinero exige agregarla aquí, y
// entonces la prueba enumera sus acciones y falla si alguna no tiene la guarda.
const RAIZ = join(process.cwd(), 'src/app/dashboard');
const LISTA = [
  'timbrado/[viajeId]/timbrar.tsx', // timbrar, cancelar timbre, receptor
  'contador/timbrado.tsx',
  'facturacion/page.tsx', // factura, pago, sello de emitida, cancelar
  'facturacion/portal.tsx', // cobro: generar/revocar/conciliar/descartar
  'facturacion/estadias.tsx',
  'agentes/facturas/page.tsx',
  'agentes/facturas/acciones-control.ts', // encender/apagar emisión real, límites, lotes
  'agentes/facturas/acciones-vinculacion.ts',
  'agentes/cobranza/page.tsx',
  'agentes/liquidacion/page.tsx',
  '[id]/page.tsx', // aprobar / revisar / reabrir liquidación
  'agentes/proveedores/page.tsx',
  'llaves-api/page.tsx',
  'usuarios/page.tsx', // roles, altas y bajas
  'contador/estimulo-peaje.tsx', // declaracion fiscal del estimulo de peaje
  'contador/perfil-erp.tsx', // plantilla de exportacion contable
  'conexiones/page.tsx', // credenciales, secreto GPS, importaciones
];
const GUARDA = /\b(resolverTenantAtadoAccion|resolverTenantAtadoFirmado|exigirFlotaPintada)\(/;

function cuerpoDesde(f: string, desde: number): string {
  const abre = f.indexOf('{', desde);
  if (abre < 0) return '';
  let prof = 0;
  for (let i = abre; i < f.length; i++) {
    if (f[i] === '{') prof++;
    else if (f[i] === '}') { prof--; if (prof === 0) return f.slice(abre, i + 1); }
  }
  return f.slice(abre);
}
function cuerpoDeFuncion(f: string, trasNombre: number): string {
  const a = f.indexOf('(', trasNombre);
  if (a < 0) return '';
  let p = 0, i = a;
  for (; i < f.length; i++) { if (f[i] === '(') p++; else if (f[i] === ')') { p--; if (p === 0) break; } }
  let ang = 0;
  for (let j = i + 1; j < f.length; j++) {
    const c = f[j];
    if (c === '<') ang++;
    else if (c === '>' && f[j - 1] !== '=') ang--;
    else if (c === '{' && ang <= 0) return cuerpoDesde(f, j);
  }
  return '';
}
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Acciones (nombre) del archivo que no llegan a la guarda, directo o por un ayudante del mismo archivo. */
export function accionesSinGuarda(fuenteCruda: string): string[] {
  const fuente = sinComentarios(fuenteCruda);
  const cuerpos = new Map<string, string>();
  for (const m of fuente.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) cuerpos.set(m[1], cuerpoDeFuncion(fuente, m.index! + m[0].length));
  const llega = (cuerpo: string, visto: Set<string>): boolean => {
    if (GUARDA.test(cuerpo)) return true;
    for (const [n, c] of cuerpos) {
      if (visto.has(n) || !new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\s*\\(`).test(cuerpo)) continue;
      visto.add(n);
      if (llega(c, visto)) return true;
    }
    return false;
  };
  const sin: string[] = [];
  if (/^\s*['"]use server['"]/.test(fuente)) {
    for (const m of fuente.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g)) {
      if (!llega(cuerpoDeFuncion(fuente, m.index! + m[0].length), new Set([m[1]]))) sin.push(m[1]);
    }
    return sin;
  }
  for (const m of fuente.matchAll(/^[ \t]*['"]use server['"];/gm)) {
    const d = [...fuente.slice(0, m.index).matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)].pop();
    if (!d) { sin.push('(directiva sin función)'); continue; }
    if (!llega(cuerpoDeFuncion(fuente, d.index! + d[0].length), new Set([d[1]]))) sin.push(d[1]);
  }
  return sin;
}
function totalAcciones(fuenteCruda: string): number {
  const f = sinComentarios(fuenteCruda);
  return /^\s*['"]use server['"]/.test(f) ? [...f.matchAll(/export\s+async\s+function\s+/g)].length : [...f.matchAll(/^[ \t]*['"]use server['"];/gm)].length;
}

describe('MX-002 · acciones de dinero y plazo legal atadas a la flota pintada', () => {
  it('el detector de la prueba funciona: una acción sin guarda se señala, una con guarda no', () => {
    const mala = "async function P(){\n async function emitir(){\n 'use server';\n const s = await resolverTenantEfectivo(R, sp); } }";
    const buena = "async function P(){\n async function emitir(){\n 'use server';\n const s = await resolverTenantAtadoAccion(R, sp, tenantId); } }";
    expect(accionesSinGuarda(mala)).toEqual(['emitir']);
    expect(accionesSinGuarda(buena)).toEqual([]);
    expect(accionesSinGuarda("'use server';\nexport async function a(){ await requireSessionTenant(R); }")).toEqual(['a']);
    expect(accionesSinGuarda("'use server';\nasync function s(){ return resolverTenantAtadoFirmado(R, x); }\nexport async function a(){ await s(); }")).toEqual([]);
  });

  it('la lista no se vacía en silencio: cada archivo existe y tiene acciones', () => {
    for (const a of LISTA) expect(totalAcciones(readFileSync(join(RAIZ, a), 'utf8')), a).toBeGreaterThan(0);
  });

  it.each(LISTA)('%s: toda server action pasa por la guarda de flota pintada', (a) => {
    expect(accionesSinGuarda(readFileSync(join(RAIZ, a), 'utf8')), `acciones sin guarda en ${a}`).toEqual([]);
  });

  it('ninguna acción de la lista resuelve la flota «a ciegas» con resolverTenantEfectivo dentro de su cuerpo', () => {
    // La resolución libre solo vale para PINTAR (fuera de las acciones). Dentro de una acción es el hueco.
    const culpables: string[] = [];
    for (const a of LISTA) {
      const f = sinComentarios(readFileSync(join(RAIZ, a), 'utf8'));
      const dirs = /^\s*['"]use server['"]/.test(f)
        ? [...f.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g)].map((m) => [m[1], cuerpoDeFuncion(f, m.index! + m[0].length)] as const)
        : [...f.matchAll(/^[ \t]*['"]use server['"];/gm)].map((m) => {
          const d = [...f.slice(0, m.index).matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)].pop()!;
          return [d[1], cuerpoDeFuncion(f, d.index! + d[0].length)] as const;
        });
      for (const [n, c] of dirs) if (/\bresolverTenantEfectivo\(/.test(c)) culpables.push(`${a}::${n}`);
    }
    expect(culpables).toEqual([]);
  });
});
