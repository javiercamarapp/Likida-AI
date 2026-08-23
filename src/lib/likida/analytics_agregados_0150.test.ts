import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectarDuplicadosEntreViajes } from './duplicados';
import { rpcFalso0150, type Tablas, type Fila } from './analytics_rpc_0150.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// ESCALA 50k (mig. 0150, 22-ago-2026): ONCE reducciones de analytics.ts
// pasaron de "traerTodo → agregar en JS" a RPC en SQL. Este archivo es la
// PRUEBA DE EQUIVALENCIA obligatoria (REGLAS-ESCALA §2), una por función:
//
//   la reducción JS VIEJA (copia congelada de analytics.ts antes de la 0150,
//   `legacy*` aquí) contra la función NUEVA con la RPC mockeada por el
//   reductor SQL escrito de forma independiente (`analytics_rpc_0150.
//   fixture.ts`), sobre el MISMO dataset sintético de DOS flotas — con
//   los bordes que motivaron cada regla: concepto nulo, folio vacío, CFDI
//   consolidado con `cfdi_orden`, el folio que ES un UUID, cierres de las
//   20:00 CDMX (día siguiente en UTC), viajes sin fecha, operador con
//   oposición, `diferencias` con tipo ausente.
//
// Y fail-closed: error o forma inesperada de CADA RPC → LANZA (nunca `?? 0`).
// ═══════════════════════════════════════════════════════════════════════════

const TZ_MX = 'America/Mexico_City';
const round2 = (n: number) => Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
const hoyMxDe = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ_MX, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// ── Dataset sintético, determinista ────────────────────────────────────────
function lcg(semilla: number) { let s = semilla; return () => (s = (s * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648; }

function dataset(): Tablas {
  const rnd = lcg(7);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const t: Tablas = { operador: [], viaje: [], gasto: [], liquidacion: [], cfdi_consolidado_linea: [] };
  const ciudades = ['CDMX', 'Guadalajara, Jal.', 'Monterrey', 'Pueblo Chico', '', null];
  for (const tenant of ['A', 'B']) {
    for (let o = 0; o < 4; o++) {
      t.operador.push({
        tenant_id: tenant, id: `${tenant}-o${o}`, nombre: `Op ${tenant}${o}`, telefono: `55${o}`,
        numero_empleado: o % 2 ? `E${o}` : null, activo: o !== 3, rfc: o === 1 ? 'XAXX010101000' : null,
        licencia: o === 2 ? 'LIC-1' : null, licencia_tipo: o === 2 ? 'E' : null, licencia_vence: o === 2 ? '2027-01-31' : null,
        oposicion_automatizada: o === 3 ? '2026-08-01T00:00:00Z' : null,
      });
    }
    for (let v = 0; v < 60; v++) {
      const dia = 1 + Math.floor(rnd() * 28);
      const mes = pick(['05', '06', '07', '08']);
      t.viaje.push({
        tenant_id: tenant, id: `${tenant}-v${String(v).padStart(3, '0')}`, operador_id: `${tenant}-o${v % 4}`,
        origen: pick(ciudades), destino: pick(ciudades), anticipo: Math.round(rnd() * 9000) + 100,
        fecha_inicio: v % 9 === 0 ? null : `2026-${mes}-${String(dia).padStart(2, '0')}`,
        estatus: v % 3 === 0 ? 'liquidado' : 'abierto',
      });
    }
    let g = 0;
    const push = (f: Fila) => t.gasto.push({ tenant_id: tenant, id: `${tenant}-g${String(g++).padStart(4, '0')}`, ...f });
    for (let i = 0; i < 400; i++) {
      push({
        viaje_id: `${tenant}-v${String(Math.floor(rnd() * 60)).padStart(3, '0')}`,
        concepto: pick(['diesel', 'diesel', 'caseta', 'alimentacion', 'hospedaje', 'viaticos', null]),
        monto: Math.round(rnd() * 300000) / 100,
        fecha: `2026-${pick(['06', '07', '08'])}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`,
        folio: rnd() < 0.6 ? `F-${Math.floor(rnd() * 80)}` : (rnd() < 0.5 ? '' : null),
        cfdi_uuid: rnd() < 0.25 ? `${tenant.toLowerCase()}${String(Math.floor(rnd() * 30)).padStart(3, '0')}-UUID-0000-0000-000000000000` : null,
        cfdi_orden: 1,
      });
    }
    // Bordes a propósito:
    // · mismo CFDI, orden 1, en dos viajes → cfdi_duplicado
    push({ viaje_id: `${tenant}-v001`, concepto: 'caseta', monto: 120, fecha: '2026-08-03', folio: 'X1', cfdi_uuid: `${tenant}DUP-0000-0000-0000-000000000001`, cfdi_orden: 1 });
    push({ viaje_id: `${tenant}-v002`, concepto: 'caseta', monto: 120, fecha: '2026-08-03', folio: 'X1', cfdi_uuid: `${tenant}dup-0000-0000-0000-000000000001`, cfdi_orden: 1 });
    // · consolidado: mismo UUID, partidas 1..3 en tres viajes → NO es duplicado (A5)
    for (let k = 1; k <= 3; k++) push({ viaje_id: `${tenant}-v00${k + 2}`, concepto: 'caseta', monto: 90, fecha: '2026-08-04', folio: null, cfdi_uuid: `${tenant}CONS-0000-0000-0000-000000000002`, cfdi_orden: k });
    // · partida 2 del consolidado repetida en otro viaje → cfdi_duplicado "(partida 2)"
    push({ viaje_id: `${tenant}-v010`, concepto: 'caseta', monto: 90, fecha: '2026-08-04', folio: null, cfdi_uuid: `${tenant}CONS-0000-0000-0000-000000000002`, cfdi_orden: 2 });
    // · mismo folio+concepto+monto sin UUID en dos viajes → folio_duplicado
    push({ viaje_id: `${tenant}-v011`, concepto: 'Diesel', monto: 1500.5, fecha: '2026-08-05', folio: 'A-991', cfdi_uuid: null, cfdi_orden: 1 });
    push({ viaje_id: `${tenant}-v012`, concepto: 'diesel', monto: 1500.5, fecha: '2026-08-05', folio: 'A-991', cfdi_uuid: '', cfdi_orden: 1 });
    // · mismo folio pero distinto monto → NO es duplicado
    push({ viaje_id: `${tenant}-v013`, concepto: 'diesel', monto: 1500.51, fecha: '2026-08-05', folio: 'A-991', cfdi_uuid: null, cfdi_orden: 1 });
    // · el folio impreso ES un UUID ya reportado → se calla (no se cuenta dos veces)
    push({ viaje_id: `${tenant}-v014`, concepto: 'caseta', monto: 120, fecha: '2026-08-06', folio: `${tenant}DUP-0000-0000-0000-000000000001`, cfdi_uuid: null, cfdi_orden: 1 });
    push({ viaje_id: `${tenant}-v015`, concepto: 'caseta', monto: 120, fecha: '2026-08-06', folio: `${tenant}DUP-0000-0000-0000-000000000001`, cfdi_uuid: null, cfdi_orden: 1 });
    // · concepto nulo con folio repetido → cae en 'otro'
    push({ viaje_id: `${tenant}-v016`, concepto: null, monto: 77, fecha: '2026-08-07', folio: 'NUL-1', cfdi_uuid: null, cfdi_orden: 1 });
    push({ viaje_id: `${tenant}-v017`, concepto: null, monto: 77, fecha: '2026-08-07', folio: 'NUL-1', cfdi_uuid: null, cfdi_orden: 1 });

    for (let v = 0; v < 60; v += 2) {
      const hora = pick(['02:00:00', '16:00:00', '23:30:00', '05:59:59']);
      t.liquidacion.push({
        tenant_id: tenant, id: `${tenant}-l${v}`, viaje_id: `${tenant}-v${String(v).padStart(3, '0')}`,
        created_at: `2026-${pick(['06', '07', '08'])}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}T${hora}.000000+00:00`,
        total_comprobado: Math.round(rnd() * 800000) / 100,
        diferencia: pick([0, 0.005, -150.25, 200, 0.01]),
        diferencias: pick([
          null, [],
          [{ tipo: 'sobre_politica', monto: -120.5 }, { tipo: 'duplicado', monto: 80 }],
          [{ tipo: 'fecha_sospechosa', monto: 0 }, { monto: 33 }],
        ]),
      });
    }
    for (let i = 0; i < 25; i++) {
      t.cfdi_consolidado_linea.push({ tenant_id: tenant, id: `${tenant}-c${i}`, cfdi_xml_id: `${tenant}-x${i % 4}`, estatus: pick(['conciliada', 'por_conciliar', 'sin_match']) });
    }
  }
  return t;
}

// ── Las reducciones JS VIEJAS (copias congeladas de analytics.ts pre-0150) ──
// `traerTodo` ordenaba por `id`; aquí se reproduce ese orden.
const del = (t: Tablas, tabla: string, tenant: string) =>
  (t[tabla] ?? []).filter((f) => f.tenant_id === tenant).sort((a, b) => String(a.id).localeCompare(String(b.id)));

function legacyDetectarAnomalias(t: Tablas, tenant: string) {
  return detectarDuplicadosEntreViajes(del(t, 'gasto', tenant).map((r) => ({
    viajeId: r.viaje_id as string,
    concepto: (r.concepto as string) ?? 'otro',
    monto: Number(r.monto),
    folio: (r.folio as string) || undefined,
    cfdiUuid: (r.cfdi_uuid as string) || undefined,
    cfdiOrden: typeof r.cfdi_orden === 'number' ? r.cfdi_orden : null,
  })));
}

function semanaIso(fechaIso: string): { anio: number; semana: number } {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const inicioAnio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioAnio.getTime()) / 86_400_000 + 1) / 7);
  return { anio: d.getUTCFullYear(), semana };
}
function ultimasSemanas(semanas: number, hoy: string) {
  const out: Array<{ anio: number; semana: number; etiqueta: string }> = [];
  const cursor = new Date(`${hoy}T00:00:00Z`);
  for (let i = semanas - 1; i >= 0; i--) {
    const d = new Date(cursor);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const { anio, semana } = semanaIso(d.toISOString().slice(0, 10));
    out.push({ anio, semana, etiqueta: `${anio}-S${String(semana).padStart(2, '0')}` });
  }
  return out;
}

function legacyGastoPorSemana(t: Tablas, tenant: string, semanas: number, hoy: string) {
  const bloques = ultimasSemanas(semanas, hoy);
  const desdeGlobal = new Date(`${hoy}T00:00:00Z`);
  desdeGlobal.setUTCDate(desdeGlobal.getUTCDate() - (semanas * 7 - 1));
  const desde = desdeGlobal.toISOString().slice(0, 10);
  const filas = del(t, 'gasto', tenant).filter((g) => (g.fecha as string) >= desde && (g.fecha as string) <= hoy);
  const totalPorConcepto = new Map<string, number>();
  const porSemanaConcepto = new Map<string, number>();
  for (const f of filas) {
    const { anio, semana } = semanaIso(f.fecha as string);
    const concepto = (f.concepto as string) ?? 'otro';
    const monto = Number(f.monto ?? 0);
    totalPorConcepto.set(concepto, (totalPorConcepto.get(concepto) ?? 0) + monto);
    const k = `${anio}-${semana}-${concepto}`;
    porSemanaConcepto.set(k, (porSemanaConcepto.get(k) ?? 0) + monto);
  }
  const top3 = [...totalPorConcepto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
  return {
    categorias: bloques.map((b) => b.etiqueta),
    series: top3.map((concepto) => ({
      nombre: concepto,
      valores: bloques.map((b) => round2(porSemanaConcepto.get(`${b.anio}-${b.semana}-${concepto}`) ?? 0)),
    })),
  };
}

function legacyLiquidadoPorSemana(t: Tablas, tenant: string, semanas: number, hoy: string) {
  const bloques = ultimasSemanas(semanas, hoy);
  const desdeGlobal = new Date(`${hoy}T00:00:00Z`);
  desdeGlobal.setUTCDate(desdeGlobal.getUTCDate() - (semanas * 7 - 1));
  const corte = Date.parse(`${desdeGlobal.toISOString().slice(0, 10)}T00:00:00Z`);
  const filas = del(t, 'liquidacion', tenant).filter((l) => Date.parse(l.created_at as string) >= corte);
  const porSemana = new Map<string, number>();
  for (const f of filas) {
    const { anio, semana } = semanaIso(hoyMxDe(new Date(f.created_at as string)));
    const k = `${anio}-${semana}`;
    porSemana.set(k, (porSemana.get(k) ?? 0) + Number(f.total_comprobado ?? 0));
  }
  return bloques.map((b) => ({ dia: b.etiqueta, valor: round2(porSemana.get(`${b.anio}-${b.semana}`) ?? 0) }));
}

function legacyViajesPorMes(t: Tablas, tenant: string) {
  const porMes = new Map<string, number>();
  for (const r of del(t, 'viaje', tenant).filter((v) => v.fecha_inicio !== null)) {
    const mes = (r.fecha_inicio as string).slice(0, 7);
    porMes.set(mes, (porMes.get(mes) ?? 0) + 1);
  }
  return Array.from(porMes.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([dia, valor]) => ({ dia, valor }));
}

function legacyGastoPorConcepto(t: Tablas, tenant: string) {
  const mapa = new Map<string, { n: number; total: number }>();
  for (const f of del(t, 'gasto', tenant)) {
    const k = (f.concepto as string) ?? 'otro';
    const v = mapa.get(k) ?? { n: 0, total: 0 };
    v.n += 1; v.total += Number(f.monto ?? 0);
    mapa.set(k, v);
  }
  return [...mapa.entries()].map(([concepto, v]) => ({ concepto, n: v.n, total: round2(v.total) })).sort((a, b) => b.total - a.total);
}

function legacyTopRutas(t: Tablas, tenant: string, top: number, ventana?: { desde: string; hasta: string }) {
  const gastos = del(t, 'gasto', tenant).filter((g) => !ventana || ((g.fecha as string) >= ventana.desde && (g.fecha as string) <= ventana.hasta));
  const viajePorId = new Map(del(t, 'viaje', tenant).map((v) => [v.id as string, v]));
  const mapa = new Map<string, { origen: string; destino: string; total: number }>();
  for (const g of gastos) {
    const v = viajePorId.get(g.viaje_id as string);
    if (!v) continue;
    const origen = (v.origen as string) || '—';
    const destino = (v.destino as string) || '—';
    const clave = `${origen}→${destino}`;
    const prev = mapa.get(clave) ?? { origen, destino, total: 0 };
    prev.total += Number(g.monto ?? 0);
    mapa.set(clave, prev);
  }
  const ordenado = [...mapa.values()].sort((a, b) => b.total - a.total).slice(0, top);
  const sumaTop = ordenado.reduce((s, r) => s + r.total, 0) || 1;
  return ordenado.map((r) => ({ origen: r.origen, destino: r.destino, total: round2(r.total), pct: round2((r.total / sumaTop) * 100) }));
}

function legacyStatsPorOperador(t: Tablas, tenant: string) {
  const ops = del(t, 'operador', tenant);
  const gastos = del(t, 'gasto', tenant).filter((g) => g.concepto === 'diesel');
  const viajes = del(t, 'viaje', tenant);
  const liqs = del(t, 'liquidacion', tenant);
  const viajeToOp = new Map(viajes.map((v) => [v.id as string, v.operador_id as string]));
  const dieselPorOp = new Map<string, number>();
  const viajesPorOp = new Map<string, Set<string>>();
  for (const gr of gastos) {
    const op = viajeToOp.get(gr.viaje_id as string);
    if (!op) continue;
    dieselPorOp.set(op, (dieselPorOp.get(op) ?? 0) + Number(gr.monto));
    if (!viajesPorOp.has(op)) viajesPorOp.set(op, new Set());
    viajesPorOp.get(op)!.add(gr.viaje_id as string);
  }
  const diferenciasPorOp = new Map<string, number>();
  for (const l of liqs) {
    const op = viajeToOp.get(l.viaje_id as string);
    if (!op) continue;
    if (Math.abs(Number(l.diferencia ?? 0)) < 0.01) continue;
    diferenciasPorOp.set(op, (diferenciasPorOp.get(op) ?? 0) + 1);
  }
  return ops.filter((o) => o.oposicion_automatizada == null).map((o) => ({
    operadorId: o.id as string,
    nombre: o.nombre as string,
    viajes: viajesPorOp.get(o.id as string)?.size ?? 0,
    dieselTotal: round2(dieselPorOp.get(o.id as string) ?? 0),
    diferencias: diferenciasPorOp.get(o.id as string) ?? 0,
  }));
}

function legacyOperadoresDetalle(t: Tablas, tenant: string) {
  const comprobadoPorViaje = new Map<string, number>();
  for (const l of del(t, 'liquidacion', tenant)) {
    const k = l.viaje_id as string;
    comprobadoPorViaje.set(k, (comprobadoPorViaje.get(k) ?? 0) + Number(l.total_comprobado ?? 0));
  }
  const acum = new Map<string, { viajes: number; anticipo: number; comprobado: number }>();
  for (const v of del(t, 'viaje', tenant)) {
    const op = v.operador_id as string;
    const a = acum.get(op) ?? { viajes: 0, anticipo: 0, comprobado: 0 };
    a.viajes += 1;
    a.anticipo += Number(v.anticipo ?? 0);
    a.comprobado += comprobadoPorViaje.get(v.id as string) ?? 0;
    acum.set(op, a);
  }
  return del(t, 'operador', tenant).map((o) => {
    const a = acum.get(o.id as string) ?? { viajes: 0, anticipo: 0, comprobado: 0 };
    return {
      operadorId: o.id as string, nombre: o.nombre as string,
      telefono: (o.telefono as string) || null, numeroEmpleado: (o.numero_empleado as string) || null,
      rfc: (o.rfc as string | null) ?? null, activo: Boolean(o.activo),
      viajes: a.viajes, anticipoTotal: round2(a.anticipo), comprobadoTotal: round2(a.comprobado),
      pctComprobado: a.anticipo > 0 ? Math.round((a.comprobado / a.anticipo) * 100) : null,
      licencia: (o.licencia as string) || null, licenciaTipo: (o.licencia_tipo as string) || null,
      licenciaVence: (o.licencia_vence as string) || null,
    };
  }).sort((x, y) => y.viajes - x.viajes);
}

function legacyDineroObservadoPorTipo(t: Tablas, tenant: string) {
  const acumulado = new Map<string, { monto: number; n: number }>();
  for (const r of del(t, 'liquidacion', tenant)) {
    for (const d of ((r.diferencias as Array<{ tipo?: unknown; monto?: unknown }>) ?? [])) {
      const tipo = typeof d.tipo === 'string' ? d.tipo : 'otro';
      const prev = acumulado.get(tipo) ?? { monto: 0, n: 0 };
      prev.monto += Math.abs(Number(d.monto ?? 0));
      prev.n += 1;
      acumulado.set(tipo, prev);
    }
  }
  return [...acumulado.entries()].map(([tipo, v]) => ({ tipo, monto: v.monto, n: v.n })).sort((a, b) => b.monto - a.monto);
}

function legacyLiquidacionesPorDia(t: Tablas, tenant: string, ventanaDias: number, hoy: string) {
  const corteViejo = new Date(`${hoy}T00:00:00Z`);
  corteViejo.setUTCDate(corteViejo.getUTCDate() - (ventanaDias - 1));
  const corte = Date.parse(`${corteViejo.toISOString().slice(0, 10)}T00:00:00Z`);
  const porDiaMap = new Map<string, number>();
  for (const r of del(t, 'liquidacion', tenant).filter((l) => Date.parse(l.created_at as string) >= corte)) {
    const dia = hoyMxDe(new Date(r.created_at as string));
    porDiaMap.set(dia, (porDiaMap.get(dia) ?? 0) + 1);
  }
  const cortes = (diasAtras: number) => { const d = new Date(`${hoy}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - diasAtras); return d.toISOString().slice(0, 10); };
  return Array.from({ length: ventanaDias }, (_, i) => { const dia = cortes(ventanaDias - 1 - i); return { dia, valor: porDiaMap.get(dia) ?? 0 }; });
}

function legacyConciliacion(t: Tablas, tenant: string) {
  const filas = del(t, 'cfdi_consolidado_linea', tenant);
  if (filas.length === 0) return null;
  const conciliadas = filas.filter((f) => f.estatus === 'conciliada').length;
  const sinMatch = filas.filter((f) => f.estatus === 'sin_match').length;
  const cfdis = new Set(filas.map((f) => f.cfdi_xml_id as string)).size;
  return { conciliadas, porConciliar: filas.length - conciliadas - sinMatch, sinMatch, cfdis };
}

// ── El mock: el Postgres falso de la 0150, o una respuesta forzada ──────────
let TABLAS: Tablas = {};
let forzada: { data: unknown; error: { message: string } | null } | null = null;
const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args });
      return Promise.resolve(forzada ?? rpcFalso0150(fn, args, TABLAS) ?? { data: null, error: null });
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const A = await import('./analytics');
const HOY = '2026-08-22';

beforeEach(() => { TABLAS = dataset(); forzada = null; llamadas.length = 0; });

/** Ordena por llaves para comparar conjuntos cuyo desempate SQL (orden by
 *  … , concepto) puede diferir del orden de inserción del Map de JS en un
 *  empate EXACTO de totales — las cifras son las mismas. */
const porLlave = <T,>(xs: T[], llave: (x: T) => string) => [...xs].sort((a, b) => llave(a).localeCompare(llave(b)));

describe('EQUIVALENCIA — reducción JS vieja vs RPC de la 0150, mismo dataset, dos flotas', () => {
  for (const tenant of ['A', 'B']) {
    describe(`flota ${tenant}`, () => {
      it('detectarAnomalias ≡ detectarDuplicadosEntreViajes sobre las filas (orden incluido)', async () => {
        const viejo = legacyDetectarAnomalias(TABLAS, tenant);
        const nuevo = await A.detectarAnomalias(tenant);
        expect(viejo.length).toBeGreaterThanOrEqual(3); // hay cfdi, partida y folio sembrados
        expect(nuevo).toEqual(viejo);
        expect(nuevo.some((a) => a.detalle.includes('(partida 2)'))).toBe(true);
        expect(nuevo.some((a) => a.tipo === 'folio_duplicado' && a.detalle.includes('(otro)'))).toBe(true);
        // El folio que ES un UUID ya reportado no se cuenta dos veces
        expect(nuevo.filter((a) => a.detalle.includes(`${tenant}DUP`.toLowerCase().slice(0, 8)))).toHaveLength(1);
      });

      it.each([5, 13, 52])('getGastoPorSemana(%i semanas)', async (semanas) => {
        expect(await A.getGastoPorSemana(tenant, semanas, HOY)).toEqual(legacyGastoPorSemana(TABLAS, tenant, semanas, HOY));
      });

      it.each([5, 13, 52])('getLiquidadoPorSemana(%i semanas) — día local MX', async (semanas) => {
        expect(await A.getLiquidadoPorSemana(tenant, semanas, HOY)).toEqual(legacyLiquidadoPorSemana(TABLAS, tenant, semanas, HOY));
      });

      it('getViajesPorMes', async () => {
        expect(await A.getViajesPorMes(tenant)).toEqual(legacyViajesPorMes(TABLAS, tenant));
      });

      it('getGastoPorConcepto', async () => {
        const viejo = legacyGastoPorConcepto(TABLAS, tenant);
        const nuevo = await A.getGastoPorConcepto(tenant);
        expect(nuevo).toEqual(viejo);
        expect(nuevo.some((c) => c.concepto === 'otro')).toBe(true);
      });

      it('getTopRutasPorGasto con y sin ventana', async () => {
        const ventana = { desde: '2026-07-19', hasta: HOY };
        for (const v of [ventana, undefined]) {
          const viejo = legacyTopRutas(TABLAS, tenant, 5, v);
          const nuevo = await A.getTopRutasPorGasto(tenant, 5, v);
          expect(nuevo.map(({ origen, destino, total, pct }) => ({ origen, destino, total, pct }))).toEqual(viejo);
        }
      });

      it('getStatsPorOperador (nominal) — oposición fuera, redondeo no cuenta', async () => {
        const viejo = legacyStatsPorOperador(TABLAS, tenant);
        const nuevo = await A.getStatsPorOperador(tenant, { nominal: true });
        expect(nuevo).toEqual(viejo);
        expect(nuevo.map((o) => o.operadorId)).not.toContain(`${tenant}-o3`);
      });

      it('getOperadoresDetalle', async () => {
        const viejo = legacyOperadoresDetalle(TABLAS, tenant);
        const nuevo = await A.getOperadoresDetalle(tenant);
        expect(porLlave(nuevo, (o) => o.operadorId)).toEqual(porLlave(viejo, (o) => o.operadorId));
        expect(nuevo.map((o) => o.viajes)).toEqual(viejo.map((o) => o.viajes)); // mismo orden por viajes desc
      });

      it('getDineroObservadoPorTipo — tipo ausente cae en "otro"', async () => {
        const viejo = legacyDineroObservadoPorTipo(TABLAS, tenant);
        const nuevo = await A.getDineroObservadoPorTipo(tenant);
        expect(porLlave(nuevo, (x) => x.tipo)).toEqual(porLlave(viejo, (x) => x.tipo));
        expect(nuevo.map((x) => x.monto)).toEqual(viejo.map((x) => x.monto)); // mismo orden por monto desc
        expect(nuevo.some((x) => x.tipo === 'otro')).toBe(true);
      });

      it.each([7, 30, 84])('getLiquidacionesPorDia(%i)', async (dias) => {
        expect(await A.getLiquidacionesPorDia(tenant, dias, HOY)).toEqual(legacyLiquidacionesPorDia(TABLAS, tenant, dias, HOY));
      });

      it('getConciliacionConsolidado', async () => {
        expect(await A.getConciliacionConsolidado(tenant)).toEqual(legacyConciliacion(TABLAS, tenant));
      });
    });
  }

  it('AISLAMIENTO: ninguna RPC mezcla flotas — las cifras de A no cambian si B crece ×10', async () => {
    const antes = {
      anomalias: await A.detectarAnomalias('A'), concepto: await A.getGastoPorConcepto('A'),
      ops: await A.getOperadoresDetalle('A'), dinero: await A.getDineroObservadoPorTipo('A'),
    };
    for (const tabla of Object.keys(TABLAS)) {
      const deB = TABLAS[tabla].filter((f) => f.tenant_id === 'B');
      for (let k = 0; k < 10; k++) TABLAS[tabla].push(...deB.map((f) => ({ ...f, id: `${f.id}-x${k}` })));
    }
    expect(await A.detectarAnomalias('A')).toEqual(antes.anomalias);
    expect(await A.getGastoPorConcepto('A')).toEqual(antes.concepto);
    expect(await A.getOperadoresDetalle('A')).toEqual(antes.ops);
    expect(await A.getDineroObservadoPorTipo('A')).toEqual(antes.dinero);
    expect(llamadas.every((l) => l.args.p_tenant === 'A')).toBe(true);
  });
});

describe('FAIL-CLOSED — error o forma inesperada de la RPC LANZA, nunca se lee como cero', () => {
  const casos: Array<[string, () => Promise<unknown>]> = [
    ['detectarAnomalias', () => A.detectarAnomalias('A')],
    ['getGastoPorSemana', () => A.getGastoPorSemana('A', 5, HOY)],
    ['getTopRutasPorGasto', () => A.getTopRutasPorGasto('A')],
    ['getGastoPorConcepto', () => A.getGastoPorConcepto('A')],
    ['getStatsPorOperador', () => A.getStatsPorOperador('A')],
    ['getLiquidadoPorSemana', () => A.getLiquidadoPorSemana('A', 5, HOY)],
    ['getViajesPorMes', () => A.getViajesPorMes('A')],
    ['getOperadoresDetalle', () => A.getOperadoresDetalle('A')],
    ['getDineroObservadoPorTipo', () => A.getDineroObservadoPorTipo('A')],
    ['getLiquidacionesPorDia', () => A.getLiquidacionesPorDia('A', 7, HOY)],
    ['getConciliacionConsolidado', () => A.getConciliacionConsolidado('A')],
  ];

  it.each(casos)('%s: error de la base → lanza con el mensaje', async (_n, f) => {
    forzada = { data: null, error: { message: 'fetch failed (ENOTFOUND)' } };
    await expect(f()).rejects.toThrow(/fetch failed/);
  });

  it.each(casos)('%s: `null` (¿0150 sin aplicar?) → lanza "otra forma"', async (_n, f) => {
    forzada = { data: null, error: null };
    await expect(f()).rejects.toThrow(/otra forma/);
  });

  it.each(casos)('%s: filas con campos de otro tipo → lanza, no `?? 0`', async (_n, f) => {
    forzada = { data: [{ total: '12', n: 'tres', monto: null, tipo: 7, viajes: 'v1' }], error: null };
    await expect(f()).rejects.toThrow(/otra forma/);
  });

  it('una anomalía con un solo viaje no es una anomalía: la forma se rechaza', async () => {
    forzada = { data: [{ tipo: 'cfdi_duplicado', detalle: 'x', monto: 1, viajes: ['v1'] }], error: null };
    await expect(A.detectarAnomalias('A')).rejects.toThrow(/otra forma/);
  });
});
