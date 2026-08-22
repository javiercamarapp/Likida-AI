import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios, fuentesDeProduccion } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · A1 — `bitacora_auditoria` tenía 17 escritores a mano y tres
// firmas de actor distintas; uno ya escribía la entidad equivocada. El
// escritor es UNO (`bitacora_escritura.ts`) y esta red impide que vuelva a
// haber dos.
// ═══════════════════════════════════════════════════════════════════════════

const insert = vi.fn();
const logs = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (tabla: string) => ({ insert: (fila: unknown) => insert(tabla, fila) }) }),
}));
vi.mock('@/lib/logger', () => ({ logger: logs }));

const { anotarBitacora, filaBitacora } = await import('./bitacora_escritura');

const ESCRITOR = 'src/lib/likida/bitacora_escritura.ts';

describe('un solo escritor de bitacora_auditoria', () => {
  it('ningún archivo de producción fuera del escritor hace .from(bitacora_auditoria).insert(', () => {
    const culpables = fuentesDeProduccion('src')
      .filter((f) => f !== ESCRITOR)
      .filter((f) => /\.from\(\s*['"]bitacora_auditoria['"]\s*\)\s*\.insert\(/.test(sinComentarios(readFileSync(f, 'utf8'))));
    expect(
      culpables,
      'Escribe la bitácora con `anotarBitacora()` de lib/likida/bitacora_escritura.ts: ' +
        'ahí vive la forma de la fila (entidad tipada, actor con las dos columnas) y el fallo best-effort.',
    ).toEqual([]);
  });

  it('el escritor sí la escribe, y en ningún otro sitio se escribe con otro verbo', () => {
    const fuente = sinComentarios(readFileSync(ESCRITOR, 'utf8'));
    expect(fuente).toMatch(/\.from\('bitacora_auditoria'\)\.insert\(/);
    // `upsert`/`update`/`delete` sobre la tabla son un error por definición: es append-only.
    const otros = fuentesDeProduccion('src').filter((f) =>
      /bitacora_auditoria['"]\s*\)\s*\.(upsert|update|delete)\(/.test(sinComentarios(readFileSync(f, 'utf8'))),
    );
    expect(otros).toEqual([]);
  });
});

describe('la forma de la fila', () => {
  it('firma SIEMPRE con actor_id y actor_email, null cuando faltan', () => {
    expect(filaBitacora({ tenantId: 't-1', actor: { id: 'u-1' }, accion: 'x', entidad: 'tenant', entidadId: 't-1' }))
      .toEqual({ tenant_id: 't-1', actor_id: 'u-1', actor_email: null, accion: 'x', entidad: 'tenant', entidad_id: 't-1', detalle: null });
    expect(filaBitacora({ tenantId: 't-1', actor: { id: 'u-1', email: 'a@b.mx' }, accion: 'x', entidad: 'viaje', entidadId: 'v-1', detalle: { k: 1 } }))
      .toMatchObject({ actor_id: 'u-1', actor_email: 'a@b.mx', detalle: { k: 1 } });
  });

  it("'sistema' deja las dos columnas en null a propósito (el lector pinta 'sistema')", () => {
    expect(filaBitacora({ tenantId: null, actor: 'sistema', accion: 'x', entidad: 'runner', entidadId: 'nivel2' }))
      .toMatchObject({ tenant_id: null, actor_id: null, actor_email: null });
  });
});

describe('anotarBitacora', () => {
  beforeEach(() => { insert.mockReset(); logs.warn.mockReset(); });

  it('inserta en bitacora_auditoria y devuelve true', async () => {
    insert.mockResolvedValueOnce({ data: null, error: null });
    const ok = await anotarBitacora({ tenantId: 't-1', actor: { id: 'u' }, accion: 'flota.creada', entidad: 'tenant', entidadId: 't-1' });
    expect(ok).toBe(true);
    expect(insert).toHaveBeenCalledWith('bitacora_auditoria', expect.objectContaining({ accion: 'flota.creada', actor_id: 'u', actor_email: null }));
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it('un error POR VALOR no revienta: loguea con el evento del módulo y devuelve false', async () => {
    insert.mockResolvedValueOnce({ data: null, error: { message: 'fetch failed' } });
    const ok = await anotarBitacora(
      { tenantId: null, actor: { id: 'u' }, accion: 'interruptor.apagado', entidad: 'interruptor', entidadId: 'ocr' },
      { evento: 'interruptores.bitacora_no_escribio', contexto: { interruptor: 'ocr' } },
    );
    expect(ok).toBe(false);
    expect(logs.warn).toHaveBeenCalledWith('interruptores.bitacora_no_escribio',
      expect.objectContaining({ err: 'fetch failed', interruptor: 'ocr', accion: 'interruptor.apagado' }));
  });

  it('una excepción tampoco revienta — la acción ya ocurrió', async () => {
    insert.mockRejectedValueOnce(new Error('base caída'));
    const ok = await anotarBitacora({ tenantId: 't', actor: 'sistema', accion: 'x', entidad: 'tenant', entidadId: 't' });
    expect(ok).toBe(false);
    expect(logs.warn).toHaveBeenCalledWith('bitacora.no_escribio', expect.objectContaining({ err: 'base caída' }));
  });
});
