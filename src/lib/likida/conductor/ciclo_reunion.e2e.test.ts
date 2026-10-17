import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const { atenderConductor, hitoParaEvidenciaDelChofer, registrarHitoDesdeFoto } = await import('./atender');
const { correrConductor } = await import('./ejecutor');
const { correrDeteccionParada } = await import('./deteccion_parada');
const { correrReporteLlegada } = await import('./reporte_llegada');
const { correrAlertasEstadia } = await import('./alertas_estadia');
const { puedeEscribirAlChofer } = await import('./compuerta_movimiento');
const { decidirSelloInicio } = await import('./evidencia');
const { crearDobleSenales } = await import('./senales_conduccion');
const { cicloDelServicio, hitosDelCiclo, SEMILLA_CICLOS } = await import('./ciclo_servicio');
const { excepcionesPatio } = await import('./patio_regla');
const { regresoConCajaCargada } = await import('./resultado_descarga');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
const { crearMundo } = await import('./mundo.fixture');
const { viajeBase } = await import('./memoria.fixture');
type Servicio = import('./ciclo_servicio').Servicio;
type MuestraGps = import('./ciclo_gps').MuestraGps;
type EventoDetencionFila = import('./repo').EventoDetencionFila;
type EventoReporteFila = import('./repo').EventoReporteFila;
type EventoPatioFila = import('./repo').EventoPatioFila;
type ParadaFila = import('./paradas').ParadaFila;
type PuertosDetencion = import('./deteccion_parada').PuertosDetencion;
type PuertosReporte = import('./reporte_llegada').PuertosReporte;
type PuertosPatio = import('./patio_entrega').PuertosPatio;
type PuertosResultado = import('./resultado_descarga').PuertosResultado;
type ConfigConductor = import('./config').ConfigConductor;

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-60 — ACEPTACIÓN INTEGRADA IMPO/EXPO CON LAS REGLAS NUEVAS (R01–R22), con reloj simulado en tres zonas.
//
// Un viaje de importación y uno de exportación recorren, con el código de producción en cada eslabón y UNA sola base en memoria
// compartida por el cron y la entrada del chofer (`atenderConductor`):
//   no escribe con la unidad en movimiento (T-A5-36/37) · parada con motivo (T-A5-38) · pregunta por detención sin aviso (T-A5-39) ·
//   sello e inicio de viaje (T-A5-40) · ciclo por servicio (T-A5-41/42) · contacto y rampa (T-A5-43) · patio distinto → alerta (T-A5-44)
//   · 2 h en la descarga → supervisor (T-A5-45) · caja cargada (T-A5-46) · caso «atasco» (ajuste 16b: quieto pero conduciendo).
//
// Zonas: America/Matamoros ANTES (30-oct-2026, UTC-5) y DESPUÉS (2-nov-2026, UTC-6) del cambio de hora de EE. UU. del 1-nov,
// America/Mexico_City (UTC-6 todo el año) y America/Cancun (UTC-5 todo el año). Las mismas horas locales caen en instantes UTC distintos.
//
// 100 % sintético (SIM-0001, coordenadas inventadas, teléfonos 28999…, «Patio Alfa/Bravo/Charlie»). Sin red, sin base. Todo apagado por
// omisión: el último bloque comprueba que con los valores de fábrica ningún módulo nuevo manda ni guarda nada.
// Lección «prueba verde con medida nula no cuenta»: cada paso afirma conteos > 0 de lo que midió, y al final se suman las medidas.
// ═══════════════════════════════════════════════════════════════════════════

const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d060';
const TENANT = 't-e2e';
const TEL = { chofer: '2899900000001', supervisor: '2899900000009' };
const P_A = '11111111-1111-4111-8111-111111111111';
const P_B = '22222222-2222-4222-8222-222222222222';
const P_C = '33333333-3333-4333-8333-333333333333';
const PATIOS = [{ id: P_A, nombre: 'Patio Alfa' }, { id: P_B, nombre: 'Patio Bravo' }, { id: P_C, nombre: 'Patio Charlie' }];
const LAT = 20.7;
const LNG = -103.4;
const grados = (m: number): number => m / 111_195;

interface Caso { nombre: string; zona: string; dia: string; desfase: string }
const CASOS: Caso[] = [
  { nombre: 'Matamoros 30-oct-2026, antes del cambio de hora (UTC-5)', zona: 'America/Matamoros', dia: '2026-10-30', desfase: '-05:00' },
  { nombre: 'Matamoros 2-nov-2026, después del cambio de hora (UTC-6)', zona: 'America/Matamoros', dia: '2026-11-02', desfase: '-06:00' },
  { nombre: 'Ciudad de México 30-oct-2026 (UTC-6)', zona: 'America/Mexico_City', dia: '2026-10-30', desfase: '-06:00' },
  { nombre: 'Cancún 2-nov-2026 (UTC-5, sin cambio de hora)', zona: 'America/Cancun', dia: '2026-11-02', desfase: '-05:00' },
];

interface Envio { t: Date; telefono: string; texto: string; plantilla: string; botones: string[]; contexto: string }

const aMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Muestras cada 5 min de `desde` min antes de `ref` hasta `ref`, en el mismo punto (o desplazadas `deriva` m por muestra). */
const muestras = (ref: Date, desde = 40, deriva = 0): MuestraGps[] => {
  const salida: MuestraGps[] = [];
  for (let i = 0, t = desde; t >= 0; i += 1, t -= 5) salida.push({ lat: LAT + grados(i * deriva), lng: LNG, medidaEn: new Date(ref.getTime() - t * 60_000) });
  return salida;
};

function armar(caso: Caso, servicio: Servicio, extra: Partial<ConfigConductor> | 'fabrica' = {}) {
  const base = new Date(`${caso.dia}T00:00:00${caso.desfase}`).getTime();
  /** `hh:mm` hora LOCAL de la flota en el día del caso → instante. */
  const L = (hhmm: string): Date => new Date(base + aMin(hhmm) * 60_000);

  const enviados: Envio[] = [];
  let reloj = L('08:00');
  const config: Partial<ConfigConductor> = extra === 'fabrica' ? { zonaHoraria: caso.zona } : {
    zonaHoraria: caso.zona, validarUbicacion: false,
    compuertaMovimientoActiva: true, poleoMin: 5, // cadencia declarada: con muestras cada 5 min la compuerta pide dos, no tres
    deteccionParadaActiva: true, reporteLlegadaActivo: true, patioEntregaActivo: true, resultadoDescargaActivo: true,
    estadiaAlertaDescargaMin: 120, estadiaDescargaInteractiva: true, estadiaDescargaSinRespuestaMin: 30,
    exigirSelloInicio: true, ...extra,
  };
  const w = crearMundo({
    viajes: [viajeBase({
      id: V1, tenantId: TENANT, folio: 'SIM-0001', servicio, unidadId: 'u1', operadorTelefono: TEL.chofer,
      origen: 'Origen Sintético', destino: 'Patio Alfa', entregarEn: 'Patio Alfa',
      aceptadoEn: L('07:00').toISOString(),
      ...(servicio === 'importacion' ? { citaDestinoEn: L('12:30').toISOString() } : { citaOrigenEn: L('10:00').toISOString() }),
    })],
    configs: { [TENANT]: config },
    destinatarios: { [TENANT]: { 1: [TEL.supervisor] } },
    enviar: async (telefono, m, contexto) => {
      enviados.push({ t: reloj, telefono, texto: m.texto, plantilla: m.plantilla.nombre, botones: m.botones.map((b) => b.id), contexto });
      return { ok: true, via: 'botones', id: 'wamid.X', motivo: 'ventana_abierta', ventana: 'abierta' };
    },
  });
  w.m.sembrar(V1);

  // El ciclo por servicio (T-A5-41): la semilla sintética, como la deja la 0807.
  const filas = SEMILLA_CICLOS.map((p) => ({ tenantId: TENANT, servicio: p.servicio, orden: p.orden, hito: p.hito, activo: true }));
  w.puertos.ciclosDe = async () => filas;
  w.m.deps.ciclosDe = async () => filas; // la entrada del chofer (T-A5-68) lee el MISMO ciclo que el cron

  // El GPS lo gobierna la prueba: `gps.muestras` es lo que lee cada cron.
  const gps: { muestras: MuestraGps[] } = { muestras: [] };
  w.puertos.muestrasUnidad = async (us) => new Map(us.map((u) => [`${u.tenantId}|${u.unidadId}`, gps.muestras.map((m) => ({ ...m }))]));
  w.puertos.sitiosDe = async (vs) => new Map(vs.map((v) => [v.id, { origen: null, destino: null }]));

  // Las bitácoras (en producción, `viaje_hito_evento` y `viaje_parada`); la MISMA para el cron y para la entrada.
  const detencion: EventoDetencionFila[] = [];
  const reporte: EventoReporteFila[] = [];
  const patioEv: EventoPatioFila[] = [];
  const paradas: ParadaFila[] = [];
  let n = 0;
  const bitDetencion = {
    eventosDetencion: async (_t: string, ids: string[]) => detencion.filter((e) => ids.includes(e.viajeId)).map((e) => ({ ...e })),
    guardarEventoDetencion: async (h: { id: string; viajeId: string }, detalle: Record<string, string | number | boolean | null>) => {
      detencion.push({ id: ++n, viajeId: h.viajeId, hitoId: h.id, detalle: { clase: 'deteccion_parada', ...detalle }, creadoEn: reloj.toISOString() });
      return true;
    },
  };
  const bitReporte = {
    eventosReporte: async (_t: string, ids: string[]) => reporte.filter((e) => ids.includes(e.viajeId)).map((e) => ({ ...e })),
    guardarEventoReporte: async (h: { id: string; viajeId: string }, detalle: Record<string, string | number | boolean | null>) => {
      reporte.push({ id: ++n, viajeId: h.viajeId, hitoId: h.id, detalle: { clase: 'reporte_llegada', ...detalle }, creadoEn: reloj.toISOString() });
      return true;
    },
  };
  const bitPatio = {
    eventos: async (_t: string, ids: string[]) => patioEv.filter((e) => ids.includes(e.viajeId)).map((e) => ({ ...e })),
    evento: async (h: { id: string; viajeId: string }, evento: string, detalle: Record<string, string | number | boolean | null>) => {
      if ((evento !== 'validacion' && evento !== 'atendido') || (detalle.clase !== 'patio_entrega' && detalle.clase !== 'resultado_descarga')) return;
      patioEv.push({ id: ++n, viajeId: h.viajeId, hitoId: h.id, evento, detalle, creadoEn: reloj.toISOString() });
    },
  };
  // La parada que inicia el chofer (T-A5-38): una abierta por viaje, como el índice único de la 0806.
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
  w.m.deps.detencion = { ...bitDetencion, destinatarios: w.puertos.destinatarios, enviar: w.puertos.enviar };
  w.m.deps.reporte = bitReporte;
  const patio: PuertosPatio = {
    ...bitPatio, patios: async () => PATIOS, reclamar: w.puertos.reclamar, cerrarAviso: w.puertos.cerrarAviso,
    destinatarios: w.puertos.destinatarios, enviar: w.puertos.enviar,
  };
  w.m.deps.patio = patio;
  const resultado: PuertosResultado = {
    ...bitPatio, reclamar: w.puertos.reclamar, cerrarAviso: w.puertos.cerrarAviso, destinatarios: w.puertos.destinatarios, enviar: w.puertos.enviar,
  };
  w.m.deps.resultado = resultado;
  w.m.deps.estadia = w.puertos;

  const cronDetencion: PuertosDetencion = {
    ...w.puertos, ...bitDetencion,
    paradasRecientes: async (_t, ids, desde) => paradas.filter((p) => ids.includes(p.viajeId) && (p.fin === null || new Date(p.fin) >= desde)),
  };
  const cronReporte: PuertosReporte = { ...w.puertos, ...bitReporte };

  const en = (hhmm: string) => { reloj = L(hhmm); return reloj; };
  const chofer = (texto: string, hhmm: string) => {
    const t = en(hhmm);
    return atenderConductor({ tenantId: TENANT, operadorId: 'o1', telefono: TEL.chofer, viajeAbiertoId: V1, texto, mensajeEn: t, ahora: t, waMessageId: `wa-${++n}` }, w.m.deps);
  };
  const cron = (hhmm: string) => correrConductor(w.puertos, { ahora: en(hhmm) });
  const detener = (hhmm: string) => correrDeteccionParada(cronDetencion, { ahora: en(hhmm) });
  const reportar = (hhmm: string) => correrReporteLlegada(cronReporte, { ahora: en(hhmm) });
  const estadia = (hhmm: string) => correrAlertasEstadia(w.puertos, { ahora: en(hhmm) });
  const quieta = (hhmm: string, desde = 40) => { gps.muestras = muestras(L(hhmm), desde); };
  const rodando = (hhmm: string, desde = 40) => { gps.muestras = muestras(L(hhmm), desde, 400); };
  const hito = (tipo: string) => w.m.de(V1).find((h) => h.tipo === tipo)!;
  const alSupervisor = () => enviados.filter((e) => e.telefono === TEL.supervisor);
  return { caso, L, w, gps, enviados, detencion, reporte, patioEv, paradas, config, en, chofer, cron, detener, reportar, estadia, quieta, rodando, hito, alSupervisor };
}

const textos = (r: { mensajes?: Array<{ texto: string }> } | null | undefined) => (r?.mensajes ?? []).map((x) => x.texto).join('\n');

/** Las medidas de cada paso: al final ninguna puede ser cero (una prueba verde que no midió nada no cuenta). */
function medidas() {
  const m: Record<string, number> = {};
  return { anotar: (k: string, v: number) => { m[k] = (m[k] ?? 0) + v; return v; }, todas: () => m };
}

beforeEach(() => { vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
describe.each(CASOS)('IMPORTACIÓN completa · $nombre', (caso) => {
  it('del inicio de viaje a la caja cargada: cada regla nueva actúa UNA vez, en su momento y en la zona de la flota', async () => {
    const s = armar(caso, 'importacion');
    const med = medidas();

    // ── T-A5-41/42: el ciclo de importación NO pide carga; el reloj de la prueba es la hora local de la flota.
    const ciclo = cicloDelServicio(SEMILLA_CICLOS.map((p) => ({ tenantId: TENANT, servicio: p.servicio, orden: p.orden, hito: p.hito, activo: true })), 'importacion');
    expect(hitosDelCiclo(ciclo)).toEqual(['llegada_descarga', 'salida_descarga']);
    med.anotar('ciclo.hitos', hitosDelCiclo(ciclo).length);

    // ── T-A5-40 + T-A5-68 (cableado): el sello es paso previo del «ya salí» en importación, por la ENTRADA REAL del chofer.
    //    Sin foto: el inicio NO se registra y se pide la foto; con la foto «sello» (que registra el inicio con su evidencia) queda recibido.
    const ahoraSello = s.en('08:00');
    const evSello = { tipo: 'sello' as const, creadaEn: new Date(ahoraSello.getTime() - 10 * 60_000).toISOString() };
    expect(decidirSelloInicio({ objetivo: 'salida_carga', servicio: 'importacion', exigir: s.config.exigirSelloInicio, evidencias: [], ahora: ahoraSello })).toEqual({ accion: 'pedir_foto' });
    expect(decidirSelloInicio({ objetivo: 'salida_carga', servicio: 'importacion', exigir: s.config.exigirSelloInicio, evidencias: [evSello], ahora: ahoraSello })).toEqual({ accion: 'registrar', recomendar: false });
    const sinSello = await s.chofer('ya salí', '08:05');
    expect(textos(sinSello)).toMatch(/foto del sello/);
    expect(s.hito('salida_carga').estado).toBe('esperado');
    expect(s.hito('salida_descarga').estado).not.toBe('recibido'); // con ciclo, el arranque NO cierra el viaje como salida de descarga
    med.anotar('sello.pedido_en_entrada_real', 1);
    const ahoraFoto = s.en('08:06');
    const previa = await hitoParaEvidenciaDelChofer({ tenantId: TENANT, operadorId: 'o1', viajeId: V1, caption: 'sello', ahora: ahoraFoto }, s.w.m.deps);
    expect(previa).toMatchObject({ tipo: 'sello', hito: null, comoHito: 'salida_carga' });
    await registrarHitoDesdeFoto({ tenantId: TENANT, operadorId: 'o1', telefono: TEL.chofer, viajeId: V1, tipo: 'sello', ruta: `${TENANT}/${V1}/sello.jpg`, sha256: 'a'.repeat(64), ahora: ahoraFoto }, s.w.m.deps);
    expect(s.hito('salida_carga').estado).toBe('recibido');
    expect(s.w.m.evidencias).toHaveLength(1);
    med.anotar('inicio.registrado', 1);

    // ── T-A5-38: parada con motivo que inicia el chofer, y «Ya continúo» la cierra.
    s.rodando('08:10');
    const abre = await s.chofer(`parada_motivo_trafico:${V1}`, '08:10');
    expect(textos(abre)).toMatch(/tr[aá]fico/i);
    expect(s.paradas).toHaveLength(1);
    expect(s.paradas[0]).toMatchObject({ motivo: 'trafico', fin: null });
    await s.chofer(`parada_continuo:${V1}`, '08:20');
    expect(s.paradas[0].fin).not.toBeNull();
    med.anotar('parada.con_motivo', s.paradas.length);

    // ── T-A5-39: detenida 40 min SIN aviso → UNA pregunta (N05); «Registrar motivo» → lista → el motivo crea la parada.
    s.quieta('09:30');
    const p1 = await s.detener('09:30');
    expect(p1.preguntas).toBe(1);
    const n05 = s.enviados.filter((e) => e.contexto === 'conductor.deteccion_parada');
    expect(n05).toHaveLength(1);
    expect(n05[0]).toMatchObject({ telefono: TEL.chofer, plantilla: 'conductor_detencion_sin_aviso_v1' });
    expect(n05[0].botones).toEqual([`parada_ok:${V1}`, `parada_motivo:${V1}`, `parada_apoyo:${V1}`]);
    await s.detener('09:35');
    expect(s.enviados.filter((e) => e.contexto === 'conductor.deteccion_parada')).toHaveLength(1); // no repite en el mismo episodio
    const lista = await s.chofer(`parada_motivo:${V1}`, '09:36');
    expect(lista?.mensajes[0].botones?.length).toBeGreaterThan(0);
    await s.chofer(`parada_motivo_descanso:${V1}`, '09:37');
    expect(s.paradas).toHaveLength(2);
    expect(s.paradas[1]).toMatchObject({ motivo: 'descanso', fin: null });
    await s.chofer(`parada_continuo:${V1}`, '09:50');
    med.anotar('detencion.preguntas', p1.preguntas);

    // ── T-A5-36/37 + ajuste 16b: la solicitud llega con cita 12:30; con la unidad EN MOVIMIENTO no se le escribe y no se gasta el nivel.
    s.rodando('12:01');
    const reclamosAntes = s.w.reclamos.size;
    const mov = await s.cron('12:01');
    expect(mov.solicitudes + mov.recordatorios).toBe(0);
    expect(mov.saltados.compuerta_movimiento).toBe(1);
    expect(s.w.reclamos.size).toBe(reclamosAntes);
    med.anotar('compuerta.bloqueos', mov.saltados.compuerta_movimiento ?? 0);
    // «Atasco»: las muestras están quietas, pero la señal extra de la telemática dice que conduce → no escribe; sin esa señal, la regla solo-GPS sí deja.
    s.quieta('12:02');
    const quietas = muestras(s.L('12:02'), 40);
    const atasco = puedeEscribirAlChofer({ posiciones: quietas, clavesPoleo: [], sitioDelViaje: null, config: s.config, ahora: s.L('12:02'), senalExtra: { velocidadKmh: 40 } });
    expect(atasco).toEqual({ permitido: false, razon: 'conduciendo' });
    expect(puedeEscribirAlChofer({ posiciones: quietas, clavesPoleo: [], sitioDelViaje: null, config: s.config, ahora: s.L('12:02') })).toMatchObject({ permitido: true, razon: 'detenida' });
    med.anotar('atasco', 1);
    // T-A5-65/68: el MISMO caso por el camino real del cron: muestras quietas + proveedor «conduce» → el cron no escribe ni gasta el nivel.
    const puertosSinSenal = s.w.puertos.senalesConduccion;
    s.w.puertos.senalesConduccion = crearDobleSenales({ u1: { ignicion: true, velocidadKmh: 40, telefonoEnMano: null, medidaEn: s.L('12:02') } });
    const atascoCron = await s.cron('12:02');
    expect(atascoCron.solicitudes + atascoCron.recordatorios).toBe(0);
    expect(atascoCron.saltados.compuerta_movimiento).toBe(1);
    expect(s.w.reclamos.size).toBe(reclamosAntes);
    s.w.puertos.senalesConduccion = puertosSinSenal;
    med.anotar('atasco.cron', atascoCron.saltados.compuerta_movimiento ?? 0);
    // Detenida: la solicitud sale (la unidad lleva horas parada sin que eso importe a la compuerta, que solo mira el movimiento).
    const quieto = await s.cron('12:03');
    expect(quieto.solicitudes).toBe(1);
    const solicitud = s.enviados.filter((e) => e.contexto === 'conductor.solicitud');
    expect(solicitud).toHaveLength(1);
    expect(solicitud[0].texto).toMatch(/descarga en Patio Alfa/); // la solicitud de importación es la de la DESCARGA, no la de carga
    med.anotar('solicitudes', quieto.solicitudes);

    // ── Llegada a descargar → T-A5-44: «¿en qué patio entregas?». Elige OTRO patio → aviso al supervisor y excepción de solo lectura.
    s.quieta('12:45');
    const llega = await s.chofer('ya llegué', '12:45'); // T-A5-68: «ya llegué» a secas es la DESCARGA porque la entrada pasa el ciclo
    expect(s.hito('llegada_descarga').estado).toBe('recibido');
    expect(s.hito('llegada_carga').estado).not.toBe('recibido');
    med.anotar('ciclo.entrada_real', 1);
    const pregunta = llega?.mensajes.flatMap((x) => x.botones ?? []).map((b) => b.id) ?? [];
    expect(pregunta).toContain(`hito_patio:${V1}:${P_A}`);
    expect(pregunta).toContain(`hito_patio:${V1}:${P_B}`);
    const distinto = await s.chofer(`hito_patio:${V1}:${P_B}`, '12:47');
    expect(textos(distinto)).toMatch(/Patio Bravo/);
    expect(s.alSupervisor().filter((e) => /Patio/.test(e.texto) && e.contexto === 'conductor.patio_distinto')).toHaveLength(1);
    expect(excepcionesPatio(s.patioEv)).toHaveLength(1);
    med.anotar('patio.alertas', s.alSupervisor().length);

    // ── T-A5-43: «¿con quién te reportaste?» y la rampa; cada paso UNA vez, todo persistido.
    s.quieta('13:00');
    const r1 = await s.reportar('13:00');
    expect(r1.preguntas).toBe(1);
    await s.reportar('13:01');
    expect(s.enviados.filter((e) => e.contexto === 'conductor.reporte_llegada')).toHaveLength(1);
    await s.chofer(`hito_sin_contacto_anden:${V1}`, '13:02');
    expect(s.hito('llegada_descarga').sinContacto).toBe(true);
    s.quieta('13:05');
    const r2 = await s.reportar('13:05');
    expect(r2.preguntas).toBe(1);
    const rampa = s.enviados.filter((e) => e.contexto === 'conductor.reporte_llegada').at(-1)!;
    expect(rampa.botones).toEqual([`rampa_estado_si:${V1}`, `rampa_estado_no:${V1}`, `rampa_mas:${V1}`]);
    await s.chofer(`rampa_mas:${V1}`, '13:06');
    const na = await s.chofer(`rampa_estado_no_aplica:${V1}`, '13:07');
    expect(textos(na)).toMatch(/no aplica/);
    // «No aplica» ofrece «¿cómo descargas?» como pregunta OPCIONAL: se manda UNA vez y el chofer la contesta con texto libre.
    s.quieta('13:10');
    const r3 = await s.reportar('13:10');
    expect(r3.preguntas).toBe(1);
    const como = await s.chofer('a pie de calle con montacargas', '13:12');
    expect(textos(como)).toMatch(/descargas: a pie de calle con montacargas/);
    s.quieta('13:30');
    await s.reportar('13:30');
    expect(s.enviados.filter((e) => e.contexto === 'conductor.reporte_llegada')).toHaveLength(3); // contacto, rampa, cómo: cada paso UNA vez
    expect(s.reporte.map((e) => `${e.detalle.tipo}:${e.detalle.paso ?? e.detalle.estado ?? 'como'}`)).toEqual([
      'pregunta:contacto', 'pregunta:rampa', 'rampa:no_aplica', 'pregunta:como_descarga', 'como:como',
    ]);
    med.anotar('reporte.preguntas', r1.preguntas + r2.preguntas + r3.preguntas);

    // ── T-A5-45: 2 h en la descarga. Primero se le pregunta al chofer; sin respuesta, tras la gracia, el supervisor se entera UNA vez.
    const antes = s.alSupervisor().length;
    s.quieta('14:55');
    const e1 = await s.estadia('14:55'); // 130 min desde la llegada de 12:45: pasa el umbral de 120, dentro de la gracia de 30
    expect(e1.preguntas).toBe(1);
    expect(s.alSupervisor()).toHaveLength(antes);
    s.quieta('15:10');
    await s.estadia('15:10');
    expect(s.alSupervisor()).toHaveLength(antes); // 145 min: aún en gracia
    s.quieta('15:20');
    const e2 = await s.estadia('15:20'); // 155 min ≥ 120 + 30: el supervisor
    expect(e2.alertas).toBe(1);
    s.quieta('15:50');
    await s.estadia('15:50');
    const avisosEstadia = s.alSupervisor().filter((e) => e.contexto === 'conductor.alerta_estadia');
    expect(avisosEstadia).toHaveLength(1);
    expect(avisosEstadia[0].texto).toMatch(/12:45/); // la hora de llegada, en HORA LOCAL de la flota
    med.anotar('estadia.avisos', avisosEstadia.length);

    // ── T-A5-46: la salida de la descarga abre «¿cómo terminó?»; «caja cargada» avisa al supervisor y deja el regreso registrado.
    s.quieta('16:00', 10);
    const sale = await s.chofer('ya salí', '16:00');
    const opciones = sale?.mensajes.flatMap((x) => x.botones ?? []).map((b) => b.id) ?? [];
    expect(opciones).toContain(`resultado_descarga:${V1}:caja_cargada`);
    expect(s.hito('salida_descarga').estado).toBe('recibido');
    const cajas = s.alSupervisor().length;
    const caja = await s.chofer(`resultado_descarga:${V1}:caja_cargada`, '16:02');
    expect(textos(caja)).toBeTruthy();
    expect(s.alSupervisor()).toHaveLength(cajas + 1);
    expect(s.hito('regreso').estado).toBe('recibido');
    expect(regresoConCajaCargada(s.patioEv, s.hito('regreso').id)).toBe(true);
    med.anotar('caja.avisos', 1);

    // El viaje queda cerrado sin pendientes y NADA se repite: una pasada más no manda nada.
    const total = s.enviados.length;
    s.quieta('16:30');
    await s.cron('16:30'); await s.detener('16:30'); await s.reportar('16:30'); await s.estadia('16:30');
    expect(s.enviados).toHaveLength(total);

    // Ninguna medida en cero.
    for (const [k, v] of Object.entries(med.todas())) expect(v, `la medida «${k}» no puede ser 0`).toBeGreaterThan(0);
    expect(Object.keys(med.todas()).length).toBeGreaterThanOrEqual(13);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe.each(CASOS)('EXPORTACIÓN completa · $nombre', (caso) => {
  it('de la cita de carga al patio distinto: el contacto sin rampa, el sello que no se exige, el apoyo en la detención y el patio de entrega', async () => {
    const s = armar(caso, 'exportacion');
    const med = medidas();

    // ── T-A5-41/42: exportación SÍ pide carga y NO pide la descarga.
    const filas = SEMILLA_CICLOS.map((p) => ({ tenantId: TENANT, servicio: p.servicio, orden: p.orden, hito: p.hito, activo: true }));
    expect(hitosDelCiclo(cicloDelServicio(filas, 'exportacion'))).toEqual(['llegada_carga', 'salida_carga']);
    med.anotar('ciclo.hitos', 2);

    // ── T-A5-40: en exportación el sello previo NUNCA se exige ni se recomienda, aunque la opción esté encendida.
    const ahoraSello = s.en('08:00');
    expect(decidirSelloInicio({ objetivo: 'salida_carga', servicio: 'exportacion', exigir: s.config.exigirSelloInicio, evidencias: [], ahora: ahoraSello })).toEqual({ accion: 'registrar', recomendar: false });
    med.anotar('sello.decisiones', 1);

    // ── T-A5-36/37: cita de carga 10:00. En movimiento no se escribe; detenida, sale la solicitud (en hora local).
    s.rodando('09:35');
    const mov = await s.cron('09:35');
    expect(mov.solicitudes + mov.recordatorios).toBe(0);
    expect(mov.saltados.compuerta_movimiento).toBe(1);
    expect(s.w.reclamos.size).toBe(0);
    med.anotar('compuerta.bloqueos', mov.saltados.compuerta_movimiento ?? 0);
    s.quieta('09:40');
    const quieto = await s.cron('09:40');
    expect(quieto.solicitudes).toBe(1);
    const solicitud = s.enviados.filter((e) => e.contexto === 'conductor.solicitud');
    expect(solicitud).toHaveLength(1);
    expect(solicitud[0].texto).toMatch(/10:00/);
    med.anotar('solicitudes', 1);

    // ── Llegada a la carga → T-A5-43: contacto SIN rampa (la rampa es solo de importación) y el chofer lo da con texto.
    await s.chofer('ya llegué', '10:05');
    expect(s.hito('llegada_carga').estado).toBe('recibido');
    s.quieta('10:10');
    const r1 = await s.reportar('10:10');
    expect(r1.preguntas).toBe(1);
    const contacto = s.enviados.filter((e) => e.contexto === 'conductor.reporte_llegada');
    expect(contacto).toHaveLength(1);
    expect(contacto[0].botones).toEqual([`hito_sin_contacto_anden:${V1}`]);
    await s.chofer('me atiende Contacto Prueba de embarques', '10:12');
    expect(s.hito('llegada_carga')).toMatchObject({ contactoNombre: 'Contacto Prueba', contactoArea: 'embarques' });
    s.quieta('10:30');
    await s.reportar('10:30');
    expect(s.enviados.filter((e) => e.contexto === 'conductor.reporte_llegada')).toHaveLength(1); // sin rampa en exportación: nada más que preguntar
    med.anotar('reporte.preguntas', r1.preguntas);

    // ── Sale cargado → en tránsito al destino.
    const saleExpo = await s.chofer('ya salí', '12:00');
    expect(s.hito('salida_carga').estado).toBe('recibido');
    expect(textos(saleExpo)).not.toMatch(/foto del sello/); // T-A5-68: la entrada real no exige ni recomienda el sello en exportación
    med.anotar('sello.no_exigido_expo', 1);

    // ── T-A5-38: parada con motivo (retén) y «Ya continúo».
    s.rodando('12:30');
    await s.chofer(`parada_motivo_reten:${V1}`, '12:30');
    expect(s.paradas).toHaveLength(1);
    expect(s.paradas[0]).toMatchObject({ motivo: 'reten', fin: null });
    await s.chofer(`parada_continuo:${V1}`, '12:50');
    expect(s.paradas[0].fin).not.toBeNull();
    med.anotar('parada.con_motivo', 1);

    // ── T-A5-39: detenida 40 min sin aviso → pregunta; «Necesito apoyo» avisa al supervisor UNA vez; al moverse el episodio se cierra.
    s.quieta('14:00');
    const p1 = await s.detener('14:00');
    expect(p1.preguntas).toBe(1);
    const apoyo = await s.chofer(`parada_apoyo:${V1}`, '14:02');
    expect(textos(apoyo)).toMatch(/supervisor/i);
    expect(s.alSupervisor()).toHaveLength(1);
    await s.chofer(`parada_apoyo:${V1}`, '14:03');
    expect(s.alSupervisor()).toHaveLength(1);
    s.rodando('14:30');
    const cierra = await s.detener('14:30');
    expect(cierra.cerrados).toBe(1);
    med.anotar('detencion.preguntas', p1.preguntas);
    med.anotar('detencion.apoyo', s.alSupervisor().length);

    // ── Llegada al destino → T-A5-44: otro patio → aviso al supervisor y excepción de solo lectura.
    s.quieta('16:00');
    const llega = await s.chofer('ya llegué a descargar', '16:00');
    expect(s.hito('llegada_descarga').estado).toBe('recibido');
    expect(llega?.mensajes.flatMap((x) => x.botones ?? []).map((b) => b.id)).toContain(`hito_patio:${V1}:${P_B}`);
    const antes = s.alSupervisor().length;
    await s.chofer(`hito_patio:${V1}:${P_C}`.replace(P_C, P_B), '16:02');
    const alertas = s.alSupervisor().filter((e) => e.contexto === 'conductor.patio_distinto');
    expect(alertas).toHaveLength(1);
    expect(s.alSupervisor()).toHaveLength(antes + 1);
    expect(excepcionesPatio(s.patioEv)).toHaveLength(1);
    med.anotar('patio.alertas', alertas.length);

    // Nada se repite en las pasadas siguientes.
    const total = s.enviados.length;
    s.quieta('16:30');
    await s.cron('16:30'); await s.detener('16:30'); await s.reportar('16:30'); await s.estadia('16:30');
    expect(s.enviados).toHaveLength(total);

    for (const [k, v] of Object.entries(med.todas())) expect(v, `la medida «${k}» no puede ser 0`).toBeGreaterThan(0);
    expect(Object.keys(med.todas()).length).toBeGreaterThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('las tres zonas dan instantes distintos para la MISMA hora local, y el reloj local manda', () => {
  it('la solicitud de importación (cita 12:30 local) sale en el instante UTC que corresponde a cada zona', async () => {
    const salidas: Array<{ caso: string; utc: string }> = [];
    for (const caso of CASOS) {
      const s = armar(caso, 'importacion');
      s.quieta('12:03');
      const r = await s.cron('12:03');
      expect(r.solicitudes).toBe(1);
      const e = s.enviados.find((x) => x.contexto === 'conductor.solicitud')!;
      expect(e.texto).toMatch(/descarga en Patio Alfa/);
      salidas.push({ caso: caso.nombre, utc: e.t.toISOString() });
    }
    // 12:03 local = 17:03Z (UTC-5) o 18:03Z (UTC-6): las cuatro corridas caen en dos instantes distintos del día, nunca iguales por casualidad.
    const horas = new Set(salidas.map((x) => x.utc.slice(11, 16)));
    expect(horas).toEqual(new Set(['17:03', '18:03']));
    expect(salidas.filter((x) => x.utc.slice(11, 16) === '17:03')).toHaveLength(2); // Matamoros antes del cambio y Cancún
    expect(salidas.filter((x) => x.utc.slice(11, 16) === '18:03')).toHaveLength(2); // Matamoros después del cambio y Ciudad de México
  });

  it('fuera de la ventana de la flota (06:00–22:00 LOCAL) no se pregunta nada, aunque en UTC sea de día; al abrir, sí', async () => {
    for (const caso of CASOS) {
      const s = armar(caso, 'importacion');
      s.w.m.registrar(V1, 'salida_carga', s.L('04:00').toISOString());
      s.quieta('05:30');
      const noche = await s.detener('05:30');
      expect(noche.fueraDeVentana, caso.nombre).toBe(1);
      expect(noche.preguntas).toBe(0);
      expect(s.enviados).toHaveLength(0);
      s.quieta('06:30');
      const dia = await s.detener('06:30');
      expect(dia.preguntas, caso.nombre).toBe(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('todo apagado por omisión', () => {
  it.each(['importacion', 'exportacion'] as const)('con los valores de fábrica (%s) ningún módulo nuevo pregunta, avisa ni guarda nada, y los botones viejos dicen «ya no está vigente»', async (servicio) => {
    const s = armar(CASOS[0], servicio, 'fabrica');
    // Los valores de fábrica de las perillas nuevas.
    for (const k of ['compuertaMovimientoActiva', 'deteccionParadaActiva', 'reporteLlegadaActivo', 'patioEntregaActivo', 'resultadoDescargaActivo', 'estadiaDescargaInteractiva', 'exigirSelloInicio'] as const) {
      expect(CONFIG_CONDUCTOR_DEFAULT[k], k).toBeFalsy();
    }
    s.w.m.registrar(V1, 'salida_carga', s.L('07:00').toISOString());
    s.w.m.registrar(V1, 'llegada_descarga', s.L('09:00').toISOString());
    s.quieta('15:00');
    const d = await s.detener('15:00');
    const r = await s.reportar('15:00');
    const e = await s.estadia('15:00');
    expect(d).toMatchObject({ revisados: 0, preguntas: 0 });
    expect(r).toMatchObject({ revisados: 0, preguntas: 0 });
    expect(e).toMatchObject({ revisadas: 0, alertas: 0 });
    expect(s.enviados).toHaveLength(0);
    expect(s.w.reclamos.size).toBe(0);
    expect(s.detencion).toHaveLength(0);
    expect(s.reporte).toHaveLength(0);
    expect(s.patioEv).toHaveLength(0);
    for (const b of [`parada_ok:${V1}`, `parada_motivo_trafico:${V1}`, `hito_patio:${V1}:${P_A}`, `resultado_descarga:${V1}:caja_cargada`, `estadia_descarga:${V1}:no`]) {
      expect(textos(await s.chofer(b, '15:05')), b).toMatch(/ya no está vigente/);
    }
    expect(s.paradas).toHaveLength(0);
    expect(s.alSupervisor()).toHaveLength(0);
    expect(s.patioEv).toHaveLength(0);
  });
});
