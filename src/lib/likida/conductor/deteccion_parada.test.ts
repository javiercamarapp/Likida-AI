import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const {
  armarAvisoDetencion, armarPreguntaDetencion, decidirDetencion, estadoDetencionDeEventos, hitoAncla, leerBotonDetencion, salidaMotivos,
} = await import('./deteccion_parada');
const { atenderConductor } = await import('./atender');
const { correrDeteccionParada, NIVEL_PREGUNTA_DETENCION, CICLO_BASE_CLAIM_DETENCION } = await import('./deteccion_parada');
const { crearMundo } = await import('./mundo.fixture');
const { viajeBase, hitoVacio } = await import('./memoria.fixture');
const { validarConfigConductor, CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
const { MOTIVOS_PARADA } = await import('./paradas');
type EventoDetencionFila = import('./repo').EventoDetencionFila;
type ParadaFila = import('./paradas').ParadaFila;
type MuestraGps = import('./ciclo_gps').MuestraGps;
type PuertosDetencion = import('./deteccion_parada').PuertosDetencion;
type EntradaDecidirDetencion = import('./deteccion_parada').EntradaDecidirDetencion;

// T-A5-39 — todo sintético: coordenadas inventadas, teléfonos de relleno (28999…), sin nombres ni datos del cliente.
const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const T0 = new Date('2026-10-02T18:00:00.000Z'); // 12:00 en México (viernes), dentro de la ventana horaria de la flota
const hace = (m: number) => new Date(T0.getTime() - m * 60_000);
const LAT = 20.7;
const LNG = -103.4;
const grados = (m: number): number => m / 111_195;
const SUPERVISOR = '2899900000009';
const base = { tenantId: 't1', operadorId: 'o1', telefono: '2899900000001', viajeAbiertoId: V1 };

/** Muestras cada 5 min de hace `desde` a ahora (relativas a `ref`), todas en el mismo punto (o desplazadas `deriva` m por muestra). */
const quieta = (ref: Date, desde = 40, deriva = 0): MuestraGps[] => {
  const salida: MuestraGps[] = [];
  for (let i = 0, t = desde; t >= 0; i += 1, t -= 5) salida.push({ lat: LAT + grados(i * deriva), lng: LNG, medidaEn: new Date(ref.getTime() - t * 60_000) });
  return salida;
};

interface Envio { telefono: string; texto: string; plantilla: string; botones: string[]; contexto: string }

function mundo(opts: { config?: Record<string, unknown>; guardaFalla?: boolean; sinTelefono?: boolean } = {}) {
  const enviados: Envio[] = [];
  const w = crearMundo({
    viajes: [viajeBase({ id: V1, unidadId: 'u1', operadorTelefono: opts.sinTelefono ? null : '2899900000001' })],
    configs: { t1: { deteccionParadaActiva: true, ...opts.config } as never },
    destinatarios: { t1: { 1: [SUPERVISOR] } },
    enviar: async (telefono, m, contexto) => {
      enviados.push({ telefono, texto: m.texto, plantilla: m.plantilla.nombre, botones: m.botones.map((b) => b.id), contexto });
      return { ok: true, via: 'botones', id: 'wamid.X', motivo: 'ventana_abierta', ventana: 'abierta' };
    },
  });
  w.m.sembrar(V1);
  w.m.registrar(V1, 'llegada_carga', hace(700).toISOString());
  w.m.registrar(V1, 'salida_carga', hace(600).toISOString()); // en tránsito: salió de la carga y no llega a la descarga

  // El GPS lo gobierna la prueba: `gps.muestras` es lo que lee el cron en cada pasada.
  const gps: { muestras: MuestraGps[]; destino: { id: string; nombre: string; lat: number; lng: number; radioM: number; poligono: null } | null } = { muestras: [], destino: null };
  const bitacora: EventoDetencionFila[] = [];
  const paradas: ParadaFila[] = [];
  let reloj = T0;
  let n = 0;
  const puertosBitacora = {
    eventosDetencion: async (_t: string, ids: string[]) => bitacora.filter((e) => ids.includes(e.viajeId)).map((e) => ({ ...e })),
    guardarEventoDetencion: async (h: { id: string; viajeId: string }, detalle: Record<string, string | number | boolean | null>) => {
      if (opts.guardaFalla) return false;
      bitacora.push({ id: ++n, viajeId: h.viajeId, hitoId: h.id, detalle: { clase: 'deteccion_parada', ...detalle }, creadoEn: reloj.toISOString() });
      return true;
    },
  };
  // La parada del chofer (T-A5-38) en memoria: una abierta por viaje, como el índice único de la 0806.
  w.m.deps.parada = {
    leerAbierta: async (_t, viajeId) => paradas.find((p) => p.viajeId === viajeId && p.fin === null) ?? null,
    abrir: async (tenantId, viajeId, motivo, ahora) => {
      if (paradas.some((p) => p.viajeId === viajeId && p.fin === null)) return 'duplicada';
      paradas.push({ id: `p${paradas.length + 1}`, tenantId, viajeId, inicio: ahora.toISOString(), fin: null, motivo, origen: 'chofer' });
      return 'ok';
    },
    cerrar: async (_t, viajeId, fin, origen) => {
      const p = paradas.find((x) => x.viajeId === viajeId && x.fin === null);
      if (!p) return 'sin_parada';
      Object.assign(p, { fin: fin.toISOString(), origen });
      return 'cerrada';
    },
  };
  w.m.deps.detencion = { ...puertosBitacora, destinatarios: w.puertos.destinatarios, enviar: w.puertos.enviar };
  const cron: PuertosDetencion = {
    ...w.puertos, ...puertosBitacora,
    paradasRecientes: async (_t, ids, desde) => paradas.filter((p) => ids.includes(p.viajeId) && (p.fin === null || new Date(p.fin) >= desde)),
    muestrasUnidad: async (us) => new Map(us.map((u) => [`${u.tenantId}|${u.unidadId}`, gps.muestras.map((m) => ({ ...m }))])),
    sitiosDe: async (vs) => new Map(vs.map((v) => [v.id, { origen: null, destino: gps.destino }])),
  };
  const pasada = (min = 0) => { reloj = new Date(T0.getTime() + min * 60_000); return correrDeteccionParada(cron, { ahora: reloj }); };
  const chofer = (texto: string, min = 0) => { reloj = new Date(T0.getTime() + min * 60_000); return atenderConductor({ ...base, texto, ahora: reloj }, w.m.deps); };
  return { w, enviados, bitacora, paradas, gps, pasada, chofer, cron };
}
const textos = (r: Awaited<ReturnType<typeof atenderConductor>>) => (r?.mensajes ?? []).map((x) => x.texto).join('\n');

describe('decidirDetencion (pura)', () => {
  const estadoVacio = { abierto: false, preguntas: 0, preguntadoEn: null, respuesta: null, apoyoAvisado: false, escalada: false };
  const base2: EntradaDecidirDetencion = {
    activo: true, enTransito: true, paradaAbierta: false, paradaReciente: false, estado: estadoVacio,
    elegibilidad: { elegible: true, razon: 'detenida' }, compuerta: { permitido: true, razon: 'detenida' },
    dentroDeVentana: true, tieneTelefono: true, ahora: T0,
  };
  it('detenida, en tránsito y sin parada → UNA pregunta (la 1)', () => {
    expect(decidirDetencion(base2)).toEqual({ accion: 'preguntar', ordinal: 1 });
  });
  it('cada guarda detiene la pregunta', () => {
    expect(decidirDetencion({ ...base2, activo: false })).toEqual({ accion: 'nada', razon: 'flota_apagada' });
    expect(decidirDetencion({ ...base2, enTransito: false })).toEqual({ accion: 'nada', razon: 'no_transito' });
    expect(decidirDetencion({ ...base2, paradaAbierta: true })).toEqual({ accion: 'nada', razon: 'parada_abierta' });
    expect(decidirDetencion({ ...base2, paradaReciente: true })).toEqual({ accion: 'nada', razon: 'parada_reciente' });
    expect(decidirDetencion({ ...base2, elegibilidad: { elegible: false, razon: 'lapso_corto' } })).toEqual({ accion: 'nada', razon: 'no_elegible' });
    expect(decidirDetencion({ ...base2, dentroDeVentana: false })).toEqual({ accion: 'nada', razon: 'fuera_de_ventana' });
    expect(decidirDetencion({ ...base2, tieneTelefono: false })).toEqual({ accion: 'nada', razon: 'sin_telefono' });
    expect(decidirDetencion({ ...base2, compuerta: { permitido: false, razon: 'en_movimiento' } })).toEqual({ accion: 'nada', razon: 'compuerta_movimiento' });
  });
  it('episodio abierto: no repite, aunque haya contestado o no', () => {
    const abierto = { ...estadoVacio, abierto: true, preguntas: 1, preguntadoEn: hace(10).toISOString() };
    expect(decidirDetencion({ ...base2, estado: abierto })).toEqual({ accion: 'nada', razon: 'episodio_abierto' });
    expect(decidirDetencion({ ...base2, estado: { ...abierto, respuesta: 'ok' } })).toEqual({ accion: 'nada', razon: 'episodio_abierto' });
  });
  it('el episodio se cierra al verse movimiento, dentro de un sitio o al dejar el tránsito; sin GPS no se cierra', () => {
    const abierto = { ...estadoVacio, abierto: true, preguntas: 1, preguntadoEn: hace(10).toISOString() };
    for (const razon of ['en_movimiento', 'conduciendo', 'dentro_del_sitio'] as const) {
      expect(decidirDetencion({ ...base2, estado: abierto, elegibilidad: { elegible: false, razon } })).toEqual({ accion: 'cerrar', motivo: 'movimiento' });
    }
    expect(decidirDetencion({ ...base2, estado: abierto, enTransito: false })).toEqual({ accion: 'cerrar', motivo: 'viaje' });
    expect(decidirDetencion({ ...base2, estado: abierto, elegibilidad: { elegible: false, razon: 'sin_gps' } })).toEqual({ accion: 'nada', razon: 'no_elegible' });
  });
  it('un episodio nuevo tras uno cerrado lleva el ordinal siguiente', () => {
    expect(decidirDetencion({ ...base2, estado: { ...estadoVacio, preguntas: 2 } })).toEqual({ accion: 'preguntar', ordinal: 3 });
  });
  it('sin respuesta NO escala (apagada); con la opción, solo tras los minutos, una vez y dentro de la ventana', () => {
    const abierto = { ...estadoVacio, abierto: true, preguntas: 1, preguntadoEn: hace(31).toISOString() };
    expect(decidirDetencion({ ...base2, estado: abierto })).toEqual({ accion: 'nada', razon: 'episodio_abierto' });
    expect(decidirDetencion({ ...base2, estado: abierto, escalaSinRespuestaMin: 30 })).toEqual({ accion: 'escalar' });
    expect(decidirDetencion({ ...base2, estado: abierto, escalaSinRespuestaMin: 45 })).toEqual({ accion: 'nada', razon: 'episodio_abierto' });
    expect(decidirDetencion({ ...base2, estado: { ...abierto, escalada: true }, escalaSinRespuestaMin: 30 })).toEqual({ accion: 'nada', razon: 'episodio_abierto' });
    expect(decidirDetencion({ ...base2, estado: { ...abierto, respuesta: 'ok' }, escalaSinRespuestaMin: 30 })).toEqual({ accion: 'nada', razon: 'episodio_abierto' });
    expect(decidirDetencion({ ...base2, estado: abierto, escalaSinRespuestaMin: 30, dentroDeVentana: false })).toEqual({ accion: 'nada', razon: 'episodio_abierto' });
  });
});

describe('botones y mensajes de N05', () => {
  it('lee los tres botones y las páginas de motivos, con el uuid validado y anclado', () => {
    expect(leerBotonDetencion(`parada_ok:${V1}`)).toEqual({ accion: 'opcion', opcion: 'ok', viajeId: V1 });
    expect(leerBotonDetencion(`parada_motivo:${V1}`)).toEqual({ accion: 'opcion', opcion: 'motivo', viajeId: V1 });
    expect(leerBotonDetencion(`parada_apoyo:${V1}`)).toEqual({ accion: 'opcion', opcion: 'apoyo', viajeId: V1 });
    expect(leerBotonDetencion(`parada_mas1:${V1}`)).toEqual({ accion: 'pagina', pagina: 1, viajeId: V1 });
    expect(leerBotonDetencion(`parada_mas2:${V1}`)).toEqual({ accion: 'pagina', pagina: 2, viajeId: V1 });
    expect(leerBotonDetencion('parada_ok:no-es-uuid')).toBeNull();
    expect(leerBotonDetencion(`parada_ok:${V1}:x`)).toBeNull();
    expect(leerBotonDetencion(`parada_mas3:${V1}`)).toBeNull();
    expect(leerBotonDetencion(`parada_motivo_trafico:${V1}`)).toBeNull(); // ese es del motivo de T-A5-38, no de N05
    expect(leerBotonDetencion(undefined)).toBeNull();
  });

  it('la pregunta lleva los payloads de la plantilla N05 y NO pide clave de amago, evidencias ni foto', () => {
    const m = armarPreguntaDetencion(viajeBase({ id: V1 }), 15);
    expect(m.botones.map((b) => b.id)).toEqual([`parada_ok:${V1}`, `parada_motivo:${V1}`, `parada_apoyo:${V1}`]);
    expect(m.botones.map((b) => b.titulo)).toEqual(['Todo bien', 'Registrar motivo', 'Necesito apoyo']);
    expect(m.plantilla.nombre).toBe('conductor_detencion_sin_aviso_v1');
    expect(m.plantilla.parametros).toEqual(['Juan', 'F-1042', '15']);
    expect(m.texto).toMatch(/lleva 15 minutos detenida/);
    expect(m.texto).not.toMatch(/clave|amago|evidencia|foto|p[aá]nico/i);
  });

  it('la lista de motivos sale en tres páginas de ≤ 3 botones y cubre los seis motivos con los ids de T-A5-38', () => {
    const paginas = [0, 1, 2].map((p) => salidaMotivos(V1, p as 0 | 1 | 2));
    for (const p of paginas) expect(p.botones!.length).toBeLessThanOrEqual(3);
    const motivos = paginas.flatMap((p) => p.botones!.map((b) => b.id)).filter((id) => id.startsWith('parada_motivo_')).map((id) => id.split(':')[0].replace('parada_motivo_', ''));
    expect(motivos.sort()).toEqual([...MOTIVOS_PARADA].sort());
    expect(paginas[0].botones!.at(-1)!.id).toBe(`parada_mas1:${V1}`);
    expect(paginas[2].botones!.some((b) => b.id.startsWith('parada_mas'))).toBe(false);
  });

  it('el aviso al supervisor lleva la plantilla genérica de operación y el folio', () => {
    const a = armarAvisoDetencion(viajeBase({ id: V1 }), 'apoyo', 15, T0);
    expect(a.texto).toMatch(/Apoyo solicitado/);
    expect(a.plantilla.nombre).toBe('aviso_operacion_v1');
    expect(armarAvisoDetencion(viajeBase({ id: V1 }), 'sin_respuesta', 45, T0).texto).toMatch(/no contestó/);
  });

  it('hitoAncla prefiere la salida de carga y cae al primero; sin hitos, null', () => {
    const hs = [hitoVacio({ id: 'a', tipo: 'llegada_carga', viajeId: 'v1' }), hitoVacio({ id: 'b', tipo: 'salida_carga', viajeId: 'v1' })];
    expect(hitoAncla(hs)!.id).toBe('b');
    expect(hitoAncla([hs[0]])!.id).toBe('a');
    expect(hitoAncla([])).toBeNull();
  });
});

describe('estadoDetencionDeEventos', () => {
  const ev = (id: number, detalle: Record<string, unknown>, min = 0): EventoDetencionFila => ({ id, viajeId: 'v1', hitoId: 'h', detalle: { clase: 'deteccion_parada', ...detalle }, creadoEn: hace(min).toISOString() });
  it('pregunta abre, cierre cierra y una pregunta nueva reinicia respuesta, apoyo y escalada', () => {
    const e = [
      ev(1, { tipo: 'pregunta' }, 60), ev(2, { tipo: 'respuesta', opcion: 'apoyo' }, 55), ev(3, { tipo: 'apoyo', entregado: true }, 55), ev(4, { tipo: 'cierre' }, 40),
    ];
    expect(estadoDetencionDeEventos(e, 'v1')).toMatchObject({ abierto: false, preguntas: 1, respuesta: 'apoyo', apoyoAvisado: false });
    // A37-S35-04: un apoyo ENTREGADO antes del cierre no vale después; uno posterior al cierre sí vuelve a contar
    expect(estadoDetencionDeEventos([...e, ev(6, { tipo: 'apoyo', entregado: true }, 3)], 'v1').apoyoAvisado).toBe(true);
    const e2 = [...e, ev(5, { tipo: 'pregunta' }, 5)];
    expect(estadoDetencionDeEventos(e2, 'v1')).toMatchObject({ abierto: true, preguntas: 2, respuesta: null, apoyoAvisado: false, escalada: false });
  });
  it('ignora renglones de otro viaje o de otra clase, y un apoyo no entregado no cuenta', () => {
    const e = [
      ev(1, { tipo: 'pregunta' }), { ...ev(2, { tipo: 'pregunta' }), viajeId: 'v2' }, { ...ev(3, { tipo: 'pregunta' }), detalle: { clase: 'reporte_llegada', tipo: 'pregunta' } },
      ev(4, { tipo: 'apoyo', entregado: false }),
    ];
    expect(estadoDetencionDeEventos(e, 'v1')).toMatchObject({ abierto: true, preguntas: 1, apoyoAvisado: false });
  });
});

describe('config (T-A5-39)', () => {
  it('nace apagada y sin escalada; la escalada acepta 5–720 y rechaza el resto', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT.deteccionParadaActiva).toBe(false);
    expect(CONFIG_CONDUCTOR_DEFAULT.detencionEscalaSinRespuestaMin).toBeUndefined();
    const ok = validarConfigConductor({ ...CONFIG_CONDUCTOR_DEFAULT, deteccionParadaActiva: true, detencionEscalaSinRespuestaMin: 30 });
    expect('ok' in ok && ok.ok).toMatchObject({ deteccionParadaActiva: true, detencionEscalaSinRespuestaMin: 30 });
    for (const malo of [4, 721, 2.5, 'x']) {
      expect(validarConfigConductor({ ...CONFIG_CONDUCTOR_DEFAULT, detencionEscalaSinRespuestaMin: malo as never })).toHaveProperty('error');
    }
    const sin = validarConfigConductor({ ...CONFIG_CONDUCTOR_DEFAULT });
    expect('ok' in sin && sin.ok).not.toHaveProperty('detencionEscalaSinRespuestaMin');
  });
});

describe('T-A5-39 · apagado de origen', () => {
  it('con la perilla apagada el cron no pregunta, no reclama y no anota nada', async () => {
    const { w, enviados, bitacora, gps, pasada } = mundo({ config: { deteccionParadaActiva: false } });
    gps.muestras = quieta(T0);
    const r = await pasada();
    expect(enviados).toHaveLength(0);
    expect(r.preguntas).toBe(0);
    expect(w.reclamos.size).toBe(0);
    expect(bitacora).toHaveLength(0);
  });

  it('con la perilla apagada un botón viejo contesta «ya no está vigente» y NO guarda ni avisa a nadie', async () => {
    const { enviados, bitacora, paradas, chofer } = mundo({ config: { deteccionParadaActiva: false } });
    for (const b of ['parada_ok', 'parada_motivo', 'parada_apoyo', 'parada_mas1', 'parada_abrir', 'parada_motivo_trafico']) {
      expect(textos(await chofer(`${b}:${V1}`))).toMatch(/ya no está vigente/);
    }
    expect(bitacora).toHaveLength(0);
    expect(paradas).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it('con la perilla apagada «parada por tráfico» sigue su camino de siempre (no lo atiende este módulo)', async () => {
    const { paradas, chofer } = mundo({ config: { deteccionParadaActiva: false } });
    await chofer('parada por tráfico');
    expect(paradas).toHaveLength(0);
  });
});

describe('T-A5-39 · un episodio = una pregunta', () => {
  it('detenida ≥ umbral → UNA pregunta con la plantilla N05; las pasadas siguientes no repiten, ni con «Todo bien»', async () => {
    const { w, enviados, bitacora, gps, pasada, chofer, paradas } = mundo();
    gps.muestras = quieta(T0, 40);
    await pasada();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ telefono: '2899900000001', plantilla: 'conductor_detencion_sin_aviso_v1', contexto: 'conductor.deteccion_parada' });
    expect(enviados[0].botones).toEqual([`parada_ok:${V1}`, `parada_motivo:${V1}`, `parada_apoyo:${V1}`]);
    // el claim vive en el hito de la salida de carga, con el ciclo del episodio (100 + 1)
    const claim = [...w.reclamos.keys()].find((k) => k.endsWith(`|${CICLO_BASE_CLAIM_DETENCION + 1}|escalacion|${NIVEL_PREGUNTA_DETENCION}`));
    expect(claim).toBeDefined();

    await pasada(5);
    await pasada(10);
    expect(enviados).toHaveLength(1);

    // «Todo bien»: se anota, NO crea parada y sigue sin repreguntar dentro del episodio.
    expect(textos(await chofer(`parada_ok:${V1}`, 11))).toMatch(/gracias por avisar/i);
    expect(paradas).toHaveLength(0);
    await pasada(60);
    expect(enviados).toHaveLength(1);
    expect(bitacora.map((e) => e.detalle.tipo)).toEqual(['pregunta', 'respuesta']);
    expect(bitacora[1].detalle).toMatchObject({ opcion: 'ok' });
  });

  it('dos pasadas simultáneas del cron mandan UNA sola pregunta (el claim lo gana una)', async () => {
    const { enviados, gps, cron } = mundo();
    gps.muestras = quieta(T0, 40);
    const dos = await Promise.all([correrDeteccionParada(cron, { ahora: T0 }), correrDeteccionParada(cron, { ahora: T0 })]);
    expect(enviados).toHaveLength(1);
    expect(dos.reduce((s, r) => s + r.preguntas, 0)).toBe(1);
  });

  it('cuando la unidad se mueve el episodio se cierra y una nueva detención es OTRA pregunta (ordinal 2)', async () => {
    const { w, enviados, bitacora, gps, pasada } = mundo();
    gps.muestras = quieta(T0, 40);
    await pasada();
    expect(enviados).toHaveLength(1);

    // 90 min después: la unidad rodó (muestras dispersas) → cierra el episodio.
    gps.muestras = quieta(new Date(T0.getTime() + 90 * 60_000), 40, 400);
    const mov = await pasada(90);
    expect(mov.cerrados).toBe(1);
    expect(mov.preguntas).toBe(0);
    expect(bitacora.at(-1)!.detalle).toMatchObject({ tipo: 'cierre', motivo: 'movimiento' });

    // Se vuelve a detener 3 h después: episodio nuevo, pregunta nueva.
    gps.muestras = quieta(new Date(T0.getTime() + 180 * 60_000), 40);
    await pasada(180);
    expect(enviados).toHaveLength(2);
    expect([...w.reclamos.keys()].some((k) => k.includes(`|${CICLO_BASE_CLAIM_DETENCION + 2}|escalacion|`))).toBe(true);
  });

  it('antes de cumplir el umbral no pregunta; al cumplirlo, sí', async () => {
    const { enviados, gps, pasada } = mundo({ config: { detenidoAvisoMin: 60 } });
    gps.muestras = quieta(T0, 40);
    await pasada();
    expect(enviados).toHaveLength(0);
    gps.muestras = quieta(new Date(T0.getTime() + 60 * 60_000), 100);
    await pasada(60);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toMatch(/lleva 60 minutos/);
  });
});

describe('T-A5-39 · nunca en movimiento ni en un sitio del viaje, y siempre dentro de la ventana', () => {
  it('unidad en movimiento → nunca pregunta (ni reclama)', async () => {
    const { w, enviados, gps, pasada } = mundo();
    gps.muestras = quieta(T0, 40, 400);
    const r = await pasada();
    expect(enviados).toHaveLength(0);
    expect(r.preguntas).toBe(0);
    expect(w.reclamos.size).toBe(0);
  });

  it('unidad dentro de un sitio del viaje → no pregunta', async () => {
    const { enviados, gps, pasada } = mundo();
    gps.muestras = quieta(T0, 40);
    gps.destino = { id: 's1', nombre: 'Sitio de prueba', lat: LAT, lng: LNG, radioM: 300, poligono: null };
    await pasada();
    expect(enviados).toHaveLength(0);
  });

  it('sin GPS (sin muestras) o con muestras demasiado viejas → no pregunta: falla cerrado', async () => {
    const { enviados, gps, pasada } = mundo();
    gps.muestras = [];
    await pasada();
    gps.muestras = quieta(new Date(T0.getTime() - 600 * 60_000), 40);
    await pasada();
    expect(enviados).toHaveLength(0);
  });

  it('fuera de la ventana horaria de la flota no pregunta; al abrir, sí (no se pierde)', async () => {
    const { enviados, gps, cron } = mundo();
    const noche = new Date('2026-10-03T07:00:00.000Z'); // 01:00 en México
    gps.muestras = quieta(noche, 40);
    const r = await correrDeteccionParada(cron, { ahora: noche });
    expect(enviados).toHaveLength(0);
    expect(r.fueraDeVentana).toBe(1);
    const dia = new Date('2026-10-03T16:00:00.000Z'); // 10:00 en México
    gps.muestras = quieta(dia, 40);
    await correrDeteccionParada(cron, { ahora: dia });
    expect(enviados).toHaveLength(1);
  });

  it('la compuerta de unidad detenida (T-A5-36) encendida y la unidad con ignición encendida → no pregunta', async () => {
    const { enviados, gps, pasada } = mundo({ config: { compuertaMovimientoActiva: true, poleoMin: 5 } }); // cadencia declarada: con muestras cada 5 min la compuerta pide dos en vez de tres
    gps.muestras = quieta(T0, 40).map((m) => ({ ...m, ignicion: true }));
    await pasada();
    expect(enviados).toHaveLength(0);
    gps.muestras = quieta(T0, 40).map((m) => ({ ...m, ignicion: false }));
    await pasada();
    expect(enviados).toHaveLength(1);
  });

  it('una parada abierta (incl. pernocta) o recién cerrada por el chofer no dispara la pregunta', async () => {
    const m1 = mundo();
    m1.gps.muestras = quieta(T0, 40);
    await m1.chofer('parada_motivo_pernocta:' + V1, -1);
    expect(m1.paradas).toHaveLength(1);
    await m1.pasada();
    expect(m1.enviados).toHaveLength(0);
    // «ya continúo»: recién cerrada, el GPS aún lo ve quieto → tampoco pregunta
    await m1.chofer('ya continúo', 1);
    await m1.pasada(2);
    expect(m1.enviados).toHaveLength(0);
  });

  it('el viaje fuera de tránsito (aún no sale de la carga) no pregunta', async () => {
    const { w, enviados, gps, pasada } = mundo();
    for (const h of w.m.de(V1)) if (h.tipo === 'salida_carga') w.m.hitos.set(h.id, { ...h, estado: 'esperado', recibidoEn: null, mensajeEn: null });
    gps.muestras = quieta(T0, 40);
    await pasada();
    expect(enviados).toHaveLength(0);
  });

  it('sin teléfono no reclama ni anota nada; sin bitácora legible o con guardado fallido, no manda', async () => {
    const a = mundo({ sinTelefono: true });
    a.gps.muestras = quieta(T0, 40);
    const r = await a.pasada();
    expect(r.sinTelefono).toBe(1);
    expect(a.w.reclamos.size).toBe(0);
    expect(a.bitacora).toHaveLength(0);

    const b = mundo({ guardaFalla: true });
    b.gps.muestras = quieta(T0, 40);
    const rb = await b.pasada();
    expect(b.enviados).toHaveLength(0);
    expect(rb.fallos.join(' ')).toMatch(/no se pudo anotar la pregunta/);
    expect(b.w.reclamos.size).toBe(0); // el claim se soltó: la pasada siguiente reintenta entera

    const c = mundo();
    c.gps.muestras = quieta(T0, 40);
    c.cron.eventosDetencion = async () => { throw new Error('base caída'); };
    const rc = await correrDeteccionParada(c.cron, { ahora: T0 });
    expect(c.enviados).toHaveLength(0);
    expect(rc.fallos.join(' ')).toMatch(/no se pudo leer la bitácora/);
  });
});

describe('T-A5-39 · las respuestas del chofer', () => {
  it('«Registrar motivo» abre la lista en páginas y el motivo elegido CREA la parada; «ya continúo» la cierra', async () => {
    const { enviados, gps, paradas, bitacora, pasada, chofer } = mundo();
    gps.muestras = quieta(T0, 40);
    await pasada();
    const lista = await chofer(`parada_motivo:${V1}`, 1);
    expect(lista!.mensajes[0].botones!.map((b) => b.titulo)).toEqual(['Tráfico', 'Descanso', 'Más opciones']);
    expect(paradas).toHaveLength(0); // elegir «Registrar motivo» todavía no crea nada

    const mas = await chofer(`parada_mas1:${V1}`, 2);
    expect(mas!.mensajes[0].botones!.map((b) => b.titulo)).toEqual(['Pernocta', 'Retén', 'Más opciones']);

    const abierta = await chofer(`parada_motivo_trafico:${V1}`, 3);
    expect(textos(abierta)).toMatch(/anoté tu parada \(tráfico\)/);
    expect(abierta!.mensajes[0].botones![0].titulo).toBe('Ya continúo');
    expect(paradas).toHaveLength(1);
    expect(paradas[0]).toMatchObject({ viajeId: V1, motivo: 'trafico', fin: null, origen: 'chofer' });

    // con la parada abierta no hay otra pregunta ni duplicado
    await pasada(10);
    expect(enviados).toHaveLength(1);
    await chofer(`parada_motivo_trafico:${V1}`, 11);
    expect(paradas).toHaveLength(1);

    expect(textos(await chofer(`parada_continuo:${V1}`, 20))).toMatch(/ya sigues en camino/);
    expect(paradas[0].fin).not.toBeNull();
    expect(bitacora.filter((e) => e.detalle.tipo === 'respuesta').map((e) => e.detalle.opcion)).toEqual(['motivo']);
  });

  it('el chofer también puede iniciar la parada con texto: «parada por descanso» crea la parada con ese motivo', async () => {
    const { paradas, chofer } = mundo();
    expect(textos(await chofer('parada por descanso'))).toMatch(/descanso/);
    expect(paradas.map((p) => p.motivo)).toEqual(['descanso']);
    expect(textos(await chofer('parada'))).toMatch(/ya tengo tu parada/i); // idempotente: no abre otra
    expect(paradas).toHaveLength(1);
  });

  it('«Necesito apoyo» avisa al supervisor UNA vez y se lo dice al chofer; un segundo toque no repite el aviso', async () => {
    const { enviados, gps, bitacora, pasada, chofer } = mundo();
    gps.muestras = quieta(T0, 40);
    await pasada();
    const r = await chofer(`parada_apoyo:${V1}`, 1);
    expect(textos(r)).toMatch(/avisé a tu supervisor/);
    const aviso = enviados.filter((e) => e.telefono === SUPERVISOR);
    expect(aviso).toHaveLength(1);
    expect(aviso[0]).toMatchObject({ plantilla: 'aviso_operacion_v1', contexto: 'conductor.deteccion_parada_apoyo' });
    expect(aviso[0].texto).toMatch(/Apoyo solicitado/);
    expect(textos(await chofer(`parada_apoyo:${V1}`, 2))).toMatch(/ya le avisé/i);
    expect(enviados.filter((e) => e.telefono === SUPERVISOR)).toHaveLength(1);
    expect(bitacora.map((e) => `${e.detalle.tipo}:${e.detalle.opcion ?? e.detalle.entregado}`)).toEqual(['pregunta:undefined', 'respuesta:apoyo', 'apoyo:true']);
  });

  it('A37-S35-04: tras cerrarse el episodio, un botón viejo de «Necesito apoyo» vuelve a avisar al supervisor', async () => {
    const { enviados, gps, pasada, chofer, bitacora } = mundo();
    gps.muestras = quieta(T0, 40);
    await pasada();
    await chofer(`parada_apoyo:${V1}`, 1);
    expect(enviados.filter((e) => e.telefono === SUPERVISOR)).toHaveLength(1);
    bitacora.push({ id: 99, viajeId: V1, hitoId: bitacora[0].hitoId, detalle: { clase: 'deteccion_parada', tipo: 'cierre' }, creadoEn: T0.toISOString() });
    expect(textos(await chofer(`parada_apoyo:${V1}`, 3))).toMatch(/avisé a tu supervisor/);
    expect(enviados.filter((e) => e.telefono === SUPERVISOR)).toHaveLength(2);
  });

  it('«Necesito apoyo» sin destinatario configurado se lo dice al chofer con honestidad y permite reintentar', async () => {
    const enviados: string[] = [];
    const w = crearMundo({
      viajes: [viajeBase({ id: V1, unidadId: 'u1' })], configs: { t1: { deteccionParadaActiva: true } as never },
      enviar: async (t) => { enviados.push(t); return { ok: true, via: 'botones', id: 'x', motivo: 'ventana_abierta', ventana: 'abierta' }; },
    });
    w.m.sembrar(V1);
    const bit: EventoDetencionFila[] = [];
    w.m.deps.detencion = {
      destinatarios: w.puertos.destinatarios, enviar: w.puertos.enviar,
      eventosDetencion: async () => bit.map((e) => ({ ...e })),
      guardarEventoDetencion: async (h, d) => { bit.push({ id: bit.length + 1, viajeId: h.viajeId, hitoId: h.id, detalle: { clase: 'deteccion_parada', ...d }, creadoEn: T0.toISOString() }); return true; },
    };
    const r = await atenderConductor({ ...base, texto: `parada_apoyo:${V1}`, ahora: T0 }, w.m.deps);
    expect(textos(r)).toMatch(/No pude avisarle a tu supervisor/);
    expect(enviados).toHaveLength(0);
    expect(estadoDetencionDeEventos(bit, V1).apoyoAvisado).toBe(false);
  });

  it('un botón de otro chofer o de un viaje inexistente nunca toca datos ajenos', async () => {
    const { bitacora, paradas, enviados, chofer } = mundo();
    const OTRO = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d999';
    expect(textos(await chofer(`parada_apoyo:${OTRO}`))).toMatch(/otro viaje|ya no está vigente/);
    expect(textos(await chofer(`parada_motivo_trafico:${OTRO}`))).toMatch(/otro viaje|ya no está vigente/);
    expect(bitacora).toHaveLength(0);
    expect(paradas).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it('un «Todo bien» o «Registrar motivo» de un episodio que ya cerró dice «ya no está vigente» y no guarda', async () => {
    const { bitacora, chofer } = mundo();
    expect(textos(await chofer(`parada_ok:${V1}`))).toMatch(/ya no está vigente/);
    expect(textos(await chofer(`parada_motivo:${V1}`))).toMatch(/ya no está vigente/);
    expect(bitacora).toHaveLength(0);
  });

  it('las palabras de seguridad no se guardan: la guardia de T-A5-58 sigue mandando', async () => {
    const { bitacora, paradas, chofer } = mundo();
    const r = await chofer('parada, mi clave de amago es 1234');
    expect(textos(r)).toBeTruthy();
    expect(bitacora).toHaveLength(0);
    expect(paradas).toHaveLength(0);
  });
});

describe('T-A5-39 · sin respuesta no escala por sí sola (opción de configuración)', () => {
  it('por omisión (apagada) pasan horas sin respuesta y el supervisor no recibe nada', async () => {
    const { enviados, gps, pasada } = mundo();
    gps.muestras = quieta(T0, 40);
    await pasada();
    gps.muestras = quieta(new Date(T0.getTime() + 240 * 60_000), 40);
    await pasada(240);
    expect(enviados.filter((e) => e.telefono === SUPERVISOR)).toHaveLength(0);
    expect(enviados).toHaveLength(1);
  });

  it('con la opción encendida avisa al supervisor UNA vez pasados los minutos, y no si el chofer contestó', async () => {
    const a = mundo({ config: { detencionEscalaSinRespuestaMin: 30 } });
    a.gps.muestras = quieta(T0, 40);
    await a.pasada();
    a.gps.muestras = quieta(new Date(T0.getTime() + 20 * 60_000), 40);
    await a.pasada(20); // aún no se cumplen los 30 min
    expect(a.enviados.filter((e) => e.telefono === SUPERVISOR)).toHaveLength(0);
    a.gps.muestras = quieta(new Date(T0.getTime() + 35 * 60_000), 40);
    const r = await a.pasada(35);
    expect(r.escaladas).toBe(1);
    expect(a.enviados.filter((e) => e.telefono === SUPERVISOR)).toHaveLength(1);
    expect(a.enviados.at(-1)!.texto).toMatch(/Detención sin respuesta/);
    a.gps.muestras = quieta(new Date(T0.getTime() + 70 * 60_000), 40);
    await a.pasada(70);
    expect(a.enviados.filter((e) => e.telefono === SUPERVISOR)).toHaveLength(1); // una vez por episodio

    const b = mundo({ config: { detencionEscalaSinRespuestaMin: 30 } });
    b.gps.muestras = quieta(T0, 40);
    await b.pasada();
    await b.chofer(`parada_ok:${V1}`, 5);
    b.gps.muestras = quieta(new Date(T0.getTime() + 60 * 60_000), 40);
    await b.pasada(60);
    expect(b.enviados.filter((e) => e.telefono === SUPERVISOR)).toHaveLength(0);
  });
});
