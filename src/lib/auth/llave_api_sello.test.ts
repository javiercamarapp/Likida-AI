// A37-S24-09 — el sello `ultimo_uso_en` no escribe en CADA petición de /v1: un
// TMS que sondea cada segundo generaba una escritura por segundo sobre la misma
// fila, y sin `await` la promesa podía morir con la invocación serverless.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let filas: Array<Record<string, unknown>> = [];
const updates: unknown[] = [];

function builder() {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.is = () => b;
  b.update = (v: unknown) => { updates.push(v); return b; };
  b.limit = async () => ({ data: filas, error: null });
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builder() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { resolverLlave, generarLlave } = await import('./llave-api');
const LLAVE = generarLlave();
const fila = (ultimo: string | null) => ({
  id: 'l-1', tenant_id: 't-1', area: 'administracion', hash: LLAVE.hash, expira_en: null, ultimo_uso_en: ultimo,
});

beforeEach(() => { filas = []; updates.length = 0; });

describe('resolverLlave — sello de último uso con límite de frecuencia', () => {
  it('una llave sin sello previo lo escribe', async () => {
    filas = [fila(null)];
    expect(await resolverLlave(LLAVE.enClaro)).toMatchObject({ ok: true });
    expect(updates).toHaveLength(1);
  });

  it('un sello de hace 10 segundos NO se vuelve a escribir', async () => {
    filas = [fila(new Date(Date.now() - 10_000).toISOString())];
    expect(await resolverLlave(LLAVE.enClaro)).toMatchObject({ ok: true });
    expect(updates).toHaveLength(0);
  });

  it('un sello de hace una hora sí se renueva', async () => {
    filas = [fila(new Date(Date.now() - 3_600_000).toISOString())];
    expect(await resolverLlave(LLAVE.enClaro)).toMatchObject({ ok: true });
    expect(updates).toHaveLength(1);
  });
});
