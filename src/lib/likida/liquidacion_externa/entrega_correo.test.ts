import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { logger } from '@/lib/logger';

import {
  procesarEntregasCorreo, armarCorreoDesglose, enmascararCorreo, esperaCorreoMs, inicioVentanaHoy, llaveIdempotencia,
  rangoCorto, MAX_INTENTOS_CORREO,
  type DependenciasEntregaCorreo,
} from './entrega_correo';
import { CONFIG_CORREO_POR_DEFECTO, type ConfigCorreo, type EntregaCorreo } from './repo_correo';
import type { ResultadoEnvio } from '@/lib/correo/enviar';

// ═══════════════════════════════════════════════════════════════════════════
// LA ENTREGA DEL DESGLOSE POR CORREO, con dobles (sin Resend, sin base).
// Datos 100 % sintéticos: bitácora 1228, flota «Flota Prueba», importes inventados.
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = '11111111-1111-4111-8111-111111111111';
const LIQ = '22222222-2222-4222-8222-222222222222';
const BYTES = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 250, 251, 252]);
const SHA = createHash('sha256').update(BYTES).digest('hex');
// 2026-10-14 18:30 UTC = 12:30 en México (sin horario de verano desde 2022).
const AHORA = new Date('2026-10-14T18:30:00.000Z');
const TOTAL_SINTETICO = 7345.67;

function entrega(extra: Partial<EntregaCorreo> = {}): EntregaCorreo {
  return {
    id: 'e-1', tenantId: TENANT, liquidacionExternaId: LIQ, generacion: 1, rol: 'operador', correo: 'ana.prueba@ejemplo.test',
    estado: 'enviando', intentos: 0, proximoIntentoEn: '2026-10-14T18:00:00.000Z', claimToken: 'tok-1', claimExpiraEn: '2026-10-14T18:32:00.000Z',
    resendId: null, ultimoError: null, disparo: 'auto', xlsxRuta: `${TENANT}/x.xlsx`, xlsxSha256: SHA,
    enviadaEn: null, entregadaEn: null, rebotadaEn: null, creadaEn: '2026-10-14T17:00:00.000Z', ...extra,
  };
}

interface Estado {
  cola: EntregaCorreo[];
  llamadasEnviar: Array<{ para: string; asunto: string; parrafos: string[]; op: Parameters<DependenciasEntregaCorreo['enviar']>[2] }>;
  enviadas: Array<{ id: string; resendId: string }>;
  fallidas: Array<{ id: string; error: string }>;
  reprogramadas: Array<{ id: string; intentos: number; proximo: Date; error: string | null }>;
  liquidacionEnviada: number;
  eventos: string[];
  excepciones: Array<{ tipo: string; detalle: Record<string, unknown> }>;
}

function montar(resultado: ResultadoEnvio | (() => ResultadoEnvio), config: Partial<ConfigCorreo> = {}, cola: EntregaCorreo[] = [entrega()]) {
  const e: Estado = { cola, llamadasEnviar: [], enviadas: [], fallidas: [], reprogramadas: [], liquidacionEnviada: 0, eventos: [], excepciones: [] };
  const reclamadas = new Set<string>();
  const deps: DependenciasEntregaCorreo = {
    ahora: () => AHORA,
    enviar: async (para, correo, op) => {
      e.llamadasEnviar.push({ para, asunto: correo.asunto, parrafos: correo.parrafos, op });
      return typeof resultado === 'function' ? resultado() : resultado;
    },
    leerConfig: async () => ({ ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true, ...config }),
    // El claim real: una fila reclamada no la ve otro trabajador.
    reclamar: async (limite) => {
      const mias = e.cola.filter((f) => !reclamadas.has(f.id)).slice(0, limite);
      mias.forEach((f) => reclamadas.add(f.id));
      return mias;
    },
    leerContexto: async () => ({ claveExterna: 'BIT-T01-1228', periodoDesde: '2026-10-09', periodoHasta: '2026-10-14' }),
    descargarXlsx: async () => BYTES,
    marcarEnviada: async (_t, id, _tok, resendId) => { e.enviadas.push({ id, resendId }); return true; },
    marcarFallida: async (_t, id, _tok, error) => { e.fallidas.push({ id, error }); return true; },
    reprogramar: async (_t, id, _tok, intentos, proximo, error) => { e.reprogramadas.push({ id, intentos, proximo, error }); return true; },
    liquidacionEnviada: async () => { e.liquidacionEnviada += 1; return true; },
    registrarEvento: async (_t, _l, tipo) => { e.eventos.push(tipo); },
    abrirExcepcion: async (_t, _c, tipo, detalle) => { e.excepciones.push({ tipo, detalle }); return { id: 1, nueva: true }; },
  };
  return { e, deps };
}

beforeEach(() => vi.clearAllMocks());

describe('procesarEntregasCorreo — las seis ramas de ResultadoEnvio', () => {
  it('ok ⇒ entrega enviada con su resend_id y la liquidación pasa a enviada (rol operador)', async () => {
    const { e, deps } = montar({ ok: true, id: 're_123' });
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r).toMatchObject({ reclamadas: 1, enviadas: 1, fallidas: 0, reintentar: 0 });
    expect(e.enviadas).toEqual([{ id: 'e-1', resendId: 're_123' }]);
    expect(e.liquidacionEnviada).toBe(1);
    expect(e.eventos).toEqual(['enviada']);
  });

  it('ok de un rol que no es operador ⇒ enviada, pero NO mueve la liquidación', async () => {
    const { e, deps } = montar({ ok: true, id: 're_rh' }, {}, [entrega({ rol: 'rh', correo: 'rh@ejemplo.test' })]);
    await procesarEntregasCorreo(deps, 10);
    expect(e.enviadas).toHaveLength(1);
    expect(e.liquidacionEnviada).toBe(0);
    expect(e.eventos).toEqual([]);
  });

  it('ok sin id de Resend ⇒ se anota un id propio (la columna exige uno) y no se reenvía', async () => {
    const { e, deps } = montar({ ok: true, id: '' });
    await procesarEntregasCorreo(deps, 10);
    expect(e.enviadas[0]?.resendId).toBe('sin-id-e-1');
  });

  it('429 ⇒ vuelve a pendiente con espera de 2 min y un intento más', async () => {
    const { e, deps } = montar({ ok: false, motivo: 'rechazado', detalle: 'HTTP 429', status: 429 });
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r.reintentar).toBe(1);
    expect(e.reprogramadas[0]).toMatchObject({ id: 'e-1', intentos: 1 });
    expect(e.reprogramadas[0]?.proximo.getTime()).toBe(AHORA.getTime() + 2 * 60_000);
    expect(e.enviadas).toEqual([]);
    expect(e.liquidacionEnviada).toBe(0);
  });

  it('5xx ⇒ reintento; el backoff crece 2/4/8/16 min', async () => {
    for (const [previos, minutos] of [[0, 2], [1, 4], [2, 8], [3, 16]] as const) {
      const { e, deps } = montar({ ok: false, motivo: 'rechazado', detalle: 'HTTP 503', status: 503 }, {}, [entrega({ intentos: previos })]);
      await procesarEntregasCorreo(deps, 10);
      expect(e.reprogramadas[0]?.proximo.getTime()).toBe(AHORA.getTime() + minutos * 60_000);
    }
    expect(esperaCorreoMs(1)).toBe(2 * 60_000);
  });

  it('el 5.º intento fallido ⇒ fallida, sin más reintentos', async () => {
    const { e, deps } = montar({ ok: false, motivo: 'rechazado', detalle: 'HTTP 500', status: 500 }, {}, [entrega({ intentos: MAX_INTENTOS_CORREO - 1 })]);
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r.fallidas).toBe(1);
    expect(e.reprogramadas).toEqual([]);
    expect(e.fallidas[0]?.error).toMatch(/agotó 5 intentos/);
  });

  it('red caída ⇒ reintento marcado como ambiguo (el POST pudo haber entrado)', async () => {
    const { e, deps } = montar({ ok: false, motivo: 'red', detalle: 'timeout' });
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r.reintentar).toBe(1);
    expect(e.reprogramadas[0]?.error).toMatch(/^ambiguo:/);
  });

  it('4xx del destinatario ⇒ fallida SIN reintento + excepción para la oficina, con el correo enmascarado', async () => {
    const { e, deps } = montar({ ok: false, motivo: 'rechazado', detalle: 'HTTP 422', status: 422 });
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r.fallidas).toBe(1);
    expect(e.reprogramadas).toEqual([]);
    expect(e.excepciones).toHaveLength(1);
    expect(e.excepciones[0]?.tipo).toBe('operador_sin_correo');
    expect(JSON.stringify(e.excepciones[0]?.detalle)).not.toContain('ana.prueba@ejemplo.test');
    expect(e.excepciones[0]?.detalle.correo).toBe('a***@ejemplo.test');
  });

  it('el detalle del proveedor que repite la dirección NO se persiste ni se loguea completo (fallida, excepción y reintento)', async () => {
    const cuerpo = 'Invalid `to` field: ana.prueba@ejemplo.test no es válida';
    const { e, deps } = montar({ ok: false, motivo: 'rechazado', detalle: cuerpo, status: 422 });
    await procesarEntregasCorreo(deps, 10);
    expect(JSON.stringify([e.fallidas, e.excepciones])).not.toContain('ana.prueba@ejemplo.test');
    expect(e.fallidas[0]?.error).toContain('a***@ejemplo.test');
    const t = montar({ ok: false, motivo: 'rechazado', detalle: cuerpo, status: 503 });
    await procesarEntregasCorreo(t.deps, 10);
    expect(JSON.stringify(t.e.reprogramadas)).not.toContain('ana.prueba@ejemplo.test');
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('ana.prueba@ejemplo.test');
  });

  it('el buzón de archivo rebota (422) ⇒ solo esa copia falla: el operador queda enviado y no se abre excepción de coordinador', async () => {
    const cola = [
      entrega({ id: 'e-op', rol: 'operador', correo: 'ana.prueba@ejemplo.test' }),
      entrega({ id: 'e-ar', rol: 'archivo', correo: 'archivo@ejemplo.test' }),
    ];
    const { e, deps } = montar({ ok: true, id: 're_op' }, {}, cola);
    deps.enviar = async (para) => (para === 'archivo@ejemplo.test'
      ? { ok: false, motivo: 'rechazado', detalle: 'HTTP 422', status: 422 }
      : { ok: true, id: 're_op' });
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r).toMatchObject({ reclamadas: 2, enviadas: 1, fallidas: 1, errores: 0 });
    expect(e.enviadas).toEqual([{ id: 'e-op', resendId: 're_op' }]);
    expect(e.fallidas.map((f) => f.id)).toEqual(['e-ar']);
    expect(e.liquidacionEnviada).toBe(1);
    expect(e.excepciones).toEqual([]);
  });

  it('el archivo recibe el MISMO adjunto que el operador, con su propia llave de idempotencia', async () => {
    const cola = [entrega({ id: 'e-op' }), entrega({ id: 'e-ar', rol: 'archivo', correo: 'archivo@ejemplo.test' })];
    const { e, deps } = montar({ ok: true, id: 're_1' }, {}, cola);
    await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar.map((l) => l.para)).toEqual(['ana.prueba@ejemplo.test', 'archivo@ejemplo.test']);
    const [a, b] = e.llamadasEnviar;
    expect(a?.op.adjuntos).toEqual(b?.op.adjuntos);
    expect(a?.op.idempotencyKey).not.toBe(b?.op.idempotencyKey);
    expect(b?.op.idempotencyKey).toMatch(/:archivo$/);
  });

  it('rechazo local sin status (destinatario no válido) ⇒ fallida sin reintento', async () => {
    const { e, deps } = montar({ ok: false, motivo: 'rechazado', detalle: 'Sin destinatarios válidos.' });
    await procesarEntregasCorreo(deps, 10);
    expect(e.fallidas).toHaveLength(1);
    expect(e.reprogramadas).toEqual([]);
  });

  it('sin_configurar ⇒ no gasta intento, queda pendiente y se cuenta como «correo no configurado» (jamás enviada)', async () => {
    const { e, deps } = montar({ ok: false, motivo: 'sin_configurar' }, {}, [entrega({ intentos: 2 })]);
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r.sinConfigurar).toBe(1);
    expect(r.enviadas).toBe(0);
    expect(e.reprogramadas[0]).toMatchObject({ intentos: 2, error: 'correo no configurado' });
    expect(e.liquidacionEnviada).toBe(0);
    expect(e.enviadas).toEqual([]);
  });

  it('401/403 (llave o dominio sin verificar) no es culpa del destinatario: no gasta intento ni falla la fila', async () => {
    const { e, deps } = montar({ ok: false, motivo: 'rechazado', detalle: 'HTTP 403', status: 403 }, {}, [entrega({ intentos: 1 })]);
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r.sinConfigurar).toBe(1);
    expect(r.fallidas).toBe(0);
    expect(e.reprogramadas[0]?.intentos).toBe(1);
    expect(e.excepciones).toEqual([]);
  });
});

describe('procesarEntregasCorreo — interruptor «Activar el envío» (INN-A1-04)', () => {
  it('activa=false ⇒ NO envía ni descarga el Excel; reprograma sin gastar intento y lo cuenta como apagada', async () => {
    // La pantalla promete «Apagado, no sale ningún correo aunque haya desgloses listos»: durante el alta ya hay contactos
    // reales cargados y el integrador prueba `POST /desgloses`; nada debe salir hasta que alguien lo encienda.
    const { e, deps } = montar({ ok: true, id: 're_no_debe_salir' }, { activa: false }, [entrega({ intentos: 2 })]);
    const r = await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar).toEqual([]);
    expect(r.enviadas).toBe(0);
    expect(r.apagada).toBe(1);
    expect(r.fallidas).toBe(0);
    expect(e.enviadas).toEqual([]);
    expect(e.liquidacionEnviada).toBe(0);
    expect(e.reprogramadas).toHaveLength(1);
    expect(e.reprogramadas[0]).toMatchObject({ id: 'e-1', intentos: 2 });
    expect(e.reprogramadas[0]?.proximo.getTime()).toBeGreaterThan(AHORA.getTime());
  });

  it('activa=true ⇒ sigue enviando igual (el interruptor encendido no cambia nada)', async () => {
    const { e, deps } = montar({ ok: true, id: 're_ok' }, { activa: true });
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r.enviadas).toBe(1);
    expect(r.apagada).toBe(0);
    expect(e.llamadasEnviar).toHaveLength(1);
  });

  it('sin fila de config (valor por defecto, activa=false) ⇒ tampoco envía', async () => {
    const { e, deps } = montar({ ok: true, id: 're_x' }, { ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo' });
    await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar).toEqual([]);
  });
});

describe('procesarEntregasCorreo — idempotencia y concurrencia', () => {
  it('dos invocaciones concurrentes ⇒ un solo envío (el claim reparte filas distintas)', async () => {
    const { e, deps } = montar({ ok: true, id: 're_1' });
    const [a, b] = await Promise.all([procesarEntregasCorreo(deps, 10), procesarEntregasCorreo(deps, 10)]);
    expect(e.llamadasEnviar).toHaveLength(1);
    expect(a.enviadas + b.enviadas).toBe(1);
    expect(a.reclamadas + b.reclamadas).toBe(1);
  });

  it('la Idempotency-Key es estable entre reintentos y cambia con la generación y el rol', async () => {
    const llaves: string[] = [];
    for (const intentos of [0, 1, 2]) {
      const { e, deps } = montar({ ok: false, motivo: 'rechazado', detalle: 'HTTP 503', status: 503 }, {}, [entrega({ intentos })]);
      await procesarEntregasCorreo(deps, 10);
      llaves.push(e.llamadasEnviar[0]!.op.idempotencyKey!);
    }
    expect(new Set(llaves).size).toBe(1);
    expect(llaves[0]).toBe(`liqcorreo:${LIQ}:g1:operador`);
    expect(llaveIdempotencia({ liquidacionExternaId: LIQ, generacion: 2, rol: 'operador' })).not.toBe(llaves[0]);
    expect(llaveIdempotencia({ liquidacionExternaId: LIQ, generacion: 1, rol: 'rh' })).not.toBe(llaves[0]);
  });

  it('claim vencido que YA trae resend_id ⇒ NO reenvía: fallida «sin confirmar» para decisión humana', async () => {
    const { e, deps } = montar({ ok: true, id: 'otro' }, {}, [entrega({ resendId: 're_previo' })]);
    const r = await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar).toEqual([]);
    expect(r.sinConfirmar).toBe(1);
    expect(e.fallidas[0]?.error).toMatch(/sin confirmar/);
  });

  it('intento previo ambiguo y llave de Resend ya vencida (>23 h) ⇒ NO reenvía: «sin confirmar»', async () => {
    const vieja = entrega({ ultimoError: 'ambiguo: timeout', proximoIntentoEn: '2026-10-13T12:00:00.000Z' });
    const { e, deps } = montar({ ok: true, id: 'x' }, {}, [vieja]);
    const r = await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar).toEqual([]);
    expect(r.sinConfirmar).toBe(1);
  });

  it('intento previo ambiguo pero dentro de la vigencia de la llave ⇒ SÍ reintenta (Resend deduplica)', async () => {
    const reciente = entrega({ ultimoError: 'ambiguo: timeout', proximoIntentoEn: '2026-10-14T18:20:00.000Z', intentos: 1 });
    const { e, deps } = montar({ ok: true, id: 're_x' }, {}, [reciente]);
    await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar).toHaveLength(1);
    expect(e.enviadas).toHaveLength(1);
  });

  it('si Resend aceptó pero el lease ya no es nuestro ⇒ no reintenta ni toca la liquidación; se cuenta como error', async () => {
    const { e, deps } = montar({ ok: true, id: 're_z' });
    deps.marcarEnviada = async () => false;
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r.errores).toBe(1);
    expect(e.reprogramadas).toEqual([]);
    expect(e.liquidacionEnviada).toBe(0);
  });

  it('un error inesperado en una fila no tumba las demás', async () => {
    const cola = [entrega({ id: 'e-a', claimToken: 't-a' }), entrega({ id: 'e-b', claimToken: 't-b', rol: 'rh', correo: 'rh@ejemplo.test' })];
    const { e, deps } = montar({ ok: true, id: 're_ok' }, {}, cola);
    let n = 0;
    deps.leerContexto = async () => { n += 1; if (n === 1) throw new Error('base caída'); return { claveExterna: 'BIT-T01-1228', periodoDesde: '2026-10-09', periodoHasta: '2026-10-14' }; };
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r.errores).toBe(1);
    expect(r.enviadas).toBe(1);
    expect(e.enviadas[0]?.id).toBe('e-b');
  });
});

describe('procesarEntregasCorreo — contenido del correo', () => {
  it('asunto y cuerpo no contienen importes, ni el nombre de la flota, ni el correo del destinatario', async () => {
    const { e, deps } = montar({ ok: true, id: 're_1' });
    await procesarEntregasCorreo(deps, 10);
    const l = e.llamadasEnviar[0]!;
    const todo = `${l.asunto}\n${l.parrafos.join('\n')}`;
    expect(l.asunto).toBe('Desglose de pago — bitácora 1228 — 9 al 14 oct');
    expect(l.parrafos).toHaveLength(3);
    expect(todo).not.toMatch(/\$/);
    expect(todo).not.toMatch(/\d[.,]\d{2}\b/);
    expect(todo).not.toContain(String(TOTAL_SINTETICO));
    expect(todo.toLowerCase()).not.toContain('flota prueba');
    expect(todo).not.toContain('ejemplo.test');
    expect(l.op.sobrio).toBe(true);
  });

  it('el adjunto es el base64 de los MISMOS bytes del Storage, con nombre y tipo de xlsx', async () => {
    const { e, deps } = montar({ ok: true, id: 're_1' });
    await procesarEntregasCorreo(deps, 10);
    const adj = e.llamadasEnviar[0]!.op.adjuntos!;
    expect(adj).toHaveLength(1);
    expect(adj[0]!.filename).toBe('desglose-1228.xlsx');
    expect(adj[0]!.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(Buffer.from(adj[0]!.content, 'base64').equals(Buffer.from(BYTES))).toBe(true);
  });

  it('remitente y responder-a vienen de la configuración de la flota', async () => {
    const { e, deps } = montar({ ok: true, id: 're_1' }, { remitenteNombre: 'Nómina Prueba', responderA: 'nomina@ejemplo.test' });
    await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar[0]!.op).toMatchObject({ remitenteNombre: 'Nómina Prueba', replyTo: 'nomina@ejemplo.test' });
  });

  it('un Excel cuya huella no coincide NO se envía', async () => {
    const { e, deps } = montar({ ok: true, id: 'x' }, {}, [entrega({ xlsxSha256: 'a'.repeat(64) })]);
    const r = await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar).toEqual([]);
    expect(r.fallidas).toBe(1);
  });

  it('entrega sin ruta del Excel ⇒ fallida, sin enviar', async () => {
    const { e, deps } = montar({ ok: true, id: 'x' }, {}, [entrega({ xlsxRuta: null })]);
    await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar).toEqual([]);
    expect(e.fallidas).toHaveLength(1);
  });

  it('si no se puede descargar el Excel ⇒ reintento (cuenta intento), no «enviada»', async () => {
    const { e, deps } = montar({ ok: true, id: 'x' });
    deps.descargarXlsx = async () => { throw new Error('storage caído'); };
    const r = await procesarEntregasCorreo(deps, 10);
    expect(r.reintentar).toBe(1);
    expect(e.llamadasEnviar).toEqual([]);
  });
});

describe('procesarEntregasCorreo — ventana de envío (hora de México)', () => {
  it('antes de enviar_desde_hora no envía: libera la fila a la hora de apertura sin gastar intento', async () => {
    const { e, deps } = montar({ ok: true, id: 'x' }, { enviarDesdeHora: 14 }, [entrega({ intentos: 1 })]);
    const r = await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar).toEqual([]);
    expect(r.fueraDeVentana).toBe(1);
    expect(e.reprogramadas[0]?.intentos).toBe(1);
    expect(e.reprogramadas[0]?.proximo.toISOString()).toBe('2026-10-14T20:00:00.000Z'); // 14:00 en México
  });

  it('después de la hora sí envía', async () => {
    const { e, deps } = montar({ ok: true, id: 're_1' }, { enviarDesdeHora: 12 });
    await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar).toHaveLength(1);
  });

  it('sin hora configurada ⇒ inmediato', async () => {
    const { e, deps } = montar({ ok: true, id: 're_1' }, { enviarDesdeHora: null });
    await procesarEntregasCorreo(deps, 10);
    expect(e.llamadasEnviar).toHaveLength(1);
  });

  it('usa el día de México, no el de UTC: 03:00 UTC del día 15 sigue siendo el 14 allá', () => {
    const d = inicioVentanaHoy(new Date('2026-10-15T03:00:00.000Z'), 12);
    expect(d?.toISOString()).toBe('2026-10-14T18:00:00.000Z');
    expect(inicioVentanaHoy(AHORA, 24)).toBeNull();
    expect(inicioVentanaHoy(AHORA, null)).toBeNull();
  });
});

describe('utilidades puras', () => {
  it('enmascara el correo', () => {
    expect(enmascararCorreo('ana.prueba@ejemplo.test')).toBe('a***@ejemplo.test');
    expect(enmascararCorreo('sin-arroba')).toBe('***');
  });

  it('rango corto de fechas', () => {
    expect(rangoCorto('2026-10-09', '2026-10-14')).toBe('9 al 14 oct');
    expect(rangoCorto('2026-09-28', '2026-10-02')).toBe('28 sep al 2 oct');
    expect(rangoCorto('2026-10-09', '2026-10-09')).toBe('9 oct');
    expect(rangoCorto('basura', '2026-10-09')).toBe('');
  });

  it('el nombre del adjunto no deja pasar caracteres de ruta', () => {
    const { nombreAdjunto } = armarCorreoDesglose({ claveExterna: 'BIT-T01-../12/28', periodoDesde: '2026-10-09', periodoHasta: '2026-10-14' });
    expect(nombreAdjunto).not.toMatch(/[\\/]/);
    expect(nombreAdjunto.endsWith('.xlsx')).toBe(true);
  });
});
