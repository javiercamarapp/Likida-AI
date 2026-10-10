import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mundo } from '@/lib/likida/convenios/mundo.fixture';

let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401 | 403 | 503; motivo: string } = { ok: true, tenantId: 'ta', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
let mundo = new Mundo();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mundo.admin() }));

const { GET } = await import('./route');
const llamar = (tipo?: string) => GET(new Request(`https://app.likida.ai/api/export/convenios${tipo ? `?tipo=${tipo}` : ''}`));

beforeEach(() => {
  mundo = new Mundo();
  tenant = { ok: true, tenantId: 'ta', rol: 'flota_admin' };
  const c = mundo.poner('cliente', { tenant_id: 'ta', nombre: 'Cliente Uno' });
  const cb = mundo.poner('cliente', { tenant_id: 'tb', nombre: 'Cliente Ajeno' });
  const conv = mundo.poner('cliente_convenio', { tenant_id: 'ta', cliente_id: c.id, nombre: 'Ruta norte', origen: 'Zapopan', destino: 'Tlaquepaque', activo: true });
  mundo.poner('convenio_instruccion', { tenant_id: 'ta', convenio_id: conv.id, categoria: 'puerta', texto: 'Puerta 3', momento: 'ambos', lugar: 'destino', orden: 0, activa: true });
  mundo.poner('convenio_comercial', { tenant_id: 'ta', convenio_id: conv.id, tarifa_modo: 'por_viaje', tarifa_precio: 5000, tarifa_moneda: 'MXN', requisitos_cobro: ['Factura'] });
  const ajeno = mundo.poner('cliente_convenio', { tenant_id: 'tb', cliente_id: cb.id, nombre: 'Ruta ajena', activo: true });
  mundo.poner('convenio_instruccion', { tenant_id: 'tb', convenio_id: ajeno.id, categoria: 'puerta', texto: 'SECRETO DE B', momento: 'ambos', lugar: 'ambos', orden: 0, activa: true });
  mundo.poner('cliente_convenio', { tenant_id: 'ta', cliente_id: c.id, nombre: 'Archivada', activo: false });
});

describe('GET /api/export/convenios', () => {
  it('las instrucciones salen SIN dinero, solo de la flota de la sesión y sin los convenios archivados', async () => {
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('instrucciones_convenios_likida.csv');
    const t = await r.text();
    expect(t).toContain('Puerta 3');
    expect(t).not.toMatch(/5000|Factura|SECRETO DE B|Archivada/i);
    // y NI SIQUIERA se consultó el dinero
    expect(mundo.consultas.some((q) => q.tabla === 'convenio_comercial')).toBe(false);
  });

  it('el texto para pegar en el sistema de la flota', async () => {
    const t = await (await llamar('texto')).text();
    expect(t).toContain('Cliente Uno — Ruta norte (Zapopan → Tlaquepaque)');
    expect(t).toContain('- Por dónde entras [al descargar]: Puerta 3');
  });

  it('el completo lleva tarifa y cobro, y solo para quien ve el área de dinero (el jefe de tráfico no)', async () => {
    expect(await (await llamar('completo')).text()).toMatch(/5000.*Factura/);
    tenant = { ok: true, tenantId: 'ta', rol: 'encargado' };
    const r = await llamar('completo');
    expect(r.status).toBe(403);
    expect((await llamar('instrucciones')).status).toBe(200); // lo suyo sí
  });

  it('el contador (sin área de operación) y un rol desconocido no descargan; sin sesión, su código', async () => {
    for (const rol of ['contador', 'raro']) { tenant = { ok: true, tenantId: 'ta', rol }; expect((await llamar()).status).toBe(403); }
    tenant = { ok: false, status: 401, motivo: 'No autorizado' };
    expect((await llamar()).status).toBe(401);
  });

  it('un tipo desconocido es 400; la plantilla se baja sin tocar la base; la base sin migrar es 503', async () => {
    expect((await llamar('inventado')).status).toBe(400);
    mundo.consultas.length = 0;
    const p = await llamar('plantilla');
    expect(p.status).toBe(200);
    expect(await p.text()).toContain('EJEMPLO');
    expect(mundo.consultas).toHaveLength(0);
    mundo.ausentes.add('cliente_convenio');
    expect((await llamar()).status).toBe(503);
  });
});
