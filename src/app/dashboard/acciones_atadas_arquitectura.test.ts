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
import { accionesSinGuarda, cuerpoDeFuncion, sinComentarios, totalAcciones } from './acciones_atadas_deteccion';

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
          const d = [...f.slice(0, m.index).matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].pop()!;
          return [d[1], cuerpoDeFuncion(f, d.index! + d[0].length)] as const;
        });
      for (const [n, c] of dirs) if (/\bresolverTenantEfectivo\(/.test(c)) culpables.push(`${a}::${n}`);
    }
    expect(culpables).toEqual([]);
  });
});
