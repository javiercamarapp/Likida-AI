import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// CT-SEG-11: /admin/trust-safety afirmaba «los detectores están cableados» sin que nadie lo midiera. El registro de fuentes
// (cobertura.ts) es la declaración de QUÉ emite y QUÉ no, y estas pruebas la atan al código: una fuente declarada «emite» tiene
// un emisor real en el árbol, y una declarada «no emite» no lo tiene (si alguien la cablea, esta prueba falla y obliga a
// actualizar el registro y, con él, lo que el panel le dice a Javier).
// ═══════════════════════════════════════════════════════════════════════════

type Cuenta = { count: number | null; error: { message: string } | null };
const filtros: Array<Record<string, unknown>> = [];
let respuesta: (f: Record<string, unknown>) => Cuenta = () => ({ count: 0, error: null });
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => {
        const f: Record<string, unknown> = {};
        const b: Record<string, unknown> = {};
        b.eq = (c: string, v: unknown) => { f[c] = v; return b; };
        b.gte = (c: string, v: unknown) => { f[`${c}>=`] = v; return b; };
        b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => { filtros.push(f); return Promise.resolve(respuesta(f)).then(res, rej); };
        return b;
      },
    }),
  }),
}));

const { FUENTES_SEGURIDAD, coberturaEventosSeguridad } = await import('./cobertura');

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
function fuentesDelArbol(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') fuentesDelArbol(p, acc); continue; }
    if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) acc.push(p);
  }
  return acc;
}
const CODIGO = fuentesDelArbol(RAIZ)
  .filter((p) => !p.endsWith('/seguridad/cobertura.ts') && !p.endsWith('/seguridad/eventos.ts'))
  .map((p) => readFileSync(p, 'utf8'));
const hayEmisor = (origen: string, tipo: string) =>
  CODIGO.some((src) => new RegExp(`origen:\\s*'${origen}',\\s*tipo:\\s*'${tipo}'`).test(src));

beforeEach(() => { filtros.length = 0; respuesta = () => ({ count: 0, error: null }); });

describe('el registro de fuentes dice la verdad sobre el código', () => {
  const conPar = FUENTES_SEGURIDAD.filter((f) => f.par);
  it.each(conPar.filter((f) => f.emite).map((f) => [f.id, f.par!] as const))('«%s» declarada como emisora tiene un emisor real', (_id, par) => {
    expect(hayEmisor(par.origen, par.tipo), `${par.origen}/${par.tipo}`).toBe(true);
  });
  it.each(conPar.filter((f) => !f.emite).map((f) => [f.id, f.par!] as const))('«%s» declarada como NO emisora no tiene emisor', (_id, par) => {
    expect(hayEmisor(par.origen, par.tipo), `${par.origen}/${par.tipo}`).toBe(false);
  });
  it('los ids son únicos y cada fuente dice dónde vive o por qué no existe', () => {
    expect(new Set(FUENTES_SEGURIDAD.map((f) => f.id)).size).toBe(FUENTES_SEGURIDAD.length);
    for (const f of FUENTES_SEGURIDAD) expect(f.donde.length, f.id).toBeGreaterThan(5);
  });
  it('declara honestamente lo que falta: rate limit, correo entrante, inyección y lecturas de datos personales NO emiten', () => {
    const noEmiten = FUENTES_SEGURIDAD.filter((f) => !f.emite).map((f) => f.id);
    expect(noEmiten).toEqual(expect.arrayContaining(['rate_limit', 'correo_firma', 'inyeccion_prompt', 'lectura_datos_personales']));
  });
  it('las cinco fuentes de CT-SEG-11 están declaradas como emisoras', () => {
    for (const id of ['login_fallido', 'llave_invalida', 'api_negada', 'exporte_dinero', 'cambio_rol']) {
      expect(FUENTES_SEGURIDAD.find((f) => f.id === id)?.emite, id).toBe(true);
    }
  });
});

describe('coberturaEventosSeguridad — conteos medidos por fuente, últimos 30 días', () => {
  it('cuenta cada par (origen, tipo) en la base con la ventana de 30 días y devuelve un número por fuente con par', async () => {
    respuesta = (f) => ({ count: f.tipo === 'login_fallido' ? 7 : 0, error: null });
    const r = await coberturaEventosSeguridad(new Date('2026-11-04T12:00:00Z'));
    expect(r.find((x) => x.id === 'login_fallido')?.filas30d).toBe(7);
    expect(r.find((x) => x.id === 'cambio_rol')?.filas30d).toBe(0);
    expect(filtros.every((f) => f['creado_en>='] === '2026-10-05T12:00:00.000Z')).toBe(true);
    // Las fuentes sin par (no existen como evento) no tienen conteo: null, no 0.
    expect(r.find((x) => x.id === 'lectura_datos_personales')?.filas30d).toBeNull();
  });
  it('LANZA si la base falla: un cero inventado seria una cobertura falsa', async () => {
    respuesta = () => ({ count: null, error: { message: 'boom' } });
    await expect(coberturaEventosSeguridad()).rejects.toThrow('boom');
  });
});
