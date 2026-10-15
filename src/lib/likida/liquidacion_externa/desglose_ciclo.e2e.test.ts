import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';
import { DESGLOSE_SINTETICO, centavos, sumaCentavos, type DesgloseFixture } from './desglose.fixture';
import type { DesgloseBitacora } from './desglose_contrato';
import { DatoInvalido } from '../errores';
import type { LiquidacionExterna, NuevaLiquidacionExterna } from './repo';
import {
  CONFIG_CORREO_POR_DEFECTO, type ConfigCorreo, type ContactoOperador, type ConteoInsights, type EntregaCorreo,
  type EstadoEntregaCorreo, type EventoEntregaCorreo, type NuevaEntrega, type ResultadoEntregaCorreo, type TipoExcepcion,
} from './repo_correo';
import type { CursorDesglose } from './desglose_puerto';

// ═══════════════════════════════════════════════════════════════════════════
// E2E DE ACEPTACIÓN DEL DESGLOSE POR CORREO (T-A1-34), de punta a punta y con dobles en los límites:
//
//   bitácoras (lector en memoria) → pull → recibirDesglose → Excel → entregas →
//   procesarEntregasCorreo → enviarCorreo (doble que captura el adjunto) → webhook de Resend → pantalla (insights) →
//   reenvío tras corregir el correo.
//
// Los dobles son SOLO los límites (base en memoria, Storage, Resend y el cursor del origen). Todo lo de en medio es el
// código real: `pullDesgloses`, `recibirDesglose`, `generarDesgloseXlsx`, `procesarEntregasCorreo`, `reenviarDesglose` y
// la RUTA real del webhook `/api/correo/eventos` (firma Svix incluida). Datos 100 % sintéticos.
//
// LOCAL-ONLY (al final): con `LIKIDA_DESGLOSE_REAL_JSON` apuntando a un JSON fuera del repo, el desglose real sale al centavo
// por el mismo camino y su .xlsx se guarda junto a ese JSON. Sin la variable queda `skipped`.
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = '00000000-0000-4000-8000-000000000001';
const OP_ID = '00000000-0000-4000-8000-0000000000a1';
const COORD_ID = '00000000-0000-4000-8000-0000000000c1';
const AHORA = new Date('2026-10-15T18:00:00.000Z');
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SECRETO = `whsec_${Buffer.from('secreto-de-prueba').toString('base64')}`;
const CONFIG: ConfigCorreo = {
  ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true, rhCorreos: ['rh@ejemplo.test'], archivoCorreo: 'archivo@ejemplo.test',
};

// ── la base en memoria (límite) ─────────────────────────────────────────────
interface Excep { id: number; clave: string; tipo: TipoExcepcion; detalle: Record<string, unknown>; abierta: boolean }
const bd = {
  liquidaciones: [] as LiquidacionExterna[],
  desgloses: [] as Array<Record<string, unknown>>,
  entregas: [] as EntregaCorreo[],
  excepciones: [] as Excep[],
  eventos: [] as Array<{ id: string; tipo: string }>,
  subidas: new Map<string, Uint8Array>(),
  contacto: { operadorId: OP_ID, correo: 'operador@ejemplo.test', correoRebotadoEn: null, coordinadorId: COORD_ID } as ContactoOperador,
  estadoPull: { cursor: null as CursorDesglose | null, leidas: 0, importadas: 0, excepciones: 0, exito: 0 },
  secuencia: 0,
};
function reiniciar(): void {
  bd.liquidaciones.length = 0; bd.desgloses.length = 0; bd.entregas.length = 0; bd.excepciones.length = 0; bd.eventos.length = 0;
  bd.subidas.clear();
  bd.contacto = { operadorId: OP_ID, correo: 'operador@ejemplo.test', correoRebotadoEn: null, coordinadorId: COORD_ID };
  bd.estadoPull = { cursor: null, leidas: 0, importadas: 0, excepciones: 0, exito: 0 };
  bd.secuencia = 0;
}

const abiertas = (tipo?: TipoExcepcion) => bd.excepciones.filter((e) => e.abierta && (!tipo || e.tipo === tipo));
const entregaDe = (liqId: string, rol: string, generacion = 1) =>
  bd.entregas.find((e) => e.liquidacionExternaId === liqId && e.rol === rol && e.generacion === generacion)!;

// Los dos puntos de `repo_correo` que hablan con la base y que el webhook / la pantalla usan: se sustituyen por la MISMA
// semántica en memoria (la real vive en repo_correo.test.ts). Lo demás de `repo_correo` es el módulo real.
vi.mock('./repo_correo', async (orig) => ({
  ...(await orig<typeof import('./repo_correo')>()),
  confirmarEntregaCorreo: vi.fn(async (emailId: string, evento: EventoEntregaCorreo, ahora: Date = AHORA): Promise<ResultadoEntregaCorreo> => {
    const e = bd.entregas.find((x) => x.resendId === emailId);
    if (!e) return { resultado: 'sin_entrega' };
    const antes = e.estado;
    let cambio = false;
    if (evento === 'entregada') {
      if (antes === 'enviada') { e.estado = 'entregada'; e.entregadaEn = ahora.toISOString(); cambio = true; }
    } else if (evento === 'rebotada') {
      if (antes === 'enviada' || antes === 'entregada') { e.estado = 'rebotada'; e.rebotadaEn = ahora.toISOString(); cambio = true; }
    } else if (antes === 'enviada' || antes === 'entregada') { e.estado = 'queja'; e.rebotadaEn = ahora.toISOString(); cambio = true; }
    const mala = evento !== 'entregada';
    const yaEraMala = antes === 'rebotada' || antes === 'queja';
    if (!(mala && e.rol === 'operador' && (cambio || yaEraMala))) return { resultado: cambio ? 'aplicada' : 'sin_cambio', rol: e.rol };
    const liq = bd.liquidaciones.find((l) => l.id === e.liquidacionExternaId)!;
    let operadorMarcado = false;
    if (bd.contacto.correo === e.correo) {
      bd.contacto.correoRebotadoEn = ahora.toISOString();
      operadorMarcado = true;
      if (!abiertas('operador_sin_correo').some((x) => x.clave === liq.claveExterna)) {
        bd.excepciones.push({ id: ++bd.secuencia, clave: liq.claveExterna, tipo: 'operador_sin_correo', detalle: { motivo: 'correo_rebotado', evento }, abierta: true });
      }
    }
    return { resultado: cambio ? 'aplicada' : 'sin_cambio', rol: e.rol, operadorMarcado };
  }),
  contarParaInsights: vi.fn(async (_t: string, desde: Date, hasta: Date) => {
    const dentro = (iso: string) => Date.parse(iso) >= desde.getTime() && Date.parse(iso) < hasta.getTime();
    const porEstado: Partial<Record<EstadoEntregaCorreo, number>> = {};
    for (const e of bd.entregas.filter((x) => dentro(x.creadaEn))) porEstado[e.estado] = (porEstado[e.estado] ?? 0) + 1;
    const valor: ConteoInsights = {
      desgloses: bd.desgloses.filter((d) => dentro(String(d.creadoEn))).length, entregasPorEstado: porEstado, excepcionesAbiertas: abiertas().length,
    };
    return { ok: true as const, valor };
  }),
}));

// El webhook consulta primero la cola de campañas (`cola_aprobacion`): aquí ninguna pieza es de esa cola, así que el
// circuito cae al desglose, como en producción. Las listas de supresión y el buzón de facturas se aíslan.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'update', 'eq', 'or', 'select']) b[m] = () => b;
    b.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res, rej);
    return b;
  },
}));
const suprimidas: string[] = [];
vi.mock('@/lib/likida/agentes/enviador', () => ({ suprimirCorreo: async (c: string) => { suprimidas.push(c); } }));
vi.mock('@/lib/likida/buzon/entrega_repo', () => ({ confirmarPorResend: async () => 'sin_lote' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { pullDesgloses } = await import('./pull_desglose');
const { recibirDesglose } = await import('./desglose_recibir');
const { procesarEntregasCorreo, llaveIdempotencia } = await import('./entrega_correo');
const { reenviarDesglose } = await import('./reenvio_correo');
const { lectorEnMemoria } = await import('./desglose_puerto');
const { contarParaInsights } = await import('./repo_correo');
const rutaEventos = await import('@/app/api/correo/eventos/route');
type DepsRecibir = import('./desglose_recibir').DependenciasDesglose;
type DepsPull = import('./pull_desglose').DependenciasPull;
type DepsEntrega = import('./entrega_correo').DependenciasEntregaCorreo;
type DepsReenvio = import('./reenvio_correo').DependenciasReenvio;

// ── dependencias reales con la base en memoria ──────────────────────────────
function nuevaExcepcion(clave: string, tipo: TipoExcepcion, detalle: Record<string, unknown>): { id: number; nueva: boolean } {
  const previa = bd.excepciones.find((e) => e.abierta && e.clave === clave && e.tipo === tipo);
  if (previa) { previa.detalle = detalle; return { id: previa.id, nueva: false }; }
  const e: Excep = { id: ++bd.secuencia, clave, tipo, detalle, abierta: true };
  bd.excepciones.push(e);
  return { id: e.id, nueva: true };
}

const depsRecibir: DepsRecibir = {
  ahora: () => AHORA,
  leerConfig: async () => CONFIG,
  buscarPorClave: async (_t, clave) => bd.liquidaciones.find((l) => l.claveExterna === clave) ?? null,
  resolverOperador: async () => ({ id: OP_ID, nombre: DESGLOSE_SINTETICO.operador.nombre, telefono: '5210000000000', activo: true }),
  resolverViajeIds: async () => [],
  leerContacto: async () => ({ ...bd.contacto }),
  leerCoordinador: async () => ({ id: COORD_ID, nombre: null, correo: 'coordinador@ejemplo.test', activo: true }),
  subirXlsx: async (t, clave, huella, bytes) => {
    const ruta = `${t}/${clave}-${huella.slice(0, 8)}.xlsx`;
    bd.subidas.set(ruta, bytes);
    return ruta;
  },
  insertarLiquidacion: async (n: NuevaLiquidacionExterna) => {
    const l = {
      id: `liq-${bd.liquidaciones.length + 1}`, tenantId: n.tenantId, claveExterna: n.datos.claveExterna, huella: n.huella,
      sistemaOrigen: n.datos.sistemaOrigen, operadorId: n.operadorId, total: n.datos.total, pdfRuta: n.pdfRuta, pdfOrigen: n.pdfOrigen,
      periodoDesde: n.datos.periodo.desde, periodoHasta: n.datos.periodo.hasta, estado: 'pendiente', generacion: 1,
    } as unknown as LiquidacionExterna;
    bd.liquidaciones.push(l);
    return l;
  },
  insertarDesglose: async (_t, m) => { bd.desgloses.push({ ...m, creadoEn: AHORA.toISOString() }); return true; },
  insertarEntregas: async (_t, filas: NuevaEntrega[]) => insertarEntregasEnMemoria(filas),
  abrirExcepcion: async (_t, clave, tipo, detalle) => nuevaExcepcion(clave, tipo, detalle),
  registrarEvento: async (_t, id, tipo) => { bd.eventos.push({ id, tipo }); },
};

function insertarEntregasEnMemoria(filas: NuevaEntrega[]): number {
  let creadas = 0;
  for (const f of filas) {
    const generacion = f.generacion ?? 1;
    if (bd.entregas.some((e) => e.liquidacionExternaId === f.liquidacionExternaId && e.generacion === generacion && e.rol === f.rol)) continue;
    bd.entregas.push({
      id: `ent-${bd.entregas.length + 1}`, tenantId: TENANT, liquidacionExternaId: f.liquidacionExternaId, generacion, rol: f.rol,
      correo: f.correo.trim().toLowerCase(), estado: 'pendiente', intentos: 0, proximoIntentoEn: AHORA.toISOString(), claimToken: null,
      claimExpiraEn: null, resendId: null, ultimoError: null, disparo: f.disparo ?? 'auto', xlsxRuta: f.xlsxRuta ?? null,
      xlsxSha256: f.xlsxSha256 ?? null, enviadaEn: null, entregadaEn: null, rebotadaEn: null, creadaEn: AHORA.toISOString(),
    });
    creadas += 1;
  }
  return creadas;
}

const depsPull: DepsPull = {
  ahora: () => AHORA,
  leerEstado: async () => ({
    cursor: bd.estadoPull.cursor, ultimaCorrida: null, ultimoExito: null, ultimoError: null,
    leidas: bd.estadoPull.leidas, importadas: bd.estadoPull.importadas, excepciones: bd.estadoPull.excepciones,
  }),
  guardarEstado: async (_t, e) => {
    if (e.exito && e.cursor !== undefined) bd.estadoPull.cursor = e.cursor;
    if (e.exito) bd.estadoPull.exito += 1;
    Object.assign(bd.estadoPull, { leidas: e.leidas, importadas: e.importadas, excepciones: e.excepciones });
  },
  recibir: (t, d) => recibirDesglose(t, d, depsRecibir),
  abrirExcepcion: async (_t, clave, tipo, detalle) => nuevaExcepcion(clave, tipo, detalle),
  excepcionesSinPoliza: async () => new Map(abiertas('sin_poliza').map((e) => [e.clave, e.id] as const)),
  resolverExcepcion: async (_t, id) => {
    const e = bd.excepciones.find((x) => x.id === id && x.abierta);
    if (!e) return false;
    e.abierta = false;
    return true;
  },
  entregasDe: async (_t, id) => bd.entregas.filter((e) => e.liquidacionExternaId === id).map((e) => ({ ...e })),
};

// Resend: acepta todo y devuelve un id por envío; captura el adjunto tal cual viajó.
interface Envio { para: string; asunto: string; parrafos: string[]; llave: string | undefined; adjunto: { filename: string; contentType?: string; bytes: Buffer } | null; resendId: string }
const envios: Envio[] = [];
const depsEntrega: DepsEntrega = {
  ahora: () => AHORA,
  enviar: async (para, correo, op) => {
    const a = op.adjuntos?.[0];
    const resendId = `re_${envios.length + 1}`;
    envios.push({
      para, asunto: correo.asunto, parrafos: correo.parrafos, llave: op.idempotencyKey, resendId,
      adjunto: a ? { filename: a.filename, contentType: a.contentType, bytes: Buffer.from(a.content as string, 'base64') } : null,
    });
    return { ok: true, id: resendId };
  },
  leerConfig: async () => CONFIG,
  reclamar: async (limite, ahora) => {
    const listas = bd.entregas.filter((e) => e.estado === 'pendiente' && Date.parse(e.proximoIntentoEn) <= ahora.getTime()).slice(0, limite);
    for (const e of listas) { e.estado = 'enviando'; e.claimToken = `tok-${e.id}`; }
    return listas.map((e) => ({ ...e }));
  },
  leerContexto: async (_t, id) => {
    const l = bd.liquidaciones.find((x) => x.id === id);
    return l ? { claveExterna: l.claveExterna, periodoDesde: l.periodoDesde, periodoHasta: l.periodoHasta } : null;
  },
  descargarXlsx: async (_t, ruta) => {
    const b = bd.subidas.get(ruta);
    if (!b) throw new Error('no está en Storage');
    return b;
  },
  marcarEnviada: async (_t, id, _tok, resendId, ahora) => {
    const e = bd.entregas.find((x) => x.id === id && x.estado === 'enviando');
    if (!e) return false;
    Object.assign(e, { estado: 'enviada', resendId, enviadaEn: ahora.toISOString() });
    return true;
  },
  marcarFallida: async (_t, id, _tok, error) => { Object.assign(bd.entregas.find((x) => x.id === id)!, { estado: 'fallida', ultimoError: error }); return true; },
  reprogramar: async (_t, id, _tok, intentos, proximo, error) => {
    Object.assign(bd.entregas.find((x) => x.id === id)!, { estado: 'pendiente', intentos, proximoIntentoEn: proximo.toISOString(), ultimoError: error });
    return true;
  },
  liquidacionEnviada: async (_t, id) => {
    const l = bd.liquidaciones.find((x) => x.id === id);
    if (!l || l.estado !== 'pendiente') return false;
    l.estado = 'enviada';
    return true;
  },
  registrarEvento: async (_t, id, tipo) => { bd.eventos.push({ id, tipo }); },
  abrirExcepcion: async (_t, clave, tipo, detalle) => nuevaExcepcion(clave, tipo, detalle),
};

const depsReenvio: DepsReenvio = {
  ahora: () => AHORA,
  leerLiquidacion: async (_t, id) => bd.liquidaciones.find((l) => l.id === id) ?? null,
  leerConfig: async () => CONFIG,
  leerContacto: async () => ({ ...bd.contacto }),
  leerCoordinador: async () => ({ id: COORD_ID, nombre: null, correo: 'coordinador@ejemplo.test', activo: true }),
  entregas: async (_t, id) => bd.entregas.filter((e) => e.liquidacionExternaId === id).map((e) => ({ ...e })),
  // Igual que `guardarContactoOperador`: el correo corregido limpia el rebote.
  guardarCorreoOperador: async (_t, _op, correo) => { bd.contacto.correo = correo; bd.contacto.correoRebotadoEn = null; },
  insertarEntregas: async (_t, filas) => insertarEntregasEnMemoria(filas),
  registrarEvento: async (_t, id, tipo) => { bd.eventos.push({ id, tipo }); },
};

// ── las tres bitácoras: ok, sin póliza y neto negativo ──────────────────────
const F = DESGLOSE_SINTETICO;
function bitacora(num: string, extra: Partial<DesgloseBitacora> = {}): DesgloseBitacora {
  return {
    terminal: 'T1', bitacora: num, poliza: 'P-1', operador: { numeroEmpleado: 'E-1', nombre: F.operador.nombre }, unidad: F.unidad,
    tipoOperador: 'foraneo', desde: F.desde, hasta: F.hasta, dias: F.dias,
    percepciones: F.percepciones.map((r) => ({ concepto: r.descripcion, monto: r.monto })),
    deducciones: F.deducciones.map((r) => ({ concepto: r.descripcion, monto: r.monto, ...(r.vale ? { vale: r.vale } : {}) })),
    neto: F.esperado.neto, ...extra,
  };
}
const OK = bitacora('B-0001');
const SIN_POLIZA = bitacora('B-0002', { poliza: null });
const NEGATIVA = bitacora('B-0003', {
  poliza: 'P-3', neto: -100, percepciones: [{ concepto: 'Sueldo', monto: 100 }], deducciones: [{ concepto: 'Retención uno', monto: 200 }],
});
const CLAVE_OK = 'BIT-T1-B-0001';
const CLAVE_SIN_POLIZA = 'BIT-T1-B-0002';
const CLAVE_NEGATIVA = 'BIT-T1-B-0003';

function lector() {
  return lectorEnMemoria([
    { modificadoEn: '2026-10-15T08:00:00.000Z', desglose: OK },
    { modificadoEn: '2026-10-15T08:05:00.000Z', desglose: SIN_POLIZA },
    { modificadoEn: '2026-10-15T08:10:00.000Z', desglose: NEGATIVA },
  ], { conMarcar: true });
}

// ── utilidades del webhook y del Excel ──────────────────────────────────────
async function evento(tipo: 'email.delivered' | 'email.bounced' | 'email.complained', emailId: string): Promise<{ status: number; cuerpo: Record<string, unknown> }> {
  const cuerpo = JSON.stringify({ type: tipo, data: { email_id: emailId, to: [] } });
  const id = `msg_${crypto.randomUUID()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const firma = crypto.createHmac('sha256', Buffer.from(SECRETO.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${cuerpo}`).digest('base64');
  const res = await rutaEventos.POST(new Request('http://localhost/api/correo/eventos', {
    method: 'POST', body: cuerpo, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${firma}` },
  }));
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> };
}

/** Relee el adjunto como Excel: celdas con valor y la lista de las que traen fórmula. */
function releer(bytes: Uint8Array | Buffer) {
  const libro = XLSX.read(bytes, { type: 'buffer', cellFormula: true });
  const hoja = libro.Sheets['Desglose'];
  const formulas = Object.keys(hoja).filter((k) => !k.startsWith('!') && (hoja[k] as XLSX.CellObject).f !== undefined);
  return { hoja, formulas, val: (ref: string) => hoja[ref]?.v as unknown };
}

beforeEach(() => {
  reiniciar();
  envios.length = 0;
  suprimidas.length = 0;
  process.env.RESEND_EVENTOS_WEBHOOK_SECRET = SECRETO;
  vi.mocked(contarParaInsights).mockClear();
});

async function importarYEnviar() {
  const l = lector();
  const pull = await pullDesgloses(TENANT, l, depsPull);
  const pasada = await procesarEntregasCorreo(depsEntrega, 25);
  return { l, pull, pasada };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('E2E del desglose: bitácora → desglose → correo (dobles)', () => {
  it('el pull trae las tres bitácoras: la buena crea sus 4 entregas, la sin póliza NO se envía y la negativa queda retenida', async () => {
    const pull = await pullDesgloses(TENANT, lector(), depsPull);
    expect(pull).toMatchObject({ estado: 'ok', leidas: 3, importadas: 2 });

    // sin póliza: no hay liquidación ni archivo ni entrega, solo la excepción
    expect(bd.liquidaciones.map((l) => l.claveExterna).sort()).toEqual([CLAVE_OK, CLAVE_NEGATIVA]);
    expect(abiertas('sin_poliza').map((e) => e.clave)).toEqual([CLAVE_SIN_POLIZA]);

    // la buena: operador + coordinador + RH + archivo, cada uno con su correo, todas contra el mismo Excel
    const ok = bd.liquidaciones.find((l) => l.claveExterna === CLAVE_OK)!;
    const suyas = bd.entregas.filter((e) => e.liquidacionExternaId === ok.id);
    expect(suyas.map((e) => [e.rol, e.correo])).toEqual([
      ['operador', 'operador@ejemplo.test'], ['coordinador', 'coordinador@ejemplo.test'], ['rh', 'rh@ejemplo.test'], ['archivo', 'archivo@ejemplo.test'],
    ]);
    expect(new Set(suyas.map((e) => e.xlsxRuta)).size).toBe(1);

    // la negativa: retenida, sin entregas y con su excepción
    const neg = bd.liquidaciones.find((l) => l.claveExterna === CLAVE_NEGATIVA)!;
    expect(bd.entregas.filter((e) => e.liquidacionExternaId === neg.id)).toHaveLength(0);
    expect(neg.estado).toBe('pendiente');
    expect(String(bd.desgloses.find((d) => d.liquidacionExternaId === neg.id)?.retenidaMotivo)).toMatch(/negativo/i);
    expect(abiertas('neto_negativo').map((e) => e.clave)).toEqual([CLAVE_NEGATIVA]);
    expect(bd.entregas).toHaveLength(4); // y NADA más
  });

  it('el envío: cada destinatario recibe su correo con el .xlsx releído SIN fórmulas y con el neto del fixture', async () => {
    const { pasada } = await importarYEnviar();
    expect(pasada).toMatchObject({ reclamadas: 4, enviadas: 4, fallidas: 0, errores: 0 });

    expect(envios.map((e) => e.para).sort()).toEqual(
      ['archivo@ejemplo.test', 'coordinador@ejemplo.test', 'operador@ejemplo.test', 'rh@ejemplo.test'],
    );
    const ok = bd.liquidaciones.find((l) => l.claveExterna === CLAVE_OK)!;
    for (const e of envios) {
      expect(e.adjunto?.filename).toBe('desglose-B-0001.xlsx');
      expect(e.adjunto?.contentType).toBe(TIPO_XLSX);
      expect(e.asunto).toBe('Desglose de pago — bitácora B-0001 — 9 al 14 oct');
      expect(`${e.asunto} ${e.parrafos.join(' ')}`).not.toMatch(/4[ ,.]?850|9[ ,.]?850|\$/); // el dato va solo en el adjunto

      const x = releer(e.adjunto!.bytes);
      expect(x.formulas).toEqual([]);
      expect(x.val('A20')).toBe(F.esperado.percepciones);
      expect(x.val('C20')).toBe(F.esperado.deducciones);
      expect(x.val('G7')).toBe(F.esperado.neto);
      expect(centavos(x.val('A20') as number) - centavos(x.val('C20') as number)).toBe(centavos(x.val('G7') as number));
    }
    // una llave de idempotencia por destinatario, estable y distinta
    expect(new Set(envios.map((e) => e.llave)).size).toBe(4);
    expect(envios.find((e) => e.para === 'operador@ejemplo.test')?.llave).toBe(llaveIdempotencia({ liquidacionExternaId: ok.id, generacion: 1, rol: 'operador' }));
    // al enviarse el del operador, la liquidación pasa a enviada
    expect(ok.estado).toBe('enviada');
    expect(bd.eventos.filter((e) => e.id === ok.id).map((e) => e.tipo)).toEqual(['recibida', 'enviada']);
    // y la bitácora sin póliza y la negativa no mandaron nada
    expect(envios.some((e) => /B-0002|B-0003/.test(e.asunto))).toBe(false);
  });

  it('reejecutar el cron (pull + envío) ⇒ 0 envíos nuevos, 0 archivos nuevos; el origen queda marcado como enviado', async () => {
    const { l } = await importarYEnviar();
    expect(envios).toHaveLength(4);
    const subidas = bd.subidas.size;

    const pull2 = await pullDesgloses(TENANT, l, depsPull);
    expect(pull2).toMatchObject({ estado: 'ok', leidas: 3, importadas: 0 });
    const pasada2 = await procesarEntregasCorreo(depsEntrega, 25);
    expect(pasada2.reclamadas).toBe(0);
    expect(envios).toHaveLength(4);
    expect(bd.subidas.size).toBe(subidas);
    expect(bd.liquidaciones).toHaveLength(2);
    expect(bd.entregas).toHaveLength(4);
    // la excepción de «sin póliza» se refresca, no se duplica
    expect(abiertas('sin_poliza')).toHaveLength(1);
    // la marca «enviado» al origen solo para la que el operador ya recibió
    expect([...l.enviadas]).toEqual([CLAVE_OK]);
  });

  it('cuando la póliza llega, la bitácora se envía y la excepción se resuelve sola', async () => {
    const l = lector();
    await pullDesgloses(TENANT, l, depsPull);
    await procesarEntregasCorreo(depsEntrega, 25);
    const conPoliza = lectorEnMemoria([{ modificadoEn: '2026-10-15T09:00:00.000Z', desglose: { ...SIN_POLIZA, poliza: 'P-2' } }]);
    const pull = await pullDesgloses(TENANT, conPoliza, depsPull);
    expect(pull).toMatchObject({ estado: 'ok', importadas: 1, resueltas: 1 });
    expect(abiertas('sin_poliza')).toHaveLength(0);
    await procesarEntregasCorreo(depsEntrega, 25);
    expect(envios).toHaveLength(8);
    expect(envios.filter((e) => /B-0002/.test(e.asunto))).toHaveLength(4);
  });
});

describe('E2E del desglose: webhook de Resend → pantalla → reenvío', () => {
  it('entregado ×3 y rebote del operador: marca su correo, abre la excepción, no se pisa con un «entregado» tardío y la pantalla lo cuenta', async () => {
    await importarYEnviar();
    const ok = bd.liquidaciones.find((l) => l.claveExterna === CLAVE_OK)!;
    const idDe = (rol: string) => entregaDe(ok.id, rol).resendId!;

    for (const rol of ['coordinador', 'rh', 'archivo']) {
      const r = await evento('email.delivered', idDe(rol));
      expect(r).toMatchObject({ status: 200, cuerpo: { entregaCorreo: 'aplicada', estado: 'entregado' } });
      expect(entregaDe(ok.id, 'coordinador').estado).toBe('entregada');
    }
    const rebote = await evento('email.bounced', idDe('operador'));
    expect(rebote).toMatchObject({ status: 200, cuerpo: { entregaCorreo: 'aplicada', estado: 'rebotado' } });
    expect(entregaDe(ok.id, 'operador').estado).toBe('rebotada');
    expect(bd.contacto.correoRebotadoEn).not.toBeNull();
    expect(abiertas('operador_sin_correo').map((e) => e.clave)).toEqual([CLAVE_OK]);

    // el orden de los webhooks no está garantizado: el «entregado» tardío no tapa el rebote
    const tardio = await evento('email.delivered', idDe('operador'));
    expect(tardio.cuerpo).toMatchObject({ entregaCorreo: 'sin_cambio' });
    expect(entregaDe(ok.id, 'operador').estado).toBe('rebotada');
    // el rebote de nómina NO entra a la lista de supresión de campañas
    expect(suprimidas).toEqual([]);

    // la pantalla (insights): 2 desgloses, 3 entregadas + 1 rebotada, y 3 excepciones abiertas (sin póliza, negativa, correo del operador)
    const insights = await contarParaInsights(TENANT, new Date('2026-10-15T00:00:00.000Z'), new Date('2026-10-16T00:00:00.000Z'));
    expect(insights).toEqual({ ok: true, valor: { desgloses: 2, entregasPorEstado: { entregada: 3, rebotada: 1 }, excepcionesAbiertas: 3 } });
  });

  it('un evento con firma inválida o de un id desconocido no toca nada', async () => {
    await importarYEnviar();
    const mala = await rutaEventos.POST(new Request('http://localhost/api/correo/eventos', {
      method: 'POST', body: '{}', headers: { 'svix-id': 'x', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,AAAA' },
    }));
    expect(mala.status).toBe(401);
    expect((await evento('email.delivered', 're_desconocido')).cuerpo).toEqual({ sinPieza: true });
    expect(bd.entregas.every((e) => e.estado === 'enviada')).toBe(true);
  });

  it('reenvío tras corregir el correo ⇒ generación 2, llave nueva, solo al operador y con el mismo Excel', async () => {
    await importarYEnviar();
    const ok = bd.liquidaciones.find((l) => l.claveExterna === CLAVE_OK)!;
    await evento('email.bounced', entregaDe(ok.id, 'operador').resendId!);
    expect(bd.contacto.correoRebotadoEn).not.toBeNull();
    const enviosAntes = envios.length;

    const r = await reenviarDesglose(TENANT, ok.id, {
      a: 'operador', correoNuevo: 'Operador.Corregido@Ejemplo.test', motivo: 'correccion_de_correo', actor: { userId: 'u-1', rol: 'flota_admin' },
    }, depsReenvio);
    expect(r).toMatchObject({ estado: 'reenviado', generacion: 2, entregas: 1, roles: ['operador'] });
    expect(bd.contacto).toMatchObject({ correo: 'operador.corregido@ejemplo.test', correoRebotadoEn: null });
    expect(entregaDe(ok.id, 'operador', 2)).toMatchObject({ estado: 'pendiente', disparo: 'manual', xlsxRuta: entregaDe(ok.id, 'operador', 1).xlsxRuta });

    const pasada = await procesarEntregasCorreo(depsEntrega, 25);
    expect(pasada).toMatchObject({ reclamadas: 1, enviadas: 1 });
    expect(envios).toHaveLength(enviosAntes + 1);
    const nuevo = envios[envios.length - 1];
    expect(nuevo.para).toBe('operador.corregido@ejemplo.test');
    expect(nuevo.llave).toBe(llaveIdempotencia({ liquidacionExternaId: ok.id, generacion: 2, rol: 'operador' }));
    expect(nuevo.llave).not.toBe(envios.find((e) => e.para === 'operador@ejemplo.test')?.llave);
    expect(releer(nuevo.adjunto!.bytes).val('G7')).toBe(F.esperado.neto);

    expect((await evento('email.delivered', nuevo.resendId)).cuerpo).toMatchObject({ entregaCorreo: 'aplicada' });
    expect(entregaDe(ok.id, 'operador', 2).estado).toBe('entregada');
    expect(entregaDe(ok.id, 'operador', 1).estado).toBe('rebotada'); // la historia no se reescribe
    // y el cron otra vez no manda nada más
    expect((await procesarEntregasCorreo(depsEntrega, 25)).reclamadas).toBe(0);
  });

  it('el reenvío exige quien administra la flota', async () => {
    await importarYEnviar();
    const ok = bd.liquidaciones.find((l) => l.claveExterna === CLAVE_OK)!;
    const r = await reenviarDesglose(TENANT, ok.id, { a: 'operador', motivo: 'reclamo', actor: { userId: 'u-2', rol: 'contador' } }, depsReenvio);
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'sin_permiso' });
    expect(bd.entregas).toHaveLength(4);
  });
});

describe('E2E del desglose: operador que no existe', () => {
  it('no se crea nada ni se envía; queda la excepción para la oficina', async () => {
    const depsSinOperador: DepsRecibir = {
      ...depsRecibir,
      resolverOperador: async () => { throw new DatoInvalido('No encontré a ese operador en tu flota.'); },
    };
    const pull = await pullDesgloses(TENANT, lector(), { ...depsPull, recibir: (t, d) => recibirDesglose(t, d, depsSinOperador) });
    expect(pull.estado).toBe('ok');
    expect(bd.liquidaciones).toHaveLength(0);
    expect(abiertas('operador_no_encontrado').map((e) => e.clave).sort()).toEqual([CLAVE_OK, CLAVE_NEGATIVA]);
    expect((await procesarEntregasCorreo(depsEntrega, 25)).reclamadas).toBe(0);
    expect(envios).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL-ONLY: el desglose REAL sale «al centavo» por el mismo camino. `LIKIDA_DESGLOSE_REAL_JSON` apunta a un JSON FUERA
// del repo (público) con el tipo `DesgloseFixture` y su bloque `esperado`. Sin la variable, queda `skipped`.
// El .xlsx se guarda junto a ese JSON (fuera del repo) para el checkpoint visual contra el impreso.
// ═══════════════════════════════════════════════════════════════════════════

const RUTA_REAL = process.env.LIKIDA_DESGLOSE_REAL_JSON;

describe.skipIf(!RUTA_REAL)('desglose real (solo local, fuera del repo)', () => {
  it('pasa por pull → recibir → Excel y sale al centavo (percepciones, deducciones y neto), sin fórmulas', async () => {
    const real = JSON.parse(readFileSync(RUTA_REAL as string, 'utf8')) as DesgloseFixture;
    const desglose: DesgloseBitacora = {
      terminal: 'T1', bitacora: real.bitacora, poliza: 'P-LOCAL', operador: { numeroEmpleado: 'E-1', nombre: real.operador.nombre }, unidad: real.unidad,
      tipoOperador: 'foraneo', desde: real.desde, hasta: real.hasta, dias: real.dias,
      percepciones: real.percepciones.map((r) => ({ concepto: r.descripcion, monto: r.monto })),
      deducciones: real.deducciones.map((r) => ({ concepto: r.descripcion, monto: r.monto, ...(r.vale ? { vale: r.vale } : {}) })),
      neto: real.esperado.neto,
    };
    const depsReal: DepsRecibir = {
      ...depsRecibir, resolverOperador: async () => ({ id: OP_ID, nombre: real.operador.nombre, telefono: '5210000000000', activo: true }),
    };
    const lectorReal = lectorEnMemoria([{ modificadoEn: '2026-10-15T08:00:00.000Z', desglose }]);
    const pull = await pullDesgloses(TENANT, lectorReal, { ...depsPull, recibir: (t, d) => recibirDesglose(t, d, depsReal) });
    expect(pull).toMatchObject({ estado: 'ok', leidas: 1, importadas: 1 });
    await procesarEntregasCorreo(depsEntrega, 25);

    expect(envios).toHaveLength(4);
    const x = releer(envios[0].adjunto!.bytes);
    expect(x.formulas).toEqual([]);
    expect(centavos(x.val('A20') as number)).toBe(centavos(real.esperado.percepciones));
    expect(centavos(x.val('C20') as number)).toBe(centavos(real.esperado.deducciones));
    expect(centavos(x.val('G7') as number)).toBe(centavos(real.esperado.neto));
    // los renglones del Excel suman lo mismo que los totales (la suma sale de los importes, no del cálculo del Excel)
    expect(sumaCentavos(real.percepciones) - sumaCentavos(real.deducciones)).toBe(centavos(real.esperado.neto));

    // El .xlsx queda junto al JSON real (fuera del repo), p. ej. la carpeta `_local/` del análisis.
    const carpetaLocal = dirname(RUTA_REAL as string);
    mkdirSync(carpetaLocal, { recursive: true, mode: 0o700 });
    writeFileSync(join(carpetaLocal, `desglose-${real.bitacora}.xlsx`), envios[0].adjunto!.bytes, { mode: 0o600 });
  });
});
