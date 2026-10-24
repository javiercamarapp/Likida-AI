import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

// A37-S14-09: cambiar el host de la consulta periódica no puede mandar el token Bearer ANTERIOR al destino nuevo.
// A37-S14-05: anular un desglose promete que el archivo corregido puede reenviarse: si la liberación de la huella falla, se dice
// (no se devuelve «anulado») y un reintento sobre un desglose ya anulado la completa.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { guardarPullPeajes, anularDesgloseDb } = await import('./repo');

const T = 'flota-1';
const URL_VIEJA = 'https://sistema.ejemplo.test/api/cortes';

describe('A37-S14-09: el token del pull no viaja a otro host', () => {
  beforeEach(() => {
    db = crearDbFalsa({ peaje_ingesta_config: [{ tenant_id: T, activa: false, pull_url: URL_VIEJA, pull_activo: true, pull_credencial_cifrada: 'CIFRADO-VIEJO' }] });
  });
  const fila = () => db.tablas.peaje_ingesta_config[0];

  it('otro host SIN token nuevo: se rechaza, no se cambia nada y la credencial vieja no se reutiliza', async () => {
    const r = await guardarPullPeajes(T, { url: 'https://otro.ejemplo.test/api/cortes', token: '', intervaloMin: 60 });
    expect(r).toMatchObject({ ok: false, motivo: expect.stringMatching(/token/i) });
    expect(fila()).toMatchObject({ pull_url: URL_VIEJA, pull_credencial_cifrada: 'CIFRADO-VIEJO' });
  });

  it('el mismo host (otra ruta o intervalo) conserva el token como siempre', async () => {
    const r = await guardarPullPeajes(T, { url: 'https://sistema.ejemplo.test/v2/cortes', token: '', intervaloMin: 30 });
    expect(r).toEqual({ ok: true });
    expect(fila()).toMatchObject({ pull_url: 'https://sistema.ejemplo.test/v2/cortes', pull_credencial_cifrada: 'CIFRADO-VIEJO', pull_intervalo_min: 30 });
  });

  it('otro host sin token guardado antes: no hay nada que filtrar, se guarda', async () => {
    db = crearDbFalsa({ peaje_ingesta_config: [{ tenant_id: T, activa: false, pull_url: URL_VIEJA, pull_credencial_cifrada: null }] });
    expect(await guardarPullPeajes(T, { url: 'https://otro.ejemplo.test/x', token: '', intervaloMin: 60 })).toEqual({ ok: true });
  });

  it('primera configuración (sin fila): se guarda', async () => {
    db = crearDbFalsa({});
    expect(await guardarPullPeajes(T, { url: URL_VIEJA, token: '', intervaloMin: 60 })).toEqual({ ok: true });
  });

  it('si no se puede leer la configuración vigente y falta token, NO se arriesga: se rechaza', async () => {
    db.fallar('peaje_ingesta_config.select', 'caída');
    const r = await guardarPullPeajes(T, { url: 'https://otro.ejemplo.test/x', token: '', intervaloMin: 60 });
    expect(r.ok).toBe(false);
    expect(fila().pull_url).toBe(URL_VIEJA);
  });
});

describe('A37-S14-05: anular libera la huella o lo dice', () => {
  const D = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const sembrar = () => ({
    desglose_peaje: [{ id: D, tenant_id: T, anulado_en: null }],
    peaje_ingesta_archivo: [{ id: 'a1', tenant_id: T, desglose_id: D, huella: 'H1', origen: 'correo' }],
    peaje_reclamo: [],
  });

  it('si falla el UPDATE de la huella, anular NO devuelve «anulado» (lanza)', async () => {
    db = crearDbFalsa(sembrar());
    db.fallar('peaje_ingesta_archivo.update', 'caída');
    await expect(anularDesgloseDb(T, D, 'archivo equivocado', 'ana')).rejects.toThrow(/huella/i);
    expect(db.tablas.desglose_peaje[0].anulado_en).not.toBeNull(); // la anulación sí quedó
    expect(db.tablas.peaje_ingesta_archivo[0].huella).toBe('H1');   // la huella sigue tomada
  });

  it('el reintento sobre el desglose ya anulado completa la liberación', async () => {
    db = crearDbFalsa(sembrar());
    db.fallar('peaje_ingesta_archivo.update', 'caída');
    await expect(anularDesgloseDb(T, D, 'x', 'ana')).rejects.toThrow();
    db = crearDbFalsa(db.tablas); // la base se recuperó
    expect(await anularDesgloseDb(T, D, 'x', 'ana')).toBe('ya_anulado');
    expect(db.tablas.peaje_ingesta_archivo[0].huella).not.toBe('H1');
  });

  it('lo entregado por pull/SFTP sigue conservando su huella (A37-A2-08) también en el reintento', async () => {
    db = crearDbFalsa({ ...sembrar(), peaje_ingesta_archivo: [{ id: 'a1', tenant_id: T, desglose_id: D, huella: 'H1', origen: 'pull' }] });
    await anularDesgloseDb(T, D, 'x', 'ana');
    await anularDesgloseDb(T, D, 'x', 'ana');
    expect(db.tablas.peaje_ingesta_archivo[0].huella).toBe('H1');
  });

  it('un desglose que no es de la flota sigue siendo «no_encontrado» y no toca archivos', async () => {
    db = crearDbFalsa(sembrar());
    expect(await anularDesgloseDb('otra-flota', D, 'x', 'ana')).toBe('no_encontrado');
    expect(db.tablas.peaje_ingesta_archivo[0].huella).toBe('H1');
  });
});
