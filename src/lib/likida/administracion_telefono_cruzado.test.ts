// F1 lote B, L1H (CT-SEG-07 / X-01): el alta y la edición de un operador comprobaban el teléfono SOLO contra `operador`.
// Un número que ya es cuenta de oficina (app_user) o contacto activo del Vigía de OTRA flota se aceptaba, y el bot lo
// resolvería después a la flota equivocada. Ahora el chequeo amable (antes de la base) mira también esas dos tablas.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Op = [string, unknown[]];
let tablas: Record<string, unknown[] | { error: string }> = {};
const consultadas: string[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      consultadas.push(t);
      const ops: Op[] = [];
      const nodo: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit']) nodo[m] = (...a: unknown[]) => { ops.push([m, a]); return nodo; };
      nodo.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise.resolve().then(() => {
        const v = tablas[t] ?? [];
        return Array.isArray(v) ? { data: v, error: null } : { data: null, error: { message: v.error } };
      }).then(r, j);
      return nodo;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true }));
vi.mock('./config', () => ({ getConfig: vi.fn() }));

const { comprobarTelefonoLibre, TELEFONO_NO_DISPONIBLE } = await import('./administracion');
const { DatoInvalido } = await import('./errores');

const MIA = 'tenant-mia';
const OTRA = 'tenant-otra';
beforeEach(() => { tablas = {}; consultadas.length = 0; });

describe('comprobarTelefonoLibre: contra operador, app_user y vigia_contacto', () => {
  it('libre en las tres: no lanza', async () => {
    await expect(comprobarTelefonoLibre(MIA, '525512345678')).resolves.toBeUndefined();
    expect(consultadas).toEqual(expect.arrayContaining(['operador', 'app_user', 'vigia_contacto']));
  });

  it('cuenta de oficina ACTIVA de otra flota con ese número: rechaza con el mensaje genérico (no dice de quién es ni dónde)', async () => {
    tablas.app_user = [{ id: 'u-1', tenant_id: OTRA, activo: true }];
    const e = await comprobarTelefonoLibre(MIA, '525512345678').catch((x) => x);
    expect(e).toBeInstanceOf(DatoInvalido);
    expect((e as Error).message).toBe(TELEFONO_NO_DISPONIBLE);
  });

  it('contacto ACTIVO del Vigía de otra flota con ese número: rechaza igual', async () => {
    tablas.vigia_contacto = [{ id: 'c-1', tenant_id: OTRA }];
    const e = await comprobarTelefonoLibre(MIA, '525512345678').catch((x) => x);
    expect(e).toBeInstanceOf(DatoInvalido);
    expect((e as Error).message).toBe(TELEFONO_NO_DISPONIBLE);
  });

  it('la cuenta de la MISMA flota, o una de baja de otra, no bloquea (un dueño que también maneja; rotación normal)', async () => {
    tablas.app_user = [{ id: 'u-1', tenant_id: MIA, activo: true }, { id: 'u-2', tenant_id: OTRA, activo: false }];
    await expect(comprobarTelefonoLibre(MIA, '525512345678')).resolves.toBeUndefined();
  });

  it('si no pudo leer app_user o vigia_contacto, FALLA CERRADO (sin poder comprobar no se escribe)', async () => {
    tablas.app_user = { error: 'caída' };
    await expect(comprobarTelefonoLibre(MIA, '525512345678')).rejects.toThrow(/no se pudo comprobar/);
    tablas = { vigia_contacto: { error: 'caída' } };
    await expect(comprobarTelefonoLibre(MIA, '525512345678')).rejects.toThrow(/no se pudo comprobar/);
  });
});
