import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CampoValor, Extraccion } from './campos';
import type { DocumentoFila } from './repo';
import type { ConfigSalida } from './salida_config';
import type { ResultadoAvisoOficina } from '@/lib/meta/aviso_oficina';
import type { ResultadoEnvio } from '@/lib/correo/enviar';
import type { Correo } from '@/lib/correo/plantilla';
import type { DepsEnvios } from './worker_envios';
import type { DepsAlertaEnvio } from './alerta_envio';

// La alerta única del envío (T-A3-30): a quién, por qué canal y con qué texto. Dobles en memoria; el worker de envíos, el
// repo falso (con el candado real de la 0790) y la máquina de estados son los REALES. Todo sintético.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin Supabase en estas pruebas'); } }));
vi.mock('../presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const { crearAlertarEnvio, textoAlerta, TOPE_AVISOS_POR_PASADA } = await import('./alerta_envio');
const { correrWorkerEnvios } = await import('./worker_envios');
const { repoEnviosFalso, resetEnvios, sembrarEnvio, estadoEnvios } = await import('./repo_envios_falso.fixture');
const { crearTmsFalso } = await import('./tms_falso.fixture');
const { CONFIG_SALIDA_ARRANQUE } = await import('./salida_config');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U_ALERTA = '11111111-1111-4111-8111-111111111111';
const U_REVISION = '22222222-2222-4222-8222-222222222222';
const DOC = 'd0000000-0000-4000-8000-000000000001';
const BASE = 'https://app.test/dashboard/carta-porte/documentos';
const T0 = Date.parse('2026-10-15T15:00:00Z');
const MIN = 60_000;

let config: ConfigSalida;
let correos: Array<{ para: string; correo: Correo }>;
let avisos: Array<{ telefono: string; texto: string; parametros: [string, string, string] }>;
let operador: Array<{ evento: string; detalle: Record<string, unknown> }>;
let correoRes: ResultadoEnvio;
let waRes: ResultadoAvisoOficina;
let telefonos: Record<string, string | null>;
let correosUsuario: Record<string, string | null>;
let telefonoJefe: string | null;

const entrada = (motivo: 'reque_agotado' | 'rechazado_tms' | 'transitorio_agotado' = 'reque_agotado', documentoId = DOC) =>
  ({ tenantId: A, envioId: 'e1', documentoId, motivo, destinatario: 'la oficina', mensaje: 'x' });

function deps(over: Partial<DepsAlertaEnvio> = {}): DepsAlertaEnvio {
  return {
    leerConfig: async () => config,
    leerFolio: async () => 'LP-0001',
    correoDeUsuario: async (u) => correosUsuario[u] ?? null,
    telefonoDeUsuario: async (u) => telefonos[u] ?? null,
    telefonoJefe: async () => telefonoJefe,
    enviarCorreo: async (para, correo) => { correos.push({ para, correo }); return correoRes; },
    avisar: async (telefono, texto, parametros) => { avisos.push({ telefono, texto, parametros }); return waRes; },
    alertarOperador: async (evento, detalle) => { operador.push({ evento, detalle }); },
    urlBandeja: BASE,
    ...over,
  };
}

beforeEach(() => {
  config = { ...CONFIG_SALIDA_ARRANQUE, modo: 'api' };
  correos = []; avisos = []; operador = [];
  correoRes = { ok: true, id: 'c1' };
  waRes = { ok: true, via: 'texto', id: 'w1' };
  telefonos = {}; correosUsuario = {}; telefonoJefe = '+520000000001'; // grep-limpio:ok
});

describe('a quién se avisa', () => {
  it('reque agotado: correo configurado + WhatsApp del usuario de la alerta', async () => {
    config = { ...config, destinatarioAlertaCorreo: 'oficina@flota.test', destinatarioAlertaUsuario: U_ALERTA };
    telefonos[U_ALERTA] = '+520000000002'; // grep-limpio:ok
    const r = await crearAlertarEnvio(deps())(entrada());
    expect(r).toMatchObject({ correo: 'enviado', whatsapp: 'enviado', operador: false });
    expect(correos.map((c) => c.para)).toEqual(['oficina@flota.test']);
    expect(avisos.map((a) => a.telefono)).toEqual(['+520000000002']); // grep-limpio:ok
  });

  it('el rechazo va al destinatario de REVISIÓN, no al de la alerta', async () => {
    config = { ...config, destinatarioAlertaCorreo: 'alerta@flota.test', destinatarioRevisionCorreo: 'revision@flota.test', destinatarioAlertaUsuario: U_ALERTA, destinatarioRevisionUsuario: U_REVISION };
    telefonos[U_ALERTA] = '+520000000002'; telefonos[U_REVISION] = '+520000000003'; // grep-limpio:ok
    await crearAlertarEnvio(deps())(entrada('rechazado_tms'));
    expect(correos.map((c) => c.para)).toEqual(['revision@flota.test']);
    expect(avisos.map((a) => a.telefono)).toEqual(['+520000000003']); // grep-limpio:ok
  });

  it('el rechazo sin destinatario de revisión cae al de la alerta', async () => {
    config = { ...config, destinatarioAlertaCorreo: 'alerta@flota.test' };
    await crearAlertarEnvio(deps())(entrada('rechazado_tms'));
    expect(correos.map((c) => c.para)).toEqual(['alerta@flota.test']);
  });

  it('sin destinatarios configurados cae al jefe de tráfico por WhatsApp (como hoy hace avisarOficina)', async () => {
    const r = await crearAlertarEnvio(deps())(entrada());
    expect(r).toMatchObject({ correo: 'sin_destino', whatsapp: 'enviado' });
    expect(correos).toHaveLength(0);
    expect(avisos.map((a) => a.telefono)).toEqual(['+520000000001']); // grep-limpio:ok
  });

  it('un usuario configurado sin correo propio aporta el de su cuenta', async () => {
    config = { ...config, destinatarioAlertaUsuario: U_ALERTA };
    correosUsuario[U_ALERTA] = 'cuenta@flota.test';
    await crearAlertarEnvio(deps())(entrada());
    expect(correos.map((c) => c.para)).toEqual(['cuenta@flota.test']);
  });

  it('sin nadie (ni jefe con teléfono) el aviso sube al operador: no se pierde', async () => {
    telefonoJefe = null;
    const r = await crearAlertarEnvio(deps())(entrada());
    expect(r.operador).toBe(true);
    expect(operador).toHaveLength(1);
    expect(operador[0].evento).toBe('cron.carta_porte_envio.reque_agotado');
  });
});

describe('el texto: solo folio y liga (PII mínima)', () => {
  it('el correo y el WhatsApp llevan folio y liga al visor, y el aviso del reque dice qué hacer', async () => {
    config = { ...config, destinatarioAlertaCorreo: 'oficina@flota.test', reintentosMax: 6 };
    await crearAlertarEnvio(deps())(entrada());
    const { correo } = correos[0];
    const liga = `${BASE}/${DOC}`;
    expect(correo.asunto).toContain('LP-0001');
    expect(correo.boton?.href).toBe(liga);
    expect(avisos[0].texto).toBe(`Documento LP-0001: sigue sin requerimiento tras 6 reintentos. Crea el requerimiento o márcalo como subido a mano. ${liga}`);
    expect(avisos[0].parametros).toEqual(['Carta Porte', 'LP-0001: sin requerimiento', liga]);
  });

  it('el texto no trae RFC, nombres ni importes aunque el folio venga sucio', () => {
    const t = textoAlerta('rechazado_tms', 'LP-9 <script>alert(1)</script>\nRFC XAXX010101000 ' + 'z'.repeat(100), 6, 'https://app.test/x'); // grep-limpio:ok
    const todo = `${t.asunto} ${t.resumen} ${t.cuerpo}`;
    expect(todo).not.toMatch(/[<>]/);
    expect(todo).not.toContain('\n');
    expect(t.resumen.length).toBeLessThanOrEqual(60);
    expect(todo.length).toBeLessThan(450);
  });

  it('sin folio legible dice «sin folio», no inventa nada', () => {
    expect(textoAlerta('transitorio_agotado', '', 6, 'u').cuerpo).toContain('sin folio');
  });
});

describe('la regla del outbox', () => {
  it('un rechazo REINTENTABLE de WhatsApp ya quedó en la cola: cuenta como avisado y NO lanza', async () => {
    waRes = { ok: false, motivo: '429', fueraDeVentana: false, reintentable: true, encolado: true };
    const r = await crearAlertarEnvio(deps())(entrada());
    expect(r.whatsapp).toBe('en_cola');
  });

  it('un rechazo DEFINITIVO de todos los canales LANZA (para que se suelte el candado)', async () => {
    config = { ...config, destinatarioAlertaCorreo: 'oficina@flota.test' };
    correoRes = { ok: false, motivo: 'sin_configurar' };
    waRes = { ok: false, motivo: 'plantilla sin aprobar', fueraDeVentana: true, reintentable: false };
    await expect(crearAlertarEnvio(deps())(entrada())).rejects.toThrow(/ningún canal/);
  });

  it('si el correo sale aunque WhatsApp falle definitivamente, el aviso cuenta como entregado', async () => {
    config = { ...config, destinatarioAlertaCorreo: 'oficina@flota.test' };
    waRes = { ok: false, motivo: 'número inválido', fueraDeVentana: false, reintentable: false };
    const r = await crearAlertarEnvio(deps())(entrada());
    expect(r).toMatchObject({ correo: 'enviado', whatsapp: 'fallo' });
  });

  it('un servicio que LANZA se trata como canal caído, no tumba la alerta', async () => {
    config = { ...config, destinatarioAlertaCorreo: 'oficina@flota.test' };
    const r = await crearAlertarEnvio(deps({ avisar: async () => { throw new Error('red'); } }))(entrada());
    expect(r.correo).toBe('enviado');
  });
});

describe('tope por pasada', () => {
  it(`a lo más ${TOPE_AVISOS_POR_PASADA} avisos por pasada; el siguiente lanza (se suelta el candado)`, async () => {
    const alertar = crearAlertarEnvio(deps());
    for (let i = 0; i < TOPE_AVISOS_POR_PASADA; i++) await alertar(entrada());
    await expect(alertar(entrada())).rejects.toThrow(/tope/);
    expect(avisos).toHaveLength(TOPE_AVISOS_POR_PASADA);
  });
});

// ── El worker REAL con la alerta real: una sola alerta con muchas pasadas ─────────────────────────────────────

describe('con el worker de envíos (espejo de worker_envios.test.ts, sección avisos)', () => {
  const cv = (valor: string | null): CampoValor => ({ valor, confianza: 0.95, evidencia: null, origen: 'llm' });
  const extraccion = (): Extraccion => ({
    campos: { folio_cliente: cv('LP-0001'), numero_cliente_interno: cv('000123'), caja_numero: cv('CAJA-01') },
    mercancias: [{ bienes_transp: cv('43211500'), descripcion: cv('Equipo de computo'), cantidad: cv('20'), peso_kg: cv('140') }],
  });
  let ahoraMs: number;
  const doc = { id: DOC, tenantId: A, estado: 'aprobado', version: 1, nombreArchivo: 'doc.xlsx', extraccion: extraccion(), validacion: { hallazgos: [], bloqueos: 0, porConfirmar: 0, listoParaAprobar: true } } as unknown as DocumentoFila;

  function depsWorker(alertarEnvio: DepsEnvios['alertarEnvio'], tms: ReturnType<typeof crearTmsFalso>): DepsEnvios {
    return {
      reclamar: (l) => repoEnviosFalso.reclamar(l), leerEnvio: (t, id) => repoEnviosFalso.leer(t, id),
      actualizarEnvio: (t, id, d, c) => repoEnviosFalso.actualizar(t, id, d, c),
      marcarAlerta: (t, id) => repoEnviosFalso.marcarAlerta(t, id), liberarAlerta: (t, id) => repoEnviosFalso.liberarAlerta(t, id),
      leerDocumento: async () => doc, leerConfig: async () => config, salida: async () => tms,
      evento: async () => {}, devolverARevision: async () => {}, devolverPorRechazo: async () => {},
      huellasRechazadas: async () => [], alertarEnvio, alertarOperador: async () => {}, ahora: () => ahoraMs,
    };
  }

  beforeEach(() => { resetEnvios(); ahoraMs = T0; estadoEnvios.reloj.ahora = () => new Date(ahoraMs); });

  it('reque que nunca aparece: UN correo y UN WhatsApp aunque corran 10 pasadas', async () => {
    config = { ...config, reintentosMax: 2, destinatarioAlertaCorreo: 'oficina@flota.test' };
    const tms = Object.assign(crearTmsFalso('ok'), { consultarReque: async () => 'no_existe' as const, consultarCaja: async () => 'existe' as const });
    sembrarEnvio(A, { documentoId: DOC, versionDoc: 1, estado: 'pendiente_prechequeo', createdAt: new Date(ahoraMs).toISOString() });
    const alertar = crearAlertarEnvio(deps());
    for (let i = 0; i < 10; i++) { await correrWorkerEnvios(depsWorker(async (a) => { await alertar(a); }, tms), { venceEn: ahoraMs + 100_000 }); ahoraMs += 61 * MIN; }
    expect(correos).toHaveLength(1);
    expect(avisos).toHaveLength(1);
    expect(tms.llamadas).toHaveLength(0);
  });

  it('si la alerta no pudo salir, el candado se suelta y el siguiente intento puede avisar', async () => {
    config = { ...config, reintentosMax: 0, destinatarioAlertaCorreo: 'oficina@flota.test' };
    correoRes = { ok: false, motivo: 'rechazado', detalle: 'x', status: 500 };
    waRes = { ok: false, motivo: 'plantilla sin aprobar', fueraDeVentana: true, reintentable: false };
    const tms = Object.assign(crearTmsFalso('ok'), { consultarReque: async () => 'no_existe' as const, consultarCaja: async () => 'existe' as const });
    const e = sembrarEnvio(A, { documentoId: DOC, versionDoc: 1, estado: 'pendiente_prechequeo', createdAt: new Date(ahoraMs).toISOString() });
    const alertar = crearAlertarEnvio(deps());
    let fallidas = 0;
    for (let i = 0; i < 3; i++) { fallidas += (await correrWorkerEnvios(depsWorker(async (a) => { await alertar(a); }, tms), { venceEn: ahoraMs + 100_000 })).alertasFallidas; ahoraMs += 61 * MIN; }
    expect(fallidas).toBeGreaterThanOrEqual(1);
    expect(correos).toHaveLength(1); // se intentó por el correo y rebotó
    expect((await repoEnviosFalso.leer(A, e.id))!.alertaEnviadaEn).toBeNull();
  });
});
