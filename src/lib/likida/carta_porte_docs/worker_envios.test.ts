import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CampoValor, Extraccion } from './campos';
import type { DocumentoFila } from './repo';
import type { ConfigSalida } from './salida_config';
import type { Existencia, SalidaTms } from './tms_puerto';
import type { DepsEnvios } from './worker_envios';
import type { Hallazgo } from './validacion';

// El worker de envíos al TMS (T-A3-28), probado ENTERO con dobles: el repo de envíos en memoria (T-A3-27, con el mismo
// reclamo con lease que la 0790), el puerto `tms_falso` (T-A3-01), la máquina de estados y el prechequeo REALES.
// Espejo del patrón de `worker.test.ts`. Todo sintético: ni un dato de ninguna flota ni del cliente.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('el worker de envíos no toca Supabase en estas pruebas'); } }));
vi.mock('../presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const { logger } = await import('@/lib/logger');
const { correrWorkerEnvios, sinPII, enviosPendientes, TOPE_FALLOS_TMS_SEGUIDOS, SIN_MAS_REVISIONES, ESPERA_LISTO_MANUAL_MIN, MARGEN_ENVIO_MS } = await import('./worker_envios');
const { repoEnviosFalso, estadoEnvios, resetEnvios, sembrarEnvio } = await import('./repo_envios_falso.fixture');
const { crearTmsFalso } = await import('./tms_falso.fixture');
const { CONFIG_SALIDA_ARRANQUE } = await import('./salida_config');
const { SIN_TMS } = await import('./tms_puerto');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T0 = Date.parse('2026-10-15T15:00:00Z');
const MIN = 60_000;
/** El reloj de una pasada: ≈ el maxDuration del cron menos su margen, contado desde el «ahora» de la prueba. */
const HORIZONTE_MS = 100_000;

let ahoraMs = T0;
const docs = new Map<string, DocumentoFila>();
let config: ConfigSalida;
let puertos: Map<string, SalidaTms>;
let eventos: Array<{ tenantId: string; documentoId: string; tipo: string; detalle: Record<string, unknown> }>;
let alertasEnvio: Array<{ tenantId: string; envioId: string; motivo: string; destinatario: string; mensaje: string }>;
let alertasOperador: Array<{ evento: string; detalle: Record<string, unknown> }>;
let devueltos: Array<{ documentoId: string; motivo: string }>;
let rechazosDevueltos: Array<{ documentoId: string; versionDoc: number; hallazgos: Hallazgo[]; ubicaciones: string[] }>;

const cv = (valor: string | null): CampoValor => ({ valor, confianza: 0.95, evidencia: null, origen: 'llm' });
const extraccion = (): Extraccion => ({
  campos: { folio_cliente: cv('LP-0001'), numero_cliente_interno: cv('000123'), caja_numero: cv('CAJA-01'), origen_nombre: cv('Origen Sintetico SA'), destino_nombre: cv('Destino Sintetico SA') },
  mercancias: [{ bienes_transp: cv('43211500'), descripcion: cv('Equipo de computo'), cantidad: cv('20'), peso_kg: cv('140') }],
});

/** Un documento aprobado y su envío en el estado pedido. */
function sembrar(
  tenantId: string, n: number, estado: Parameters<typeof sembrarEnvio>[1]['estado'] = 'pendiente_prechequeo',
  over: { versionDoc?: number; versionActual?: number; bloqueos?: number; docEstado?: DocumentoFila['estado']; envio?: Partial<Parameters<typeof sembrarEnvio>[1]> } = {},
) {
  const documentoId = `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  docs.set(`${tenantId}:${documentoId}`, {
    id: documentoId, tenantId, estado: over.docEstado ?? 'aprobado', version: over.versionActual ?? 1, nombreArchivo: 'doc.xlsx',
    extraccion: extraccion(), validacion: { hallazgos: [], bloqueos: over.bloqueos ?? 0, porConfirmar: 0, listoParaAprobar: (over.bloqueos ?? 0) === 0 },
  } as unknown as DocumentoFila);
  return sembrarEnvio(tenantId, { documentoId, versionDoc: over.versionDoc ?? 1, estado, createdAt: new Date(ahoraMs).toISOString(), ...over.envio });
}

/** El puerto falso con las consultas OPCIONALES que el TMS aún no acordó (para probar el prechequeo). */
function puerto(modo: Parameters<typeof crearTmsFalso>[0] = 'ok', consultas: { reque?: Existencia; caja?: Existencia } = {}) {
  const f = crearTmsFalso(modo);
  const reque = { valor: consultas.reque ?? 'existe' as Existencia };
  return Object.assign(f, { consultarReque: async () => reque.valor, consultarCaja: async () => consultas.caja ?? 'existe' as Existencia, reque });
}

function deps(over: Partial<DepsEnvios> = {}): DepsEnvios {
  return {
    reclamar: (l) => repoEnviosFalso.reclamar(l),
    leerEnvio: (t, id) => repoEnviosFalso.leer(t, id),
    actualizarEnvio: (t, id, d, c) => repoEnviosFalso.actualizar(t, id, d, c),
    marcarAlerta: (t, id) => repoEnviosFalso.marcarAlerta(t, id),
    liberarAlerta: (t, id) => repoEnviosFalso.liberarAlerta(t, id),
    leerDocumento: async (t, id) => docs.get(`${t}:${id}`) ?? null,
    leerConfig: async () => config,
    salida: async (t) => puertos.get(t) ?? SIN_TMS,
    evento: async (tenantId, documentoId, tipo, detalle) => { eventos.push({ tenantId, documentoId, tipo, detalle }); },
    devolverARevision: async (_t, documentoId, _v, motivo) => { devueltos.push({ documentoId, motivo }); },
    devolverPorRechazo: async (_t, documentoId, versionDoc, hallazgos, ubicaciones) => { rechazosDevueltos.push({ documentoId, versionDoc, hallazgos, ubicaciones }); },
    huellasRechazadas: async (t, documentoId) =>
      (await repoEnviosFalso.listarPorDocumento(t, documentoId)).filter((x) => x.estado === 'rechazado_tms' && x.plantillaSha256 !== null).map((x) => x.plantillaSha256 as string),
    alertarEnvio: async (a) => { alertasEnvio.push(a); },
    alertarOperador: async (evento, detalle) => { alertasOperador.push({ evento, detalle }); },
    ahora: () => ahoraMs,
    ...over,
  };
}

const pasada = (d: DepsEnvios = deps(), venceEn = ahoraMs + HORIZONTE_MS) => correrWorkerEnvios(d, { venceEn });
const leer = async (tenantId: string, id: string) => (await repoEnviosFalso.leer(tenantId, id))!;
const avanzar = (ms: number) => { ahoraMs += ms; };

beforeEach(() => {
  resetEnvios();
  ahoraMs = T0;
  estadoEnvios.reloj.ahora = () => new Date(ahoraMs);
  docs.clear();
  config = { ...CONFIG_SALIDA_ARRANQUE, modo: 'api' };
  puertos = new Map();
  eventos = []; alertasEnvio = []; alertasOperador = []; devueltos = []; rechazosDevueltos = [];
});

describe('el camino feliz', () => {
  it('pendiente_prechequeo con reque existente → UNA subida, envío `enviado` con referencia, huella y evento', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    const e = sembrar(A, 1);
    const r = await pasada();
    expect(r).toMatchObject({ reclamados: 1, enviados: 1, errores: 0, rechazados: 0 });
    expect(tms.llamadas).toHaveLength(1);
    const entrada = tms.llamadas[0];
    expect(entrada).toMatchObject({ tenantId: A, idempotencyKey: e.idempotencyKey, plantilla: 'normal', metadatos: { clienteInterno: '000123', folio: 'LP-0001' } });
    expect(entrada.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(entrada.nombre).toMatch(/^plantilla-tms-d0000000-v1\.xlsx$/);
    expect(Array.from(entrada.archivo.slice(0, 2))).toEqual([0x50, 0x4b]); // un .xlsx real (ZIP)
    const f = await leer(A, e.id);
    expect(f).toMatchObject({ estado: 'enviado', referenciaTms: 'REF-1', procesandoHasta: null, proximaRevision: null, errores: [], ultimoError: null });
    expect(f.enviadoEn).toBe(new Date(T0).toISOString());
    expect(f.plantillaSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(eventos.map((x) => x.tipo)).toEqual(['envio_enviado']);
    expect(eventos[0].detalle).toEqual({ envioId: e.id, versionDoc: 1, duplicado: false });
  });

  it('el mismo contenido da la misma huella (la plantilla es determinista)', async () => {
    puertos.set(A, puerto('ok'));
    const e1 = sembrar(A, 1); const e2 = sembrar(A, 2);
    await pasada();
    expect((await leer(A, e1.id)).plantillaSha256).toBe((await leer(A, e2.id)).plantillaSha256);
  });
});

describe('idempotencia: un envío, un solo POST', () => {
  it('dos pasadas solapadas no suben el mismo envío dos veces', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    sembrar(A, 1);
    const [r1, r2] = await Promise.all([pasada(), pasada()]);
    expect(tms.llamadas).toHaveLength(1);
    expect(r1.enviados + r2.enviados).toBe(1);
    expect(r1.reclamados + r2.reclamados).toBe(1); // el lease: la segunda no recibe el envío
  });

  it('una pasada posterior a `enviado` no vuelve a subir nada', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    sembrar(A, 1);
    await pasada();
    avanzar(10 * 60 * MIN);
    const r = await pasada();
    expect(r.reclamados).toBe(0);
    expect(tms.llamadas).toHaveLength(1);
  });

  it('lease vencido de un `enviando` (la pasada murió tras el POST): se recupera con la MISMA llave y el TMS la reconoce como duplicada', async () => {
    const tms = puerto('duplicado'); puertos.set(A, tms);
    const e = sembrar(A, 1, 'listo');
    // 1.ª pasada: el TMS recibe el archivo, pero guardar el resultado falla (se cae la base): queda `enviando` con lease.
    let fallo = true;
    const d = deps({ actualizarEnvio: async (t, id, desde, c) => { if (fallo && c.estado === 'enviado') { fallo = false; throw new Error('base caída'); } return repoEnviosFalso.actualizar(t, id, desde, c); } });
    const r1 = await pasada(d);
    expect(r1).toMatchObject({ errores: 1, enviados: 0 });
    expect((await leer(A, e.id)).estado).toBe('enviando');
    // Dentro del lease nadie lo toca.
    expect((await pasada()).reclamados).toBe(0);
    // Vencido el lease: se reenvía con la misma llave → `duplicado` → `enviado` sin segundo efecto.
    avanzar(3 * MIN);
    const r2 = await pasada();
    expect(r2).toMatchObject({ enviados: 1, duplicados: 1, errores: 0 });
    expect(tms.llamadas).toHaveLength(2);
    expect(new Set(tms.llamadas.map((x) => x.idempotencyKey)).size).toBe(1);
    expect(await leer(A, e.id)).toMatchObject({ estado: 'enviado', referenciaTms: 'REF-1' });
    expect(eventos.at(-1)).toMatchObject({ tipo: 'envio_enviado', detalle: { duplicado: true } });
  });
});

describe('el requerimiento todavía no existe', () => {
  it('prechequeo `no_existe` → `pendiente_reque` con su próxima revisión, 0 subidas y evento', async () => {
    const tms = puerto('ok', { reque: 'no_existe' }); puertos.set(A, tms);
    const e = sembrar(A, 1);
    const r = await pasada();
    expect(r).toMatchObject({ pendientesReque: 1, enviados: 0 });
    expect(tms.llamadas).toHaveLength(0);
    const f = await leer(A, e.id);
    expect(f).toMatchObject({ estado: 'pendiente_reque', intentos: 1, causaPendiente: 'El requerimiento no existe en el TMS.', procesandoHasta: null });
    expect(f.proximaRevision).toBe(new Date(T0 + 60 * MIN).toISOString());
    expect(eventos.map((x) => x.tipo)).toEqual(['envio_pendiente_reque']);
  });

  it('no se vuelve a mirar antes de tiempo; cuando el reque aparece, el MISMO envío sube solo', async () => {
    const tms = puerto('ok', { reque: 'no_existe' }); puertos.set(A, tms);
    const e = sembrar(A, 1);
    await pasada();
    avanzar(30 * MIN);
    expect((await pasada()).reclamados).toBe(0);
    avanzar(31 * MIN);
    expect((await pasada()).pendientesReque).toBe(1); // sigue sin reque: +1 intento
    expect((await leer(A, e.id)).intentos).toBe(2);
    tms.reque.valor = 'existe';
    avanzar(61 * MIN);
    const r = await pasada();
    expect(r).toMatchObject({ enviados: 1 });
    expect(tms.llamadas).toHaveLength(1);
    expect((await leer(A, e.id)).estado).toBe('enviado');
  });

  it('agota los reintentos: alerta ÚNICA, queda visible y nadie lo vuelve a reclamar', async () => {
    config = { ...config, reintentosMax: 2, destinatarioAlertaCorreo: 'oficina@flota.test' };
    const tms = puerto('ok', { reque: 'no_existe' }); puertos.set(A, tms);
    const e = sembrar(A, 1);
    for (let i = 0; i < 6; i++) { await pasada(); avanzar(61 * MIN); }
    const f = await leer(A, e.id);
    expect(f.estado).toBe('pendiente_reque');
    expect(f.proximaRevision).toBe(SIN_MAS_REVISIONES);
    expect(f.alertaEnviadaEn).not.toBeNull();
    expect(alertasEnvio).toHaveLength(1);
    expect(alertasEnvio[0]).toMatchObject({ motivo: 'reque_agotado', destinatario: 'oficina@flota.test', envioId: e.id });
    expect(eventos.filter((x) => x.tipo === 'envio_alertado')).toHaveLength(1);
    expect(tms.llamadas).toHaveLength(0);
    expect((await pasada()).reclamados).toBe(0);
  });

  it('si el TMS contesta `reque_inexistente` a la subida, vuelve a esperar el reque (no es un fallo de red)', async () => {
    const tms = puerto('reque_inexistente'); puertos.set(A, tms);
    const e = sembrar(A, 1);
    const r = await pasada();
    expect(tms.llamadas).toHaveLength(1);
    expect(r).toMatchObject({ pendientesReque: 1, reintentos: 0, rechazados: 0 });
    const f = await leer(A, e.id);
    expect(f).toMatchObject({ estado: 'pendiente_reque', intentos: 1 });
    expect(f.proximaRevision).toBe(new Date(T0 + 60 * MIN).toISOString());
  });
});

describe('fallos transitorios del TMS', () => {
  it('cuenta los intentos POR FASE (se deshace el +1 del reclamo), espera creciente y, al sexto, alerta única', async () => {
    const tms = puerto('transitorio'); puertos.set(A, tms);
    const e = sembrar(A, 1);
    const esperas: number[] = [];
    for (let i = 1; i <= 5; i++) {
      await pasada();
      const f = await leer(A, e.id);
      expect(f.estado, `intento ${i}`).toBe('error_transitorio');
      expect(f.intentos, `intento ${i}`).toBe(i);
      esperas.push(Math.round((Date.parse(f.proximaRevision!) - ahoraMs) / MIN));
      avanzar(Date.parse(f.proximaRevision!) - ahoraMs);
    }
    expect(esperas).toEqual([60, 120, 240, 480, 480]);
    expect(alertasEnvio).toHaveLength(0);
    await pasada(); // el 6.º fallo seguido: agotado
    const f = await leer(A, e.id);
    expect(f).toMatchObject({ estado: 'error_transitorio', intentos: 6, proximaRevision: SIN_MAS_REVISIONES });
    expect(alertasEnvio).toHaveLength(1);
    expect(alertasEnvio[0].motivo).toBe('transitorio_agotado');
    expect(tms.llamadas).toHaveLength(6);
    avanzar(30 * 60 * MIN);
    expect((await pasada()).reclamados).toBe(0);
  });

  it('la espera que pide el TMS pesa si es mayor que la del backoff, pero nunca menos', async () => {
    const tms = puerto('ok');
    tms.cargarPlantilla = async () => ({ ok: false, clase: 'transitorio', mensajeLlano: 'x', errores: [], reintentarEnMs: 3 * 60 * MIN });
    puertos.set(A, tms);
    const e = sembrar(A, 1);
    await pasada();
    expect(Date.parse((await leer(A, e.id)).proximaRevision!)).toBe(T0 + 180 * MIN);
  });

  it('un puerto que LANZA cuenta como transitorio y no tumba la pasada', async () => {
    const tms = puerto('ok');
    tms.cargarPlantilla = async () => { throw new Error('socket hang up'); };
    puertos.set(A, tms);
    const e = sembrar(A, 1);
    const r = await pasada();
    expect(r).toMatchObject({ reintentos: 1, errores: 0 });
    expect((await leer(A, e.id)).estado).toBe('error_transitorio');
  });

  it(`${TOPE_FALLOS_TMS_SEGUIDOS} fallos seguidos abren el circuito: no se manda nada más, los demás se sueltan sin gastar intento y el operador recibe UNA alerta`, async () => {
    const tms = puerto('transitorio'); puertos.set(A, tms);
    const ids = [1, 2, 3, 4, 5, 6].map((n) => sembrar(A, n).id);
    const r = await pasada();
    expect(tms.llamadas).toHaveLength(TOPE_FALLOS_TMS_SEGUIDOS);
    expect(r).toMatchObject({ reclamados: 6, reintentos: 4, circuitosAbiertos: 1, soltados: 2, errores: 0 });
    expect(alertasOperador).toHaveLength(1);
    expect(alertasOperador[0].detalle).toMatchObject({ codigo: 'cp_tms_circuito_abierto', tenantId: A });
    const estados = await Promise.all(ids.map((id) => leer(A, id)));
    expect(estados.filter((f) => f.estado === 'error_transitorio')).toHaveLength(4);
    const sueltos = estados.filter((f) => f.estado === 'listo');
    expect(sueltos).toHaveLength(2);
    for (const f of sueltos) expect(f).toMatchObject({ intentos: 0, procesandoHasta: null }); // sin intento gastado y reclamables en la siguiente pasada
  });

  it('el circuito es POR FLOTA: el TMS caído de una no detiene a la otra', async () => {
    const caido = puerto('transitorio'); const sano = puerto('ok');
    puertos.set(A, caido); puertos.set(B, sano);
    for (let n = 1; n <= 5; n++) sembrar(A, n);
    const eb = sembrar(B, 6);
    const r = await correrWorkerEnvios(deps(), { venceEn: ahoraMs + HORIZONTE_MS, limite: 10 });
    expect(r.circuitosAbiertos).toBe(1);
    expect(caido.llamadas).toHaveLength(TOPE_FALLOS_TMS_SEGUIDOS);
    expect(sano.llamadas).toHaveLength(1);
    expect((await leer(B, eb.id)).estado).toBe('enviado');
  });
});

describe('credencial caducada (`auth`)', () => {
  it('no reintenta en la pasada, no gasta intentos del documento, abre el circuito y alerta al operador', async () => {
    const tms = puerto('auth'); puertos.set(A, tms);
    const ids = [1, 2, 3].map((n) => sembrar(A, n).id);
    const r = await pasada();
    expect(tms.llamadas).toHaveLength(1);
    expect(r).toMatchObject({ credencialesCaducadas: 1, circuitosAbiertos: 1, soltados: 2, rechazados: 0, reintentos: 0 });
    expect(alertasOperador).toHaveLength(1);
    expect(alertasOperador[0].detalle).toMatchObject({ codigo: 'cp_tms_credencial' });
    const fs = await Promise.all(ids.map((id) => leer(A, id)));
    for (const f of fs) expect(f.estado).toBe('listo');
    expect(fs.filter((f) => f.ultimoError?.codigo === 'auth')).toHaveLength(1);
    // Nada de este fallo es culpa del documento: ninguno quedó rechazado ni con intentos gastados.
    expect(fs.every((f) => f.intentos === 0)).toBe(true);
    // Renovada la credencial, se retoman solos.
    puertos.set(A, puerto('ok'));
    avanzar(61 * MIN);
    const r2 = await pasada();
    expect(r2.enviados).toBeGreaterThanOrEqual(1);
  });
});

describe('rechazo del TMS', () => {
  it('`validacion` → `rechazado_tms` terminal, errores SOLO con ubicación, alerta única y no se reenvía', async () => {
    const tms = puerto('validacion'); puertos.set(A, tms);
    const e = sembrar(A, 1);
    const r = await pasada();
    expect(r).toMatchObject({ rechazados: 1, enviados: 0 });
    const f = await leer(A, e.id);
    expect(f.estado).toBe('rechazado_tms');
    expect(f.ultimoError).toEqual({ codigo: 'validacion' });
    expect(f.errores).toEqual([{ hoja: 'Hoja1', fila: 3, campo: 'peso' }, { hoja: 'Hoja1', fila: 5, campo: 'claveProdServ' }]);
    expect(JSON.stringify(f.errores)).not.toContain('valor no numérico');
    expect(eventos.map((x) => x.tipo)).toEqual(['envio_rechazado', 'envio_alertado']);
    expect(alertasEnvio).toHaveLength(1);
    expect(alertasEnvio[0].motivo).toBe('rechazado_tms');
    avanzar(60 * 60 * MIN);
    await pasada();
    expect(tms.llamadas).toHaveLength(1);
    expect(alertasEnvio).toHaveLength(1);
  });

  it('si el aviso no pudo salir, se suelta el candado y la pasada lo cuenta', async () => {
    puertos.set(A, puerto('validacion'));
    const e = sembrar(A, 1);
    const r = await pasada(deps({ alertarEnvio: async () => { throw new Error('correo caído'); } }));
    expect(r).toMatchObject({ rechazados: 1, alertas: 0, alertasFallidas: 1 });
    expect((await leer(A, e.id)).alertaEnviadaEn).toBeNull();
    expect(eventos.map((x) => x.tipo)).toEqual(['envio_rechazado']);
  });
});


describe('el rechazo vuelve a la bandeja (T-A3-29)', () => {
  const ERROR_FRACCION = { hoja: 'Mercancias', fila: 22, campo: 'Fracción Arancelaria', detalle: 'El valor VALOR-SINTETICO-98765 no existe en el catálogo' };
  const puertoRechazo = (errores: Array<typeof ERROR_FRACCION>): SalidaTms => ({
    async cargarPlantilla() { return { ok: false, clase: 'validacion', mensajeLlano: 'El sistema rechazó la carga.', errores }; },
    consultarReque: async () => 'existe', consultarCaja: async () => 'existe',
  });

  it('el rechazo devuelve el documento a revisión con hallazgos ubicados, ANTES de avisar a la oficina y sin el valor citado', async () => {
    puertos.set(A, puertoRechazo([ERROR_FRACCION]));
    const e = sembrar(A, 1);
    const r = await pasada();
    expect(r).toMatchObject({ rechazados: 1, devueltosARevision: 1, errores: 0 });
    expect((await leer(A, e.id)).estado).toBe('rechazado_tms');
    expect(rechazosDevueltos).toHaveLength(1);
    expect(rechazosDevueltos[0]).toMatchObject({ documentoId: e.documentoId, versionDoc: 1, ubicaciones: ['Mercancias!22!Fracción Arancelaria'] });
    expect(rechazosDevueltos[0].hallazgos).toEqual([expect.objectContaining({ campo: 'fraccion_arancelaria', renglon: 0, severidad: 'bloqueo', origen: 'tms' })]);
    expect(JSON.stringify([rechazosDevueltos, eventos, await leer(A, e.id)])).not.toContain('VALOR-SINTETICO-98765');
    expect(alertasEnvio).toHaveLength(1);
  });

  it('un rechazo sin ubicación deja el hallazgo genérico con el mensaje llano del puerto', async () => {
    puertos.set(A, puertoRechazo([]));
    sembrar(A, 1);
    await pasada();
    expect(rechazosDevueltos[0].hallazgos).toEqual([expect.objectContaining({ campo: 'documento', mensaje: 'El sistema del cliente rechazó el archivo: El sistema rechazó la carga.' })]);
  });

  it('si no se pudo reabrir el documento, el lote no se cae: queda anotado y el envío sigue `rechazado_tms` con su alerta', async () => {
    puertos.set(A, puertoRechazo([ERROR_FRACCION]));
    const e = sembrar(A, 1);
    const r = await pasada(deps({ devolverPorRechazo: async () => { throw new Error('base caída'); } }));
    expect(r).toMatchObject({ rechazados: 1, devueltosARevision: 0, errores: 0, alertas: 1 });
    expect(r.fallos.join(' ')).toContain('base caída');
    expect((await leer(A, e.id)).estado).toBe('rechazado_tms');
  });

  it('sin bucle: el MISMO contenido que el TMS ya rechazó no se reenvía solo; vuelve a revisión pidiendo corrección', async () => {
    const tms = puertoRechazo([ERROR_FRACCION]); puertos.set(A, tms);
    const primero = sembrar(A, 1);
    await pasada();
    const huella = (await leer(A, primero.id)).plantillaSha256;
    expect(huella).toMatch(/^[0-9a-f]{64}$/);
    // Reaprobado SIN corregir nada que cambie la plantilla: otro envío (versión nueva), mismos bytes.
    const llamadas = vi.fn(tms.cargarPlantilla.bind(tms));
    puertos.set(A, { cargarPlantilla: llamadas, consultarReque: async () => 'existe', consultarCaja: async () => 'existe' });
    const segundo = sembrarEnvio(A, { documentoId: primero.documentoId, versionDoc: 2, estado: 'pendiente_prechequeo', createdAt: new Date(ahoraMs).toISOString() });
    docs.get(`${A}:${primero.documentoId}`)!.version = 2;
    rechazosDevueltos = [];
    const r = await pasada();
    expect(llamadas).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
    expect((await leer(A, segundo.id)).estado).toBe('descartado');
    expect(rechazosDevueltos).toHaveLength(1);
    expect(rechazosDevueltos[0].hallazgos[0]).toMatchObject({ codigo: 'tms_rechazo_repetido', severidad: 'bloqueo', origen: 'tms' });
    expect(eventos.some((x) => x.tipo === 'envio_error' && x.detalle.causa === 'mismo_contenido_rechazado')).toBe(true);
  });

  it('un faltante BLOQUEANTE de la plantilla (2 orígenes en la normal) NO se sube: se descarta y vuelve a revisión con el motivo (A35-A3-04)', async () => {
    const llamadas = vi.fn(async () => ({ ok: true as const, referencia: 'REF-1' }));
    puertos.set(A, { cargarPlantilla: llamadas as unknown as SalidaTms['cargarPlantilla'], consultarReque: async () => 'existe', consultarCaja: async () => 'existe' });
    const envio = sembrar(A, 1);
    docs.get(`${A}:${envio.documentoId}`)!.extraccion!.campos.origen_2_nombre = cv('Segundo Origen Sintetico SA');
    const r = await pasada();
    expect(llamadas).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
    expect((await leer(A, envio.id)).estado).toBe('descartado');
    expect(rechazosDevueltos).toHaveLength(1);
    expect(rechazosDevueltos[0].hallazgos[0]).toMatchObject({ codigo: 'plantilla_incompleta', severidad: 'bloqueo', origen: 'tms' });
    expect(rechazosDevueltos[0].hallazgos[0].mensaje).toMatch(/or[ií]genes/i);
    expect(eventos.some((x) => x.tipo === 'envio_error' && x.detalle.causa === 'plantilla_incompleta')).toBe(true);
  });

  it('una corrección que SÍ cambia la plantilla se envía normal', async () => {
    puertos.set(A, puertoRechazo([ERROR_FRACCION]));
    const primero = sembrar(A, 1);
    await pasada();
    const tms = puerto('ok'); puertos.set(A, tms);
    const d = docs.get(`${A}:${primero.documentoId}`)!;
    d.version = 2;
    d.extraccion!.mercancias[0].descripcion = cv('Equipo de computo corregido');
    const segundo = sembrarEnvio(A, { documentoId: primero.documentoId, versionDoc: 2, estado: 'pendiente_prechequeo', createdAt: new Date(ahoraMs).toISOString() });
    const r = await pasada();
    expect(r.enviados).toBe(1);
    expect(tms.llamadas).toHaveLength(1);
    expect((await leer(A, segundo.id)).estado).toBe('enviado');
  });
});

describe('lo que nunca se envía', () => {
  it('versión del documento cambiada ⇒ `descartado`, 0 subidas', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    const e = sembrar(A, 1, 'listo', { versionDoc: 1, versionActual: 2 });
    const r = await pasada();
    expect(r).toMatchObject({ descartados: 1, enviados: 0 });
    expect(tms.llamadas).toHaveLength(0);
    expect((await leer(A, e.id)).estado).toBe('descartado');
    expect(eventos[0]).toMatchObject({ tipo: 'envio_error', detalle: { causa: 'version_cambio', versionDoc: 1, versionActual: 2 } });
  });

  it('también cuando el cambio llega con el envío ya en `enviando` (lease vencido) o en transitorio', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    const e1 = sembrar(A, 1, 'enviando', { versionDoc: 1, versionActual: 3 });
    const e2 = sembrar(A, 2, 'error_transitorio', { versionDoc: 1, versionActual: 2, envio: { intentos: 2 } });
    await pasada();
    expect((await leer(A, e1.id)).estado).toBe('descartado');
    expect((await leer(A, e2.id)).estado).toBe('descartado');
    expect(tms.llamadas).toHaveLength(0);
  });

  it.each([['rechazado', 'documento_no_aprobado'], ['por_revisar', 'documento_no_aprobado']] as const)('documento `%s` (reabierto) ⇒ `descartado` (%s)', async (docEstado, causa) => {
    const tms = puerto('ok'); puertos.set(A, tms);
    const e = sembrar(A, 1, 'listo', { docEstado });
    await pasada();
    expect((await leer(A, e.id)).estado).toBe('descartado');
    expect(eventos[0].detalle.causa).toBe(causa);
    expect(tms.llamadas).toHaveLength(0);
  });

  it('documento inexistente ⇒ `descartado` sin evento (no hay a qué colgarlo)', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    const e = sembrar(A, 1, 'listo');
    docs.clear();
    await pasada();
    expect((await leer(A, e.id)).estado).toBe('descartado');
    expect(eventos).toHaveLength(0);
  });

  it('documento con bloqueos abiertos ⇒ el envío se descarta, el documento vuelve a revisión y NO se sube', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    const e = sembrar(A, 1, 'pendiente_prechequeo', { bloqueos: 2 });
    const r = await pasada();
    expect(r).toMatchObject({ descartados: 1, devueltosARevision: 1, enviados: 0 });
    expect(tms.llamadas).toHaveLength(0);
    expect((await leer(A, e.id)).estado).toBe('descartado');
    expect(devueltos).toHaveLength(1);
    expect(devueltos[0].motivo).toMatch(/bloqueos abiertos/);
  });

  it('un `listo` que gana bloqueos antes de subir tampoco se envía', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    const e = sembrar(A, 1, 'listo', { bloqueos: 1 });
    const r = await pasada();
    expect(r).toMatchObject({ devueltosARevision: 1, enviados: 0 });
    expect(tms.llamadas).toHaveLength(0);
    expect((await leer(A, e.id)).estado).toBe('descartado');
  });

  it('cliente interno o caja que faltan los resuelve una persona: el documento vuelve a revisión, sin subir', async () => {
    const tms = puerto('ok', { caja: 'no_existe' }); puertos.set(A, tms);
    const e = sembrar(A, 1);
    await pasada();
    expect(tms.llamadas).toHaveLength(0);
    expect((await leer(A, e.id)).estado).toBe('descartado');
    expect(devueltos[0].motivo).toBe('La caja no existe en el TMS.');
  });

  it('un documento sin validación se trata como bloqueado (lo que no se sabe no se envía)', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    const e = sembrar(A, 1, 'listo');
    docs.get(`${A}:${e.documentoId}`)!.validacion = null;
    await pasada();
    expect(tms.llamadas).toHaveLength(0);
    expect(devueltos).toHaveLength(1);
  });
});

describe('modo manual: descarga, o flota sin conector', () => {
  it.each([
    ['modo `descarga` con conector', () => { config = { ...config, modo: 'descarga' }; puertos.set(A, puerto('ok')); }],
    ['modo `api` sin conector (`SIN_TMS`)', () => { /* la flota no tiene puerto */ }],
  ])('%s: queda `listo`, sin consultar ni subir, sin reintentos', async (_n, preparar) => {
    preparar();
    const tms = puertos.get(A) as ReturnType<typeof puerto> | undefined;
    const e = sembrar(A, 1);
    const r = await pasada();
    expect(r).toMatchObject({ enEsperaManual: 1, enviados: 0, errores: 0, pendientesReque: 0 });
    if (tms) expect(tms.llamadas).toHaveLength(0);
    const f = await leer(A, e.id);
    expect(f).toMatchObject({ estado: 'listo', intentos: 0, procesandoHasta: null });
    expect(Date.parse(f.proximaRevision!)).toBe(T0 + ESPERA_LISTO_MANUAL_MIN * MIN);
    // Ni a la hora ni a las cinco horas: nadie lo reclama; a las seis se vuelve a mirar, sigue `listo` y NO sube.
    avanzar(5 * 60 * MIN);
    expect((await pasada()).reclamados).toBe(0);
    avanzar(61 * MIN);
    const r2 = await pasada();
    expect(r2).toMatchObject({ reclamados: 1, enEsperaManual: 1, enviados: 0 });
    expect((await leer(A, e.id)).estado).toBe('listo');
    if (tms) expect(tms.llamadas).toHaveLength(0);
  });

  it('modo manual con un documento bloqueado: nunca llega a `listo`', async () => {
    const e = sembrar(A, 1, 'pendiente_prechequeo', { bloqueos: 1 });
    await pasada();
    expect((await leer(A, e.id)).estado).toBe('descartado');
    expect(devueltos).toHaveLength(1);
  });

  it('la primera vez que un envío llega a `listo` en modo manual se avisa a la oficina (sin tomar el candado de alerta única)', async () => {
    config = { ...config, destinatarioAlertaCorreo: 'oficina@flota.test' };
    const e = sembrar(A, 1); // sin conector (`SIN_TMS`) ⇒ manual
    const r = await pasada();
    expect(r).toMatchObject({ enEsperaManual: 1, alertas: 1, alertasFallidas: 0 });
    expect(alertasEnvio).toHaveLength(1);
    expect(alertasEnvio[0]).toMatchObject({ motivo: 'listo_manual', envioId: e.id, documentoId: e.documentoId, destinatario: 'oficina@flota.test' });
    expect(eventos.filter((x) => x.tipo === 'envio_alertado')).toHaveLength(1);
    // Es un aviso de ÉXITO, no de fallo terminal: NO toma el candado `cp_envio_marcar_alerta` (0790).
    expect((await leer(A, e.id)).alertaEnviadaEn).toBeNull();
  });

  it('el aviso de `listo` manual NO se repite en las revisiones periódicas posteriores (varias pasadas del cron)', async () => {
    config = { ...config, destinatarioAlertaCorreo: 'oficina@flota.test' };
    const e = sembrar(A, 1);
    await pasada(); // 1.ª pasada: llega a `listo`, un aviso
    expect(alertasEnvio).toHaveLength(1);
    for (let i = 0; i < 3; i++) { avanzar((ESPERA_LISTO_MANUAL_MIN + 1) * MIN); await pasada(); }
    expect(alertasEnvio).toHaveLength(1); // sigue siendo UNO tras 3 revisiones de 6 h más
    expect((await leer(A, e.id)).estado).toBe('listo');
  });

  it('si el aviso de `listo` manual no pudo salir, la pasada lo cuenta pero no tumba el lote (el envío sigue `listo`)', async () => {
    config = { ...config, destinatarioAlertaCorreo: 'oficina@flota.test' };
    const e = sembrar(A, 1);
    const r = await pasada(deps({ alertarEnvio: async () => { throw new Error('correo caído'); } }));
    expect(r).toMatchObject({ enEsperaManual: 1, alertas: 0, alertasFallidas: 1, errores: 0 });
    expect(r.fallos.join(' ')).toContain('correo caído');
    expect((await leer(A, e.id)).estado).toBe('listo');
  });

  it('si la flota pasa a modo API, sus `listo` salen en la siguiente revisión', async () => {
    const e = sembrar(A, 1);
    await pasada(); // sin conector: espera
    const tms = puerto('ok'); puertos.set(A, tms);
    avanzar((ESPERA_LISTO_MANUAL_MIN + 1) * MIN);
    await pasada();
    expect(tms.llamadas).toHaveLength(1);
    expect((await leer(A, e.id)).estado).toBe('enviado');
  });
});

describe('el reloj y la infraestructura', () => {
  it('sin reloj para empezar una subida ni siquiera reclama (no deja leases colgados)', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    const e = sembrar(A, 1);
    const r = await pasada(deps(), T0 + MARGEN_ENVIO_MS - 1);
    expect(r).toMatchObject({ reclamados: 0, cortadosPorReloj: 1 });
    expect(tms.llamadas).toHaveLength(0);
    expect((await leer(A, e.id)).procesandoHasta).toBeNull();
  });

  it('el reloj se acaba a media pasada: lo que no alcanzó se suelta sin gastar intentos', async () => {
    const tms = puerto('ok');
    const subir = tms.cargarPlantilla.bind(tms);
    tms.cargarPlantilla = async (x, s) => { const res = await subir(x, s); avanzar(30_000); return res; };
    puertos.set(A, tms);
    const ids = [1, 2, 3].map((n) => sembrar(A, n).id);
    const r = await pasada(deps(), T0 + 50_000); // alcanza el primero; luego el reloj va en +30 s y quedan 20 s < margen
    expect(r).toMatchObject({ enviados: 1, cortadosPorReloj: 2, soltados: 2 });
    const fs = await Promise.all(ids.map((id) => leer(A, id)));
    expect(fs.filter((f) => f.estado === 'enviado')).toHaveLength(1);
    for (const f of fs.filter((x) => x.estado !== 'enviado')) expect(f).toMatchObject({ estado: 'listo', intentos: 0, procesandoHasta: null });
  });

  it('la base sin la 0790: la salida queda apagada y no lanza', async () => {
    estadoEnvios.sinMigracion = true;
    const r = await pasada();
    expect(r).toMatchObject({ sinMigracion: true, reclamados: 0, errores: 0 });
  });

  it('un envío cuya base falla no tumba a los demás del lote', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    const malo = sembrar(A, 1); const bueno = sembrar(A, 2);
    const d = deps({ leerDocumento: async (t, id) => { if (id === malo.documentoId) throw new Error('timeout de lectura'); return docs.get(`${t}:${id}`) ?? null; } });
    const r = await pasada(d);
    expect(r).toMatchObject({ errores: 1, enviados: 1 });
    expect(r.fallos[0]).toMatch(/timeout de lectura/);
    expect((await leer(A, bueno.id)).estado).toBe('enviado');
  });

  it('una pasada perdida (otra persona marcó «subido a mano» entre el reclamo y el guardado) no pisa el estado', async () => {
    const tms = puerto('ok'); puertos.set(A, tms);
    const e = sembrar(A, 1, 'listo');
    let primera = true;
    const d = deps({ actualizarEnvio: async (t, id, desde, c) => {
      if (primera && c.estado === 'enviando') { primera = false; await repoEnviosFalso.actualizar(t, id, ['listo'], { estado: 'subido_a_mano', soltarLease: true }); }
      return repoEnviosFalso.actualizar(t, id, desde, c);
    } });
    const r = await pasada(d);
    expect(r).toMatchObject({ conflictos: 1, enviados: 0 });
    expect(tms.llamadas).toHaveLength(0);
    expect((await leer(A, e.id)).estado).toBe('subido_a_mano');
  });
});

describe('observabilidad mínima de la salida (T-A3-38)', () => {
  const RFC = 'XAXX010101000'; // grep-limpio:ok
  const llamadasLogger = () => [logger.info, logger.warn, logger.error, logger.debug].flatMap((f) => (f as unknown as { mock: { calls: unknown[][] } }).mock.calls);

  beforeEach(() => { for (const f of [logger.info, logger.warn, logger.error, logger.debug]) (f as unknown as { mockClear(): void }).mockClear(); });

  it('cada evento deja su renglón `cp_envio.<tipo>` con ids, y la pasada cierra con `cp_envio.pasada` con los contadores', async () => {
    puertos.set(A, puerto('ok'));
    const e = sembrar(A, 1);
    await pasada();
    const info = (logger.info as unknown as { mock: { calls: Array<[string, Record<string, unknown>]> } }).mock.calls;
    const ev = info.find(([n]) => n === 'cp_envio.envio_enviado');
    expect(ev?.[1]).toMatchObject({ tenantId: A, envioId: e.id, versionDoc: 1, duplicado: false });
    const pasadaLog = info.find(([n]) => n === 'cp_envio.pasada');
    expect(pasadaLog?.[1]).toMatchObject({ reclamados: 1, enviados: 1, envios_pendientes: 0, circuito_tms_abierto: false });
  });

  it('la pasada con el circuito abierto lo dice: `circuito_tms_abierto: true`, los pendientes cuentan lo soltado y se loguea `cp_envio.circuito_abierto`', async () => {
    puertos.set(A, puerto('transitorio'));
    for (let n = 1; n <= 6; n++) sembrar(A, n);
    const r = await pasada();
    const info = (logger.info as unknown as { mock: { calls: Array<[string, Record<string, unknown>]> } }).mock.calls;
    expect(info.find(([n]) => n === 'cp_envio.pasada')?.[1]).toMatchObject({ circuito_tms_abierto: true, reintentos: 4, soltados: 2, envios_pendientes: 6 });
    expect(enviosPendientes(r)).toBe(6);
    const err = (logger.error as unknown as { mock: { calls: Array<[string, Record<string, unknown>]> } }).mock.calls;
    expect(err.find(([n]) => n === 'cp_envio.circuito_abierto')?.[1]).toMatchObject({ tenantId: A, codigo: 'cp_tms_circuito_abierto' });
  });

  it('los logs no incluyen RFC ni correos: ni en un error de infraestructura que los traiga en el mensaje', async () => {
    puertos.set(A, puerto('ok'));
    sembrar(A, 1);
    const d = deps({ actualizarEnvio: async () => { throw new Error(`fallo al guardar el envío de ${RFC} (contacto: persona@cliente.example)`); } });
    const r = await pasada(d);
    expect(r.errores).toBe(1);
    expect(r.fallos.join(' ')).not.toContain(RFC);
    const todo = JSON.stringify(llamadasLogger());
    expect(todo).not.toContain(RFC);
    expect(todo).not.toContain('persona@cliente.example');
    expect(todo).toContain('[rfc]');
  });

  it('`sinPII` tapa RFC de moral y de física, en cualquier caja, y deja intacto lo demás', () => {
    expect(sinPII('RFC ABC010101AB1 y ñaño800101xx9 aquí')).toBe('RFC [rfc] y [rfc] aquí'); // grep-limpio:ok
    expect(sinPII('envío d0000000 intentos 3')).toBe('envío d0000000 intentos 3');
  });
});
