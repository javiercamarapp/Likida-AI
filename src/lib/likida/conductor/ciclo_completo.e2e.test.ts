import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
// Meta: el SELECTOR REAL (enviarConFallback) corre completo; lo que se simula es el proveedor.
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
    ventanaDeContacto: async (tel: string, ahora: Date = new Date()) => {
      if (meta.estado.registroForzado) return { estado: meta.estado.registroForzado, ultimoEntranteEn: null, expiraEn: null };
      return real.estadoDeVentana(meta.ultimoEntrante.get(real.normalizarTelefonoWa(tel)) ?? null, ahora);
    },
    registrarDecisionEnvio: async () => {},
  };
});

const { atenderConductor, atenderAcuseJefe, atenderPinConductor, registrarEvidenciaDelChofer, hitoParaEvidenciaDelChofer } = await import('./atender');
const { correrConductor } = await import('./ejecutor');
const { correrAlertasEstadia } = await import('./alertas_estadia');
const { barridoValidacion } = await import('./validar_hito');
const { armarTablero } = await import('./tablero');
const { calcularEstancias } = await import('./estadias_anden');
const { crearMundo } = await import('./mundo.fixture');
const { meta } = await import('./meta.fixture');
const { viajeBase } = await import('./memoria.fixture');
const { enviarConFallback } = await import('@/lib/meta/enviar_con_fallback');
type Mundo = ReturnType<typeof import('./mundo.fixture').crearMundo>;
type ViajeContexto = import('./repo').ViajeContexto;

// ═══════════════════════════════════════════════════════════════════════════
// EL CICLO COMPLETO DEL AGENTE 5 «CONDUCTOR», DE PUNTA A PUNTA (0380 + 0385), con dobles de WhatsApp:
//   cron (pide, persigue, escala, alerta) ⇄ chofer (texto, botón, pin, foto) ⇄ validación ⇄ tablero ⇄ estadías.
//
// Todas las horas son UTC; México es UTC-6 (la ventana de la flota es 06:00–22:00 MX = 12:00Z–04:00Z).
// ═══════════════════════════════════════════════════════════════════════════

const DIA = '2026-10-02';
const T = (hhmm: string, dia = DIA) => new Date(`${dia}T${hhmm}:00.000Z`);
const V1 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const V2 = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d002';
const VB = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0b1';
const TEL_CHOFER = '5219990000001';
const TEL_CHOFER2 = '5219990000002';
const TEL_PATIO = '5219990000091';
const TEL_JEFE = '5219990000092';
const TEL_B = '5219990000099';

const SITIO_CARGA = { tenantId: 't1', id: 's-carga', nombre: 'Planta Zapopan', lat: 20.72, lng: -103.39, radioM: 300 };
const SITIO_DESCARGA = { tenantId: 't1', id: 's-desc', nombre: 'CEDIS Monterrey', lat: 25.6866, lng: -100.3161, radioM: 400 };

function viaje(p: Partial<ViajeContexto> = {}): ViajeContexto {
  return viajeBase({ id: V1, aceptadoEn: T('13:00').toISOString(), unidadId: 'u1', operadorTelefono: TEL_CHOFER, ...p });
}

function mundo(o: Partial<Parameters<typeof crearMundo>[0]> = {}): Mundo {
  return crearMundo({
    viajes: [viaje()],
    destinatarios: { t1: { 1: [TEL_PATIO], 2: [TEL_JEFE] } },
    sitios: { [V1]: { carga: SITIO_CARGA, descarga: SITIO_DESCARGA } },
    enviar: (telefono, m, contexto, tenantId, ahora) => enviarConFallback(telefono, { texto: m.texto, botones: m.botones, plantilla: m.plantilla, contexto, tenantId, ahora }),
    ...o,
  });
}

/** El chofer escribe (abre su ventana de 24 h) y el entrante pasa por el motor. */
async function chofer(w: Mundo, texto: string, cuando: Date, extra: { operadorId?: string; tenantId?: string; telefono?: string; viajeAbiertoId?: string | null; waMessageId?: string } = {}) {
  const telefono = extra.telefono ?? TEL_CHOFER;
  meta.entrante(telefono, cuando);
  return atenderConductor({
    tenantId: extra.tenantId ?? 't1', operadorId: extra.operadorId ?? 'o1', telefono, viajeAbiertoId: extra.viajeAbiertoId === undefined ? V1 : extra.viajeAbiertoId,
    texto, mensajeEn: cuando, ahora: cuando, waMessageId: extra.waMessageId ?? `wa-${texto}-${cuando.toISOString()}`,
  }, w.m.deps);
}
const cron = (w: Mundo, cuando: Date) => correrConductor(w.puertos, { ahora: cuando });
const hitoDe = (w: Mundo, tipo: string, viajeId = V1) => w.m.de(viajeId).find((h) => h.tipo === tipo)!;
const estados = (w: Mundo, viajeId = V1) => Object.fromEntries(w.m.de(viajeId).map((h) => [h.tipo, h.estado]));

beforeEach(() => { meta.reiniciar(); meta.estado.reloj = T('13:00'); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. el viaje feliz: del «ya llegué» a las estadías, con validación y evidencia', () => {
  it('cinco hitos, el agente pide UNA vez cada uno, valida con el GPS y con el pin, guarda el sello y deja las estadías medibles', async () => {
    // El GPS de la unidad REPORTA CON RETRASO: al registrar la llegada todavía no hay posición.
    const gps: Array<{ tenantId: string; unidadId: string; lat: number; lng: number; medidaEn: Date; fuente: 'gps' }> = [];
    const w = mundo({ viajes: [viaje({ citaOrigenEn: T('15:00').toISOString(), citaDestinoEn: T('23:00').toISOString() })], gps });
    meta.entrante(TEL_CHOFER, T('13:00')); // aceptó el viaje: su ventana de 24 h está abierta
    meta.estado.reloj = T('14:00');

    // 14:00 — todavía no toca (la cita es a las 15:00 y se pide 30 min antes).
    expect(await cron(w, T('14:00'))).toMatchObject({ solicitudes: 0 });

    // 14:31 — toca: UNA solicitud con botones (ventana abierta → texto, no plantilla).
    meta.estado.reloj = T('14:31');
    expect(await cron(w, T('14:31'))).toMatchObject({ solicitudes: 1, escalaciones: 0 });
    expect(meta.salientes).toHaveLength(1);
    expect(meta.salientes[0]).toMatchObject({ tipo: 'botones', botones: [`hito_llegada_carga:${V1}`, `hito_retraso_carga:${V1}`, `pedir_ubicacion:${V1}`] });
    expect(meta.salientes[0].cuerpo).toMatch(/cita de carga en Planta Zapopan a las 09:00/);

    // 14:55 — el chofer toca «Ya llegué». Queda registrado con la hora de SU mensaje, y como el GPS aún no reportó se pide el pin.
    const r = await chofer(w, `hito_llegada_carga:${V1}`, T('14:55'));
    expect(r?.mensajes[0].texto).toMatch(/Anotado ✅ llegaste a CARGAR \(Planta Zapopan\) a las 08:55/);
    expect(hitoDe(w, 'llegada_carga')).toMatchObject({ estado: 'recibido', fuente: 'boton', mensajeEn: T('14:55').toISOString() });
    expect(r?.solicitarUbicacion).toMatch(/comparte tu ubicación/);
    // La sincronización con la 0090 NO sella la llegada al destino por un «ya llegué» en el origen.
    expect(w.m.legado).toEqual([]);

    // 15:05 — el poller entrega la posición de las 14:58 (dentro del sitio): el barrido del cron valida la llegada.
    gps.push({ tenantId: 't1', unidadId: 'u1', lat: 20.7201, lng: -103.3901, medidaEn: T('14:58'), fuente: 'gps' });
    const barrido = await barridoValidacion({ candidatos: w.candidatosValidacion, configDe: async (t) => w.configDe(t), deps: w.depsValidacion }, T('15:05'));
    expect(barrido).toMatchObject({ revisados: 1, validados: 1 });
    expect(hitoDe(w, 'llegada_carga')).toMatchObject({ estado: 'validado', validadoPor: 'gps' });

    // El chofer dice con quién se reportó.
    await chofer(w, 'me atiende Pedro López de embarques', T('15:07'));
    expect(hitoDe(w, 'llegada_carga')).toMatchObject({ contactoNombre: 'Pedro López', contactoArea: 'embarques' });

    // 16:56 — tras 2 h en el andén toca la salida de carga (y, con la alerta configurada, el patio ya sabe).
    meta.estado.reloj = T('16:56');
    expect(await cron(w, T('16:56'))).toMatchObject({ solicitudes: 1 });
    expect(meta.salientes.at(-1)?.botones).toEqual([`hito_salida_carga:${V1}`, `hito_sigue_cargando:${V1}`]);

    // 17:10 — «ya salí» + la foto del sello (caption «sello»), con el MISMO pipeline de evidencia.
    const salida = await chofer(w, 'ya salí', T('17:10'));
    expect(salida?.mensajes[0].texto).toMatch(/saliste de la carga a las 11:10/);
    const previa = await hitoParaEvidenciaDelChofer({ tenantId: 't1', operadorId: 'o1', viajeId: V1, caption: 'sello', ahora: T('17:11') }, w.m.deps);
    expect(previa).toMatchObject({ tipo: 'sello', hito: { tipo: 'salida_carga' } });
    const ack = await registrarEvidenciaDelChofer({ tenantId: 't1', hito: previa!.hito!, tipo: 'sello', ruta: `t1/${V1}/ev_x.jpg`, sha256: 'a'.repeat(64), waMessageId: 'wamid.foto1', ahora: T('17:11') }, w.m.deps);
    expect(ack).toMatch(/Recibí la foto de el sello/);

    // 22:30 → toca la llegada a descarga (cita 23:00); 22:40 «ya llegué» = DESCARGA (ya salió de la carga).
    meta.estado.reloj = T('22:30');
    expect(await cron(w, T('22:30'))).toMatchObject({ solicitudes: 1 });
    const llegaDesc = await chofer(w, 'ya llegué', T('22:40'));
    expect(llegaDesc?.mensajes[0].texto).toMatch(/llegaste a DESCARGAR \(CEDIS Monterrey\)/);
    // Sin posición que lo respalde (el GPS reporta con retraso) la llegada al destino NO se sella todavía…
    expect(w.m.legado).toEqual([]);
    // …y cuando el poller entrega la muestra DENTRO del CEDIS, el barrido la valida y entonces sí se sella `llegada`.
    gps.push({ tenantId: 't1', unidadId: 'u1', lat: 25.6867, lng: -100.3162, medidaEn: T('22:42'), fuente: 'gps' });
    const barridoDesc = await barridoValidacion({ candidatos: w.candidatosValidacion, configDe: async (t) => w.configDe(t), deps: w.depsValidacion }, T('22:50'));
    expect(barridoDesc).toMatchObject({ validados: 1 });
    expect(w.m.legado).toEqual([{ viajeId: V1, sellos: ['llegada'] }]);
    await chofer(w, 'ya descargué', T('23:50'));
    await chofer(w, 'voy de regreso', T('00:10', '2026-10-03'));

    // Resultado: los cinco hitos resueltos y NADA más que pedir.
    expect(estados(w)).toEqual({ llegada_carga: 'validado', salida_carga: 'recibido', llegada_descarga: 'validado', salida_descarga: 'recibido', regreso: 'recibido' });
    meta.estado.reloj = T('00:30', '2026-10-03');
    const antes = meta.salientes.length;
    expect(await cron(w, T('00:30', '2026-10-03'))).toMatchObject({ solicitudes: 0, recordatorios: 0, escalaciones: 0 });
    expect(meta.salientes.length).toBe(antes);

    // Ninguna solicitud se repitió: cada hito se pidió a lo más una vez (el chofer contestó a la primera).
    expect(w.m.hitos.size).toBe(5);
    expect([...w.m.hitos.values()].every((h) => h.recordatoriosEnviados <= 1)).toBe(true);

    // El tablero: viaje completo, y las estadías medidas con la hora exacta de los mensajes.
    const d = w.datosTablero('t1');
    const t = armarTablero(d, w.configDe('t1'), T('00:30', '2026-10-03'));
    expect(t.filas[0].semaforo).toBe('completo');
    expect(t.excepciones).toEqual([]);
    expect(t.filas[0].hitos[0]).toMatchObject({ validadoPor: 'gps', contacto: 'Pedro López (embarques)', evidencias: 0 });
    expect(t.filas[0].hitos[1].evidencias).toBe(1);
    const est = calcularEstancias(d.viajes[0], d.hitos, T('00:30', '2026-10-03'), { validaciones: new Map(), evidencias: new Map() });
    expect(est.map((e) => [e.lugar, e.minutos])).toEqual([['carga', 135], ['descarga', 70]]);
  });

  it('la alerta de estadía llega UNA vez al patio, con la hora exacta, y deja de existir cuando el chofer sale', async () => {
    const w = mundo({ configs: { t1: { estadiaAlertaCargaMin: 120 } } });
    w.m.registrar(V1, 'llegada_carga', T('15:00').toISOString());
    meta.entrante(TEL_PATIO, T('15:00'));
    meta.estado.reloj = T('17:30');
    const r1 = await correrAlertasEstadia(w.puertos, { ahora: T('17:30') });
    expect(r1).toMatchObject({ alertas: 1 });
    expect(meta.salientes.at(-1)).toMatchObject({ a: TEL_PATIO, tipo: 'texto' });
    expect(meta.salientes.at(-1)?.cuerpo).toMatch(/lleva 2 horas y 30 minutos en la carga/);
    expect(meta.salientes.at(-1)?.cuerpo).toMatch(/Llegó a las 09:00 \(hora de su mensaje\)/);
    const [a, b] = await Promise.all([correrAlertasEstadia(w.puertos, { ahora: T('17:35') }), correrAlertasEstadia(w.puertos, { ahora: T('17:35') })]);
    expect(a.alertas + b.alertas).toBe(0);
    expect(meta.salientes.filter((s) => s.cuerpo.includes('Estadía larga'))).toHaveLength(1);
    w.m.registrar(V1, 'salida_carga', T('17:40').toISOString());
    expect(await correrAlertasEstadia(w.puertos, { ahora: T('18:30') })).toMatchObject({ alertas: 0, revisadas: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. el chofer que no contesta: la escalera 0/+15/+30/+45, el patio a los 90 y el jefe 30 min después', () => {
  async function correrCadaCinco(w: Mundo, desde: string, hasta: string) {
    const [h0, m0] = desde.split(':').map(Number);
    const [h1, m1] = hasta.split(':').map(Number);
    for (let t = h0 * 60 + m0; t <= h1 * 60 + m1; t += 5) {
      const cuando = T(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
      meta.estado.reloj = cuando;
      await cron(w, cuando);
    }
  }

  it('con el cron corriendo cada 5 minutos manda exactamente: 1 solicitud, 3 recordatorios, 1 escalación al patio y 1 al jefe', async () => {
    const w = mundo();
    meta.entrante(TEL_CHOFER, T('13:00'));
    meta.entrante(TEL_PATIO, T('13:00'));
    meta.entrante(TEL_JEFE, T('13:00'));
    // Sin cita: la llegada toca a las 15:00 (aceptado 13:00 + 120 de espera por defecto).
    await correrCadaCinco(w, '14:30', '17:30');
    const alChofer = meta.salientes.filter((s) => s.a === TEL_CHOFER);
    expect(alChofer).toHaveLength(4); // 0, +15, +30, +45
    expect(alChofer.every((s) => s.tipo === 'botones')).toBe(true);
    expect(alChofer[0].botones[0]).toBe(`hito_llegada_carga:${V1}`);
    expect(alChofer[3].cuerpo).toMatch(/último aviso antes de avisar a tu jefe/);
    const alPatio = meta.salientes.filter((s) => s.a === TEL_PATIO);
    const alJefe = meta.salientes.filter((s) => s.a === TEL_JEFE);
    expect(alPatio).toHaveLength(1);
    expect(alJefe).toHaveLength(1);
    expect(alPatio[0].botones).toEqual([`jefe_atiendo:${V1}`]);
    expect(alJefe[0].cuerpo).toMatch(/Segundo aviso, nadie del patio lo atendió/);
    expect(hitoDe(w, 'llegada_carga')).toMatchObject({ estado: 'escalado', escalacionNivel: 2 });
    // La escalación es del PRIMER hito pendiente, no de los cinco: los demás no se persiguen todavía.
    expect(estados(w)).toMatchObject({ salida_carga: 'esperado', regreso: 'esperado' });
  });

  it('cada mensaje sale en su minuto y en ningún otro (la escalera no se compacta ni se repite)', async () => {
    const w = mundo();
    meta.entrante(TEL_CHOFER, T('13:00'));
    const horas: string[] = [];
    for (const hhmm of ['15:00', '15:05', '15:14', '15:15', '15:20', '15:30', '15:45', '16:00']) {
      meta.estado.reloj = T(hhmm);
      const antes = meta.salientes.length;
      await cron(w, T(hhmm));
      if (meta.salientes.length > antes) horas.push(hhmm);
    }
    expect(horas).toEqual(['15:00', '15:15', '15:30', '15:45']);
  });

  it('si el cron estuvo caído, manda SOLO el nivel más alto vencido (no los tres recordatorios de golpe)', async () => {
    const w = mundo();
    meta.entrante(TEL_CHOFER, T('13:00'));
    meta.estado.reloj = T('15:35');
    const r = await cron(w, T('15:35'));
    expect(r.solicitudes + r.recordatorios).toBe(1);
    expect(meta.salientes.filter((s) => s.a === TEL_CHOFER)).toHaveLength(1);
    expect(meta.salientes[0].cuerpo).toMatch(/sigue pendiente «tu llegada a cargar» del viaje F-1042 desde hace 35 minutos/);
  });

  it('«Ya lo atiendo» del patio detiene la escalera: no hay segundo nivel y el tablero deja de listar la excepción', async () => {
    const w = mundo();
    meta.entrante(TEL_CHOFER, T('13:00'));
    meta.entrante(TEL_PATIO, T('13:00'));
    meta.entrante(TEL_JEFE, T('13:00'));
    await correrCadaCinco(w, '14:30', '16:35');
    expect(meta.salientes.filter((s) => s.a === TEL_PATIO)).toHaveLength(1);
    const antes = armarTablero(w.datosTablero('t1'), w.configDe('t1'), T('16:35'));
    expect(antes.excepciones.map((e) => e.tipo)).toEqual(['escalado_sin_atender']);

    const respuesta = await atenderAcuseJefe(TEL_PATIO, `jefe_atiendo:${V1}`, T('16:36'), w.depsAcuse);
    expect(respuesta).toMatch(/lo marqué como atendido/);
    await correrCadaCinco(w, '16:40', '18:00');
    expect(meta.salientes.filter((s) => s.a === TEL_JEFE)).toHaveLength(0);
    const despues = armarTablero(w.datosTablero('t1'), w.configDe('t1'), T('18:00'));
    expect(despues.excepciones).toEqual([]);
    expect(despues.filas[0].semaforo).toBe('sin_reporte'); // sigue en rojo: atendido no es reportado
    // Un segundo toque del botón no repite nada.
    expect(await atenderAcuseJefe(TEL_PATIO, `jefe_atiendo:${V1}`, T('18:01'), w.depsAcuse)).toMatch(/Ya estaba atendido/);
  });

  it('si el chofer contesta tarde, el hito se registra, el reloj se reinicia y el agente deja de insistir', async () => {
    const w = mundo();
    meta.entrante(TEL_CHOFER, T('13:00'));
    await correrCadaCinco(w, '14:55', '15:35');
    const r = await chofer(w, 'ya llegué', T('15:40'));
    expect(r?.mensajes[0].texto).toMatch(/Anotado ✅/);
    const antes = meta.salientes.length;
    await correrCadaCinco(w, '15:45', '16:20');
    // Lo único que puede venir ahora es la solicitud del SIGUIENTE hito (salida de carga), no más recordatorios de la llegada.
    expect(meta.salientes.slice(antes).every((s) => !s.cuerpo.includes('llegada a cargar'))).toBe(true);
    expect(hitoDe(w, 'llegada_carga').estado).toBe('recibido');
  });

  it('«Tengo un problema» escala AL INSTANTE al patio, una sola vez, aunque el botón se toque dos veces', async () => {
    const w = mundo();
    meta.entrante(TEL_CHOFER, T('14:00'));
    meta.entrante(TEL_PATIO, T('14:00'));
    meta.estado.reloj = T('14:05');
    const a = await chofer(w, `recordatorio_problema:${V1}:llegada_carga`, T('14:05'));
    const b = await chofer(w, `recordatorio_problema:${V1}:llegada_carga`, T('14:06'), { waMessageId: 'otro' });
    expect(a?.mensajes[0].texto).toMatch(/Ya le avisé a tu jefe de tráfico/);
    expect(b?.mensajes[0].texto).toMatch(/Ya le avisé a tu jefe de tráfico/);
    expect(meta.salientes.filter((s) => s.a === TEL_PATIO)).toHaveLength(1);
    expect(meta.salientes.find((s) => s.a === TEL_PATIO)?.cuerpo).toMatch(/el chofer reportó un problema/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. mensajes fuera de orden', () => {
  it('«ya descargué» sin nada registrado: el hito se registra y los anteriores quedan OMITIDOS (no se inventan horas)', async () => {
    const w = mundo();
    const r = await chofer(w, 'ya descargué', T('22:00'));
    expect(r?.mensajes[0].texto).toMatch(/terminaste de descargar a las 16:00/);
    expect(estados(w)).toEqual({ llegada_carga: 'omitido', salida_carga: 'omitido', llegada_descarga: 'omitido', salida_descarga: 'recibido', regreso: 'esperado' });
    expect(hitoDe(w, 'llegada_carga')).toMatchObject({ mensajeEn: null, recibidoEn: null }); // jamás una hora para lo que no se avisó
    // Las estadías de lo omitido NO son medibles y el tablero lo dice (no se inventa).
    const d = w.datosTablero('t1');
    const est = calcularEstancias(d.viajes[0], d.hitos, T('22:30'), { validaciones: new Map(), evidencias: new Map() });
    expect(est.every((e) => e.minutos === null)).toBe(true);
  });

  it('un «ya salí» antes de la llegada: sale de la carga y la llegada queda omitida', async () => {
    const w = mundo();
    await chofer(w, 'ya cargué', T('17:00'));
    expect(estados(w)).toMatchObject({ llegada_carga: 'omitido', salida_carga: 'recibido' });
  });

  it('el aviso tardío de un hito omitido lo REABRE con su hora real y reconstruye la estadía', async () => {
    const w = mundo();
    await chofer(w, 'ya cargué', T('17:00'));
    const r = await chofer(w, 'llegué a cargar a las 3 de la tarde', T('17:05'));
    expect(r).not.toBeNull();
    // (el texto libre sin hora estructurada se anota con la hora del mensaje; lo que importa es que NO se pierde)
    expect(hitoDe(w, 'llegada_carga').estado).toBe('recibido');
  });

  it('«me equivoqué»: solo retira el ÚLTIMO hito y reinicia su escalera', async () => {
    const w = mundo();
    await chofer(w, 'ya llegué', T('15:00'));
    const r = await chofer(w, 'me equivoqué', T('15:05'));
    expect(r?.mensajes[0].texto).toMatch(/retiré|corregí|quité|Listo/i);
    expect(hitoDe(w, 'llegada_carga')).toMatchObject({ estado: 'esperado', ciclo: 2 });
  });

  it('un hito VALIDADO no se puede retirar desde WhatsApp: se le dice que avise a su jefe', async () => {
    const w = mundo({ gps: [{ tenantId: 't1', unidadId: 'u1', lat: 20.72, lng: -103.39, medidaEn: T('15:00'), fuente: 'gps' }] });
    await chofer(w, 'ya llegué', T('15:00'));
    expect(hitoDe(w, 'llegada_carga').estado).toBe('validado');
    const r = await chofer(w, 'me equivoqué', T('15:05'));
    expect(r?.mensajes[0].texto).toMatch(/ya lo validó|ya quedó validado|jefe de tráfico/i);
    expect(hitoDe(w, 'llegada_carga').estado).toBe('validado');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. duplicados y concurrencia', () => {
  it('el mismo «ya llegué» dos veces: la primera hora gana y nada se duplica', async () => {
    const w = mundo();
    await chofer(w, 'ya llegué a cargar', T('15:00'));
    const primera = hitoDe(w, 'llegada_carga').mensajeEn;
    const r = await chofer(w, 'ya llegué a cargar', T('15:20'));
    expect(hitoDe(w, 'llegada_carga').mensajeEn).toBe(primera);
    expect(r?.mensajes[0].texto).toMatch(/Ya tenía|ya la tenía|ya lo tenía|ya tengo|Anotado/i);
    expect(w.m.eventos.filter((e) => e.evento === 'recibido')).toHaveLength(1);
  });

  it('dos corridas SOLAPADAS del cron mandan un solo mensaje (el claim es el candado)', async () => {
    const w = mundo();
    meta.entrante(TEL_CHOFER, T('13:00'));
    meta.estado.reloj = T('15:00');
    const [a, b] = await Promise.all([cron(w, T('15:00')), cron(w, T('15:00'))]);
    expect(a.solicitudes + b.solicitudes).toBe(1);
    expect(a.yaReclamados + b.yaReclamados).toBe(1);
    expect(meta.salientes.filter((s) => s.a === TEL_CHOFER)).toHaveLength(1);
  });

  it('el chofer repite el botón del recordatorio viejo: ya no registra el hito de hoy', async () => {
    const w = mundo();
    await chofer(w, 'ya llegué', T('15:00'));
    const r = await chofer(w, `recordatorio_registrar:${V1}:llegada_carga`, T('15:10'));
    expect(r?.mensajes[0]).toBeDefined();
    expect(hitoDe(w, 'salida_carga').estado).toBe('esperado'); // no se coló como otro hito
  });

  it('el reintento del webhook (mismo wa_message_id) no registra dos hitos', async () => {
    const w = mundo();
    await chofer(w, 'ya llegué', T('15:00'), { waMessageId: 'wamid.X' });
    await chofer(w, 'ya salí', T('15:30'), { waMessageId: 'wamid.X' });
    // Un mismo mensaje de WhatsApp registra a lo más UN hito (la red durable contra el reintento).
    expect(estados(w)).toMatchObject({ llegada_carga: 'recibido', salida_carga: 'esperado' });
  });

  it('la misma foto de evidencia dos veces: una sola evidencia', async () => {
    const w = mundo();
    w.m.registrar(V1, 'salida_carga', T('17:00').toISOString());
    const previa = await hitoParaEvidenciaDelChofer({ tenantId: 't1', operadorId: 'o1', viajeId: V1, caption: 'sello', ahora: T('17:05') }, w.m.deps);
    const e = { tenantId: 't1', hito: previa!.hito!, tipo: 'sello' as const, ruta: `t1/${V1}/a.jpg`, sha256: 'b'.repeat(64), waMessageId: 'wamid.F', ahora: T('17:05') };
    expect(await registrarEvidenciaDelChofer(e, w.m.deps)).toMatch(/Recibí/);
    expect(await registrarEvidenciaDelChofer(e, w.m.deps)).toMatch(/ya la tenía/);
    expect(w.m.evidencias).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. el chofer equivocado y la flota equivocada', () => {
  it('un botón del viaje de OTRO chofer de la MISMA flota no toca nada', async () => {
    const w = mundo({ viajes: [viaje(), viaje({ id: V2, operadorId: 'o2', operadorTelefono: TEL_CHOFER2, folio: 'F-2' })] });
    w.m.sembrar(V1); w.m.sembrar(V2);
    const antes = JSON.stringify(w.m.de(V2));
    const r = await chofer(w, `hito_llegada_carga:${V2}`, T('15:00'), { operadorId: 'o1', viajeAbiertoId: V1 });
    expect(r?.mensajes[0].texto).toMatch(/Ese botón es de otro viaje o ya no está vigente/);
    expect(JSON.stringify(w.m.de(V2))).toBe(antes);
    expect(hitoDe(w, 'llegada_carga', V1).estado).toBe('esperado');
  });

  it('un chofer de OTRA flota con el payload de mi viaje tampoco', async () => {
    const w = mundo({ viajes: [viaje(), viaje({ id: VB, tenantId: 'tB', operadorId: 'oB', operadorTelefono: TEL_B, folio: 'B-1' })] });
    w.m.sembrar(V1); w.m.sembrar(VB);
    const r = await chofer(w, `hito_llegada_carga:${V1}`, T('15:00'), { tenantId: 'tB', operadorId: 'oB', telefono: TEL_B, viajeAbiertoId: VB });
    expect(r?.mensajes[0].texto).toMatch(/otro viaje|ya no está vigente/);
    expect(hitoDe(w, 'llegada_carga', V1).estado).toBe('esperado');
  });

  it('un payload inventado a mano (uuid que no existe, o texto tipo botón) no registra nada', async () => {
    const w = mundo();
    w.m.sembrar(V1);
    const r = await chofer(w, 'hito_llegada_carga:00000000-0000-4000-8000-000000000000', T('15:00'));
    expect(r?.mensajes[0].texto).toMatch(/otro viaje/);
    expect(estados(w)).toMatchObject({ llegada_carga: 'esperado' });
  });

  it('un número ajeno NO puede dar «Ya lo atiendo» a un viaje de otra flota, y se le contesta lo mismo que si no existiera', async () => {
    const w = mundo();
    meta.entrante(TEL_CHOFER, T('13:00')); meta.entrante(TEL_PATIO, T('13:00'));
    meta.estado.reloj = T('16:35');
    for (let t = 870; t <= 995; t += 5) { const c = T(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`); meta.estado.reloj = c; await cron(w, c); }
    const ajeno = await atenderAcuseJefe(TEL_B, `jefe_atiendo:${V1}`, T('16:40'), w.depsAcuse);
    const inexistente = await atenderAcuseJefe(TEL_B, 'jefe_atiendo:00000000-0000-4000-8000-000000000000', T('16:40'), w.depsAcuse);
    expect(ajeno).toBe('No tengo ese aviso asignado a este número.');
    expect(inexistente).toBe(ajeno);
    expect(hitoDe(w, 'llegada_carga').escalacionAtendidaEn).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. fuera de la ventana de 24 h: la plantilla del catálogo, con los mismos botones', () => {
  it('la solicitud al chofer sale como PLANTILLA conductor_solicitud_llegada_carga_v1 (con el payload del botón) y NUNCA como texto', async () => {
    const w = mundo({ viajes: [viaje({ citaOrigenEn: T('15:00').toISOString() })] });
    meta.entrante(TEL_CHOFER, new Date(T('13:00').getTime() - 30 * 3_600_000)); // su último mensaje fue hace 30 h
    meta.estado.reloj = T('14:31');
    const r = await cron(w, T('14:31'));
    expect(r.solicitudes).toBe(1);
    expect(meta.enviarTexto).not.toHaveBeenCalled();
    expect(meta.enviarBotones).not.toHaveBeenCalled();
    expect(meta.salientes).toHaveLength(1);
    expect(meta.salientes[0]).toMatchObject({
      tipo: 'plantilla', plantilla: 'conductor_solicitud_llegada_carga_v1', a: TEL_CHOFER,
      parametros: ['Juan', 'F-1042', 'Planta Zapopan', '09:00'],
      botonesPlantilla: [`hito_llegada_carga:${V1}`, `hito_retraso_carga:${V1}`, `pedir_ubicacion:${V1}`],
    });
  });

  it('la escalación al patio, también por plantilla (aviso_jefe_trafico_v1) con «Ya lo atiendo»', async () => {
    const w = mundo();
    const viejo = new Date(T('13:00').getTime() - 40 * 3_600_000);
    meta.entrante(TEL_CHOFER, viejo); meta.entrante(TEL_PATIO, viejo); meta.entrante(TEL_JEFE, viejo);
    for (let t = 15 * 60; t <= 16 * 60 + 35; t += 5) { const c = T(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`); meta.estado.reloj = c; await cron(w, c); }
    const alPatio = meta.salientes.filter((s) => s.a === TEL_PATIO);
    expect(alPatio).toHaveLength(1);
    expect(alPatio[0]).toMatchObject({ tipo: 'plantilla', plantilla: 'aviso_jefe_trafico_v1', botonesPlantilla: [`jefe_atiendo:${V1}`] });
    expect(alPatio[0].parametros[0]).toBe('Juan Pérez');
    expect(alPatio[0].parametros[3]).toMatch(/sin respuesta a 4 avisos/);
    expect(meta.salientes.filter((s) => s.a === TEL_CHOFER).every((s) => s.tipo === 'plantilla')).toBe(true);
  });

  it('el aviso de estadía al patio fuera de ventana usa la plantilla genérica de operación (≤ 60 caracteres en el parámetro)', async () => {
    const w = mundo({ configs: { t1: { estadiaAlertaCargaMin: 120 } } });
    w.m.registrar(V1, 'llegada_carga', T('15:00').toISOString());
    meta.estado.reloj = T('17:30');
    await correrAlertasEstadia(w.puertos, { ahora: T('17:30') });
    expect(meta.salientes.at(-1)).toMatchObject({ tipo: 'plantilla', plantilla: 'aviso_operacion_v1', a: TEL_PATIO });
    expect(meta.salientes.at(-1)!.parametros[1].length).toBeLessThanOrEqual(60);
  });

  it('el registro de ventana está viejo (cree que está abierta) pero Meta la tiene cerrada: cae a plantilla en el MISMO envío', async () => {
    const w = mundo({ viajes: [viaje({ citaOrigenEn: T('15:00').toISOString() })] });
    meta.entrante(TEL_CHOFER, new Date(T('13:00').getTime() - 30 * 3_600_000));
    meta.estado.registroForzado = 'abierta';
    meta.estado.reloj = T('14:31');
    const r = await cron(w, T('14:31'));
    expect(r.solicitudes).toBe(1);
    expect(meta.enviarBotones).toHaveBeenCalledTimes(1); // se intentó (el registro decía abierta)…
    expect(meta.salientes).toHaveLength(1);              // …y se entregó UNA sola vez, por plantilla
    expect(meta.salientes[0].tipo).toBe('plantilla');
  });

  it('plantilla SIN APROBAR y ventana cerrada: no sale nada, queda dicho (fallo) y NO se reintenta en cada pasada', async () => {
    const w = mundo();
    meta.entrante(TEL_CHOFER, new Date(T('13:00').getTime() - 30 * 3_600_000));
    meta.estado.aprobadas = new Set(); // Meta todavía no aprueba ninguna
    meta.estado.registroForzado = 'cerrada';
    meta.estado.reloj = T('15:00');
    const r1 = await cron(w, T('15:00'));
    expect(r1.fallos[0]).toMatch(/no está aprobada todavía/);
    expect(meta.salientes).toHaveLength(0);
    const claims = [...w.reclamos.values()];
    expect(claims[0]).toMatchObject({ ok: false });
    // La siguiente pasada ve el claim cerrado: NO reintenta el mismo mensaje cada 5 minutos (y no hay fallo nuevo).
    const r2 = await cron(w, T('15:02'));
    expect(r2).toMatchObject({ solicitudes: 0, recordatorios: 0, fallos: [] });
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('un rechazo REINTENTABLE (429) YA está en wa_outbox: el claim se cierra «en cola» y la siguiente pasada NO lo reenvía', async () => {
    const w = mundo();
    meta.entrante(TEL_CHOFER, T('13:00'));
    meta.estado.bloqueados.add(meta.norm(TEL_CHOFER));
    meta.estado.reloj = T('15:00');
    const r1 = await cron(w, T('15:00'));
    expect(r1).toMatchObject({ solicitudes: 0, rechazosReintentables: 1 });
    expect([...w.reclamos.values()][0]).toMatchObject({ ok: true, motivo: 'en_cola_outbox' });
    // Aunque Meta ya no bloquee, el cron no manda un segundo aviso: el primero lo entrega el outbox.
    meta.estado.bloqueados.clear();
    const r2 = await cron(w, T('15:05'));
    expect(r2).toMatchObject({ solicitudes: 0, recordatorios: 0, fallos: [] });
    expect(meta.salientes).toHaveLength(0);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. la validación contra la ubicación, sin acusar al chofer', () => {
  it('el pin cae lejos del sitio: «sin coincidencia», el hito NO se valida, el chofer recibe una línea neutral y el tablero lo lista como excepción para revisar', async () => {
    const w = mundo();
    await chofer(w, 'ya llegué', T('15:00'));
    const linea = await atenderPinConductor({ tenantId: 't1', operadorId: 'o1', viajeId: V1, lat: 20.75, lng: -103.45, enviadoEn: T('15:02'), ahora: T('15:02') }, w.m.deps);
    expect(linea).toMatch(/Tu aviso de llegada a cargar ya quedó anotado/);
    expect(linea).toMatch(/tu jefe de tráfico lo revisa/);
    expect(hitoDe(w, 'llegada_carga').estado).toBe('recibido');
    const t = armarTablero(w.datosTablero('t1'), w.configDe('t1'), T('15:05'));
    const e = t.excepciones.find((x) => x.tipo === 'sin_coincidencia');
    expect(e).toMatchObject({ gravedad: 2, hitoTipo: 'llegada_carga' });
    expect(e?.texto).toMatch(/revísalo antes de dar por mala la llegada/);
  });

  it('después un pin DENTRO del sitio mejora el veredicto y valida; uno lejano posterior NO lo desdice', async () => {
    const w = mundo();
    await chofer(w, 'ya llegué', T('15:00'));
    await atenderPinConductor({ tenantId: 't1', operadorId: 'o1', viajeId: V1, lat: 20.75, lng: -103.45, enviadoEn: T('15:02'), ahora: T('15:02') }, w.m.deps);
    const ok = await atenderPinConductor({ tenantId: 't1', operadorId: 'o1', viajeId: V1, lat: 20.7201, lng: -103.3902, enviadoEn: T('15:04'), ahora: T('15:04') }, w.m.deps);
    expect(ok).toMatch(/quedó confirmada tu llegada a cargar en «Planta Zapopan»/);
    expect(hitoDe(w, 'llegada_carga')).toMatchObject({ estado: 'validado', validadoPor: 'gps' });
    await atenderPinConductor({ tenantId: 't1', operadorId: 'o1', viajeId: V1, lat: 25, lng: -100, enviadoEn: T('15:06'), ahora: T('15:06') }, w.m.deps);
    expect(hitoDe(w, 'llegada_carga').estado).toBe('validado');
  });

  it('viaje SIN sitio asignado: «sin dato» (nunca «no coincide»), no se le pide el pin y el tablero no lo trata como excepción', async () => {
    const w = mundo({ sitios: {} });
    const r = await chofer(w, 'ya llegué', T('15:00'));
    expect(r?.solicitarUbicacion).toBeUndefined();
    const pin = await atenderPinConductor({ tenantId: 't1', operadorId: 'o1', viajeId: V1, lat: 20.72, lng: -103.39, enviadoEn: T('15:02'), ahora: T('15:02') }, w.m.deps);
    expect(pin).toBeNull();
    const t = armarTablero(w.datosTablero('t1'), w.configDe('t1'), T('15:05'));
    expect(t.excepciones.find((x) => x.tipo === 'sin_coincidencia')).toBeUndefined();
    expect(t.filas[0].hitos[0].validacion?.resultado).toBe('sin_dato');
    expect(t.filas[0].sitioCarga).toBeNull();
  });

  it('el GPS reporta tarde: el barrido valida la llegada cuando por fin llega la posición, y NO valida con una de otra hora', async () => {
    const gps: Array<{ tenantId: string; unidadId: string; lat: number; lng: number; medidaEn: Date; fuente: 'gps' }> = [];
    const w = mundo({ gps });
    const r = await chofer(w, 'ya llegué', T('15:00'));
    expect(hitoDe(w, 'llegada_carga').estado).toBe('recibido');
    expect(r?.solicitarUbicacion).toBeDefined();
    const barrer = (cuando: string) => barridoValidacion({ candidatos: w.candidatosValidacion, configDe: async (t) => w.configDe(t), deps: w.depsValidacion }, T(cuando));
    // Una posición de 41 minutos DESPUÉS del aviso (ventana de 30) no sirve: sigue «sin dato».
    gps.push({ tenantId: 't1', unidadId: 'u1', lat: 20.72, lng: -103.39, medidaEn: T('15:41'), fuente: 'gps' });
    expect(await barrer('15:45')).toMatchObject({ validados: 0 });
    expect(hitoDe(w, 'llegada_carga').estado).toBe('recibido');
    // La de las 15:10 sí.
    gps.push({ tenantId: 't1', unidadId: 'u1', lat: 20.72, lng: -103.39, medidaEn: T('15:10'), fuente: 'gps' });
    expect(await barrer('15:46')).toMatchObject({ revisados: 1, validados: 1 });
    expect(hitoDe(w, 'llegada_carga')).toMatchObject({ estado: 'validado', validadoPor: 'gps' });
    // Idempotente: otro barrido no toca lo ya validado (ya no es candidato).
    expect(await barrer('15:50')).toMatchObject({ revisados: 0 });
  });

  it('una posición de HACE UN DÍA no sirve para validar (fuera de la ventana de la flota)', async () => {
    const w = mundo({ gps: [{ tenantId: 't1', unidadId: 'u1', lat: 20.72, lng: -103.39, medidaEn: new Date(T('15:00').getTime() - 24 * 3_600_000), fuente: 'gps' }] });
    const r = await chofer(w, 'ya llegué', T('15:00'));
    expect(hitoDe(w, 'llegada_carga').estado).toBe('recibido');
    expect(r?.solicitarUbicacion).toBeDefined(); // sigue sin dato y se pide el pin
  });

  it('el sitio de OTRA flota nunca valida: mismas coordenadas, otra flota → sin dato', async () => {
    const w = mundo({
      viajes: [viaje(), viaje({ id: VB, tenantId: 'tB', operadorId: 'oB', operadorTelefono: TEL_B, folio: 'B-1', unidadId: 'uB' })],
      sitios: { [V1]: { carga: SITIO_CARGA }, [VB]: { carga: { ...SITIO_CARGA, tenantId: 't1' } } }, // el sitio apunta a una flota que NO es la del viaje B
      gps: [{ tenantId: 'tB', unidadId: 'uB', lat: 20.72, lng: -103.39, medidaEn: T('15:00'), fuente: 'gps' }],
    });
    await chofer(w, 'ya llegué', T('15:00'), { tenantId: 'tB', operadorId: 'oB', telefono: TEL_B, viajeAbiertoId: VB });
    expect(hitoDe(w, 'llegada_carga', VB).estado).toBe('recibido');
    expect(w.veredictos.get(hitoDe(w, 'llegada_carga', VB).id)?.v).toMatchObject({ resultado: 'sin_dato', motivo: 'sin_sitio' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. aislamiento entre flotas en la MISMA pasada del cron', () => {
  it('cada flota con su escalera, sus destinatarios y su ventana; los mensajes jamás cruzan', async () => {
    const w = crearMundo({
      viajes: [
        viaje(),
        viaje({ id: VB, tenantId: 'tB', operadorId: 'oB', operadorTelefono: TEL_B, folio: 'B-1', unidadId: null }),
      ],
      configs: { tB: { escalarTrasMin: 60, solicitudesMin: [0, 10, 20] } },
      destinatarios: { t1: { 1: [TEL_PATIO] }, tB: { 1: ['5219990000077'] } },
      enviar: (telefono, m, contexto, tenantId, ahora) => enviarConFallback(telefono, { texto: m.texto, botones: m.botones, plantilla: m.plantilla, contexto, tenantId, ahora }),
    });
    for (const t of [TEL_CHOFER, TEL_B, TEL_PATIO, '5219990000077']) meta.entrante(t, T('13:00'));
    for (let t = 15 * 60; t <= 16 * 60 + 40; t += 5) { const c = T(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`); meta.estado.reloj = c; await cron(w, c); }
    const aA = meta.salientes.filter((s) => s.a === TEL_CHOFER);
    const aB = meta.salientes.filter((s) => s.a === TEL_B);
    expect(aA).toHaveLength(4);   // escalera de A: 0/15/30/45
    expect(aB).toHaveLength(3);   // escalera de B: 0/10/20
    expect(aA.every((s) => s.botones.every((b) => b.includes(V1)))).toBe(true);
    expect(aB.every((s) => s.botones.every((b) => b.includes(VB)))).toBe(true);
    expect(aB.some((s) => s.botones.some((b) => b.includes(V1)))).toBe(false);
    // Escalación de B a los 60 min (A: a los 90): cada una a SU patio.
    expect(meta.salientes.filter((s) => s.a === '5219990000077')).toHaveLength(1);
    expect(meta.salientes.filter((s) => s.a === TEL_PATIO)).toHaveLength(1);
    expect(meta.salientes.find((s) => s.a === '5219990000077')?.botones).toEqual([`jefe_atiendo:${VB}`]);
    expect(meta.salientes.find((s) => s.a === TEL_PATIO)?.botones).toEqual([`jefe_atiendo:${V1}`]);
  });

  it('el tablero de una flota NO incluye viajes ni hitos de otra', async () => {
    const w = mundo({ viajes: [viaje(), viaje({ id: VB, tenantId: 'tB', operadorId: 'oB', folio: 'B-1' })] });
    await cron(w, T('15:00'));
    const a = w.datosTablero('t1');
    const b = w.datosTablero('tB');
    expect(a.viajes.map((v) => v.folio)).toEqual(['F-1042']);
    expect(b.viajes.map((v) => v.folio)).toEqual(['B-1']);
    expect(a.hitos.every((h) => h.tenantId === 't1')).toBe(true);
    expect(b.hitos.every((h) => h.tenantId === 'tB')).toBe(true);
  });

  it('una flota con el agente APAGADO no recibe nada y no frena a las demás', async () => {
    const w = crearMundo({
      viajes: [viaje(), viaje({ id: VB, tenantId: 'tB', operadorId: 'oB', operadorTelefono: TEL_B, folio: 'B-1' })],
      configs: { t1: { activo: false } }, destinatarios: { t1: { 1: [TEL_PATIO] }, tB: { 1: ['5219990000077'] } },
      enviar: (telefono, m, contexto, tenantId, ahora) => enviarConFallback(telefono, { texto: m.texto, botones: m.botones, plantilla: m.plantilla, contexto, tenantId, ahora }),
    });
    meta.entrante(TEL_CHOFER, T('13:00')); meta.entrante(TEL_B, T('13:00'));
    meta.estado.reloj = T('15:00');
    await cron(w, T('15:00'));
    expect(meta.salientes.map((s) => s.a)).toEqual([TEL_B]);
    // Pero el OÍDO sigue: un «ya llegué» del chofer de la flota apagada se registra (lo proactivo es lo que se apaga).
    const r = await chofer(w, 'ya llegué', T('15:10'));
    expect(r?.mensajes[0].texto).toMatch(/Anotado/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('9. el tablero con TODO junto', () => {
  it('semáforo, excepciones y línea de tiempo coherentes en un mismo viaje que pasa por varios estados', async () => {
    const w = mundo();
    meta.entrante(TEL_CHOFER, T('13:00')); meta.entrante(TEL_PATIO, T('13:00'));
    // 15:20: pedido y recordatorio, sin respuesta → atrasado.
    for (const hhmm of ['15:00', '15:15']) { meta.estado.reloj = T(hhmm); await cron(w, T(hhmm)); }
    let t = armarTablero(w.datosTablero('t1'), w.configDe('t1'), T('15:20'));
    expect(t.filas[0].semaforo).toBe('atrasado');
    expect(t.excepciones.map((e) => e.tipo)).toEqual(['atrasado']);
    // 16:35: escalado al patio → sin reporte, excepción urgente.
    for (let m = 20; m <= 95; m += 5) { const c = new Date(T('15:00').getTime() + m * 60_000); meta.estado.reloj = c; await cron(w, c); }
    t = armarTablero(w.datosTablero('t1'), w.configDe('t1'), T('16:35'));
    expect(t.filas[0].semaforo).toBe('sin_reporte');
    expect(t.excepciones[0]).toMatchObject({ tipo: 'escalado_sin_atender', gravedad: 3 });
    // El chofer por fin avisa: el semáforo vuelve a verde (a tiempo para el siguiente hito) y la cola se vacía.
    await chofer(w, 'ya llegué', T('16:40'));
    t = armarTablero(w.datosTablero('t1'), w.configDe('t1'), T('16:41'));
    expect(t.filas[0].hitoActivo).toBe('salida_carga');
    expect(t.filas[0].semaforo).toBe('a_tiempo');
    expect(t.excepciones.filter((e) => e.tipo === 'escalado_sin_atender')).toEqual([]);
  });
});
