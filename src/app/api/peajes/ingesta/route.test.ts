import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from '@/lib/likida/peajes/db_falsa.test.util';

// El buzón firmado del desglose de peajes. Lo que se fija es su CONTRATO de
// seguridad y de idempotencia: firma antes que nada, fail-closed sin secreto,
// flota sin activar = misma respuesta que firma mala, el tenant solo de la
// cabecera firmada, tope de cuerpo, kill switch con 503 (reintentable) y el
// mismo archivo dos veces = una fila.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
let apagado = false;
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado: async () => apagado }));
let limitar: (clave: string) => boolean = () => true;
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async (clave: string) => limitar(clave), clientIp: () => '1.2.3.4' }));

const { claveDeFlota, firmarIngesta, MAX_CUERPO_INGESTA_BYTES } = await import('@/lib/likida/peajes/ingesta');
const { POST } = await import('./route');

const SECRETO = 's'.repeat(40);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CSV = 'Fecha,Caseta,Importe\n05/08/2026,Caseta Ejemplo Norte,189.00\n';
const cuerpoDe = (o: Record<string, unknown> = {}) => JSON.stringify({ nombre: 'corte.csv', proveedor: 'PASE', contenido_base64: Buffer.from(CSV).toString('base64'), ...o });
const nowSeg = () => Math.floor(Date.now() / 1000);

function pedir(cuerpo: string, o: { flota?: string | null; firmarCon?: string; ts?: number; firma?: string | null; sinFirma?: boolean } = {}) {
  const flota = o.flota === undefined ? A : o.flota;
  const ts = o.ts ?? nowSeg();
  const clave = claveDeFlota(SECRETO, o.firmarCon ?? flota ?? A, 1);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-likida-timestamp': String(ts) };
  if (flota) headers['x-likida-flota'] = flota;
  if (!o.sinFirma) headers['x-likida-firma'] = o.firma ?? firmarIngesta(clave, flota ?? A, ts, cuerpo);
  return POST(new Request('https://app.likida.ai/api/peajes/ingesta', { method: 'POST', headers, body: cuerpo }));
}

beforeEach(() => {
  process.env.PEAJES_INGESTA_SECRETO = SECRETO;
  apagado = false;
  limitar = () => true;
  db = crearDbFalsa({
    peaje_ingesta_config: [{ tenant_id: A, rotacion: 1, activa: true }, { tenant_id: B, rotacion: 1, activa: false }],
    peaje_ingesta_archivo: [],
  });
});

describe('la firma es la puerta', () => {
  it('firma buena → 202 y el archivo queda en cola de LA FLOTA de la cabecera', async () => {
    const r = await pedir(cuerpoDe());
    expect(r.status).toBe(202);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, duplicado: false, estado: 'pendiente' });
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(1);
    expect(db.tablas.peaje_ingesta_archivo[0]).toMatchObject({ tenant_id: A, nombre: 'corte.csv', proveedor: 'PASE', origen: 'api' });
  });

  it('sin firma, firma basura o firma de otro cuerpo → 401 SIN detalle y sin tocar la cola', async () => {
    for (const o of [{ sinFirma: true }, { firma: 'v1=abc' }, { firma: '' }]) {
      const r = await pedir(cuerpoDe(), o);
      expect(r.status).toBe(401);
      expect(await r.text()).toBe('Firma no válida.');
    }
    const firmada = await pedir(cuerpoDe({ nombre: 'otro.csv' }), { firma: firmarIngesta(claveDeFlota(SECRETO, A, 1), A, nowSeg(), cuerpoDe()) });
    expect(firmada.status).toBe(401);
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(0);
  });

  it('SIN PEAJES_INGESTA_SECRETO (o corto) todo se rechaza: una variable olvidada no abre el buzón', async () => {
    delete process.env.PEAJES_INGESTA_SECRETO;
    expect((await pedir(cuerpoDe())).status).toBe(401);
    process.env.PEAJES_INGESTA_SECRETO = 'corto';
    expect((await pedir(cuerpoDe())).status).toBe(401);
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(0);
  });

  it('flota sin activar o desconocida → la MISMA respuesta que una firma mala (no se revela qué existe)', async () => {
    const inactiva = await pedir(cuerpoDe(), { flota: B });
    const desconocida = await pedir(cuerpoDe(), { flota: '33333333-3333-4333-8333-333333333333' });
    const mala = await pedir(cuerpoDe(), { firma: 'v1=zzz' });
    for (const r of [inactiva, desconocida, mala]) {
      expect(r.status).toBe(401);
      expect(await r.text()).toBe('Firma no válida.');
    }
  });

  it('flota ausente o con forma inválida (incluida una inyección) → 401', async () => {
    for (const flota of [null, 'no-uuid', "'; drop table peaje_tag; --", A + 'x', '']) {
      expect((await pedir(cuerpoDe(), { flota, firmarCon: A })).status, String(flota)).toBe(401);
    }
  });

  it('la firma de la flota A NO sirve para entrar como la flota B (aunque B esté activa)', async () => {
    db.tablas.peaje_ingesta_config[1].activa = true;
    const r = await pedir(cuerpoDe(), { flota: B, firmarCon: A });
    expect(r.status).toBe(401);
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(0);
  });

  it('el tenant SOLO viene de la cabecera firmada: un tenant_id en el cuerpo no redirige el archivo', async () => {
    const r = await pedir(cuerpoDe({ tenant_id: B, flota: B }));
    expect(r.status).toBe(202);
    expect(db.tablas.peaje_ingesta_archivo[0].tenant_id).toBe(A);
  });

  it('una llave ROTADA invalida lo firmado con la anterior', async () => {
    db.tablas.peaje_ingesta_config[0].rotacion = 2;
    expect((await pedir(cuerpoDe())).status).toBe(401);
  });

  it('el timestamp viejo (replay de una captura) → 401', async () => {
    expect((await pedir(cuerpoDe(), { ts: nowSeg() - 600 })).status).toBe(401);
    expect((await pedir(cuerpoDe(), { ts: nowSeg() + 600 })).status).toBe(401);
  });

  it('un fallo de base al validar la flota es 503 (el remitente reintenta), no 401', async () => {
    db.fallar('peaje_ingesta_config.select', 'base caída');
    expect((await pedir(cuerpoDe())).status).toBe(503);
  });
});

describe('idempotencia y límites', () => {
  it('el MISMO archivo dos veces (reintento del proveedor) → 200 duplicado y UNA fila', async () => {
    const a = await pedir(cuerpoDe());
    const b = await pedir(cuerpoDe({ nombre: 'renombrado.csv' }));
    expect(a.status).toBe(202);
    expect(b.status).toBe(200);
    expect(await b.json()).toMatchObject({ ok: true, duplicado: true });
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(1);
  });

  it('cuerpo enorme → 413 antes de firmar nada', async () => {
    const r = await pedir('x'.repeat(MAX_CUERPO_INGESTA_BYTES + 10));
    expect(r.status).toBe(413);
  });

  it('JSON roto pero bien FIRMADO → 400 con el motivo (el firmante sí puede saberlo)', async () => {
    const r = await pedir('{no es json');
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/JSON/);
  });

  it('archivo con extensión no aceptada / base64 inválido → 400', async () => {
    expect((await pedir(cuerpoDe({ nombre: 'virus.exe' }))).status).toBe(400);
    expect((await pedir(cuerpoDe({ contenido_base64: '***' }))).status).toBe(400);
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(0);
  });

  it('rate limit por IP y por flota → 429', async () => {
    limitar = (c) => !c.includes(':ip:');
    expect((await pedir(cuerpoDe())).status).toBe(429);
    limitar = (c) => !c.includes(':flota:');
    expect((await pedir(cuerpoDe())).status).toBe(429);
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(0);
  });

  it('cola llena → 429', async () => {
    db.tablas.peaje_ingesta_archivo = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, tenant_id: A, huella: `h${i}`, estado: 'pendiente' }));
    expect((await pedir(cuerpoDe())).status).toBe(429);
  });
});

describe('el kill switch', () => {
  it('agente apagado → 503 (NO 200): el remitente reintenta y el archivo no se pierde para siempre', async () => {
    apagado = true;
    const r = await pedir(cuerpoDe());
    expect(r.status).toBe(503);
    expect(db.tablas.peaje_ingesta_archivo).toHaveLength(0);
    apagado = false;
    expect((await pedir(cuerpoDe())).status).toBe(202);
  });

  it('un error al guardar es 503, no un éxito falso', async () => {
    db.fallar('peaje_ingesta_archivo.insert', 'disco lleno');
    expect((await pedir(cuerpoDe())).status).toBe(503);
  });
});
