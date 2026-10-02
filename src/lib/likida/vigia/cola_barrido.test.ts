import { describe, it, expect, vi } from 'vitest';
import { barridoVigia } from './servicio';
import { proximoVencimientoMs, seleccionarEnEspera, DIAS_CICLO_INACTIVO } from './escalamiento';
import { escenario, RepoEnMemoria } from './repo.fixture';
import { AHORA, T1, T2, CLIENTE_A, CLIENTE_A2, CLIENTE_B } from './datos.fixture';
import type { DepsVigia } from './puertos';
import type { Conversacion } from './tipos';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ═══════════════════════════════════════════════════════════════════════════
// El BLOQUEO EN CABEZA DE COLA del barrido (ronda 05 · P5): el barrido mira un número acotado de conversaciones por pasada y
// las pedía por antigüedad. Con más de 100 hilos que ya no pueden avisar nada (escalera completa) o que aún no vencen (flota
// con plazo largo), una crítica nueva quedaba detrás y su alerta de 10 min no salía nunca.
// ═══════════════════════════════════════════════════════════════════════════

const min = (m: number) => m * 60_000;
const hace = (m: number, base = AHORA) => new Date(base.getTime() - min(m)).toISOString();

function armar(repo: RepoEnMemoria, ahora: Date) {
  const alGerente: Array<{ telefono: string; texto: string }> = [];
  const deps: DepsVigia = {
    repo, ahora: () => ahora,
    enviar: (async (telefono: string, op: { texto: string }) => {
      alGerente.push({ telefono, texto: op.texto });
      return { ok: true, via: 'botones', id: 'wamid.GER', motivo: 'ventana_abierta', ventana: 'abierta' };
    }) as unknown as DepsVigia['enviar'],
  };
  return { deps, alGerente };
}

let tel = 0;
function hilo(repo: RepoEnMemoria, tenantId: string, clienteId: string, c: Partial<Conversacion>): Conversacion {
  tel += 1;
  const contacto = repo.agregarContacto({ tenantId, clienteId, telefono: `52551${String(tel).padStart(7, '0')}` });
  const conv: Conversacion = {
    id: `00000000-0000-4000-9000-${String(tel).padStart(12, '0')}`, tenantId, contactoId: contacto.id, clienteId, viajeId: null, estado: 'activa',
    control: 'agente', tomadaPor: null, ultimaEntradaEn: null, ultimaSalidaEn: null, sinRespuestaDesde: hace(10), entradasSinRespuesta: 1,
    molestiaNivel: 0, molestiaMotivos: [], molestiaEn: null, escalamientoNivel: 0, escaladoEn: null, atendidaEn: null, ...c,
  };
  repo.conversaciones.set(conv.id, conv);
  repo.mensajes.set(`m-${conv.id}`, {
    id: `m-${conv.id}`, tenantId, conversacionId: conv.id, direccion: 'entrante', autor: 'cliente', wamid: `w-${conv.id}`, tipo: 'texto', texto: '¿y mi carga?', intencion: null,
    estado: 'recibido', respuestaA: null, riesgo: null, autoenviado: false, editado: false, aprobadoPor: null, enviadoEn: null, via: null, error: null, senales: [], adjuntos: [], createdAt: conv.sinRespuestaDesde ?? hace(10),
  });
  return conv;
}

describe('proximoVencimientoMs · cuándo le toca su aviso a un hilo', () => {
  const cfg = { slaRespuestaMin: 30, escalarNivel2Min: 60 };
  const base = { sinRespuestaDesde: hace(5), escalamientoNivel: 0, molestiaNivel: 0, atendidaEn: null, entradasSinRespuesta: 1 };

  it('nivel 0: al cumplirse el SLA; nivel 1 o ya tomado: a SLA + N2; nivel 2 o sin espera: nunca', () => {
    const t0 = Date.parse(base.sinRespuestaDesde);
    expect(proximoVencimientoMs(base, cfg)).toBe(t0 + min(30));
    expect(proximoVencimientoMs({ ...base, escalamientoNivel: 1 }, cfg)).toBe(t0 + min(90));
    expect(proximoVencimientoMs({ ...base, atendidaEn: hace(1) }, cfg)).toBe(t0 + min(90));
    expect(proximoVencimientoMs({ ...base, escalamientoNivel: 2 }, cfg)).toBeNull();
    expect(proximoVencimientoMs({ ...base, sinRespuestaDesde: null }, cfg)).toBeNull();
  });

  it('molestia sin avisar: vencida desde que empezó la espera (no se queda esperando al SLA)', () => {
    expect(proximoVencimientoMs({ ...base, molestiaNivel: 2 }, cfg)).toBe(Date.parse(base.sinRespuestaDesde));
    expect(proximoVencimientoMs({ ...base, entradasSinRespuesta: 5 }, cfg)).toBe(Date.parse(base.sinRespuestaDesde));
  });

  it('seleccionarEnEspera: quita el nivel 2, ordena por vencimiento y respeta el límite', () => {
    const f = (id: string, sinRespuestaDesde: string, sla: number, escalamientoNivel = 0) =>
      ({ conversacion: { ...base, id, sinRespuestaDesde, escalamientoNivel }, config: { slaRespuestaMin: sla, escalarNivel2Min: 60 } });
    const filas = [f('lenta-vieja', hace(600), 1440), f('nivel2', hace(900), 10, 2), f('critica', hace(12), 10), f('normal', hace(40), 30)];
    expect(seleccionarEnEspera(filas, 10).map((x) => x.conversacion.id)).toEqual(['normal', 'critica', 'lenta-vieja']);
    expect(seleccionarEnEspera(filas, 1).map((x) => x.conversacion.id)).toEqual(['normal']);
  });
});

describe('barridoVigia · una crítica nueva sí recibe su alerta de 10 min', () => {
  it('con 150 hilos en la escalera completa y otros 150 de una flota con plazo de 24 h, la crítica de 12 min avisa al gerente', async () => {
    const { repo } = escenario({ slaRespuestaMin: 30, escalarNivel2Min: 60 });
    repo.criticos.add(`${T1}:${CLIENTE_A}`);
    // Flota B: plazo de 24 h, 150 hilos con 20 h de espera (más viejos que la crítica, pero faltan 4 h para su plazo).
    repo.habilitar(T2, { slaRespuestaMin: 1440, escalarNivel2Min: 60 });
    repo.destinatario(T2, 1, { userId: 'u-b', telefono: '525500000002' });
    for (let i = 0; i < 150; i++) hilo(repo, T2, CLIENTE_B, { sinRespuestaDesde: hace(1200) });
    // Flota A: 150 hilos viejos que YA llegaron al nivel 2 (nada más que avisar).
    for (let i = 0; i < 150; i++) hilo(repo, T1, CLIENTE_A2, { sinRespuestaDesde: hace(3000), escalamientoNivel: 2, atendidaEn: hace(2900) });
    const critica = hilo(repo, T1, CLIENTE_A, { sinRespuestaDesde: hace(12) });

    const { deps, alGerente } = armar(repo, AHORA);
    const r = await barridoVigia(deps, { limite: 100 });

    expect(r.escaladas).toBe(1);
    expect(alGerente).toHaveLength(1);
    expect(alGerente[0].telefono).toBe('525599999999');
    expect(alGerente[0].texto).toContain('12 minutos sin respuesta');
    expect(repo.conversaciones.get(critica.id)?.escalamientoNivel).toBe(1);
  });

  it('un hilo con la escalera completa deja de ocupar la cola aunque sea el más viejo', async () => {
    const { repo } = escenario();
    const viejo = hilo(repo, T1, CLIENTE_A2, { sinRespuestaDesde: hace(5000), escalamientoNivel: 2 });
    hilo(repo, T1, CLIENTE_A, { sinRespuestaDesde: hace(40) });
    const filas = await repo.conversacionesEnEspera(1, AHORA);
    expect(filas.map((f) => f.conversacion.id)).not.toContain(viejo.id);
    expect(filas).toHaveLength(1);
  });

  it('un hilo ya tomado por una persona sigue vigilado para el dueño (nivel 2), pero no se interpone a uno que vence antes', async () => {
    const { repo } = escenario({ slaRespuestaMin: 30, escalarNivel2Min: 60 });
    const tomado = hilo(repo, T1, CLIENTE_A2, { sinRespuestaDesde: hace(100), atendidaEn: hace(90), control: 'humano', tomadaPor: 'u-gerente' });
    const nuevo = hilo(repo, T1, CLIENTE_A, { sinRespuestaDesde: hace(31) });
    expect((await repo.conversacionesEnEspera(1, AHORA)).map((f) => f.conversacion.id)).toEqual([tomado.id]); // vencido a 90 min: ya le toca al dueño
    const { deps, alGerente } = armar(repo, AHORA);
    await barridoVigia(deps, { limite: 1 });
    expect(alGerente.map((a) => a.telefono)).toEqual(['525588888888']);
    // Ya en nivel 2 sale de la cola y entra el siguiente.
    expect((await repo.conversacionesEnEspera(1, AHORA)).map((f) => f.conversacion.id)).toEqual([nuevo.id]);
  });
});

describe('barridoVigia · expiración de ciclos muertos y mantenimiento', () => {
  it(`cierra los hilos con ${DIAS_CICLO_INACTIVO} días o más de espera, con huella en la bitácora; los recientes quedan`, async () => {
    const { repo } = escenario();
    const muerto = hilo(repo, T1, CLIENTE_A2, { sinRespuestaDesde: hace(DIAS_CICLO_INACTIVO * 1440 + 5), escalamientoNivel: 2 });
    const vivo = hilo(repo, T1, CLIENTE_A, { sinRespuestaDesde: hace(5) });
    const { deps } = armar(repo, AHORA);
    const r = await barridoVigia(deps);
    expect(r.expiradas).toBe(1);
    expect(repo.conversaciones.get(muerto.id)).toMatchObject({ estado: 'cerrada', sinRespuestaDesde: null });
    expect(repo.conversaciones.get(vivo.id)?.estado).toBe('activa');
    expect(repo.eventosDe('cerrada').filter((e) => e.conversacionId === muerto.id && (e.detalle as { motivo?: string }).motivo === 'ciclo_inactivo')).toHaveLength(1);
  });

  it('mantenimiento:false (las pasadas de cada minuto) solo vigila clientes: no expira, no purga, no toca aprobados', async () => {
    const { repo } = escenario();
    hilo(repo, T1, CLIENTE_A2, { sinRespuestaDesde: hace(DIAS_CICLO_INACTIVO * 1440 + 5) });
    const { deps } = armar(repo, AHORA);
    const r = await barridoVigia(deps, { mantenimiento: false });
    expect(r).toMatchObject({ expiradas: 0, purgadas: 0, atorados: 0 });
    expect(repo.purgas).toBe(0);
  });

  it('una falla al expirar no tira el barrido', async () => {
    const { repo } = escenario();
    repo.fallaEn.expirarCiclosInactivos = true;
    const { deps } = armar(repo, AHORA);
    await expect(barridoVigia(deps)).resolves.toMatchObject({ expiradas: 0 });
  });
});

describe('ejecutarEscalamiento · sello sin actualizar', () => {
  it('si una pasada murió entre el sello y la actualización, la siguiente sube el nivel (si no, el hilo se quedaría en la cola)', async () => {
    const { repo } = escenario({ slaRespuestaMin: 30 });
    const c = hilo(repo, T1, CLIENTE_A, { sinRespuestaDesde: hace(31) });
    await repo.evento(T1, { conversacionId: c.id, tipo: 'escalada', clave: `${c.id}:${Date.parse(c.sinRespuestaDesde!)}:n1`, nivel: 1 });
    const { deps } = armar(repo, AHORA);
    const r = await barridoVigia(deps);
    expect(r.duplicadas).toBe(1);
    expect(repo.conversaciones.get(c.id)?.escalamientoNivel).toBe(1);
  });
});
