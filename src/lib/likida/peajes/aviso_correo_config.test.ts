import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const R = await import('./repo');
const T = 'tenant-1';
beforeEach(() => { db = crearDbFalsa({}); });

describe('configuración del correo de avisos (umbrales.correo_avisos)', () => {
  it('una flota sin fila lee apagado y sin destinatarios', async () => {
    expect(await R.leerCorreoAvisos(T)).toEqual({ activo: false, destinatarios: [], asunto: null, noEnviarAntes: null });
  });
  it('guarda, relee y no mezcla flotas; lo inválido no escribe nada', async () => {
    const r = await R.guardarCorreoAvisos(T, { activo: true, destinatarios: ['ana@flota.mx'], noEnviarAntes: '2026-10-01' });
    expect(r.ok).toBe(true);
    expect((await R.leerCorreoAvisos(T)).destinatarios).toEqual(['ana@flota.mx']);
    expect((await R.leerCorreoAvisos('tenant-2')).activo).toBe(false);
    const mala = await R.guardarCorreoAvisos('tenant-3', { activo: true, destinatarios: [], noEnviarAntes: '2026-10-01' });
    expect(mala.ok).toBe(false);
    expect((db.tablas.peaje_atipico_config ?? []).filter((f) => f.tenant_id === 'tenant-3')).toHaveLength(0);
  });
  it('conserva plazo, interruptores y teléfono, y al revés', async () => {
    await R.guardarConfigAvisos(T, { plazo: { meses: 5 }, interruptores: { aviso_plazo: true } });
    await R.guardarCorreoAvisos(T, { activo: true, destinatarios: ['ana@flota.mx'], noEnviarAntes: '2026-10-01' });
    let c = await R.leerConfigPeajes(T);
    expect(c.avisos.plazo.meses).toBe(5);
    expect(c.avisos.interruptores.aviso_plazo).toBe(true);
    await R.guardarConfigAvisos(T, { plazo: { meses: 6 } });
    expect((await R.leerCorreoAvisos(T)).activo).toBe(true);
    c = await R.leerConfigPeajes(T);
    expect(c.avisos.plazo.meses).toBe(6);
  });
});
