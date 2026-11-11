import { describe, it, expect, vi, beforeEach } from 'vitest';

// «Pregunta a tus datos» bajo el perfil `cinco_agentes` (abierto el 11-nov): el analista solo OFRECE las herramientas de los cinco
// agentes y, si el modelo inventa el nombre de otra, el ejecutor la niega sin tocar ningún dato.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base en pruebas'); } }));
let perfil: 'cinco_agentes' | null = 'cinco_agentes';
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => perfil }));

const generateWithTools = vi.fn();
vi.mock('@/lib/llm/openrouter', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, generateWithTools: (...a: unknown[]) => generateWithTools(...(a as [never])) };
});
const { ejecutarAnalista } = await import('./analista');

type Opts = { tools: Array<{ function: { name: string } }>; toolExecutor: (n: string, a: Record<string, unknown>) => Promise<{ result: unknown }> };
let ofrecidas: string[] = [];
let respuestaProhibida: unknown = null;

beforeEach(() => {
  generateWithTools.mockReset();
  ofrecidas = [];
  respuestaProhibida = null;
  generateWithTools.mockImplementation(async (o: Opts) => {
    ofrecidas = o.tools.map((t) => t.function.name);
    respuestaProhibida = (await o.toolExecutor('motor_fiscal', {})).result;
    return { finalText: 'Hola.', toolCalls: [], model: 'm', tokensIn: 1, tokensOut: 1, cost: 0, costoPorModelo: {} };
  });
});

const preguntar = () => ejecutarAnalista({ tenantId: 't-1', nombreFlota: 'Flota', usuario: { nombre: 'Ana', rol: 'flota_admin' }, mensajes: [{ rol: 'usuario', texto: 'hola' }] });

describe('analista bajo el perfil cinco_agentes', () => {
  it('ofrece solo las herramientas de los cinco agentes, nunca lo fiscal, el gasto ni la cobranza', async () => {
    await preguntar();
    for (const h of ['kpis_flota', 'consultar_carta_porte', 'estado_vigia', 'tablero_viajes', 'entregar_respuesta']) expect(ofrecidas, h).toContain(h);
    for (const h of ['motor_fiscal', 'acreditables_periodo', 'serie_gasto', 'estado_cobranza', 'estado_autofactura', 'estado_buzon', 'top_rutas', 'escalar_a_persona']) expect(ofrecidas, h).not.toContain(h);
  });

  it('una herramienta inventada fuera del perfil se niega dentro del ejecutor, sin devolver datos', async () => {
    await preguntar();
    expect(JSON.stringify(respuestaProhibida)).toMatch(/no está incluida en el plan/);
  });

  it('sin perfil el analista conserva todas las herramientas del rol (control)', async () => {
    perfil = null;
    await preguntar();
    expect(ofrecidas).toContain('motor_fiscal');
    expect(ofrecidas).toContain('estado_cobranza');
    perfil = 'cinco_agentes';
  });
});
