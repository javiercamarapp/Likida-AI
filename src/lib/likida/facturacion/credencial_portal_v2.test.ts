import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-O7-01. La credencial de un portal se GUARDA por guardarCredencial (cofre
// v2, atado a `tenant:conector`) y la LEEN cuentas.ts y relogin_portal.ts. Esta
// prueba usa el cofre REAL (sin mocks de cifrar/descifrar) para que un lector
// que olvide el contexto falle aquí y no en producción.

type Fila = { tenant_id: string; conector_id: string; valores_cifrados: string; activo: boolean };
const filas: Fila[] = [];

function consulta() {
  const f: Array<(r: Fila) => boolean> = [];
  let accion: 'select' | 'update' = 'select';
  let cambios: Partial<Fila> = {};
  const q = {
    select() { return q; },
    update(c: Partial<Fila>) { accion = 'update'; cambios = c; return q; },
    upsert(r: Fila) {
      const i = filas.findIndex((x) => x.tenant_id === r.tenant_id && x.conector_id === r.conector_id);
      if (i >= 0) filas[i] = r; else filas.push(r);
      return { select: () => ({ single: () => Promise.resolve({ data: { id: 'fila-1' }, error: null }) }) };
    },
    eq(c: keyof Fila, v: unknown) { f.push((r) => r[c] === v); return q; },
    like(c: keyof Fila, v: string) { const p = v.replace('%', ''); f.push((r) => String(r[c]).startsWith(p)); return q; },
    maybeSingle() { return Promise.resolve({ data: filas.find((r) => f.every((x) => x(r))) ?? null, error: null }); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => {
        const hit = filas.filter((r) => f.every((x) => x(r)));
        if (accion === 'update') { hit.forEach((r) => Object.assign(r, cambios)); return { data: null, error: null }; }
        return { data: hit, error: null };
      }).then(res, rej);
    },
  };
  return q;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => consulta() }) }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (p: unknown) => p }));
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => {}) }));

process.env.LIKIDA_COFRE_LLAVE = 'una-llave-de-prueba-de-al-menos-32-caracteres!!';

const { cifrar } = await import('../conectores/cofre');
const { guardarCredencial } = await import('../conectores/credenciales');
const { contextoCredencial } = await import('../conectores/contexto_credencial');
const { conectorDePortal } = await import('../conectores/portales_facturacion');
const { credencialesDePortales, credencialDePortal } = await import('./cuentas');
const { contrasenaDePortal, borrarContrasenaGuardada } = await import('./relogin_portal');
const { COMERCIOS } = await import('./comercios');

const TENANT = '66666666-6666-6666-6666-666666666666';
const COMERCIO = COMERCIOS.find((c: { requiereCuenta?: boolean }) => c.requiereCuenta)!.clave;
const CONECTOR = conectorDePortal(COMERCIO);

beforeEach(() => { filas.length = 0; });

describe('credencial de portal guardada como v2 (A37-O7-01)', () => {
  const guardarV2 = () => filas.push({
    tenant_id: TENANT, conector_id: CONECTOR, activo: true,
    valores_cifrados: cifrar({ usuario: 'u@flota.mx', contrasena: 's3creto' }, contextoCredencial(TENANT, CONECTOR)),
  });
  const guardarV1 = () => filas.push({
    tenant_id: TENANT, conector_id: CONECTOR, activo: true,
    valores_cifrados: cifrar({ usuario: 'u@flota.mx', contrasena: 'viejo' }),
  });

  it('guardado por la ruta REAL (guardarCredencial) se lee por los tres lectores de portales', async () => {
    await guardarCredencial(TENANT, CONECTOR, { usuario: 'u@flota.mx', contrasena: 's3creto' });
    expect(filas[0].valores_cifrados.startsWith('v2.')).toBe(true);
    const esperado = { usuario: 'u@flota.mx', contrasena: 's3creto' };
    expect(await credencialDePortal(TENANT, COMERCIO)).toEqual(esperado);
    expect((await credencialesDePortales(TENANT)).get(COMERCIO)).toEqual(esperado);
    expect(await contrasenaDePortal(TENANT, COMERCIO)).toEqual(esperado);
  });

  it('credencialDePortal abre la v2', async () => {
    guardarV2();
    expect(await credencialDePortal(TENANT, COMERCIO)).toEqual({ usuario: 'u@flota.mx', contrasena: 's3creto' });
  });

  it('credencialesDePortales abre la v2', async () => {
    guardarV2();
    const m = await credencialesDePortales(TENANT);
    expect(m.get(COMERCIO)).toEqual({ usuario: 'u@flota.mx', contrasena: 's3creto' });
  });

  it('contrasenaDePortal abre la v2', async () => {
    guardarV2();
    expect(await contrasenaDePortal(TENANT, COMERCIO)).toEqual({ usuario: 'u@flota.mx', contrasena: 's3creto' });
  });

  it('las filas v1 antiguas siguen abriendo en todos los lectores', async () => {
    guardarV1();
    expect((await credencialDePortal(TENANT, COMERCIO))?.contrasena).toBe('viejo');
    expect((await credencialesDePortales(TENANT)).get(COMERCIO)?.contrasena).toBe('viejo');
    expect((await contrasenaDePortal(TENANT, COMERCIO))?.contrasena).toBe('viejo');
  });

  it('una v2 copiada a otra flota NO abre (el contexto sigue atando)', async () => {
    guardarV2();
    expect(await credencialDePortal('77777777-7777-7777-7777-777777777777', COMERCIO)).toBeNull();
    filas[0].tenant_id = '77777777-7777-7777-7777-777777777777';
    expect(await credencialDePortal('77777777-7777-7777-7777-777777777777', COMERCIO)).toBeNull();
  });

  it('borrarContrasenaGuardada lee la v2 y deja el usuario, aún legible', async () => {
    guardarV2();
    expect(await borrarContrasenaGuardada(TENANT, COMERCIO)).toBe(true);
    expect(filas[0].valores_cifrados.startsWith('v2.')).toBe(true);
    const sin = await credencialDePortal(TENANT, COMERCIO);
    expect(sin).toEqual({ usuario: 'u@flota.mx' });
  });
});
