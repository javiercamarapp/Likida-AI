import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', async (original) => {
  const real = await original<Record<string, unknown>>();
  const { meta } = await import('./meta.fixture');
  return {
    ...real,
    enviarTexto: (...a: Parameters<typeof meta.enviarTexto>) => meta.enviarTexto(...a),
    enviarBotones: (...a: Parameters<typeof meta.enviarBotones>) => meta.enviarBotones(...a),
    sendTemplate: (...a: Parameters<typeof meta.sendTemplate>) => meta.sendTemplate(...a),
    enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true, id: 'wamid.ubicacion' })),
  };
});
vi.mock('@/lib/likida/wa_ventana', async (original) => {
  const real = await original<typeof import('@/lib/likida/wa_ventana')>();
  const { meta } = await import('./meta.fixture');
  return {
    ...real,
    ventanaDeContacto: async (tel: string, ahora: Date = new Date()) => real.estadoDeVentana(meta.ultimoEntrante.get(real.normalizarTelefonoWa(tel)) ?? null, ahora),
    registrarDecisionEnvio: async () => {},
  };
});

const { correrConductor } = await import('./ejecutor');
const { crearMundo } = await import('./mundo.fixture');
const { meta } = await import('./meta.fixture');
const { enviarConFallback } = await import('@/lib/meta/enviar_con_fallback');
import { CONFIG_CONDUCTOR_DEFAULT } from './config';
import {
  aplicarCiclo, cicloActual, cicloDelServicio, estaFueraDeCiclo, hitoEnCiclo, hitosDelCiclo, MOTIVO_FUERA_DE_CICLO, SEMILLA_CICLOS,
  type CicloEfectivo, type CicloServicioFila, type Servicio,
} from './ciclo_servicio';
import { decidir, hitoActivo, type EntradaMaquina } from './maquina';
import { hitoVacio, viajeBase } from './memoria.fixture';
import { planificar } from './planificador';
import { TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';
import type { ViajeContexto } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-42 — el motor sigue el ciclo del servicio. Datos 100 % sintéticos; la semilla es «propuesta hasta recibir la hoja de estatus».
// Hora de México = UTC-6 (America/Mexico_City, sin horario de verano); 2026-10-06 es martes.
// ═══════════════════════════════════════════════════════════════════════════

const mx = (hhmm: string, dia = '2026-10-06') => new Date(`${dia}T${hhmm}:00-06:00`);
const FILAS: CicloServicioFila[] = SEMILLA_CICLOS.map((p) => ({ tenantId: 't1', servicio: p.servicio, orden: p.orden, hito: p.hito, activo: true }));
const ciclo = (s: Servicio | null): CicloEfectivo => cicloDelServicio(FILAS, s);
const sembrados = (cambios: Partial<Record<TipoHito, Partial<HitoFila>>> = {}): HitoFila[] =>
  TIPOS_HITO.map((tipo, i) => hitoVacio({ id: `h${i}`, tipo, viajeId: 'v1', ...(cambios[tipo] ?? {}) }));
const registrado = (iso: string): Partial<HitoFila> => ({ estado: 'recibido', fuente: 'texto', mensajeEn: iso, recibidoEn: iso });
const cfg = { ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [0, 15, 30, 45], diasSemana: [1, 2, 3, 4, 5, 6, 7], esperaCargaMin: 120 };

const entrada = (c: CicloEfectivo | undefined, clase: 'llegada' | 'salida', hitos: HitoFila[], ahora = mx('10:00')): EntradaMaquina => ({
  hitos, intencion: { clase, lugar: null } as EntradaMaquina['intencion'], contacto: null, ahora, mensajeEn: ahora,
  ventanaCorreccionMin: 30, posponerMin: 15, ciclo: c,
});

describe('qué hitos tiene cada servicio', () => {
  it('importación NO pide carga; exportación NO pide descarga; nacional los cinco', () => {
    expect(hitosDelCiclo(ciclo('importacion'))).toEqual(['llegada_descarga', 'salida_descarga']);
    expect(hitosDelCiclo(ciclo('exportacion'))).toEqual(['llegada_carga', 'salida_carga']);
    expect(hitosDelCiclo(ciclo('nacional'))).toEqual([...TIPOS_HITO]);
    expect(hitoEnCiclo(ciclo('importacion'), 'llegada_carga')).toBe(false);
    expect(hitoEnCiclo(undefined, 'regreso')).toBe(true);
  });

  it('el ciclo actual (flota sin filas o viaje sin servicio) deja la MISMA lista, sin tocar nada', () => {
    const hs = sembrados();
    expect(aplicarCiclo(hs, undefined)).toBe(hs);
    expect(aplicarCiclo(hs, cicloActual())).toBe(hs);
    expect(aplicarCiclo(hs, cicloDelServicio([], 'importacion'))).toBe(hs);
    expect(aplicarCiclo(hs, cicloDelServicio(FILAS, null))).toBe(hs);
  });

  it('lo pendiente fuera del ciclo se lee omitido/fuera_de_ciclo; lo registrado y lo omitido por otra causa se conservan', () => {
    const hs = sembrados({
      llegada_carga: registrado(mx('08:00').toISOString()),
      salida_carga: { estado: 'omitido', omitidoMotivo: 'fuera_de_perfil' },
      regreso: { estado: 'escalado' },
    });
    const v = aplicarCiclo(hs, ciclo('importacion'));
    const por = (t: TipoHito) => v.find((h) => h.tipo === t)!;
    expect(por('llegada_carga').estado).toBe('recibido'); // ya dicho por el chofer: no se pierde
    expect(por('salida_carga')).toMatchObject({ estado: 'omitido', omitidoMotivo: 'fuera_de_perfil' });
    expect(estaFueraDeCiclo(por('regreso'))).toBe(true);
    expect(por('regreso').omitidoMotivo).toBe(MOTIVO_FUERA_DE_CICLO);
    expect(v.filter((h) => h.estado === 'esperado').map((h) => h.tipo)).toEqual(['llegada_descarga', 'salida_descarga']);
    expect(hs.find((h) => h.tipo === 'regreso')!.estado).toBe('escalado'); // no muta la entrada
  });

  it('un ciclo configurado sin ningún paso que tenga hito deja todo omitido (se dice, no se persigue nada)', () => {
    const solo: CicloEfectivo = { origen: 'flota', servicio: 'nacional', pasos: ['confirmar', 'inicio_viaje'] };
    expect(hitosDelCiclo(solo)).toEqual([]);
    expect(hitoActivo(aplicarCiclo(sembrados(), solo))).toBeNull();
  });
});

describe('la máquina valida con la secuencia del servicio', () => {
  it('importación: «ya llegué» a secas con nada registrado es la llegada a CLIENTE (descarga), sin ambigüedad', () => {
    const d = decidir(entrada(ciclo('importacion'), 'llegada', sembrados()));
    expect(d).toMatchObject({ accion: 'registrar', objetivo: 'llegada_descarga', ambigua: false, omitir: [] });
  });

  it('importación: repetir «ya llegué» es duplicado, no «¿es la descarga?»; «ya salí» es la salida de la descarga', () => {
    const hs = sembrados({ llegada_descarga: registrado(mx('09:00').toISOString()) });
    expect(decidir(entrada(ciclo('importacion'), 'llegada', hs))).toMatchObject({ accion: 'duplicado', objetivo: 'llegada_descarga' });
    expect(decidir(entrada(ciclo('importacion'), 'salida', hs))).toMatchObject({ accion: 'registrar', objetivo: 'salida_descarga', ambigua: false });
  });

  it('exportación: «ya llegué» es la carga; repetirlo es duplicado (en el ciclo de siempre sería «aclarar»); «ya salí» es la salida de carga', () => {
    const hs = sembrados({ llegada_carga: registrado(mx('09:00').toISOString()) });
    expect(decidir(entrada(ciclo('exportacion'), 'llegada', sembrados()))).toMatchObject({ accion: 'registrar', objetivo: 'llegada_carga', ambigua: false });
    expect(decidir(entrada(ciclo('exportacion'), 'llegada', hs))).toMatchObject({ accion: 'duplicado', objetivo: 'llegada_carga' });
    expect(decidir(entrada(undefined, 'llegada', hs))).toMatchObject({ accion: 'aclarar' });
    expect(decidir(entrada(ciclo('exportacion'), 'salida', hs))).toMatchObject({ accion: 'registrar', objetivo: 'salida_carga' });
  });

  it('nacional y sin ciclo deciden EXACTAMENTE igual que hoy', () => {
    const casos: HitoFila[][] = [
      sembrados(),
      sembrados({ llegada_carga: registrado(mx('08:00').toISOString()) }),
      sembrados({ llegada_carga: registrado(mx('08:00').toISOString()), salida_carga: registrado(mx('10:00').toISOString()) }),
    ];
    for (const hs of casos) for (const clase of ['llegada', 'salida'] as const) {
      const sin = decidir(entrada(undefined, clase, hs));
      expect(decidir(entrada(ciclo('nacional'), clase, hs))).toEqual(sin);
      expect(decidir(entrada(cicloActual(), clase, hs))).toEqual(sin);
    }
    expect(decidir(entrada(undefined, 'llegada', sembrados()))).toMatchObject({ objetivo: 'llegada_carga', ambigua: true });
  });

  it('lo que el chofer dice explícitamente fuera del ciclo se registra (no se pierde el dato)', () => {
    const d = decidir({ ...entrada(ciclo('importacion'), 'llegada', sembrados()), intencion: { clase: 'llegada', lugar: 'carga' } as EntradaMaquina['intencion'] });
    expect(d).toMatchObject({ accion: 'registrar', objetivo: 'llegada_carga' });
  });
});

describe('el planificador persigue solo los hitos del servicio', () => {
  const viaje = (p: Partial<ViajeContexto> = {}) => viajeBase({ aceptadoEn: mx('05:00').toISOString(), operadorTelefono: '5219990000001', ...p });
  const plan = (c: CicloEfectivo | undefined, hitos: HitoFila[], v: ViajeContexto, ahora: Date) => planificar({ viaje: v, hitos, config: cfg, ahora, enviadosHoyChofer: 0, avisos: [], ciclo: c });

  it('importación: el primer hito perseguible es la llegada a cliente, anclada a la cita de descarga', () => {
    const v = viaje({ citaDestinoEn: mx('12:00').toISOString(), citaOrigenEn: mx('07:00').toISOString() });
    expect(plan(ciclo('importacion'), sembrados(), v, mx('09:00'))).toMatchObject({ tipo: 'nada', motivo: 'no_toca' });
    const a = plan(ciclo('importacion'), sembrados(), v, mx('11:40'));
    expect(a).toMatchObject({ tipo: 'chofer', clase: 'solicitud' });
    if (a.tipo === 'chofer') expect(a.hito.tipo).toBe('llegada_descarga');
    // sin ciclo, el mismo viaje a las 09:00 ya estaría pidiendo la carga
    const sin = plan(undefined, sembrados(), v, mx('09:00'));
    expect(sin.tipo === 'chofer' && sin.hito.tipo).toBe('llegada_carga');
  });

  it('exportación: tras la salida de carga el viaje está completo (no se persigue una descarga que el servicio no tiene)', () => {
    const hs = sembrados({ llegada_carga: registrado(mx('08:00').toISOString()), salida_carga: registrado(mx('10:00').toISOString()) });
    const v = viaje({ citaOrigenEn: mx('08:00').toISOString(), citaDestinoEn: mx('12:00').toISOString() });
    expect(plan(ciclo('exportacion'), hs, v, mx('15:00'))).toEqual({ tipo: 'nada', motivo: 'completo' });
    const sin = plan(undefined, hs, v, mx('15:00'));
    expect(sin.tipo === 'chofer' && sin.hito.tipo).toBe('llegada_descarga');
  });

  it('nacional decide igual que sin ciclo', () => {
    const v = viaje({ citaOrigenEn: mx('08:00').toISOString(), citaDestinoEn: mx('12:00').toISOString() });
    for (const ahora of [mx('07:40'), mx('09:00'), mx('11:45')]) {
      expect(plan(ciclo('nacional'), sembrados(), v, ahora)).toEqual(plan(undefined, sembrados(), v, ahora));
    }
  });
});

// ── e2e del cron: tres servicios con reloj simulado (hora de México) ─────────
const TEL = '5219990000001';
function mundo(servicio: Servicio | undefined, conCiclos = true) {
  const w = crearMundo({
    viajes: [viajeBase({
      id: 'v1', aceptadoEn: mx('05:00').toISOString(), operadorTelefono: TEL, unidadId: 'u1',
      citaOrigenEn: mx('08:00').toISOString(), citaDestinoEn: mx('14:00').toISOString(), ...(servicio ? { servicio } : {}),
    })],
    configs: { t1: { diasSemana: [1, 2, 3, 4, 5, 6, 7], solicitudesMin: [0, 15, 30, 45] } },
    enviar: (telefono, m, contexto, tenantId, ahora) => enviarConFallback(telefono, { texto: m.texto, botones: m.botones, plantilla: m.plantilla, contexto, tenantId, ahora }),
  });
  const puertos = conCiclos ? { ...w.puertos, ciclosDe: async () => FILAS } : w.puertos;
  const cron = (cuando: Date) => { meta.entrante(TEL, cuando); meta.estado.reloj = cuando; return correrConductor(puertos, { ahora: cuando }); };
  /** El chofer dice algo a secas; la máquina decide con el ciclo del servicio y se aplica el registro. */
  const dice = (clase: 'llegada' | 'salida', cuando: Date) => {
    const hs = w.m.de('v1');
    const d = decidir({ ...entrada(conCiclos && servicio ? ciclo(servicio) : undefined, clase, hs, cuando), ahora: cuando, mensajeEn: cuando });
    if (d.accion === 'registrar') {
      const h = hs.find((x) => x.tipo === d.objetivo)!;
      w.m.hitos.set(h.id, { ...h, ...registrado(cuando.toISOString()) });
    }
    return d;
  };
  const botonesUltimos = () => meta.salientes.at(-1)?.botones ?? [];
  return { w, cron, dice, botonesUltimos };
}

beforeEach(() => { meta.reiniciar(); meta.estado.reloj = mx('05:00'); });

describe('e2e: el cron y la máquina siguen el ciclo de cada servicio', () => {
  it('importación: pide la llegada a cliente (nunca la carga), cierra en la salida de descarga y no persigue el regreso', async () => {
    const { w, cron, dice, botonesUltimos } = mundo('importacion');
    // 08:00 mx: la cita de CARGA ya pasó y no pidió nada (la importación no tiene carga).
    expect(await cron(mx('08:10'))).toMatchObject({ solicitudes: 0 });
    // 13:35: toca la llegada a cliente (30 min antes de la cita de descarga, 14:00).
    const r = await cron(mx('13:35'));
    expect(r.solicitudes).toBeGreaterThan(0);
    expect(botonesUltimos()).toEqual(['hito_llegada_descarga:v1', 'hito_retraso_descarga:v1', 'pedir_ubicacion:v1'].filter((b) => botonesUltimos().includes(b)));
    expect(botonesUltimos().some((b) => b.startsWith('hito_llegada_descarga:'))).toBe(true);
    expect(botonesUltimos().some((b) => b.startsWith('hito_llegada_carga:'))).toBe(false);

    expect(dice('llegada', mx('13:50'))).toMatchObject({ accion: 'registrar', objetivo: 'llegada_descarga', ambigua: false });
    expect(dice('salida', mx('16:00'))).toMatchObject({ accion: 'registrar', objetivo: 'salida_descarga' });
    // Con los hitos del servicio cumplidos, el cron ya no pide nada: ni la carga ni el regreso.
    const despues = await cron(mx('20:00'));
    expect(despues.solicitudes + despues.recordatorios).toBe(0);
    expect(despues.saltados.completo).toBeGreaterThan(0);
    expect(w.m.de('v1').find((h) => h.tipo === 'regreso')!.estado).toBe('esperado'); // la base no se toca: es lectura
  });

  it('exportación: pide la carga, «ya llegué»/«ya salí» caen en la carga y el viaje queda completo sin descarga', async () => {
    const { cron, dice, botonesUltimos } = mundo('exportacion');
    const r = await cron(mx('07:35'));
    expect(r.solicitudes).toBeGreaterThan(0);
    expect(botonesUltimos().some((b) => b.startsWith('hito_llegada_carga:'))).toBe(true);

    expect(dice('llegada', mx('07:50'))).toMatchObject({ accion: 'registrar', objetivo: 'llegada_carga', ambigua: false });
    expect(dice('llegada', mx('08:05'))).toMatchObject({ accion: 'duplicado', objetivo: 'llegada_carga' });
    expect(dice('salida', mx('10:00'))).toMatchObject({ accion: 'registrar', objetivo: 'salida_carga' });
    const despues = await cron(mx('13:35')); // la cita «de destino» no existe para este servicio
    expect(despues.solicitudes + despues.recordatorios).toBe(0);
    expect(despues.saltados.completo).toBeGreaterThan(0);
  });

  it('nacional (y viaje sin servicio, o flota sin ciclos): los cinco hitos de siempre', async () => {
    for (const [servicio, conCiclos] of [['nacional', true], [undefined, true], ['importacion', false]] as const) {
      meta.reiniciar();
      const { cron, dice, botonesUltimos } = mundo(servicio, conCiclos);
      expect((await cron(mx('07:35'))).solicitudes).toBeGreaterThan(0);
      expect(botonesUltimos().some((b) => b.startsWith('hito_llegada_carga:'))).toBe(true);
      expect(dice('llegada', mx('07:50'))).toMatchObject({ accion: 'registrar', objetivo: 'llegada_carga' });
      expect(dice('salida', mx('10:00'))).toMatchObject({ accion: 'registrar', objetivo: 'salida_carga' });
      const r = await cron(mx('13:35'));
      expect(r.solicitudes).toBeGreaterThan(0);
      expect(botonesUltimos().some((b) => b.startsWith('hito_llegada_descarga:'))).toBe(true);
    }
  });

  it('una flota cuyo ciclo no se puede leer se salta esta pasada (no persigue a ciegas)', async () => {
    const { w } = mundo('importacion');
    const r = await correrConductor({ ...w.puertos, ciclosDe: async () => { throw new Error('base caída'); } }, { ahora: mx('13:35') });
    expect(r).toMatchObject({ solicitudes: 0, configIlegible: 1 });
  });
});
