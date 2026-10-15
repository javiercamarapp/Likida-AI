import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-34 — LA PRUEBA DE ACEPTACIÓN INTEGRADA DEL PILOTO, CON RELOJ SIMULADO Y TRES ZONAS.
//
// Gate de la fase B5: «un viaje importado de un fixture entra al motor solo si su operador es voluntario y genera
// hitos con reloj simulado». Aquí corre la cadena ENTERA, con el código de producción en cada eslabón:
//
//   archivo (citas SIN zona, despacho, tránsito) → `interpretarFilasViajes` → `importarViajes` (la compuerta de voluntarios,
//   `aceptar_viajes_importados`) → motor del cron (perfil `esenciales`) → detección por geocerca → «sin señal de vida» → baja de voluntario.
//
// La base es un doble en memoria que obedece las MISMAS reglas que las funciones SQL de la 0800 (las que solo Postgres demuestra
// viven en supabase/tests/0800_conductor_voluntarios.sql). El único doble de proveedor es WhatsApp (el selector REAL corre completo).
// Los datos son 100 % sintéticos: OPERADOR A..D, folios SIM-000N, coordenadas inventadas. Sin red.
//
// Las tres zonas: Matamoros ANTES del cambio de hora de EE. UU. (30-oct-2026, UTC-5), Matamoros DESPUÉS (2-nov-2026, UTC-6) y
// Ciudad de México (UTC-6 todo el año). La MISMA cita «07:00» del archivo es un instante UTC distinto en cada una.
//
// Lección «prueba verde con medida nula no cuenta»: cada bloque afirma conteos > 0 de lo que midió, no solo que no pasó nada.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// ── La base en memoria: operadores y viajes, con las reglas de la 0800 ──────────────────────────────────────────────
interface OperadorBd { id: string; tenant_id: string; nombre: string; telefono: string; agente_voluntario: boolean }
interface ViajeBd {
  id: string; tenant_id: string; folio: string; origen: string | null; destino: string | null; operador_id: string; estatus: string;
  aceptado_en: string | null; avisado_en: string | null; aceptado_origen: string | null;
  cita_origen_en: string | null; despacho_ref: string | null; transito_estado: string | null; transito_texto_origen: string | null;
}

const AHORA_IMPORTACION = '2026-10-29T18:00:00.000Z';
let operadoresBd: OperadorBd[] = [];
let viajesBd: ViajeBd[] = [];
let llamadasRpc: string[] = [];
let consecutivo = 0;

function rpc(nombre: string, args: Record<string, unknown> = {}) {
  llamadasRpc.push(nombre);
  if (nombre === 'aceptar_viajes_importados') {
    const ids = args.p_viaje_ids as string[];
    const ahora = (args.p_ahora as string | undefined) ?? AHORA_IMPORTACION;
    const voluntarios = new Set(operadoresBd.filter((o) => o.agente_voluntario).map((o) => o.id));
    // Misma regla que la función SQL: solo abiertos, sin aceptar, de la flota y de un voluntario.
    const tocados = viajesBd.filter((v) => ids.includes(v.id) && v.tenant_id === args.p_tenant && v.estatus === 'abierto' && v.aceptado_en === null && voluntarios.has(v.operador_id));
    for (const v of tocados) { v.avisado_en = v.avisado_en ?? ahora; v.aceptado_en = ahora; v.aceptado_origen = 'importacion'; }
    return Promise.resolve({ data: tocados.map((v) => ({ o_id: v.id })), error: null });
  }
  if (nombre === 'retirar_voluntario') {
    // Misma regla que la 0800: devuelve a «sin aceptar» los abiertos importados de ese operador y apaga la marca.
    const revertidos = viajesBd.filter((v) => v.tenant_id === args.p_tenant && v.operador_id === args.p_operador && v.estatus === 'abierto' && v.aceptado_origen === 'importacion');
    for (const v of revertidos) { v.avisado_en = v.avisado_en === v.aceptado_en ? null : v.avisado_en; v.aceptado_en = null; v.aceptado_origen = null; }
    const op = operadoresBd.find((o) => o.id === args.p_operador && o.tenant_id === args.p_tenant);
    if (op) op.agente_voluntario = false;
    return Promise.resolve({ data: revertidos.length, error: null });
  }
  return Promise.resolve({ data: null, error: null });
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (nombre: string, args?: Record<string, unknown>) => rpc(nombre, args),
    from: (tabla: string) => {
      if (tabla === 'operador' || tabla === 'unidad' || tabla === 'cliente') {
        const nodo: Record<string, unknown> = {};
        for (const m of ['eq', 'not', 'in', 'order', 'abortSignal', 'select']) nodo[m] = () => nodo;
        nodo.range = () => Promise.resolve({ data: [], error: null });
        return nodo;
      }
      return {
        select: () => {
          const nodo: Record<string, unknown> = {};
          let porFolio = false; let tenant = ''; let folios: string[] = [];
          for (const m of ['not', 'order', 'abortSignal']) nodo[m] = () => nodo;
          nodo.eq = (col: string, val: string) => { if (col === 'tenant_id') tenant = val; return nodo; };
          nodo.in = (col: string, val: string[]) => { if (col === 'folio') { porFolio = true; folios = val; } return nodo; };
          nodo.then = (res: (v: unknown) => unknown) => {
            const data = porFolio
              ? viajesBd.filter((v) => v.tenant_id === tenant && folios.includes(v.folio)).map((v) => ({ folio: v.folio }))
              : viajesBd.filter((v) => v.tenant_id === tenant && ['abierto', 'en_cuadre'].includes(v.estatus)).map((v) => ({ operador_id: v.operador_id }));
            return Promise.resolve({ data, error: null }).then(res);
          };
          return nodo;
        },
        upsert: (lote: Array<Record<string, unknown>>) => ({
          select: () => {
            const nuevos: ViajeBd[] = [];
            for (const f of lote) {
              if (viajesBd.some((v) => v.tenant_id === f.tenant_id && v.folio === f.folio)) continue; // viaje_folio_unico
              const v: ViajeBd = {
                id: `viaje-${++consecutivo}`, tenant_id: String(f.tenant_id), folio: String(f.folio),
                origen: (f.origen as string | null) ?? null, destino: (f.destino as string | null) ?? null,
                operador_id: String(f.operador_id), estatus: 'abierto', aceptado_en: null, avisado_en: null, aceptado_origen: null,
                cita_origen_en: (f.cita_origen_en as string | undefined) ?? null, despacho_ref: (f.despacho_ref as string | undefined) ?? null,
                transito_estado: (f.transito_estado as string | undefined) ?? null, transito_texto_origen: (f.transito_texto_origen as string | undefined) ?? null,
              };
              viajesBd.push(v); nuevos.push(v);
            }
            return Promise.resolve({ data: nuevos.map((v) => ({ id: v.id, folio: v.folio })), error: null });
          },
        }),
      };
    },
  }),
}));

// El amarre por nombre del importador, sobre los operadores de la base en memoria.
vi.mock('../crear_viaje_wa', () => ({
  elegirOperadorPorNombre: (_filas: unknown, texto: string) => {
    const o = operadoresBd.find((x) => x.nombre === texto);
    return o ? { operadorId: o.id } : null;
  },
  OperadorNombreAmbiguo: class OperadorNombreAmbiguo extends Error {},
}));

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

const { importarViajes, interpretarFilasViajes } = await import('../importar_viajes');
const { retirarVoluntario } = await import('./repo');
const { correrConductor } = await import('./ejecutor');
const { barridoCicloGps } = await import('./ciclo_gps');
const { barridoSenalVida } = await import('./senal_vida');
const { crearMundo } = await import('./mundo.fixture');
const { meta } = await import('./meta.fixture');
const { viajeBase } = await import('./memoria.fixture');
const { hitosDeSiembra } = await import('./perfil');
const { enviarConFallback } = await import('@/lib/meta/enviar_con_fallback');
type Mundo = ReturnType<typeof import('./mundo.fixture').crearMundo>;
type ViajeContexto = import('./repo').ViajeContexto;

// ── Las tres zonas ──────────────────────────────────────────────────────────────────────────────────────────────────
interface Caso { nombre: string; tenant: string; zona: string; dia: string; desfase: string }
const CASOS: Caso[] = [
  { nombre: 'Matamoros 30-oct-2026, antes del cambio de hora (UTC-5)', tenant: 't-mat', zona: 'America/Matamoros', dia: '2026-10-30', desfase: '-05:00' },
  { nombre: 'Matamoros 2-nov-2026, después del cambio de hora (UTC-6)', tenant: 't-mat', zona: 'America/Matamoros', dia: '2026-11-02', desfase: '-06:00' },
  { nombre: 'Ciudad de México 30-oct-2026 (UTC-6)', tenant: 't-cdmx', zona: 'America/Mexico_City', dia: '2026-10-30', desfase: '-06:00' },
];

const TEL = { A: '5219990000011', B: '5219990000012', C: '5219990000013', D: '5219990000014', terminal: '5219990000091', jefe: '5219990000092' };
const LETRAS = ['A', 'B', 'C', 'D'] as const;
type Letra = typeof LETRAS[number];
const VOLUNTARIOS: Letra[] = ['A', 'C'];

/** El sitio de carga sintético de cada viaje (uno por letra, lejos entre sí). */
const sitioDe = (tenant: string, l: Letra) => ({ tenantId: tenant, id: `sitio-${l}`, nombre: `PLANTA SINTETICA ${l}`, lat: 25.5 + LETRAS.indexOf(l) * 0.2, lng: -100.3, radioM: 300 });

type Muestra = { tenantId: string; unidadId: string; lat: number; lng: number; medidaEn: Date; fuente: 'gps' };

function sembrarOperadores(tenant: string): void {
  operadoresBd = LETRAS.map((l) => ({ id: `op-${l}`, tenant_id: tenant, nombre: `OPERADOR ${l}`, telefono: TEL[l], agente_voluntario: VOLUNTARIOS.includes(l) }));
}

/** El archivo del TMS: 4 viajes con cita de carga SIN zona (07:00 hora local de la flota), despacho y estado de tránsito. */
function archivoDelTms(dia: string): unknown[][] {
  const encabezado = ['folio', 'origen', 'destino', 'fecha inicio', 'operador', 'cita carga', 'despacho', 'estado transito'];
  const fila = (l: Letra, i: number) => [`SIM-000${i + 1}`, 'ORIGEN SINTETICO', 'DESTINO SINTETICO', dia, `OPERADOR ${l}`, `${dia} 07:00`, `dsp-${i + 1}00`, i % 2 === 0 ? 'EN RUTA' : 'PATIO SINTETICO'];
  return [encabezado, ...LETRAS.map(fila)];
}

interface Escenario {
  caso: Caso;
  w: Mundo;
  gps: Muestra[];
  /** Muestras del guion que aún no «han llegado»: entran al arreglo del mundo cuando el reloj las alcanza (no hay GPS del futuro). */
  pendientes: Muestra[];
  /** `hh:mm` local (o minutos desde la medianoche local del día del caso, con `dias` extra) → instante. */
  L: (hhmm: string | number, dias?: number) => Date;
  viajeDe: (l: Letra) => ViajeBd;
  ctx: (l: Letra) => ViajeContexto;
  salientes: Array<{ t: Date; a: string; tipo: string; cuerpo: string; botones: string[]; plantilla: string | null }>;
  paso: (t: Date) => Promise<{ solicitudes: number; recordatorios: number; escalaciones: number; avisosSenal: number; escalacionesSenal: number; detectados: number }>;
  barrer: (desde: string | number, hasta: string | number, dias?: number, cada?: number) => Promise<void>;
}

const aMinutos = (hhmm: string | number): number => {
  if (typeof hhmm === 'number') return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Importa el archivo de verdad (compuerta de voluntarios incluida) y monta el mundo del motor con SOLO lo que la base dejó. */
async function armar(caso: Caso, opciones: { salidaDeA?: string; sinGps?: boolean } = {}): Promise<Escenario> {
  sembrarOperadores(caso.tenant);
  const lectura = interpretarFilasViajes(archivoDelTms(caso.dia), { zona: caso.zona });
  expect(lectura.error).toBeUndefined();
  expect(lectura.viajes).toHaveLength(4);
  const r = await importarViajes(caso.tenant, lectura.viajes);
  expect(r.error).toBeUndefined();
  expect(r.creados).toBe(4);

  const base = new Date(`${caso.dia}T00:00:00${caso.desfase}`).getTime();
  const L = (hhmm: string | number, dias = 0): Date => new Date(base + (aMinutos(hhmm) + dias * 1440) * 60_000);
  const unidadDe = (l: Letra) => `u-${l}`;
  const opDe = (id: string) => operadoresBd.find((o) => o.id === id)!;

  const ctx = (l: Letra): ViajeContexto => {
    const v = viajesBd.find((x) => x.tenant_id === caso.tenant && x.operador_id === `op-${l}`)!;
    const o = opDe(v.operador_id);
    return viajeBase({
      id: v.id, tenantId: v.tenant_id, folio: v.folio, origen: v.origen, destino: v.destino, estatus: v.estatus,
      operadorId: v.operador_id, operadorNombre: o.nombre, operadorTelefono: o.telefono, unidadId: unidadDe(l),
      aceptadoEn: v.aceptado_en, aceptadoOrigen: v.aceptado_origen, citaOrigenEn: v.cita_origen_en, despachoRef: v.despacho_ref,
    });
  };

  const gps: Muestra[] = [];
  const w = crearMundo({
    viajes: LETRAS.map(ctx),
    configs: { [caso.tenant]: { perfilSeguimiento: 'esenciales', zonaHoraria: caso.zona, avisarSenalVida: true } },
    destinatarios: { [caso.tenant]: { 1: [TEL.terminal], 2: [TEL.jefe] } },
    sitios: Object.fromEntries(LETRAS.map((l) => [ctx(l).id, { carga: sitioDe(caso.tenant, l) }])),
    gps,
    enviar: (telefono, m, contexto, tenantId, ahora) => enviarConFallback(telefono, { texto: m.texto, botones: m.botones, plantilla: m.plantilla, contexto, tenantId, ahora }),
  });

  // La siembra por perfil, como la hace `sembrar_hitos_conductor` (0801): solo viajes ABIERTOS Y ACEPTADOS, y los hitos fuera del
  // perfil nacen omitidos con su motivo. El mundo por omisión siembra los cinco como `esperado`; aquí se aplica el perfil de la flota.
  const sembrados = new Set<string>();
  w.puertos.sembrar = async () => {
    let n = 0;
    for (const v of w.m.viajes.values()) {
      if (v.estatus !== 'abierto' || !v.aceptadoEn || sembrados.has(v.id)) continue;
      sembrados.add(v.id);
      w.m.sembrar(v.id);
      for (const siembra of hitosDeSiembra('esenciales')) {
        if (siembra.estado !== 'omitido') continue;
        const h = w.m.de(v.id).find((x) => x.tipo === siembra.tipo)!;
        w.m.hitos.set(h.id, { ...h, estado: 'omitido', omitidoMotivo: siembra.omitidoMotivo });
      }
      n++;
    }
    return n;
  };

  // El guion del GPS de A: dentro de su planta hasta `salidaDeA` (por omisión 08:50), sale y luego se calla.
  const salida = aMinutos(opciones.salidaDeA ?? '08:50');
  const sitioA = sitioDe(caso.tenant, 'A');
  const m = (min: number, dentro: boolean): Muestra => ({ tenantId: caso.tenant, unidadId: unidadDe('A'), lat: sitioA.lat + (dentro ? 0.001 : 0.03), lng: sitioA.lng, medidaEn: L(min), fuente: 'gps' });
  const pendientes: Muestra[] = [];
  if (!opciones.sinGps) {
    for (let min = salida - 60; min <= salida; min += 5) pendientes.push(m(min, true));
    pendientes.push(m(salida + 5, false), m(salida + 8, false)); // la ÚLTIMA muestra: de ahí en adelante, silencio
  }

  const salientes: Escenario['salientes'] = [];
  const paso: Escenario['paso'] = async (t) => {
    meta.estado.reloj = t;
    while (pendientes.length && pendientes[0].medidaEn.getTime() <= t.getTime()) gps.push(pendientes.shift()!);
    await w.puertos.sembrar(400);
    const c = await barridoCicloGps(w.puertosCiclo, t);
    const cron = await correrConductor(w.puertos, { ahora: t });
    const s = await barridoSenalVida(w.puertosSenal, t);
    return { solicitudes: cron.solicitudes, recordatorios: cron.recordatorios, escalaciones: cron.escalaciones, avisosSenal: s.avisosChofer, escalacionesSenal: s.escalaciones, detectados: c.detectados };
  };
  const barrer: Escenario['barrer'] = async (desde, hasta, dias = 0, cada = 5) => {
    for (let min = aMinutos(desde); min <= aMinutos(hasta) + dias * 1440; min += cada) {
      const t = L(min);
      const antes = meta.salientes.length;
      await paso(t);
      for (const s of meta.salientes.slice(antes)) salientes.push({ t, a: s.a, tipo: s.tipo, cuerpo: s.cuerpo, botones: s.botones, plantilla: s.plantilla });
    }
  };

  // Los choferes del piloto escribieron hace un rato: su ventana de 24 h está abierta.
  for (const l of VOLUNTARIOS) meta.entrante(TEL[l], L('05:00'));
  meta.entrante(TEL.terminal, L('05:00'));
  meta.entrante(TEL.jefe, L('05:00'));
  return { caso, w, gps, pendientes, L, viajeDe: (l) => viajesBd.find((x) => x.tenant_id === caso.tenant && x.operador_id === `op-${l}`)!, ctx, salientes, paso, barrer };
}

/** La hora LOCAL (0-23.99) de un instante en la zona del caso. */
function horaLocal(t: Date, zona: string): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: zona, hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(t);
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value ?? '0');
  return (g('hour') % 24) + g('minute') / 60;
}
const hhmmLocal = (t: Date, zona: string): string => new Intl.DateTimeFormat('es-MX', { timeZone: zona, hour12: false, hour: '2-digit', minute: '2-digit' }).format(t);

beforeEach(() => {
  meta.reiniciar();
  operadoresBd = []; viajesBd = []; llamadasRpc = []; consecutivo = 0;
});

// Nota (T-A5-34): bajo `esenciales`, `llegada_descarga` nace `omitido/fuera_de_perfil`; `enTransito` lo cuenta como «aún no llega»,
// por eso la señal de vida (aviso 1, aviso 2, terminal) sí corre en el piloto.

describe.each(CASOS)('piloto de voluntarios — $nombre', (caso) => {
  it('COMPUERTA: de 4 viajes importados solo los 2 de operadores voluntarios entran al motor, con la cita en el instante UTC de SU zona', async () => {
    const e = await armar(caso);

    // La base: aceptados SOLO los de voluntarios, por importación; el resto intacto.
    const aceptados = viajesBd.filter((v) => v.aceptado_en !== null).map((v) => v.folio).sort();
    expect(aceptados).toEqual(['SIM-0001', 'SIM-0003']);
    expect(viajesBd.filter((v) => v.aceptado_en !== null).every((v) => v.aceptado_origen === 'importacion')).toBe(true);
    for (const v of viajesBd.filter((x) => x.aceptado_en === null)) {
      expect(v.avisado_en).toBeNull();
      expect(v.aceptado_origen).toBeNull();
    }
    expect(llamadasRpc.filter((n) => n === 'aceptar_viajes_importados')).toHaveLength(1);

    // La cita «07:00» del archivo es hora LOCAL de la flota: el instante UTC cambia con el cambio de hora.
    const citaEsperada = new Date(`${caso.dia}T07:00:00${caso.desfase}`).toISOString();
    expect(viajesBd).toHaveLength(4);
    for (const v of viajesBd) expect(v.cita_origen_en).toBe(citaEsperada);
    expect(e.L('07:00').toISOString()).toBe(citaEsperada);
    // Despacho normalizado y estado de tránsito vocabulario cerrado (T-A5-13 / T-A5-20).
    expect(viajesBd.map((v) => v.despacho_ref)).toEqual(['DSP-100', 'DSP-200', 'DSP-300', 'DSP-400']);
    expect(viajesBd.map((v) => v.transito_estado)).toEqual(['en_ruta', 'en_patio', 'en_ruta', 'en_patio']);
    expect(e.ctx('A').despachoRef).toBe('DSP-100');

    // El motor: SOLO los dos voluntarios son viajes activos; sus hitos nacen por perfil (1 pendiente, 4 omitidos).
    await e.w.puertos.sembrar(400);
    const activos = (await e.w.puertos.viajesActivos(400)).map((v) => v.folio).sort();
    expect(activos).toEqual(['SIM-0001', 'SIM-0003']);
    for (const l of VOLUNTARIOS) {
      const hs = e.w.m.de(e.ctx(l).id);
      expect(hs.filter((h) => h.estado === 'esperado').map((h) => h.tipo)).toEqual(['salida_carga']);
      expect(hs.filter((h) => h.estado === 'omitido' && h.omitidoMotivo === 'fuera_de_perfil')).toHaveLength(4);
    }
    // Los no voluntarios no tienen ni un hito sembrado: el motor no sabe que existen.
    for (const l of ['B', 'D'] as const) expect(e.w.m.de(e.ctx(l).id)).toHaveLength(0);
  });

  it('PERFIL ESENCIALES: un solo aviso de «salida de carga» por viaje, en el instante local exacto (cita 07:00 + 120 min = 09:00), y nada antes', async () => {
    const e = await armar(caso, { sinGps: true });
    await e.barrer('06:00', '09:10');

    const avisos = e.salientes;
    // Medida NO nula: hubo mensajes, exactamente uno por voluntario, ninguno a un no voluntario.
    expect(avisos).toHaveLength(2);
    expect(avisos.map((a) => a.a).sort()).toEqual([TEL.A, TEL.C].sort());
    for (const a of avisos) {
      expect(hhmmLocal(a.t, caso.zona)).toBe('09:00');
      expect(a.t.toISOString()).toBe(e.L('09:00').toISOString());
      expect(a.tipo).toBe('botones');
      expect(a.botones).toEqual([expect.stringMatching(/^hito_salida_carga:/), expect.stringMatching(/^sigue_cargando:|^hito_sigue_cargando:|sigue/)]);
      expect(a.cuerpo).toMatch(/¿ya saliste de la carga/);
    }
    // Ningún aviso de llegada: ese hito no se sigue bajo el perfil.
    expect(meta.salientes.some((s) => /llegada/.test(s.botones.join(',')))).toBe(false);
    // 08:59 todavía nada y 09:05 / 09:10 no repiten: el siguiente escalón de la escalera es a los +15.
    expect(avisos.filter((a) => a.t.getTime() < e.L('09:00').getTime())).toHaveLength(0);
    // Los no voluntarios no recibieron nada en toda la mañana.
    expect(meta.salientes.some((s) => s.a === TEL.B || s.a === TEL.D)).toBe(false);
  });

  it('GPS: el cruce de la salida de A registra el hito `sistema` validado a la hora de la MUESTRA, y entonces el cron ya no le pregunta a A (sí a C)', async () => {
    const e = await armar(caso);
    await e.barrer('06:00', '09:10');

    const hitoA = e.w.m.de(e.ctx('A').id).find((h) => h.tipo === 'salida_carga')!;
    expect(hitoA).toMatchObject({ estado: 'validado', fuente: 'sistema', validadoPor: 'gps' });
    expect(hitoA.mensajeEn).toBe(e.L('08:55').toISOString());
    expect(hitoA.validadoEn).not.toBeNull();
    // Sólo C recibió la solicitud de las 09:00; A (que ya salió) no.
    expect(e.salientes.map((s) => s.a)).toEqual([TEL.C]);
    expect(hhmmLocal(e.salientes[0].t, caso.zona)).toBe('09:00');
    // C sigue pendiente, y los hitos de B y D ni existen.
    expect(e.w.m.de(e.ctx('C').id).find((h) => h.tipo === 'salida_carga')!.estado).toBe('esperado');
    expect(e.w.m.de(e.ctx('B').id)).toHaveLength(0);
  });

  it('SIN SEÑAL DE VIDA: GPS mudo > 45 min → aviso 1; +20 → aviso 2; +20 → escala al contacto de la terminal; y se queda ahí', async () => {
    const e = await armar(caso);
    await e.barrer('06:00', '11:30');

    // La última muestra de A fue a las 08:58. A las 09:40 son 42 min (no toca); a las 09:45, 47 min.
    const delChofer = e.salientes.filter((s) => s.a === TEL.A);
    const delTerminal = e.salientes.filter((s) => s.a === TEL.terminal && /señal de vida/i.test(s.cuerpo));
    expect(delChofer).toHaveLength(2);
    expect(delTerminal).toHaveLength(1);
    expect(hhmmLocal(delChofer[0].t, caso.zona)).toBe('09:45');
    expect(delChofer[0].botones.some((b) => b.startsWith('senal_vida_estoy:'))).toBe(true);
    expect(hhmmLocal(delChofer[1].t, caso.zona)).toBe('10:05');
    expect(delChofer[1].cuerpo).toMatch(/segundo aviso/);
    expect(hhmmLocal(delTerminal[0].t, caso.zona)).toBe('10:25');
    expect(delTerminal[0].botones.some((b) => b.startsWith('jefe_atiendo:'))).toBe(true);
    expect(delTerminal[0].cuerpo).toMatch(/no hay señal de vida de OPERADOR A/);
    // Y no se insiste después: hasta las 11:30 no hay más mensajes de señal de vida.
    expect(e.salientes.filter((s) => s.t.getTime() > e.L('10:25').getTime() && /señal/i.test(s.cuerpo))).toHaveLength(0);
  });

  it('BAJA A MEDIA CORRIDA: retirar a A (voluntario) tras el aviso 2 deja de perseguirlo — no se escala, y C sigue en el motor', async () => {
    const e = await armar(caso);
    await e.barrer('06:00', '10:05');
    expect(e.salientes.filter((s) => s.a === TEL.A)).toHaveLength(2);
    const antes = e.salientes.length;

    // La oficina retira a A del piloto (código de producción `retirarVoluntario` → la función atómica de la 0800).
    const dejados = await retirarVoluntario(caso.tenant, 'op-A');
    expect(dejados).toBe(1);
    expect(operadoresBd.find((o) => o.id === 'op-A')!.agente_voluntario).toBe(false);
    const filaA = e.viajeDe('A');
    expect(filaA).toMatchObject({ aceptado_en: null, aceptado_origen: null });
    // El viaje de C no se toca.
    expect(e.viajeDe('C').aceptado_origen).toBe('importacion');
    // El motor lee la base: el viaje de A vuelve a «sin aceptar» y deja de ser un viaje activo.
    e.w.m.viajes.set(e.ctx('A').id, e.ctx('A'));
    expect((await e.w.puertos.viajesActivos(400)).map((v) => v.folio)).toEqual(['SIM-0003']);

    await e.barrer('10:10', '12:00');
    // Ni la escalación a la terminal por la señal de vida de A, ni un aviso más a A.
    const despues = e.salientes.slice(antes);
    expect(despues.some((s) => s.a === TEL.A)).toBe(false);
    expect(despues.some((s) => s.a === TEL.terminal && /OPERADOR A/.test(s.cuerpo))).toBe(false);
    // Medida NO nula: el motor siguió trabajando para C en el mismo tramo (su escalera y su escalación al patio).
    expect(despues.filter((s) => s.a === TEL.terminal && /OPERADOR C/.test(s.cuerpo))).toHaveLength(1);
    expect(despues.filter((s) => s.a === TEL.jefe)).toHaveLength(1);
    expect(despues.some((s) => /OPERADOR A/.test(s.cuerpo))).toBe(false);
  });

  it('VENTANA: de 06:00 a 07:00 del día siguiente NINGÚN mensaje sale fuera de 06:00–22:00 de la zona de la flota, y lo que cae de noche espera a la apertura', async () => {
    // A sale a las 21:00 locales (su última muestra a las 21:08): el aviso 1 de la señal de vida toca a las 21:55,
    // el aviso 2 le toca a las 22:15 — fuera de ventana — y debe esperar a las 06:00; la escalación, 20 min después.
    const e = await armar(caso, { salidaDeA: '21:00' });
    await e.barrer('06:00', '07:00', 1);

    // Medida NO nula: hubo mensajes de día y de la mañana siguiente.
    expect(e.salientes.length).toBeGreaterThan(5);
    for (const s of e.salientes) {
      const h = horaLocal(s.t, caso.zona);
      expect(h, `mensaje a ${s.a} a las ${hhmmLocal(s.t, caso.zona)} locales`).toBeGreaterThanOrEqual(6);
      expect(h, `mensaje a ${s.a} a las ${hhmmLocal(s.t, caso.zona)} locales`).toBeLessThan(22);
    }
    // (A también recibió, de día, la escalera de «salida de carga»: aquí solo cuentan los avisos de señal de vida.)
    const deNoche = e.salientes.filter((s) => s.t.getTime() >= e.L('21:30').getTime());
    const deA = deNoche.filter((s) => s.a === TEL.A);
    expect(deA).toHaveLength(2);
    expect(hhmmLocal(deA[0].t, caso.zona)).toBe('21:55');
    expect(deA[1].t.toISOString()).toBe(e.L('06:00', 1).toISOString());   // el aviso 2 esperó la apertura de la ventana
    const aTerminal = deNoche.filter((s) => s.a === TEL.terminal);
    expect(aTerminal).toHaveLength(1);
    expect(aTerminal[0].t.toISOString()).toBe(e.L('06:20', 1).toISOString());
  });
});

describe('piloto de voluntarios — lo que cruza zonas', () => {
  it('el MISMO archivo («07:00» sin zona) da citas y avisos distintos en Matamoros antes y después del cambio de hora, y en CDMX', async () => {
    const instantes: Record<string, string> = {};
    for (const caso of CASOS) {
      meta.reiniciar(); operadoresBd = []; viajesBd = []; consecutivo = 0;
      const e = await armar(caso);
      await e.barrer('06:00', '09:05');
      const primero = e.salientes[0];
      expect(primero, `sin avisos en ${caso.nombre}`).toBeDefined();
      instantes[caso.nombre] = primero.t.toISOString();
    }
    // 09:00 hora local = 14:00Z en Matamoros (UTC-5), 15:00Z en Matamoros tras el cambio (UTC-6) y 15:00Z en CDMX.
    expect(instantes[CASOS[0].nombre]).toBe('2026-10-30T14:00:00.000Z');
    expect(instantes[CASOS[1].nombre]).toBe('2026-11-02T15:00:00.000Z');
    expect(instantes[CASOS[2].nombre]).toBe('2026-10-30T15:00:00.000Z');
  });

  it('un archivo con cita pero sin la zona de la flota declarada no se inventa una: la cita se lee en la zona por omisión y el instante lo dice', async () => {
    // Guardia de contrato: la lectura de citas depende de `zona`. Sin ella, la de México; con Matamoros el mismo texto es OTRO instante.
    const sinZona = interpretarFilasViajes(archivoDelTms('2026-10-30'));
    const conZona = interpretarFilasViajes(archivoDelTms('2026-10-30'), { zona: 'America/Matamoros' });
    expect(sinZona.viajes[0].citaOrigen).toBe('2026-10-30T13:00:00.000Z');
    expect(conZona.viajes[0].citaOrigen).toBe('2026-10-30T12:00:00.000Z');
  });

  it('reimportar el mismo archivo no vuelve a aceptar nada ni re-persigue a quien se retiró', async () => {
    const caso = CASOS[0];
    const e = await armar(caso);
    await retirarVoluntario(caso.tenant, 'op-A');
    const antes = JSON.stringify(viajesBd);
    const r2 = await importarViajes(caso.tenant, interpretarFilasViajes(archivoDelTms(caso.dia), { zona: caso.zona }).viajes);
    expect(r2.creados).toBe(0);
    expect(r2.saltados).toHaveLength(4);
    expect(JSON.stringify(viajesBd)).toBe(antes);
    expect(e.viajeDe('A').aceptado_en).toBeNull();
    expect(e.viajeDe('C').aceptado_en).not.toBeNull();
  });
});
