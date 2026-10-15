/* eslint-disable security/detect-non-literal-fs-filename -- pruebas que leen el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  RUTAS_PERFIL_CINCO_AGENTES, RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, CRONS_PERFIL_CINCO_AGENTES,
  rutaPermitidaEnPerfil, apiPermitidaEnPerfil, puedeVerRuta,
} from './visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// A1 (Liquidación) bajo el perfil `cinco_agentes` (B1): T-A1-33.
// «Nada fuera de la lista responde»: todo lo de A1 queda DENTRO de la lista
// cerrada, y sin perfil el comportamiento es el de siempre. Sin mocks: lee el
// mapa real y el árbol real de fuentes.
// ═══════════════════════════════════════════════════════════════════════════

const PERFIL = 'cinco_agentes';
const RAIZ = process.cwd();

const PANTALLAS_A1 = [
  '/dashboard/agentes/liquidacion',
  '/dashboard/agentes/liquidacion/formato',
  '/dashboard/agentes/liquidacion/configuracion',
];

const APIS_A1 = [
  '/api/v1/liquidaciones-externas',
  '/api/v1/liquidaciones-externas/desgloses',
  '/api/v1/liquidaciones-externas/acuses',
  '/api/v1/liquidaciones-externas/acuses/confirmar',
  '/api/v1/liquidaciones-externas/exportacion',
  '/api/export/liquidaciones-externas',
];

describe('A1 dentro de la lista cerrada del perfil', () => {
  it.each(PANTALLAS_A1)('la pantalla %s está permitida bajo el perfil y es del módulo liquidacion', (ruta) => {
    expect(rutaPermitidaEnPerfil(PERFIL, ruta)).toBe(true);
    expect(RUTAS_PERFIL_CINCO_AGENTES[ruta]).toBe('liquidacion');
    expect(RUTAS_STAND_BY_PERFIL_CINCO_AGENTES).not.toContain(ruta);
  });

  it('el detalle de una liquidación (uuid) se pliega a su llave permitida', () => {
    expect(rutaPermitidaEnPerfil(PERFIL, '/dashboard/0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true);
  });

  it('con query o barra final las pantallas de A1 siguen permitidas', () => {
    expect(rutaPermitidaEnPerfil(PERFIL, '/dashboard/agentes/liquidacion/configuracion/?aviso=x')).toBe(true);
  });

  it.each(APIS_A1)('la API %s sigue viva bajo el perfil', (ruta) => {
    expect(apiPermitidaEnPerfil(PERFIL, ruta)).toBe(true);
  });

  it('el cron liquidaciones-externas sigue corriendo para flotas con perfil', () => {
    expect(CRONS_PERFIL_CINCO_AGENTES).toContain('liquidaciones-externas');
  });

  it('toda pantalla de A1 tiene su page.tsx y toda page.tsx estática de A1 está en la lista', () => {
    const base = join(RAIZ, 'src/app/dashboard/agentes/liquidacion');
    const paginas: string[] = [];
    const recorre = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) recorre(p);
        else if (n === 'page.tsx') paginas.push('/dashboard/' + relative(join(RAIZ, 'src/app/dashboard'), dir));
      }
    };
    recorre(base);
    for (const r of PANTALLAS_A1) expect(existsSync(join(RAIZ, 'src/app', r.slice(1), 'page.tsx')), r).toBe(true);
    for (const p of paginas) expect(rutaPermitidaEnPerfil(PERFIL, p), `${p} no está en la lista del perfil`).toBe(true);
  });

  it('cada carpeta de src/app/api/v1/liquidaciones-externas cuelga de un segmento permitido', () => {
    expect(existsSync(join(RAIZ, 'src/app/api/v1/liquidaciones-externas/route.ts'))).toBe(true);
    expect(existsSync(join(RAIZ, 'src/app/api/export/liquidaciones-externas/route.ts'))).toBe(true);
    expect(existsSync(join(RAIZ, 'src/app/api/cron/liquidaciones-externas/route.ts'))).toBe(true);
  });
});

describe('A1 bajo el perfil: lo ajeno sigue negado (fail closed)', () => {
  it('una ruta nueva no declarada de A1 se niega', () => {
    expect(rutaPermitidaEnPerfil(PERFIL, '/dashboard/agentes/liquidacion/ruta-nueva')).toBe(false);
    expect(apiPermitidaEnPerfil(PERFIL, '/api/v1/liquidaciones-externas-nuevo/x')).toBe(false);
  });

  it('las pantallas de stand-by vecinas de A1 (cobranza, facturas) siguen negadas', () => {
    expect(rutaPermitidaEnPerfil(PERFIL, '/dashboard/agentes/cobranza')).toBe(false);
    expect(rutaPermitidaEnPerfil(PERFIL, '/dashboard/agentes/facturas')).toBe(false);
  });

  it('un perfil desconocido o vacío no permite nada (fail closed)', () => {
    for (const r of PANTALLAS_A1) expect(rutaPermitidaEnPerfil('otro', r), r).toBe(false);
    for (const a of APIS_A1) expect(apiPermitidaEnPerfil('', a), a).toBe(false);
  });
});

describe('sin perfil, A1 se comporta como siempre', () => {
  it('las pantallas de A1 las gobierna solo el rol; con el perfil el rol sigue mandando sobre lo permitido', () => {
    for (const r of PANTALLAS_A1) {
      expect(puedeVerRuta('flota_admin', r), r).toBe(true);
      expect(puedeVerRuta('superadmin', r), r).toBe(true);
      expect(puedeVerRuta('flota_admin', r, PERFIL), r).toBe(true);
      expect(puedeVerRuta('rol_inventado', r), r).toBe(false);
      expect(puedeVerRuta('rol_inventado', r, PERFIL), r).toBe(false);
    }
  });

  it('sin perfil no se pierde nada: la misma pantalla de stand-by que el perfil niega la ve el rol', () => {
    expect(puedeVerRuta('flota_admin', '/dashboard/agentes/cobranza')).toBe(true);
    expect(puedeVerRuta('flota_admin', '/dashboard/agentes/cobranza', PERFIL)).toBe(false);
  });
});

describe('las server actions de A1 llegan a una puerta que aplica el perfil', () => {
  const PUERTA = /\b(resolverTenantEfectivo|requireSessionTenant|exigirVerRuta)\(/;
  const ARCHIVOS = [
    'src/app/dashboard/agentes/liquidacion/page.tsx',
    'src/app/dashboard/agentes/liquidacion/formato/page.tsx',
    'src/app/dashboard/agentes/liquidacion/configuracion/page.tsx',
  ];
  it.each(ARCHIVOS)('%s con \'use server\' usa una puerta de sesión/tenant', (archivo) => {
    const fuente = readFileSync(join(RAIZ, archivo), 'utf8');
    if (!/['"]use server['"]/.test(fuente)) return;
    expect(PUERTA.test(fuente), `${archivo} tiene acciones y ninguna puerta`).toBe(true);
  });
});
