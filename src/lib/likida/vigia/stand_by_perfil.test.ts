import { describe, it, expect, vi } from 'vitest';
import { atenderMensajeCliente, atenderDecisionVigia, barridoVigia } from './servicio';
import { reintentarCorreosVencidos } from './respaldo_correo';
import { escenario, RepoEnMemoria } from './repo.fixture';
import { AHORA, T1, T2, CLIENTE_A, CLIENTE_A2 } from './datos.fixture';
import { DIAS_CICLO_INACTIVO } from './escalamiento';
import type { DepsVigia } from './puertos';
import type { Conversacion } from './tipos';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ═══════════════════════════════════════════════════════════════════════════
// PERFIL `cinco_agentes`, FASE 1: el Vigía (A4) es SOLO «Próximamente». Bajo el perfil NADA del Vigía envía, escribe ni lee
// (revisión adversarial A1 y M1): ni el WhatsApp del cliente, ni los botones del gerente, ni ninguna pasada del barrido.
// ═══════════════════════════════════════════════════════════════════════════

// Teléfonos sintéticos del fixture del Vigía.
const TEL_CLIENTE = '525511110001'; // grep-limpio:ok
const TEL_GERENTE_2 = '525577777777'; // grep-limpio:ok

const min = (m: number) => m * 60_000;
const hace = (m: number) => new Date(AHORA.getTime() - min(m)).toISOString();

function armar(repo: RepoEnMemoria, enStandBy?: DepsVigia['enStandBy']) {
  const alGerente: string[] = [];
  const alCliente: unknown[] = [];
  const enviarCorreo = vi.fn(async () => ({ ok: true as const, id: 're_1' }));
  const deps: DepsVigia = {
    repo, ahora: () => AHORA, enStandBy, enviarCorreo: enviarCorreo as unknown as DepsVigia['enviarCorreo'],
    enviarCliente: async (e) => { alCliente.push(e); return { ok: true, via: 'texto', id: 'wamid.CLI', ventana: 'abierta' }; },
    enviar: (async (telefono: string) => {
      alGerente.push(telefono);
      return { ok: true, via: 'botones', id: 'wamid.GER', motivo: 'ventana_abierta', ventana: 'abierta' };
    }) as unknown as DepsVigia['enviar'],
  };
  return { deps, alGerente, alCliente, enviarCorreo };
}

let tel = 0;
function hilo(repo: RepoEnMemoria, tenantId: string, clienteId: string, c: Partial<Conversacion>): Conversacion {
  tel += 1;
  const contacto = repo.agregarContacto({ tenantId, clienteId, telefono: `52552${String(tel).padStart(7, '0')}` });
  const conv: Conversacion = {
    id: `00000000-0000-4000-8000-${String(tel).padStart(12, '0')}`, tenantId, contactoId: contacto.id, clienteId, viajeId: null, estado: 'activa',
    control: 'agente', tomadaPor: null, ultimaEntradaEn: null, ultimaSalidaEn: null, sinRespuestaDesde: hace(15), entradasSinRespuesta: 1,
    molestiaNivel: 0, molestiaMotivos: [], molestiaEn: null, escalamientoNivel: 0, escaladoEn: null, atendidaEn: null, ...c,
  };
  repo.conversaciones.set(conv.id, conv);
  repo.mensajes.set(`m-${conv.id}`, {
    id: `m-${conv.id}`, tenantId, conversacionId: conv.id, direccion: 'entrante', autor: 'cliente', wamid: `w-${conv.id}`, tipo: 'texto', texto: '¿y mi carga?', intencion: null,
    estado: 'recibido', respuestaA: null, riesgo: null, autoenviado: false, editado: false, aprobadoPor: null, enviadoEn: null, via: null, error: null, senales: [], adjuntos: [], createdAt: conv.sinRespuestaDesde ?? hace(10),
  });
  return conv;
}

describe('el WhatsApp del cliente y los botones del gerente', () => {
  it('cliente de una flota con perfil: «atendido» en silencio; no se guarda su mensaje, no se le contesta, no se escala', async () => {
    const { repo } = escenario();
    const { deps, alCliente, alGerente } = armar(repo, async (t) => t === T1);
    const r = await atenderMensajeCliente({ from: TEL_CLIENTE, type: 'text', text: '¿dónde va mi unidad?', waMessageId: 'w1', timestampMs: AHORA.getTime() }, deps);
    expect(r).toBe('atendido');
    expect(repo.mensajes.size).toBe(0);
    expect(alCliente).toEqual([]);
    expect(alGerente).toEqual([]);
  });

  it('SIN perfil (o sin el puerto) el cliente se atiende como siempre', async () => {
    for (const enStandBy of [async () => false, undefined]) {
      const { repo } = escenario();
      const { deps } = armar(repo, enStandBy);
      await atenderMensajeCliente({ from: TEL_CLIENTE, type: 'text', text: '¿dónde va mi unidad?', waMessageId: 'w1', timestampMs: AHORA.getTime() }, deps);
      expect(repo.mensajes.size).toBeGreaterThan(0);
    }
  });

  it('si el puerto del perfil revienta, falla cerrado (se calla)', async () => {
    const { repo } = escenario();
    const { deps, alCliente } = armar(repo, async () => { throw new Error('perfil ilegible'); });
    expect(await atenderMensajeCliente({ from: TEL_CLIENTE, type: 'text', text: 'hola', waMessageId: 'w2', timestampMs: AHORA.getTime() }, deps)).toBe('atendido');
    expect(repo.mensajes.size).toBe(0);
    expect(alCliente).toEqual([]);
  });

  it('vig_ok / vig_tomo de un gerente con perfil: cadena vacía (el processor no manda nada) y ni se lee el mensaje', async () => {
    const { repo } = escenario();
    const leer = vi.spyOn(repo, 'mensaje');
    const { deps, alCliente } = armar(repo, async () => true);
    const id = '12345678-1234-4234-8234-123456789abc';
    for (const boton of [`vig_ok:${id}`, `vig_tomo:${id}`]) {
      expect(await atenderDecisionVigia({ tenantId: T1, rol: 'encargado', userId: 'u1' }, boton, deps)).toBe('');
    }
    expect(leer).not.toHaveBeenCalled();
    expect(alCliente).toEqual([]);
  });

  it('un texto que no es botón sigue devolviendo null aunque haya perfil', async () => {
    const { repo } = escenario();
    expect(await atenderDecisionVigia({ tenantId: T1, rol: 'encargado', userId: 'u1' }, 'hola', armar(repo, async () => true).deps)).toBeNull();
  });
});

describe('el barrido del cron cruza flotas: TODA pasada salta las flotas con perfil', () => {
  it('escalamiento, atorados, ciclos muertos y correos de respaldo: la flota con perfil no se toca, la libre sí', async () => {
    const { repo } = escenario({ slaRespuestaMin: 10 });
    repo.habilitar(T2, { slaRespuestaMin: 10 });
    repo.destinatario(T2, 1, { userId: 'u-gerente-2', telefono: TEL_GERENTE_2 });
    const espera1 = hilo(repo, T1, CLIENTE_A, { sinRespuestaDesde: hace(15) });
    const espera2 = hilo(repo, T2, CLIENTE_A2, { sinRespuestaDesde: hace(15) });
    const muerto1 = hilo(repo, T1, CLIENTE_A2, { sinRespuestaDesde: hace(DIAS_CICLO_INACTIVO * 1440 + 5), escalamientoNivel: 2 });
    const muerto2 = hilo(repo, T2, CLIENTE_A, { sinRespuestaDesde: hace(DIAS_CICLO_INACTIVO * 1440 + 5), escalamientoNivel: 2 });
    const atorados = vi.spyOn(repo, 'aprobadosAtorados').mockResolvedValue([{ tenantId: T1, id: 'm-t1' }, { tenantId: T2, id: 'm-t2' }]);
    const fallido = vi.spyOn(repo, 'marcarFallido').mockResolvedValue(true as never);
    const vencidos = vi.spyOn(repo, 'correosVencidos').mockResolvedValue([
      { tenantId: T1, id: 'c1', conversacionId: espera1.id, clave: 'k1', nivel: 1, directorId: null, destino: 'a@flota.invalid', datos: {} as never },
    ]);
    const reclamar = vi.spyOn(repo, 'reclamarCorreo');
    const { deps, alGerente } = armar(repo);

    await barridoVigia(deps, { saltar: new Set([T1]) });

    expect(repo.conversaciones.get(espera1.id)?.escalamientoNivel).toBe(0);
    expect(repo.conversaciones.get(espera2.id)?.escalamientoNivel).toBe(1);
    expect(alGerente).toHaveLength(1);
    expect(repo.conversaciones.get(muerto1.id)?.estado).toBe('activa');
    expect(repo.conversaciones.get(muerto2.id)?.estado).toBe('cerrada');
    expect(atorados).toHaveBeenCalled();
    expect(fallido).toHaveBeenCalledTimes(1);
    expect(fallido.mock.calls[0][0]).toBe(T2);
    expect(vencidos).toHaveBeenCalled();
    expect(reclamar).not.toHaveBeenCalled();
  });

  it('reintentarCorreosVencidos no manda el correo de respaldo de una flota con perfil', async () => {
    const { repo } = escenario();
    vi.spyOn(repo, 'correosVencidos').mockResolvedValue([
      { tenantId: T1, id: 'c1', conversacionId: 'x', clave: 'k1', nivel: 1, directorId: null, destino: 'a@flota.invalid', datos: {} as never },
    ]);
    const { deps, enviarCorreo } = armar(repo);
    expect(await reintentarCorreosVencidos(deps, 20, new Set([T1]))).toBe(0);
    expect(enviarCorreo).not.toHaveBeenCalled();
  });

  it('la pasada de avisos no recorre las flotas con perfil (el día que se cablee `deps.avisos`)', async () => {
    const { repo } = escenario();
    const generar = { repo: {} } as never;
    const flotas = vi.fn(async () => [
      { tenantId: T1, generar, aprobados: vi.fn(async () => []), entrega: {} },
      { tenantId: T2, generar, aprobados: vi.fn(async () => []), entrega: {} },
    ]);
    const { deps } = armar(repo);
    deps.avisos = { flotas } as never;
    const r = await barridoVigia(deps, { saltar: new Set([T1, T2]) });
    expect(flotas).toHaveBeenCalled();
    expect(r.avisosCreados).toBe(0);
    expect(r.avisosConError).toBe(false);
  });

  it('sin `saltar` nada cambia: la flota se escala como siempre', async () => {
    const { repo } = escenario({ slaRespuestaMin: 10 });
    const espera1 = hilo(repo, T1, CLIENTE_A, { sinRespuestaDesde: hace(15) });
    const { deps } = armar(repo);
    await barridoVigia(deps);
    expect(repo.conversaciones.get(espera1.id)?.escalamientoNivel).toBe(1);
  });
});
