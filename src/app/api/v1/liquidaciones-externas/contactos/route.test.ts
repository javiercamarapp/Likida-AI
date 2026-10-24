import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-A1-01: la puerta para cargar los correos de operadores y coordinadores. Todo sintético; la respuesta nunca repite un correo.

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

const guardados: Array<{ id: string; cambios: Record<string, unknown> }> = [];
const operadores = new Map<string, Array<{ id: string; correo: string | null; coordinadorId: string | null }>>();
const puerto = (tenantId: string) => ({
  buscarOperadores: async (numeros: readonly string[]) => new Map(numeros.filter((n) => operadores.has(n)).map((n) => [n, operadores.get(n)!])),
  asegurarCoordinador: async (c: { correo: string }) => ({ id: `coord-${c.correo}-${tenantId}`, creado: true }),
  guardarContacto: async (id: string, cambios: Record<string, unknown>) => { guardados.push({ id, cambios }); },
});
const puertoReal = vi.fn(puerto);
vi.mock('@/lib/likida/liquidacion_externa/repo_correo', () => ({ puertoContactosReal: (t: string) => puertoReal(t) }));

const { POST } = await import('./route');
const URL_BASE = 'https://app.likida.ai/api/v1/liquidaciones-externas/contactos';
const postear = (cuerpo: unknown) => POST(new Request(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }));
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  abrir.mockReset(); abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:administracion' });
  puertoReal.mockClear(); guardados.length = 0; operadores.clear();
  operadores.set('E-1', [{ id: 'op-1', correo: null, coordinadorId: null }]);
});

describe('POST /v1/liquidaciones-externas/contactos', () => {
  it('abre con área `administracion` y sin credencial no escribe nada', async () => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: new Response('no', { status: 401 }) });
    const r = await postear({ contactos: [{ numeroEmpleado: 'E-1', correo: 'op@ejemplo.test' }] });
    expect(r.status).toBe(401);
    expect(abrir.mock.calls[0][1]).toBe('administracion');
    expect(puertoReal).not.toHaveBeenCalled();
  });

  it('carga el correo del operador y su coordinador, con la flota de la credencial', async () => {
    const r = await postear({ contactos: [{ numeroEmpleado: 'E-1', correo: 'Op@Ejemplo.test', coordinadorNombre: 'Coord Uno', coordinadorCorreo: 'coord@ejemplo.test' }] });
    expect(r.status).toBe(200);
    expect(puertoReal).toHaveBeenCalledWith('t-1');
    expect(guardados).toEqual([{ id: 'op-1', cambios: { correo: 'op@ejemplo.test', coordinadorId: 'coord-coord@ejemplo.test-t-1' } }]);
    const d = (await json(r)).datos;
    expect(d).toMatchObject({ actualizados: 1, coordinadoresNuevos: 1 });
    expect(JSON.stringify(d)).not.toContain('@'); // ningún correo en la respuesta
  });

  it('un número que no existe se reporta y NO se crea el operador; uno con correo inválido no escribe', async () => {
    const r = await postear({ contactos: [{ numeroEmpleado: 'NOEXISTE', correo: 'a@ejemplo.test' }, { numeroEmpleado: 'E-1', correo: 'sin-arroba' }] });
    const d = (await json(r)).datos;
    expect(d.sinOperador).toHaveLength(1);
    expect(d.invalidas).toHaveLength(1);
    expect(guardados).toEqual([]);
  });

  it('el cuerpo es estricto: campos desconocidos (también `tenant_id`), lista vacía o más de 500 son 400', async () => {
    expect((await postear({ contactos: [{ numeroEmpleado: 'E-1', correo: 'a@e.test', tenant_id: 'otra' }] })).status).toBe(400);
    expect((await postear({ contactos: [{ numeroEmpleado: 'E-1', correo: 'a@e.test' }], tenant_id: 'otra' })).status).toBe(400);
    expect((await postear({ contactos: [] })).status).toBe(400);
    expect((await postear({ contactos: Array.from({ length: 501 }, (_, i) => ({ numeroEmpleado: `E-${i}`, correo: 'a@e.test' })) })).status).toBe(400);
    expect((await postear({ contactos: [{ numeroEmpleado: 7, correo: 'a@e.test' }] })).status).toBe(400);
    expect(guardados).toEqual([]);
  });

  it('es idempotente: lo que ya tiene el operador cae en «sin cambios»', async () => {
    operadores.set('E-1', [{ id: 'op-1', correo: 'op@ejemplo.test', coordinadorId: null }]);
    const d = (await json(await postear({ contactos: [{ numeroEmpleado: 'E-1', correo: 'op@ejemplo.test' }] }))).datos;
    expect(d).toMatchObject({ actualizados: 0, sinCambios: 1 });
    expect(guardados).toEqual([]);
  });

  it('una falla del puerto (base) es 5xx y no deja pasar el mensaje interno', async () => {
    puertoReal.mockImplementationOnce(() => ({ ...puerto('t-1'), buscarOperadores: async () => { throw new Error('secreto interno de la base'); } }));
    const r = await postear({ contactos: [{ numeroEmpleado: 'E-1', correo: 'a@ejemplo.test' }] });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(await json(r))).not.toContain('secreto interno');
  });
});
