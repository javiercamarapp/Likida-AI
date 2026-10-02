import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

// La puerta de un export del Vigía: sesión → flota → área `operacion` → `puedeExportar`; el grupo y el histórico se buscan CON el
// tenant de la sesión (un grupo ajeno es 404); sin las tablas de la 0484 es 409; xlsx por omisión y pdf si se pide.

let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } =
  { ok: true, tenantId: 't-1', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
let permitido = true;
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => permitido, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/liquidacion_externa/repo', () => ({ leerRazonSocial: async () => 'Flota Ejemplo SA' }));
vi.mock('@/lib/likida/vigia/repo', () => ({ crearRepoVigia: () => ({ config: async () => ({ slaCriticoMin: 8 }) }) }));

const leerMensajes = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
const grupo = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@/lib/likida/vigia/historial/repo', () => ({
  leerMensajesHistorial: (...a: unknown[]) => leerMensajes(...a),
  grupoDeFlota: (...a: unknown[]) => grupo(...a),
}));
const { GET } = await import('./route');

const G = '11111111-1111-4111-8111-111111111111';
const m = (n: number, rol: 'cliente' | 'equipo', texto: string, min = 0) => ({ enviadoEn: new Date(Date.UTC(2026, 8, 1 + n, 15, min)).toISOString(), rol, autorHash: 'a'.repeat(12), texto });
const mensajes = [0, 1, 2].flatMap((i) => [m(i, 'cliente', '¿Dónde va mi viaje?'), m(i, 'equipo', 'Va por Querétaro.', 5)]);
const get = (qs = '') => GET(new Request(`https://app.likida.ai/api/export/vigia-faqs${qs}`));

beforeEach(() => {
  tenant = { ok: true, tenantId: 't-1', rol: 'flota_admin' }; permitido = true;
  leerMensajes.mockReset(); leerMensajes.mockResolvedValue({ mensajes, truncado: false });
  grupo.mockReset(); grupo.mockResolvedValue({ id: G, nombre: 'Operación Cliente A' });
});

describe('la puerta', () => {
  it('sin sesión → el status de la credencial y no se lee nada', async () => {
    tenant = { ok: false, status: 401, motivo: 'no' };
    expect((await get()).status).toBe(401);
    expect(leerMensajes).not.toHaveBeenCalled();
  });
  it('un rol sin área de operación o que no exporta → 403 sin leer', async () => {
    for (const rol of ['operador', 'contador', 'vendedor']) {
      tenant = { ok: true, tenantId: 't-1', rol };
      expect((await get()).status, rol).toBe(403);
    }
    expect(leerMensajes).not.toHaveBeenCalled();
  });
  it('el dueño y el encargado sí', async () => {
    for (const rol of ['flota_admin', 'encargado']) {
      tenant = { ok: true, tenantId: 't-1', rol };
      expect((await get()).status, rol).toBe(200);
    }
  });
  it('rate limit → 429', async () => {
    permitido = false;
    expect((await get()).status).toBe(429);
  });
});

describe('los parámetros', () => {
  it('`grupo` y `formato` mal formados → 400 sin leer', async () => {
    expect((await get('?grupo=no-es-uuid')).status).toBe(400);
    expect((await get('?formato=csv')).status).toBe(400);
    expect(leerMensajes).not.toHaveBeenCalled();
  });
  it('un grupo que no es de la flota de la sesión → 404, y se busca con ESE tenant', async () => {
    grupo.mockResolvedValue(null);
    expect((await get(`?grupo=${G}`)).status).toBe(404);
    expect(grupo).toHaveBeenCalledWith('t-1', G);
    expect(leerMensajes).not.toHaveBeenCalled();
  });
});

describe('el archivo', () => {
  it('Excel por omisión, de TODOS los grupos con el tenant de la sesión, sin caché y con el umbral de la config', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/spreadsheetml/);
    expect(r.headers.get('Content-Disposition')).toContain('preguntas_frecuentes_vigia_likida.xlsx');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(leerMensajes).toHaveBeenCalledWith('t-1', null);
    const libro = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: 'array' });
    const resumen = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets['Resumen'], { header: 1, defval: null });
    expect(resumen.flat()).toContain('Alcance: Todos los grupos');
    expect(resumen.some((f) => String(f[0]).startsWith('Esperas que pasaron de 8 min'))).toBe(true);
  });

  it('con un grupo de la flota: lo nombra y lee solo ese', async () => {
    const r = await get(`?grupo=${G}`);
    expect(r.status).toBe(200);
    expect(leerMensajes).toHaveBeenCalledWith('t-1', G);
    const libro = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: 'array' });
    expect(XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets['Resumen'], { header: 1 }).flat()).toContain('Alcance: Operación Cliente A');
  });

  it('PDF si se pide', async () => {
    const r = await get('?formato=pdf');
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('application/pdf');
    expect(Buffer.from(new Uint8Array(await r.arrayBuffer()).slice(0, 5)).toString()).toBe('%PDF-');
  });

  it('sin las tablas de la 0484 → 409 (no un archivo vacío); sin histórico → 404; si la lectura revienta → 500 sin detalle', async () => {
    leerMensajes.mockResolvedValue(null);
    expect((await get()).status).toBe(409);
    leerMensajes.mockResolvedValue({ mensajes: [], truncado: false });
    expect((await get()).status).toBe(404);
    leerMensajes.mockRejectedValue(new Error('connection refused 10.0.0.5'));
    const r = await get();
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('10.0.0.5');
  });
});
