import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearServidorTmsFalso, comoHttpDeConector, type ServidorTmsFalso } from '../conectores/tms/falso/servidor';
import type { ConjuntoSintetico, LiquidacionSintetica } from '../conectores/tms/falso/datos';
import type { LiquidacionExterna, NuevaLiquidacionExterna } from './repo';
import {
  CONFIG_CORREO_POR_DEFECTO, type ConfigCorreo, type EntregaCorreo, type NuevaEntrega, type TipoExcepcion,
} from './repo_correo';
import type { CursorDesglose } from './desglose_puerto';
import type { ResultadoMarcado } from './desglose_puerto';
import type { LiquidacionExternaNormalizada } from './esquema';

// ═══════════════════════════════════════════════════════════════════════════
// PUNTA A PUNTA «TMS → desglose por correo» (hallazgo A35-A1-03): el servidor TMS FALSO → el lector (sesión con
// usuario/contraseña/token) → el mapeo → `pullDesgloses` → `recibirDesglose` (idempotente) → las entregas →
// `procesarEntregasCorreo`, todo disparado por UNA pasada del servicio del cron (`procesarLiquidacionesExternas`).
//
// Dobles SOLO en los límites: la base (en memoria), Storage, Resend y el servidor TMS (falso). Datos 100 % sintéticos.
// Sin red, sin correo real, sin Supabase.
// ═══════════════════════════════════════════════════════════════════════════

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const AHORA = new Date('2026-10-15T18:00:00.000Z');
const BASE_TMS = 'https://tms.ejemplo.test';

vi.mock('./trabajo', () => ({
  trabajoPendiente: vi.fn(async () => []),
  avisosPendientes: vi.fn(async () => []),
  candidatasHuerfanaCorreo: vi.fn(async () => []),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { procesarLiquidacionesExternas } = await import('./servicio');
const { pullDesgloses } = await import('./pull_desglose');
const { recibirDesglose } = await import('./desglose_recibir');
const { procesarEntregasCorreo } = await import('./entrega_correo');
const { CONFIG_API_DESGLOSE } = await import('./desglose_tms_supuesto');
const { lectoresDesglosesTms } = await import('../conectores/tms/lector_desgloses');
type DepsRecibir = import('./desglose_recibir').DependenciasDesglose;
type DepsPull = import('./pull_desglose').DependenciasPull;
type DepsEntrega = import('./entrega_correo').DependenciasEntregaCorreo;
type DepsLectores = import('../conectores/tms/lector_desgloses').DependenciasLectoresTms;
type Dependencias = import('./servicio').Dependencias;

// ── la base en memoria (límite), con el tenant en cada fila ─────────────────
interface Excep { id: number; tenantId: string; clave: string; tipo: TipoExcepcion; abierta: boolean }
const bd = {
  liquidaciones: [] as LiquidacionExterna[],
  desgloses: [] as Array<{ tenantId: string; liquidacionExternaId: string; retenidaMotivo?: string | null }>,
  entregas: [] as Array<EntregaCorreo & { tenantId: string }>,
  excepciones: [] as Excep[],
  subidas: new Map<string, Uint8Array>(),
  cursor: new Map<string, CursorDesglose | null>(),
  seq: 0,
};
const configs = new Map<string, ConfigCorreo>();
const OP = (t: string) => `op-${t}`;

function reiniciar(): void {
  bd.liquidaciones.length = 0; bd.desgloses.length = 0; bd.entregas.length = 0; bd.excepciones.length = 0;
  bd.subidas.clear(); bd.cursor.clear(); bd.seq = 0;
  configs.clear();
  envios.length = 0;
  marcas.length = 0;
}

const abiertas = (t: string, tipo: TipoExcepcion) => bd.excepciones.filter((e) => e.tenantId === t && e.abierta && e.tipo === tipo).map((e) => e.clave);
const configDe = (t: string): ConfigCorreo => configs.get(t) ?? CONFIG_CORREO_POR_DEFECTO;
function nuevaExcepcion(tenantId: string, clave: string, tipo: TipoExcepcion): { id: number; nueva: boolean } {
  const previa = bd.excepciones.find((e) => e.tenantId === tenantId && e.abierta && e.clave === clave && e.tipo === tipo);
  if (previa) return { id: previa.id, nueva: false };
  const e: Excep = { id: ++bd.seq, tenantId, clave, tipo, abierta: true };
  bd.excepciones.push(e);
  return { id: e.id, nueva: true };
}

const depsRecibir: DepsRecibir = {
  ahora: () => AHORA,
  leerConfig: async (t) => configDe(t),
  buscarPorClave: async (t, clave) => bd.liquidaciones.find((l) => l.tenantId === t && l.claveExterna === clave) ?? null,
  resolverOperador: async (t) => ({ id: OP(t), nombre: 'Operador Ejemplo', telefono: '5210000000000', activo: true }),
  resolverViajeIds: async () => [],
  leerContacto: async (t) => ({ operadorId: OP(t), correo: `operador@${t.slice(-1)}.ejemplo.test`, correoRebotadoEn: null, coordinadorId: null }),
  leerCoordinador: async () => null,
  subirXlsx: async (t, clave, huella, bytes) => {
    const ruta = `${t}/${clave}-${huella.slice(0, 8)}.xlsx`;
    bd.subidas.set(ruta, bytes);
    return ruta;
  },
  insertarLiquidacion: async (n: NuevaLiquidacionExterna) => {
    const datos = n.datos as LiquidacionExternaNormalizada;
    const l = {
      id: `liq-${bd.liquidaciones.length + 1}`, tenantId: n.tenantId, claveExterna: datos.claveExterna, huella: n.huella,
      operadorId: n.operadorId, total: datos.total, pdfRuta: n.pdfRuta, estado: 'pendiente', generacion: 1,
      periodoDesde: datos.periodo.desde, periodoHasta: datos.periodo.hasta,
    } as unknown as LiquidacionExterna;
    bd.liquidaciones.push(l);
    return l;
  },
  insertarDesglose: async (t, m) => { bd.desgloses.push({ tenantId: t, liquidacionExternaId: m.liquidacionExternaId, retenidaMotivo: m.retenidaMotivo ?? null }); return true; },
  insertarEntregas: async (t, filas: NuevaEntrega[]) => {
    let n = 0;
    for (const f of filas) {
      if (bd.entregas.some((e) => e.liquidacionExternaId === f.liquidacionExternaId && e.generacion === (f.generacion ?? 1) && e.rol === f.rol)) continue;
      bd.entregas.push({
        id: `ent-${bd.entregas.length + 1}`, tenantId: t, liquidacionExternaId: f.liquidacionExternaId, generacion: f.generacion ?? 1, rol: f.rol,
        correo: f.correo, estado: 'pendiente', intentos: 0, proximoIntentoEn: AHORA.toISOString(), claimToken: null, claimExpiraEn: null,
        resendId: null, ultimoError: null, disparo: f.disparo ?? 'auto', xlsxRuta: f.xlsxRuta ?? null, xlsxSha256: f.xlsxSha256 ?? null,
        enviadaEn: null, entregadaEn: null, rebotadaEn: null, creadaEn: AHORA.toISOString(),
      } as EntregaCorreo & { tenantId: string });
      n += 1;
    }
    return n;
  },
  abrirExcepcion: async (t, clave, tipo) => nuevaExcepcion(t, clave, tipo),
  registrarEvento: async () => undefined,
};

const depsPull: DepsPull = {
  ahora: () => AHORA,
  leerEstado: async (t) => ({
    cursor: bd.cursor.get(t) ?? null, ultimaCorrida: null, ultimoExito: null, ultimoError: null, leidas: 0, importadas: 0, excepciones: 0,
  }),
  guardarEstado: async (t, e) => { if (e.exito && e.cursor !== undefined) bd.cursor.set(t, e.cursor); },
  recibir: (t, d) => recibirDesglose(t, d, depsRecibir),
  abrirExcepcion: async (t, clave, tipo) => nuevaExcepcion(t, clave, tipo),
  excepcionesSinPoliza: async (t) => new Map(bd.excepciones.filter((e) => e.tenantId === t && e.abierta && e.tipo === 'sin_poliza').map((e) => [e.clave, e.id] as const)),
  resolverExcepcion: async (_t, id) => {
    const e = bd.excepciones.find((x) => x.id === id && x.abierta);
    if (!e) return false;
    e.abierta = false;
    return true;
  },
  entregasDe: async (t, id) => bd.entregas.filter((e) => e.tenantId === t && e.liquidacionExternaId === id).map((e) => ({ ...e })),
};

// Resend (límite): captura lo enviado; `fallar` simula un rechazo del proveedor.
interface Envio { tenantId: string; para: string }
const envios: Envio[] = [];
const ctl = { fallarEnvio: false, tamano: 100 };
const depsEntrega: DepsEntrega = {
  ahora: () => AHORA,
  enviar: async (para) => {
    if (ctl.fallarEnvio) return { ok: false, motivo: 'rechazado', detalle: 'rechazo de prueba', status: 422 };
    envios.push({ tenantId: '', para });
    return { ok: true, id: `re_${envios.length}` };
  },
  leerConfig: async (t) => configDe(t),
  reclamar: async (limite, ahora) => {
    const listas = bd.entregas.filter((e) => e.estado === 'pendiente' && Date.parse(e.proximoIntentoEn) <= ahora.getTime()).slice(0, limite);
    for (const e of listas) { e.estado = 'enviando'; e.claimToken = `tok-${e.id}`; }
    return listas.map((e) => ({ ...e }));
  },
  leerContexto: async (_t, id) => {
    const l = bd.liquidaciones.find((x) => x.id === id);
    return l ? { claveExterna: l.claveExterna, periodoDesde: l.periodoDesde, periodoHasta: l.periodoHasta } : null;
  },
  descargarXlsx: async (_t, ruta) => bd.subidas.get(ruta) ?? new Uint8Array([1]),
  marcarEnviada: async (_t, id, _tok, resendId, ahora) => {
    const e = bd.entregas.find((x) => x.id === id && x.estado === 'enviando');
    if (!e) return false;
    Object.assign(e, { estado: 'enviada', resendId, enviadaEn: ahora.toISOString() });
    return true;
  },
  marcarFallida: async (_t, id, _tok, error) => { Object.assign(bd.entregas.find((x) => x.id === id)!, { estado: 'fallida', ultimoError: error }); return true; },
  reprogramar: async (_t, id, _tok, intentos, proximo, error) => {
    Object.assign(bd.entregas.find((x) => x.id === id)!, { estado: 'pendiente', intentos, proximoIntentoEn: proximo.toISOString(), ultimoError: error, claimToken: null });
    return true;
  },
  liquidacionEnviada: async (_t, id) => {
    const l = bd.liquidaciones.find((x) => x.id === id);
    if (!l || l.estado !== 'pendiente') return false;
    l.estado = 'enviada';
    return true;
  },
  registrarEvento: async () => undefined,
  abrirExcepcion: async (t, clave, tipo) => nuevaExcepcion(t, clave, tipo),
};

// ── el TMS falso: cinco bitácoras sintéticas por flota (ok, sin póliza, neto negativo, sin tipo, renglón inválido) ──
const ISO = (h: number) => `2026-10-14T${String(h).padStart(2, '0')}:00:00.000Z`;
function bit(num: string, hora: number, extra: Partial<LiquidacionSintetica> = {}): LiquidacionSintetica {
  return {
    operador: 'Operador Ejemplo', operador_numero: 'E-1', unidad: '526', bitacora: num, de: ISO(hora), a: '2026-10-14T20:00:00.000Z', dias: 6,
    poliza: `P-${num}`, tipo_operador: 'foraneo', terminal: 'T1',
    percepciones: [{ concepto: 'SUELDO SEMANAL', desglose: 'Sueldo', valor: 4000 }, { concepto: 'KM EXTRA', valor: 1000 }],
    deducciones: [{ concepto: 'ANTICIPO', desglose: 'Anticipo', valor: 500 }],
    desglose: { texto: 'x', renglones: 3 }, enviado: false, ...extra,
  };
}
const filasTms = (): LiquidacionSintetica[] => [
  bit('B-0001', 8),
  bit('B-0002', 9, { poliza: null }),
  bit('B-0003', 10, { percepciones: [{ concepto: 'SUELDO SEMANAL', valor: 100 }], deducciones: [{ concepto: 'RETENCION', valor: 300 }] }),
  bit('B-0004', 11, { tipo_operador: undefined }),
  bit('B-0005', 12, { percepciones: [{ concepto: 'SUELDO SEMANAL', valor: '1,5' as unknown as number }] }),
];
const CLAVE = (n: string) => `BIT-T1-B-000${n}`;

const credenciales = { usuario: 'usuario-sintetico', clave: 'clave-sintetica' };
const servidores = new Map<string, ServidorTmsFalso>();
function servidor(tenant: string, filas: LiquidacionSintetica[], opciones: { tam?: number } = {}): ServidorTmsFalso {
  const datos: ConjuntoSintetico = { liquidaciones: filas, peajes: [], viajes: [], posiciones: [] };
  const s = crearServidorTmsFalso({ datos, tamPaginaDefecto: opciones.tam ?? 100, reloj: () => AHORA.getTime(), vigenciaTokenMs: 3_600_000 });
  servidores.set(tenant, s);
  return s;
}

const marcas: string[][] = [];
function depsLectores(): DepsLectores {
  return {
    ahora: () => AHORA.getTime(),
    tenantsConEnvioActivo: async () => [...configs.entries()].filter(([, c]) => c.activa && c.canal !== 'whatsapp').map(([t]) => t),
    canalDeEntrega: async (t) => configDe(t).canal,
    credencial: async (t) => (servidores.has(t)
      ? { valores: { base_url: BASE_TMS, ...credenciales }, probadaEn: '2026-10-01T00:00:00.000Z', ultimoError: null } : null),
    http: (t) => comoHttpDeConector(servidores.get(t)!),
    dormir: async () => undefined,
    config: { ...CONFIG_API_DESGLOSE, tamano: ctl.tamano },
  };
}

/** Una pasada del cron (servicio real) con dobles en los límites. `marcar` = el doble del puerto «marcar enviado» (no existe endpoint). */
async function pasada(opts: { marcar?: boolean } = {}) {
  const deps: Dependencias = {
    entrega: { enviarConFallback: vi.fn() } as unknown as Dependencias['entrega'],
    ahora: () => AHORA,
    razonSocial: async () => 'Flota SA', firmarPdf: async () => 'https://x', avisarNoCoincide: vi.fn() as never,
    formato: async () => null, subirArchivo: async () => undefined, copiarAJefe: vi.fn() as never,
    lectoresPull: async () => {
      const ls = await lectoresDesglosesTms(depsLectores());
      return opts.marcar
        ? ls.map(({ tenantId, lector }) => ({
          tenantId,
          lector: { ...lector, marcarEnviadas: async (claves: string[]): Promise<ResultadoMarcado> => { marcas.push(claves); return { ok: claves, fallidas: [] }; } },
        }))
        : ls;
    },
    pullDeFlota: (t, l) => pullDesgloses(t, l, depsPull),
    entregasCorreo: (limite) => procesarEntregasCorreo(depsEntrega, limite),
  };
  return procesarLiquidacionesExternas(deps, 25);
}

const ACTIVA: ConfigCorreo = { ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true, rhCorreos: ['rh@ejemplo.test'], archivoCorreo: 'archivo@ejemplo.test' };
const liqDe = (t: string, clave: string) => bd.liquidaciones.find((l) => l.tenantId === t && l.claveExterna === clave);
const entregasDe = (t: string) => bd.entregas.filter((e) => e.tenantId === t);

beforeEach(() => { reiniciar(); servidores.clear(); ctl.fallarEnvio = false; ctl.tamano = 100; });

describe('TMS → desglose por correo, de punta a punta (servidor TMS falso)', () => {
  it('caso feliz: lee, mapea, recibe, crea entregas y envía; marca «enviado» en el origen solo cuando salió', async () => {
    configs.set(TENANT_A, ACTIVA);
    servidor(TENANT_A, filasTms());

    const p1 = await pasada({ marcar: true });
    // B-0001 se importó y se envió (operador + RH + archivo); en ESTA pasada aún no salía cuando se leyó: no se marca.
    expect(liqDe(TENANT_A, CLAVE('1'))).toBeDefined();
    expect(liqDe(TENANT_A, CLAVE('1'))!.estado).toBe('enviada');
    expect(entregasDe(TENANT_A).filter((e) => e.estado === 'enviada').map((e) => e.rol).sort()).toEqual(['archivo', 'operador', 'rh']);
    expect(envios).toHaveLength(3);
    expect(p1.pull).toMatchObject({ flotas: 1, errores: 0 });
    expect(marcas.flat()).toEqual([]);

    // Pasada siguiente: la relectura es idempotente y AHORA que el operador ya recibió, se marca SOLO esa bitácora.
    await pasada({ marcar: true });
    expect(marcas.flat()).toEqual([CLAVE('1')]);
    expect(envios).toHaveLength(3);
  });

  it('políticas ya existentes: sin póliza, neto negativo, tipo faltante y renglón inválido se retienen/avisan; nada se inventa ni se envía', async () => {
    configs.set(TENANT_A, ACTIVA);
    servidor(TENANT_A, filasTms());
    await pasada({ marcar: true });

    expect(abiertas(TENANT_A, 'sin_poliza')).toEqual([CLAVE('2')]);
    expect(liqDe(TENANT_A, CLAVE('2'))).toBeUndefined();

    const retenida = (n: string) => bd.desgloses.find((d) => d.liquidacionExternaId === liqDe(TENANT_A, CLAVE(n))?.id);
    expect(retenida('3')?.retenidaMotivo).toMatch(/neto es negativo/);
    expect(retenida('4')?.retenidaMotivo).toMatch(/tipo de operador no viene/);
    for (const n of ['3', '4']) expect(entregasDe(TENANT_A).filter((e) => e.liquidacionExternaId === liqDe(TENANT_A, CLAVE(n))!.id)).toEqual([]);

    expect(abiertas(TENANT_A, 'mapeo_invalido')).toEqual([CLAVE('5')]);
    expect(liqDe(TENANT_A, CLAVE('5'))).toBeUndefined();
    // Nada de lo retenido o rechazado se marcó como enviado en el origen.
    await pasada({ marcar: true });
    expect(marcas.flat()).toEqual([CLAVE('1')]);
  });

  it('idempotencia: dos pasadas no duplican liquidaciones, entregas ni correos', async () => {
    configs.set(TENANT_A, ACTIVA);
    servidor(TENANT_A, filasTms());
    await pasada();
    const antes = { liq: bd.liquidaciones.length, ent: bd.entregas.length, env: envios.length, desg: bd.desgloses.length };
    await pasada();
    await pasada();
    expect({ liq: bd.liquidaciones.length, ent: bd.entregas.length, env: envios.length, desg: bd.desgloses.length }).toEqual(antes);
  });

  it('flota con activa=false: no se lee del TMS, no sale nada y nada se marca', async () => {
    configs.set(TENANT_A, { ...ACTIVA, activa: false });
    const s = servidor(TENANT_A, filasTms());
    const r = await pasada({ marcar: true });
    expect(r.pull).toMatchObject({ flotas: 0 });
    expect(s.logins).toBe(0);
    expect(s.solicitudesDatos).toBe(0);
    expect(bd.liquidaciones).toEqual([]);
    expect(envios).toEqual([]);
    expect(marcas).toEqual([]);
  });

  it('flota sin fila de configuración (valor por defecto): tampoco se lee ni se envía', async () => {
    const s = servidor(TENANT_A, filasTms());
    await pasada();
    expect(s.solicitudesDatos).toBe(0);
    expect(envios).toEqual([]);
  });

  it('activa=true pero se apaga entre la lectura y el envío: se importa, NO sale correo y no se marca', async () => {
    configs.set(TENANT_A, ACTIVA);
    servidor(TENANT_A, filasTms());
    const deps = depsLectores();
    const ls = await lectoresDesglosesTms(deps);
    configs.set(TENANT_A, { ...ACTIVA, activa: false }); // la oficina apaga el interruptor justo ahora
    for (const { tenantId, lector } of ls) await pullDesgloses(tenantId, lector, depsPull);
    const correo = await procesarEntregasCorreo(depsEntrega, 25);
    expect(correo.apagada).toBeGreaterThan(0);
    expect(envios).toEqual([]);
    expect(entregasDe(TENANT_A).every((e) => e.estado === 'pendiente')).toBe(true);
    expect(marcas).toEqual([]);
  });

  it('canal que no es correo: la flota no entra al ciclo aunque tenga el interruptor encendido', async () => {
    configs.set(TENANT_A, { ...ACTIVA, canal: 'whatsapp' });
    const s = servidor(TENANT_A, filasTms());
    const r = await pasada();
    expect(r.pull).toMatchObject({ flotas: 0 });
    expect(s.solicitudesDatos).toBe(0);
    expect(bd.liquidaciones).toEqual([]);
  });

  it('el TMS cae a mitad de la lectura: nada se marca, el cursor no avanza y la siguiente pasada recupera todo', async () => {
    configs.set(TENANT_A, ACTIVA);
    ctl.tamano = 2;
    const s = servidor(TENANT_A, filasTms());
    // Se acepta el login + 1 página; la 2.ª se topa con 429 sostenido.
    s.fallas.limite = { maximo: 1, retryAfterSeg: 0 };
    const r = await pasada({ marcar: true });
    expect(r.pull).toMatchObject({ flotas: 1, errores: 1 });
    expect(bd.liquidaciones).toEqual([]);
    expect(bd.cursor.get(TENANT_A) ?? null).toBeNull();
    expect(envios).toEqual([]);
    expect(marcas).toEqual([]);

    s.fallas.limite = undefined;
    const r2 = await pasada({ marcar: true });
    expect(r2.pull).toMatchObject({ errores: 0 });
    expect(liqDe(TENANT_A, CLAVE('1'))!.estado).toBe('enviada');
  });

  it('si el correo del operador NO salió (rechazo del proveedor), no se marca «enviado» en el origen', async () => {
    configs.set(TENANT_A, ACTIVA);
    servidor(TENANT_A, filasTms());
    ctl.fallarEnvio = true;
    await pasada({ marcar: true });
    await pasada({ marcar: true });
    expect(entregasDe(TENANT_A).some((e) => e.rol === 'operador' && e.estado === 'enviada')).toBe(false);
    expect(marcas.flat()).toEqual([]);
  });

  it('aislamiento por flota: cada una lee con SU credencial y SUS datos; nada cruza de una a otra', async () => {
    configs.set(TENANT_A, ACTIVA);
    configs.set(TENANT_B, ACTIVA);
    servidor(TENANT_A, [bit('B-0001', 8)]);
    servidor(TENANT_B, [bit('B-0001', 8), bit('B-0007', 9)]);
    await pasada();
    expect(bd.liquidaciones.filter((l) => l.tenantId === TENANT_A).map((l) => l.claveExterna)).toEqual([CLAVE('1')]);
    expect(bd.liquidaciones.filter((l) => l.tenantId === TENANT_B).map((l) => l.claveExterna).sort()).toEqual([CLAVE('1'), CLAVE('7')]);
    // Las entregas de cada flota cuelgan solo de liquidaciones de esa flota.
    for (const e of bd.entregas) expect(bd.liquidaciones.find((l) => l.id === e.liquidacionExternaId)!.tenantId).toBe(e.tenantId);
    // Cada flota tiene su propio cursor.
    expect(bd.cursor.get(TENANT_A)).toBeTruthy();
    expect(bd.cursor.get(TENANT_B)).toBeTruthy();
  });
});
