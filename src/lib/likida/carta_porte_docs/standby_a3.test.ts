/* eslint-disable security/detect-non-literal-fs-filename -- pruebas que leen el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CRONS_PERFIL_CINCO_AGENTES } from '@/lib/auth/visibilidad';
import { crearViajeDeDocumento } from './bandeja';
import { MENSAJE_FUNCION_NO_DISPONIBLE, fijarGuardiaPerfil } from './envio';

// ═══════════════════════════════════════════════════════════════════════════
// T-A3-40 · STAND-BY DE A3 — la prueba de que el timbrado, la descarga SAT, el
// borrador y el árbol legal siguen OCULTOS (no borrados) y de que el camino
// nuevo de A3 (envío al TMS) no puede llegar a ellos.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();
const DIR = join(RAIZ, 'src/lib/likida/carta_porte_docs');

/** Superficies en stand-by: el código sigue en el repo (se oculta con el perfil, no se elimina). */
const STAND_BY = [
  'src/lib/likida/pac/sw.ts',
  'src/lib/likida/carta_porte_timbre.ts',
  'src/lib/likida/carta_porte_cfdi.ts',
  'src/lib/likida/carta_porte_wa.ts',
  'src/app/dashboard/timbrado/page.tsx',
  'src/app/dashboard/descarga-sat/page.tsx',
  'src/app/dashboard/carta-porte/borrador/[viajeId]/page.tsx',
];

/** Los archivos NUEVOS de A3 que jamás deben llegar al camino del timbre. */
const NUEVOS_A3 = /^(envio.*|worker_envios.*|plantilla_.*|catalogo.*|ccp_respuesta|tms_puerto)\.ts$/;
const PROHIBIDO = /(^|\/)pac(\/|$)|carta_porte_timbre|carta_porte_cfdi|carta_porte_xml|carta_porte_wa/;

const sinComentarios = (src: string): string =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');

const importsDe = (src: string): string[] =>
  [...sinComentarios(src).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

const archivosNuevosA3 = (): string[] => readdirSync(DIR).filter((f) => NUEVOS_A3.test(f) && !/\.(test|fixture)\.ts$/.test(f));

describe('stand-by de A3: oculto, no borrado', () => {
  it('el código de timbrado, descarga SAT, borrador y árbol legal sigue en el repo (nada se borró)', () => {
    for (const f of STAND_BY) expect(existsSync(join(RAIZ, f)), `${f} ya no existe`).toBe(true);
  });
});

describe('el camino nuevo de A3 no puede llegar al timbre', () => {
  it('hay archivos nuevos de A3 que vigilar (la prueba no es vacía)', () => {
    const nombres = archivosNuevosA3();
    for (const esperado of ['envio.ts', 'worker_envios.ts', 'plantilla_tms.ts', 'tms_puerto.ts', 'catalogo_cliente.ts']) {
      expect(nombres, esperado).toContain(esperado);
    }
  });

  it('ningún archivo nuevo de A3 importa pac/, carta_porte_timbre, carta_porte_cfdi ni el árbol legal', () => {
    for (const f of archivosNuevosA3()) {
      const imports = importsDe(readFileSync(join(DIR, f), 'utf8'));
      for (const i of imports) expect(i, `${f} importa ${i}`).not.toMatch(PROHIBIDO);
    }
  });

  it('ningún archivo nuevo de A3 llama a una función de timbrado', () => {
    for (const f of archivosNuevosA3()) {
      const src = sinComentarios(readFileSync(join(DIR, f), 'utf8'));
      expect(/resolverPac|LIKIDA_PAC_|\.timbrar\(|timbrarCcp|timbrarCfdi/.test(src), `${f} llama al timbre`).toBe(false);
    }
  });
});

describe('rutas, acciones y crons nuevos de A3 están clasificados', () => {
  it('el cron de documentos de A3 está en la lista de crons del perfil', () => {
    expect(CRONS_PERFIL_CINCO_AGENTES).toContain('carta-porte-docs');
    expect(existsSync(join(RAIZ, 'src/app/api/cron/carta-porte-docs/route.ts'))).toBe(true);
  });

  it('cada página de A3 bajo /dashboard/carta-porte es estática y clasificada, o dinámica y colgada de una llave clasificada', () => {
    // Las estáticas las exige la prueba de escaneo de src/lib/auth/perfil_rutas.test.ts; aquí se fija que no
    // aparezca una página estática de A3 sin ella: solo existen estas.
    const raiz = join(RAIZ, 'src/app/dashboard/carta-porte');
    const estaticas: string[] = [];
    const recorre = (dir: string, ruta: string): void => {
      for (const n of readdirSync(dir, { withFileTypes: true })) {
        if (n.isDirectory()) { if (!n.name.startsWith('[')) recorre(join(dir, n.name), `${ruta}/${n.name}`); }
        else if (n.name === 'page.tsx') estaticas.push(ruta);
      }
    };
    recorre(raiz, '/dashboard/carta-porte');
    expect(estaticas.sort()).toEqual(['/dashboard/carta-porte', '/dashboard/carta-porte/documentos']);
  });
});

describe('la acción «crear viaje» bajo el perfil', () => {
  afterEach(() => fijarGuardiaPerfil());

  it('devuelve negado sin leer la base (id inexistente: si llegara a cargar, lanzaría)', async () => {
    fijarGuardiaPerfil(async () => true);
    const r = await crearViajeDeDocumento('flota-con-perfil', 'documento-que-no-existe', { id: null }, null);
    expect(r).toEqual({ ok: false, motivo: 'datos_invalidos', mensaje: MENSAJE_FUNCION_NO_DISPONIBLE });
  });

  it('si la guardia falla se asume el perfil (lado seguro)', async () => {
    fijarGuardiaPerfil(async () => { throw new Error('sin respuesta'); });
    const r = await crearViajeDeDocumento('cualquiera', 'x', { id: null }, null);
    expect(r).toMatchObject({ ok: false, mensaje: MENSAJE_FUNCION_NO_DISPONIBLE });
  });
});
