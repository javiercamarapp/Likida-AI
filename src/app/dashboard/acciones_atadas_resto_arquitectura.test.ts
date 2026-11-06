/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes fijas del propio repo. */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { accionesSinGuarda, totalAcciones } from './acciones_atadas_deteccion';

// MX-002 / PT-02 — EXTENSIÓN al RESTO de /dashboard. `acciones_atadas_arquitectura.test.ts` cierra las acciones de dinero y de
// plazo legal (lista cerrada). Esta prueba ENUMERA TODO archivo bajo src/app/dashboard con server actions (no hay lista
// que se pueda olvidar: un archivo nuevo entra solo) y exige que cada acción llegue a una guarda que ata la flota al render:
// `resolverTenantAtadoAccion` / `resolverTenantAtadoOLanza` / `resolverTenantAtado` (closure) o `resolverTenantAtadoFirmado`
// (módulo, con la flota pintada firmada en un campo oculto) / `exigirFlotaPintada`. Un superadmin con dos pestañas
// (cookie de flota compartida) ya no escribe en la flota equivocada en NINGUNA pantalla del panel.
//
// EXENTAS: archivos cuyas acciones no escriben ni leen datos de una flota (son del usuario o de la sesión). Cada una con razón.
const RAIZ = join(process.cwd(), 'src/app/dashboard');
const EXENTAS: Record<string, string> = {
  'layout.tsx': 'cerrarSesion: cierra la sesión del usuario; no toca datos de ninguna flota.',
  'puesta-en-marcha/acciones.ts': 'enviarPruebaCorreo manda la prueba SOLO al correo del usuario en sesión (la acción no recibe destino) y no lee ni escribe datos de ninguna flota: el tenantId solo se anota en el log.',
  'mi-perfil/page.tsx': 'acciones del propio usuario (nombre, avatar, sus sesiones, su MFA): se escriben por userId de la sesión real, nunca por flota.',
};

function recorrer(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) recorrer(p, salida);
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) salida.push(p);
  }
  return salida;
}

const CON_ACCIONES = recorrer(RAIZ)
  .map((p) => ({ rel: relative(RAIZ, p), fuente: readFileSync(p, 'utf8') }))
  .filter((a) => totalAcciones(a.fuente) > 0)
  .sort((a, b) => a.rel.localeCompare(b.rel));

describe('MX-002 · TODA server action de /dashboard está atada a la flota pintada', () => {
  it('la enumeración ve las pantallas del panel (no se vacía en silencio)', () => {
    expect(CON_ACCIONES.length).toBeGreaterThan(50);
    expect(CON_ACCIONES.map((a) => a.rel)).toContain('clientes/page.tsx');
  });

  it('cada exención existe, tiene acciones y lleva razón', () => {
    for (const [rel, razon] of Object.entries(EXENTAS)) {
      expect(CON_ACCIONES.map((a) => a.rel), rel).toContain(rel);
      expect(razon.length, rel).toBeGreaterThan(20);
    }
  });

  it.each(CON_ACCIONES.filter((a) => !(a.rel in EXENTAS)).map((a) => [a.rel, a.fuente] as const))(
    '%s: toda server action pasa por la guarda de flota pintada',
    (rel, fuente) => {
      expect(accionesSinGuarda(fuente), `acciones sin guarda en ${rel}`).toEqual([]);
    },
  );
});
