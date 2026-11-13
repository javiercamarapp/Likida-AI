import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parsearArgumentos, ejecutarAlta, type ArgsAlta, type Dependencias } from './linea_alta_cli';
import { descifrar } from '../likida/conectores/cofre';

// Núcleo testeable del alta de línea: validación de argumentos, dry-run sin escrituras y el token jamás en la salida.

const TENANT = '10000000-0000-4000-8000-00000000000a';
const PN = '111111111111111';
const WABA = '555555555555555';
const TOKEN = 'EAAT-token-permanente-secreto-9999';
const LLAVE_SB = 'service-role-key-secreta-de-prueba';
const LLAVE_COFRE = 'una-llave-de-cofre-de-prueba-de-mas-de-32-caracteres';

const base = ['--tenant', TENANT, '--phone-number-id', PN];
const args = (extra: Partial<ArgsAlta> = {}): ArgsAlta => ({
  tenantId: TENANT, phoneNumberId: PN, wabaId: WABA, numeroVisible: '+52 55 1234 5678', etiqueta: 'Servicio', proposito: 'servicio_cliente',
  terminalId: null, principal: true, activar: false, dryRun: false, ...extra,
});

describe('parsearArgumentos', () => {
  it('acepta lo mínimo y las banderas', () => {
    const r = parsearArgumentos([...base, '--waba-id', WABA, '--proposito', 'oficina', '--principal', '--activar', '--dry-run', '--etiqueta', ' Oficina ']);
    expect(r).toMatchObject({ ok: true, args: { tenantId: TENANT, phoneNumberId: PN, wabaId: WABA, proposito: 'oficina', etiqueta: 'Oficina', principal: true, activar: true, dryRun: true } });
  });
  it('rechaza uuid, ids, propósito y valores faltantes', () => {
    expect(parsearArgumentos(['--tenant', 'x', '--phone-number-id', PN])).toMatchObject({ ok: false });
    expect(parsearArgumentos(['--tenant', TENANT, '--phone-number-id', 'abc'])).toMatchObject({ ok: false });
    expect(parsearArgumentos([...base, '--proposito', 'marketing'])).toMatchObject({ ok: false });
    expect(parsearArgumentos([...base, '--etiqueta'])).toMatchObject({ ok: false });
    expect(parsearArgumentos([...base, '--terminal', 'no-uuid'])).toMatchObject({ ok: false });
    expect(parsearArgumentos([...base, '--raro'])).toMatchObject({ ok: false });
  });
  it('--activar exige --waba-id', () => {
    expect(parsearArgumentos([...base, '--activar'])).toMatchObject({ ok: false });
  });
  it('el token NO se acepta por argumentos y el error no lo repite', () => {
    const r = parsearArgumentos([...base, '--token', TOKEN]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

type Llamada = { url: string; method: string; body?: string };
function montar(opciones: { meta?: Record<string, { status: number; json: unknown }>; rest?: (l: Llamada) => { status: number; json: unknown } } = {}) {
  const llamadas: Llamada[] = [];
  const salida: string[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const l: Llamada = { url: u, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined };
    llamadas.push(l);
    let r: { status: number; json: unknown };
    if (u.startsWith('https://graph.facebook.com')) {
      const clave = u.includes('subscribed_apps') ? 'subs' : 'numero';
      r = opciones.meta?.[clave] ?? (clave === 'subs' ? { status: 200, json: { data: [{ id: 'app' }] } } : { status: 200, json: { id: PN, display_phone_number: '+52 55 1234 5678', verified_name: 'Flota' } });
    } else if (opciones.rest) r = opciones.rest(l);
    else if (u.includes('/rest/v1/tenant?')) r = { status: 200, json: [{ id: TENANT }] };
    else if (l.method === 'POST' && u.endsWith('/tenant_whatsapp_linea')) r = { status: 201, json: [{ id: 'lin-1' }] };
    else if (u.includes('/rpc/')) r = { status: 200, json: true };
    else r = { status: 204, json: null };
    return new Response(r.json === null ? null : JSON.stringify(r.json), { status: r.status });
  });
  const deps: Dependencias = {
    leerToken: async () => TOKEN,
    fetch: f as unknown as typeof fetch,
    env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: LLAVE_SB, LIKIDA_COFRE_LLAVE: LLAVE_COFRE },
    escribir: (l) => salida.push(l),
  };
  return { deps, llamadas, salida };
}
const escrituras = (ll: Llamada[]) => ll.filter((l) => l.method !== 'GET');

beforeEach(() => { process.env.LIKIDA_COFRE_LLAVE = LLAVE_COFRE; });

describe('ejecutarAlta', () => {
  it('dry-run valida contra Meta y la base pero NO escribe nada', async () => {
    const m = montar();
    const r = await ejecutarAlta(args({ dryRun: true, activar: true }), m.deps);
    expect(r.codigo).toBe(0);
    expect(escrituras(m.llamadas)).toEqual([]);
    expect(m.salida.join('\n')).toContain('DRY-RUN');
    expect(m.llamadas.every((l) => l.method === 'GET')).toBe(true);
  });

  it('alta real: inserta PENDIENTE con token cifrado v2 atado a flota y número (no en claro)', async () => {
    const m = montar();
    const r = await ejecutarAlta(args(), m.deps);
    expect(r).toEqual({ codigo: 0, lineaId: 'lin-1' });
    const post = escrituras(m.llamadas);
    expect(post).toHaveLength(1);
    const fila = JSON.parse(post[0].body as string);
    expect(fila).toMatchObject({ tenant_id: TENANT, phone_number_id: PN, estado: 'pendiente', principal: true, proposito: 'servicio_cliente', token_pistas: '…9999' });
    expect(fila.token_cifrado.startsWith('v2.')).toBe(true);
    expect(post[0].body).not.toContain(TOKEN);
    expect(descifrar(fila.token_cifrado, `${TENANT}:${PN}`)).toEqual({ token: TOKEN });
    expect(() => descifrar(fila.token_cifrado, `otro:${PN}`)).toThrow();
  });

  it('el token (y las llaves) nunca salen en la salida, ni en éxito ni en error', async () => {
    const ok = montar();
    await ejecutarAlta(args({ activar: true }), ok.deps);
    const mal = montar({ meta: { numero: { status: 401, json: { error: { code: 190, message: `Invalid OAuth ${TOKEN}` } } } } });
    await ejecutarAlta(args(), mal.deps);
    for (const s of [...ok.salida, ...mal.salida]) {
      expect(s).not.toContain(TOKEN);
      expect(s).not.toContain(LLAVE_SB);
      expect(s).not.toContain(LLAVE_COFRE);
    }
    expect(mal.salida.join('\n')).toContain('código 190');
  });

  it('si Meta no valida el token, aborta SIN guardar', async () => {
    const m = montar({ meta: { numero: { status: 400, json: { error: { code: 190 } } } } });
    const r = await ejecutarAlta(args(), m.deps);
    expect(r.codigo).toBe(1);
    expect(escrituras(m.llamadas)).toEqual([]);
  });

  it('si el token lee otro phone_number_id, aborta sin guardar', async () => {
    const m = montar({ meta: { numero: { status: 200, json: { id: '999' } } } });
    expect((await ejecutarAlta(args(), m.deps)).codigo).toBe(1);
    expect(escrituras(m.llamadas)).toEqual([]);
  });

  it('falta de entorno, flota inexistente, número de la plataforma y duplicado: no guardan', async () => {
    const sinEnv = montar();
    expect((await ejecutarAlta(args(), { ...sinEnv.deps, env: {} })).codigo).toBe(1);
    const sinLlave = montar();
    expect((await ejecutarAlta(args(), { ...sinLlave.deps, env: { ...sinLlave.deps.env, LIKIDA_COFRE_LLAVE: 'corta' } })).codigo).toBe(1);
    const plat = montar();
    expect((await ejecutarAlta(args(), { ...plat.deps, env: { ...plat.deps.env, WHATSAPP_PHONE_NUMBER_ID: PN } })).codigo).toBe(1);
    expect(plat.llamadas).toEqual([]);
    const sinFlota = montar({ rest: () => ({ status: 200, json: [] }) });
    expect((await ejecutarAlta(args(), sinFlota.deps)).codigo).toBe(1);
    expect(escrituras(sinFlota.llamadas)).toEqual([]);
    const dup = montar({ rest: (l) => (l.url.includes('/rest/v1/tenant?') ? { status: 200, json: [{ id: TENANT }] } : { status: 409, json: { code: '23505' } }) });
    expect((await ejecutarAlta(args(), dup.deps)).codigo).toBe(1);
  });

  it('--activar: webhook verificado -> activa y marca principal; sin suscripción -> queda pendiente (código 2)', async () => {
    const ok = montar();
    const r = await ejecutarAlta(args({ activar: true }), ok.deps);
    expect(r.codigo).toBe(0);
    const w = escrituras(ok.llamadas);
    expect(w.map((l) => l.method)).toEqual(['POST', 'PATCH', 'POST']);
    expect(JSON.parse(w[1].body as string)).toMatchObject({ estado: 'activa' });
    expect(w[2].url).toContain('rpc/tenant_whatsapp_linea_hacer_principal');

    const sin = montar({ meta: { subs: { status: 200, json: { data: [] } } } });
    const r2 = await ejecutarAlta(args({ activar: true }), sin.deps);
    expect(r2.codigo).toBe(2);
    expect(escrituras(sin.llamadas).map((l) => l.method)).toEqual(['POST']);
  });

  it('un diálogo cancelado o un token corto no llaman a Meta ni escriben', async () => {
    const m = montar();
    expect((await ejecutarAlta(args(), { ...m.deps, leerToken: async () => { throw new Error('x'); } })).codigo).toBe(1);
    expect((await ejecutarAlta(args(), { ...m.deps, leerToken: async () => 'corto' })).codigo).toBe(1);
    expect(m.llamadas).toEqual([]);
  });
});
