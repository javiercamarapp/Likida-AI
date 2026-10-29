import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatoInvalido, OperadorDeBaja } from '../errores';
import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { DESGLOSE_SINTETICO } from './desglose.fixture';
import type { DesgloseBitacora } from './desglose_contrato';
import { huellaContenido, huellaDesglose } from './esquema';
import { aLiquidacionExterna } from './desglose_contrato';
import type { LiquidacionExterna, NuevaLiquidacionExterna } from './repo';
import { CONFIG_CORREO_POR_DEFECTO, type ConfigCorreo, type NuevaEntrega } from './repo_correo';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('la base no debe tocarse en estas pruebas'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { recibirDesglose, renombresDeConfig, presentar } = await import('./desglose_recibir');
type Deps = import('./desglose_recibir').DependenciasDesglose;

// ═══════════════════════════════════════════════════════════════════════════
// recibirDesglose (T-A1-15). Todo con dobles en memoria y datos sintéticos: ningún nombre, correo ni importe reales.
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = '00000000-0000-4000-8000-000000000001';
const OP_ID = '00000000-0000-4000-8000-0000000000a1';
const COORD_ID = '00000000-0000-4000-8000-0000000000c1';

const f = DESGLOSE_SINTETICO;
const desglose = (extra: Partial<DesgloseBitacora> = {}): DesgloseBitacora => ({
  terminal: 'T1',
  bitacora: f.bitacora,
  poliza: 'P-1',
  operador: { numeroEmpleado: 'E-1', nombre: f.operador.nombre },
  unidad: f.unidad,
  tipoOperador: 'foraneo',
  desde: f.desde,
  hasta: f.hasta,
  dias: f.dias,
  percepciones: f.percepciones.map((r) => ({ concepto: r.descripcion, monto: r.monto })),
  deducciones: f.deducciones.map((r) => ({ concepto: r.descripcion, monto: r.monto, ...(r.vale ? { vale: r.vale } : {}) })),
  neto: f.esperado.neto,
  ...extra,
});

const CONFIG: ConfigCorreo = {
  ...CONFIG_CORREO_POR_DEFECTO,
  canal: 'correo', activa: true,
  rhCorreos: ['rh@ejemplo.test'], archivoCorreo: 'archivo@ejemplo.test',
};

interface Banco {
  deps: Deps;
  liquidaciones: LiquidacionExterna[];
  desgloses: Array<Record<string, unknown>>;
  entregas: NuevaEntrega[];
  excepciones: Array<{ clave: string; tipo: string; detalle: Record<string, unknown> }>;
  eventos: string[];
  detallesEvento: Array<Record<string, unknown>>;
  resueltas: string[];
  subidas: Array<{ ruta: string; bytes: Uint8Array }>;
  orden: string[];
  /** A1-01/A1-02: ids de liquidación cuyas entregas pendientes se pasaron a `omitida` (y con qué motivo). */
  omitidasIds: string[];
  motivosOmision: string[];
}

function banco(opciones: {
  config?: Partial<ConfigCorreo>;
  operador?: 'ok' | 'inexistente';
  correoOperador?: string | null;
  coordinador?: { correo: string; activo: boolean } | null;
  fallaStorage?: boolean;
} = {}): Banco {
  const b: Banco = { deps: null as unknown as Deps, liquidaciones: [], desgloses: [], entregas: [], excepciones: [], eventos: [], detallesEvento: [], resueltas: [], subidas: [], orden: [], omitidasIds: [], motivosOmision: [] };
  const correoOperador = opciones.correoOperador === undefined ? 'operador@ejemplo.test' : opciones.correoOperador;
  const coordinador = opciones.coordinador === undefined ? { correo: 'coordinador@ejemplo.test', activo: true } : opciones.coordinador;
  b.deps = {
    ahora: () => new Date('2026-10-15T12:00:00Z'),
    leerConfig: async () => ({ ...CONFIG, ...opciones.config }),
    buscarPorClave: async (_t, clave) => b.liquidaciones.find((l) => l.claveExterna === clave) ?? null,
    resolverOperador: async () => {
      if (opciones.operador === 'inexistente') throw new DatoInvalido('No encontré a ese operador en tu flota.');
      return { id: OP_ID, nombre: f.operador.nombre, telefono: '5210000000000', activo: true };
    },
    resolverViajeIds: async () => [],
    leerContacto: async () => ({ operadorId: OP_ID, correo: correoOperador, correoRebotadoEn: null, coordinadorId: coordinador ? COORD_ID : null }),
    leerCoordinador: async () => (coordinador ? { id: COORD_ID, nombre: null, correo: coordinador.correo, activo: coordinador.activo } : null),
    subirXlsx: async (t, clave, huella, bytes) => {
      b.orden.push('subir');
      if (opciones.fallaStorage) throw new Error('storage caído');
      const ruta = `${t}/${clave}-${huella.slice(0, 8)}.xlsx`;
      b.subidas.push({ ruta, bytes });
      return ruta;
    },
    insertarLiquidacion: async (n: NuevaLiquidacionExterna) => {
      b.orden.push('insertar');
      const l = {
        id: `liq-${b.liquidaciones.length + 1}`, tenantId: n.tenantId, claveExterna: n.datos.claveExterna, huella: n.huella,
        sistemaOrigen: n.datos.sistemaOrigen, operadorId: n.operadorId, total: n.datos.total, pdfRuta: n.pdfRuta, pdfOrigen: n.pdfOrigen,
        estado: 'pendiente', generacion: 1,
      } as unknown as LiquidacionExterna;
      b.liquidaciones.push(l);
      return l;
    },
    insertarDesglose: async (_t, m) => { b.desgloses.push({ ...m }); return true; },
    insertarEntregas: async (_t, filas) => { b.entregas.push(...filas); return filas.length; },
    omitirPendientes: async (_t, ids, motivo) => {
      b.orden.push('omitir');
      b.omitidasIds.push(...ids);
      b.motivosOmision.push(motivo);
      return b.entregas.filter((e) => ids.includes(e.liquidacionExternaId) && e.estado !== 'omitida').length;
    },
    abrirExcepcion: async (_t, clave, tipo, detalle) => {
      b.excepciones.push({ clave, tipo, detalle });
      return { id: b.excepciones.length, nueva: true };
    },
    registrarEvento: async (_t, _id, tipo, detalle) => { b.eventos.push(tipo); b.detallesEvento.push(detalle ?? {}); },
    resolverExcepciones: async (_t, clave, tipo) => {
      const antes = b.resueltas.length;
      b.resueltas.push(`${clave}|${tipo}`);
      return b.resueltas.length - antes;
    },
  };
  return b;
}

describe('recibirDesglose: camino feliz', () => {
  it('una bitácora sintética => 1 liquidación, 1 desglose, 4 entregas (operador, coordinador, RH, archivo)', async () => {
    const b = banco();
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r.estado).toBe('creada');
    if (r.estado !== 'creada') return;
    expect(r.retenida).toBe(false);
    expect(b.liquidaciones).toHaveLength(1);
    expect(b.desgloses).toHaveLength(1);
    expect(b.entregas.map((e) => e.rol)).toEqual(['operador', 'coordinador', 'rh', 'archivo']);
    expect(r.entregas).toBe(4);
    expect(b.excepciones).toHaveLength(0);
    expect(b.eventos).toEqual(['recibida']);
    expect(b.desgloses[0]).toMatchObject({ bitacora: 'B-0001', totalOrigen: 'tms', tipoOperador: 'foraneo', dias: 6, retenidaMotivo: null });
  });

  it('el Excel se sube antes que la fila, la fila no lleva PDF y todas las entregas apuntan al mismo archivo con su sha-256', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose(), b.deps);
    expect(b.orden).toEqual(['subir', 'insertar']);
    expect(b.liquidaciones[0]).toMatchObject({ pdfRuta: null, pdfOrigen: 'generado' });
    expect(b.subidas).toHaveLength(1);
    expect(b.subidas[0].bytes.length).toBeGreaterThan(1000);
    // un .xlsx es un zip
    expect(Array.from(b.subidas[0].bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    const rutas = new Set(b.entregas.map((e) => e.xlsxRuta));
    expect(rutas).toEqual(new Set([b.subidas[0].ruta]));
    expect(b.entregas.every((e) => /^[0-9a-f]{64}$/.test(e.xlsxSha256 ?? ''))).toBe(true);
    expect(b.entregas.every((e) => e.disparo === 'auto')).toBe(true);
  });

  it('sin neto de la fuente: total calculado y el desglose lo marca como `calculado`', async () => {
    const b = banco();
    const { neto: _omitido, ...sinNeto } = desglose();
    await recibirDesglose(TENANT, sinNeto, b.deps);
    expect(b.desgloses[0].totalOrigen).toBe('calculado');
    expect(b.liquidaciones[0].total).toBe(4850);
  });
});

describe('recibirDesglose: idempotencia y correcciones', () => {
  it('segunda llamada idéntica => idempotente, 0 inserciones, 0 archivos y 0 entregas nuevas', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose(), b.deps);
    const antes = { liq: b.liquidaciones.length, des: b.desgloses.length, ent: b.entregas.length, sub: b.subidas.length, ev: b.eventos.length };
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r.estado).toBe('idempotente');
    expect({ liq: b.liquidaciones.length, des: b.desgloses.length, ent: b.entregas.length, sub: b.subidas.length, ev: b.eventos.length }).toEqual(antes);
    expect(b.excepciones).toHaveLength(0);
  });

  it('misma clave y neto distinto => correccion_pendiente con neto antes/después, sin entregas ni sobrescribir', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose(), b.deps);
    const entregasAntes = b.entregas.length;
    const huellaAntes = b.liquidaciones[0].huella;
    const distinto = desglose({ neto: 4000, percepciones: [{ concepto: 'Sueldo', monto: 9000 }], deducciones: [{ concepto: 'Retención uno', monto: 5000 }] });
    const r = await recibirDesglose(TENANT, distinto, b.deps);
    expect(r.estado).toBe('correccion_pendiente');
    expect(b.entregas).toHaveLength(entregasAntes);
    expect(b.liquidaciones).toHaveLength(1);
    expect(b.liquidaciones[0].huella).toBe(huellaAntes);
    expect(b.subidas).toHaveLength(1);
    expect(b.excepciones).toHaveLength(1);
    expect(b.excepciones[0]).toMatchObject({ tipo: 'correccion_pendiente', detalle: { bitacora: 'B-0001', cambioElNeto: true } });
    // A37-A1-liquidaciones-15: ninguna cifra de dinero queda en el detalle de la excepción.
    expect(JSON.stringify(b.excepciones[0].detalle)).not.toMatch(/4850|4000/);
  });

  it('A37-A1-02: quien administra decide mandar la corrección => liquidación NUEVA «-R1», xlsx y entregas nuevas, la original intacta y la pendiente se cierra', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose(), b.deps);
    const original = { ...b.liquidaciones[0] };
    const distinto = desglose({ neto: 4000, percepciones: [{ concepto: 'Sueldo', monto: 9000 }], deducciones: [{ concepto: 'Retención uno', monto: 5000 }] });
    const r = await recibirDesglose(TENANT, distinto, b.deps, { correccion: { motivo: 'nómina corregida en origen', actor: 'llave:administracion' } });
    expect(r).toMatchObject({ estado: 'creada', claveExterna: 'BIT-T1-B-0001-R1', correccionDe: 'BIT-T1-B-0001', retenida: false });
    expect(b.liquidaciones).toHaveLength(2);
    expect(b.liquidaciones[0]).toEqual(original); // nunca se sobrescribe
    expect(b.liquidaciones[1]).toMatchObject({ claveExterna: 'BIT-T1-B-0001-R1', total: 4000 });
    expect(b.subidas).toHaveLength(2); // xlsx nuevo
    expect(b.entregas.filter((e) => e.liquidacionExternaId === 'liq-2')).toHaveLength(4);
    expect(b.resueltas.filter((x) => x.endsWith('|correccion_pendiente'))).toEqual(['BIT-T1-B-0001|correccion_pendiente']);
    expect(b.detallesEvento[1]).toMatchObject({ correccion_de: 'BIT-T1-B-0001', motivo_correccion: 'nómina corregida en origen', actor: 'llave:administracion' });
    expect(b.excepciones.filter((e) => e.tipo === 'correccion_pendiente')).toHaveLength(0);
    // A39-A1-01: la corrección comparte bitácora, terminal y número con la original; los índices únicos de la base (0929) se
    // distinguen por `correccionN`. La original no lo lleva (0); la corrección, su ordinal.
    expect(b.desgloses[0].correccionN).toBeUndefined();
    expect(b.desgloses[1]).toMatchObject({ bitacora: 'B-0001', terminal: 'T1', correccionN: 1 });
  });

  it('A37-A1-02: reintentar la MISMA corrección es idempotente; otra distinta es «-R2»', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose(), b.deps);
    const c1 = desglose({ neto: 4000, percepciones: [{ concepto: 'Sueldo', monto: 9000 }], deducciones: [{ concepto: 'Retención uno', monto: 5000 }] });
    const c2 = desglose({ neto: 3000, percepciones: [{ concepto: 'Sueldo', monto: 8000 }], deducciones: [{ concepto: 'Retención uno', monto: 5000 }] });
    const op = { correccion: { motivo: 'otra vez', actor: 'a' } };
    await recibirDesglose(TENANT, c1, b.deps, op);
    const entregasAntes = b.entregas.length;
    const otra = await recibirDesglose(TENANT, c1, b.deps, op);
    expect(otra).toMatchObject({ estado: 'idempotente', claveExterna: 'BIT-T1-B-0001-R1' });
    expect(b.entregas).toHaveLength(entregasAntes);
    const r2 = await recibirDesglose(TENANT, c2, b.deps, op);
    expect(r2).toMatchObject({ estado: 'creada', claveExterna: 'BIT-T1-B-0001-R2' });
    expect(b.liquidaciones).toHaveLength(3);
    expect(b.desgloses.map((d) => d.correccionN)).toEqual([undefined, 1, 2]);
  });

  it('A37-A1-02: sin la decisión de la persona la corrección sigue SIN enviarse (solo la excepción), y una bitácora nueva con «correccion» entra normal', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose(), b.deps);
    const r = await recibirDesglose(TENANT, desglose({ neto: 4000, percepciones: [{ concepto: 'Sueldo', monto: 9000 }], deducciones: [{ concepto: 'Retención uno', monto: 5000 }] }), b.deps);
    expect(r.estado).toBe('correccion_pendiente');
    const b2 = banco();
    const nueva = await recibirDesglose(TENANT, desglose(), b2.deps, { correccion: { motivo: 'por si acaso', actor: 'a' } });
    expect(nueva).toMatchObject({ estado: 'creada', claveExterna: 'BIT-T1-B-0001' });
    expect((nueva as { correccionDe?: string }).correccionDe).toBeUndefined();
  });

  it('la huella que se guarda es la del contrato (no la del Excel renombrado)', async () => {
    const b = banco({ config: { renombres: [{ patron: 'taxi', a: 'Otros' }] } });
    await recibirDesglose(TENANT, desglose(), b.deps);
    const esperada = huellaDesglose(aLiquidacionExterna(desglose(), { sistemaOrigen: 'desglose-bitacora' }).liquidacion);
    expect(b.liquidaciones[0].huella).toBe(esperada);
  });

  describe('A37-A1-liquidaciones-09: la huella no depende del orden de renglones ni del sistema de origen', () => {
    it('la misma bitácora con los renglones en OTRO orden es idempotente (no «correccion_pendiente»)', async () => {
      const b = banco();
      await recibirDesglose(TENANT, desglose(), b.deps);
      const d = desglose();
      const alReves = desglose({ percepciones: [...d.percepciones].reverse(), deducciones: [...d.deducciones].reverse() });
      expect((await recibirDesglose(TENANT, alReves, b.deps)).estado).toBe('idempotente');
      expect(b.excepciones).toHaveLength(0);
    });
    it('POST (origen «-api») y luego pull (origen por omisión) de lo mismo ⇒ idempotente', async () => {
      const b = banco();
      await recibirDesglose(TENANT, desglose(), b.deps, { sistemaOrigen: 'desglose-bitacora-api' });
      const r = await recibirDesglose(TENANT, desglose(), b.deps);
      expect(r.estado).toBe('idempotente');
      expect(b.excepciones).toHaveLength(0);
    });
    it('una fila guardada ANTES con la huella anterior (orden recibido + origen) sigue reconociéndose, sin falsa corrección', async () => {
      const b = banco();
      const liq = aLiquidacionExterna(desglose(), { sistemaOrigen: 'desglose-bitacora-api' }).liquidacion;
      b.liquidaciones.push({ id: 'liq-previa', tenantId: TENANT, claveExterna: liq.claveExterna, huella: huellaContenido(liq), total: liq.total } as unknown as LiquidacionExterna);
      const r = await recibirDesglose(TENANT, desglose(), b.deps); // origen por omisión: la huella anterior era otra
      expect(r.estado).toBe('idempotente');
      expect(b.excepciones).toHaveLength(0);
    });
    it('un cambio REAL de importe sigue siendo correccion_pendiente (no se vuelve ciega)', async () => {
      const b = banco();
      await recibirDesglose(TENANT, desglose(), b.deps);
      const d = desglose();
      const otro = desglose({ percepciones: d.percepciones.map((r, i) => (i === 0 ? { ...r, monto: r.monto + 1 } : r)), neto: (d.neto ?? 0) + 1 });
      expect((await recibirDesglose(TENANT, otro, b.deps)).estado).toBe('correccion_pendiente');
    });
    it('la huella canónica: distinto orden = igual; distinto importe = distinta', () => {
      const l = aLiquidacionExterna(desglose(), { sistemaOrigen: 'A' }).liquidacion;
      expect(huellaDesglose({ ...l, conceptos: [...l.conceptos].reverse(), sistemaOrigen: 'B' })).toBe(huellaDesglose(l));
      expect(huellaDesglose({ ...l, total: l.total + 0.01 })).not.toBe(huellaDesglose(l));
    });
  });
});

describe('recibirDesglose: guardas previas al envío', () => {
  it('neto negativo (config retener) => liquidación pendiente retenida, 0 entregas y excepción neto_negativo', async () => {
    const b = banco();
    const negativo = desglose({
      neto: -100,
      percepciones: [{ concepto: 'Sueldo', monto: 100 }],
      deducciones: [{ concepto: 'Retención uno', monto: 200 }],
    });
    const r = await recibirDesglose(TENANT, negativo, b.deps);
    expect(r).toMatchObject({ estado: 'creada', retenida: true, entregas: 0, motivos: ['neto_negativo'], excepciones: ['neto_negativo'] });
    expect(b.liquidaciones).toHaveLength(1);
    expect(b.entregas).toHaveLength(0);
    expect(b.desgloses[0].retenidaMotivo).toBe('El neto es negativo.');
    expect(b.excepciones.map((e) => e.tipo)).toEqual(['neto_negativo']);
    // el archivo sí queda subido: una persona puede liberarlo después
    expect(b.subidas).toHaveLength(1);
  });

  it('neto negativo con config `enviar` => sale normalmente', async () => {
    const b = banco({ config: { netoNegativo: 'enviar' } });
    const r = await recibirDesglose(TENANT, desglose({
      neto: -100, percepciones: [{ concepto: 'Sueldo', monto: 100 }], deducciones: [{ concepto: 'Retención uno', monto: 200 }],
    }), b.deps);
    expect(r).toMatchObject({ estado: 'creada', retenida: false });
    expect(b.entregas.length).toBeGreaterThan(0);
  });

  it('permisionario (tipo sin regla) y concepto prohibido => retenida con un motivo por cada guarda', async () => {
    const b = banco({ config: { conceptosProhibidos: ['talacha'] } });
    const r = await recibirDesglose(TENANT, desglose({ tipoOperador: 'permisionario' }), b.deps);
    expect(r.estado).toBe('creada');
    if (r.estado !== 'creada') return;
    expect(r.retenida).toBe(true);
    expect(r.motivos.sort()).toEqual(['concepto_prohibido', 'tipo_sin_regla']);
    expect(b.excepciones.map((e) => e.tipo).sort()).toEqual(['concepto_prohibido', 'tipo_sin_regla']);
    expect(b.entregas).toHaveLength(0);
  });

  it('las reglas del contralor cambian lo que se ve pero no el neto guardado', async () => {
    const b = banco({ config: { agruparViaje: true, renombres: [{ patron: 'taxi|talacha', a: 'Otros' }] } });
    await recibirDesglose(TENANT, desglose(), b.deps);
    expect(b.liquidaciones[0].total).toBe(4850);
    expect(b.entregas).toHaveLength(4);
  });
});

describe('recibirDesglose: sin póliza no se envía (también por push/archivo)', () => {
  it('poliza null => estado sin_poliza, excepción abierta y NADA guardado ni subido ni enviado', async () => {
    const b = banco();
    const r = await recibirDesglose(TENANT, desglose({ poliza: null }), b.deps);
    expect(r).toEqual({ estado: 'sin_poliza', claveExterna: 'BIT-T1-B-0001' });
    expect(b.liquidaciones).toHaveLength(0);
    expect(b.subidas).toHaveLength(0);
    expect(b.entregas).toHaveLength(0);
    expect(b.excepciones).toEqual([{ clave: 'BIT-T1-B-0001', tipo: 'sin_poliza', detalle: { bitacora: 'B-0001', desde: f.desde } }]);
  });

  it('cuando la misma bitácora llega CON póliza entra normal (no queda «idempotente» contra una fila vacía) y cierra la excepción', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose({ poliza: null }), b.deps);
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r.estado).toBe('creada');
    expect(b.entregas).toHaveLength(4);
    expect(b.resueltas).toContain('BIT-T1-B-0001|sin_poliza');
  });

  it('con póliza vacía también se aparta; con póliza el flujo de siempre no cambia', async () => {
    const b = banco();
    const r = await recibirDesglose(TENANT, desglose({ poliza: '' }), b.deps);
    expect(r.estado).toBe('sin_poliza');
    expect(b.liquidaciones).toHaveLength(0);
  });
});

describe('recibirDesglose: operador y destinatarios', () => {
  it('A37-A1-liquidaciones-12: operador de BAJA ⇒ misma excepción pero con motivo «baja» (no «no_existe»)', async () => {
    const b = banco();
    b.deps.resolverOperador = async () => { throw new OperadorDeBaja('Ese operador está dado de baja'); };
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r.estado).toBe('operador_no_encontrado');
    expect(b.excepciones[0]).toMatchObject({ tipo: 'operador_no_encontrado', detalle: { bitacora: 'B-0001', motivo: 'baja' } });
  });

  it('operador inexistente => resultado operador_no_encontrado, excepción y nada escrito', async () => {
    const b = banco({ operador: 'inexistente' });
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r).toMatchObject({ estado: 'operador_no_encontrado', claveExterna: 'BIT-T1-B-0001' });
    expect(b.excepciones.map((e) => e.tipo)).toEqual(['operador_no_encontrado']);
    expect(b.liquidaciones).toHaveLength(0);
    expect(b.subidas).toHaveLength(0);
    expect(b.entregas).toHaveLength(0);
  });

  it('un error que no es de datos al resolver el operador se propaga (no se confunde con "no existe")', async () => {
    const b = banco();
    b.deps.resolverOperador = async () => { throw new Error('base caída'); };
    await expect(recibirDesglose(TENANT, desglose(), b.deps)).rejects.toThrow('base caída');
    expect(b.excepciones).toHaveLength(0);
  });

  it('operador sin correo => 3 entregas (coordinador, RH, archivo) y excepción operador_sin_correo', async () => {
    const b = banco({ correoOperador: null });
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r).toMatchObject({ estado: 'creada', entregas: 3, excepciones: ['operador_sin_correo'] });
    expect(b.entregas.map((e) => e.rol)).toEqual(['coordinador', 'rh', 'archivo']);
    expect(b.excepciones.map((e) => e.tipo)).toEqual(['operador_sin_correo']);
  });

  it('con archivo_correo => una entrega más al archivo con el mismo Excel; sin él => ninguna', async () => {
    const con = banco();
    await recibirDesglose(TENANT, desglose(), con.deps);
    const delArchivo = con.entregas.filter((e) => e.rol === 'archivo');
    expect(delArchivo.map((e) => e.correo)).toEqual(['archivo@ejemplo.test']);
    expect(delArchivo[0]?.xlsxRuta).toBe(con.entregas[0]?.xlsxRuta);
    expect(delArchivo[0]?.xlsxSha256).toBe(con.entregas[0]?.xlsxSha256);

    const sin = banco({ config: { archivoCorreo: null } });
    const r = await recibirDesglose(TENANT, desglose(), sin.deps);
    expect(r).toMatchObject({ estado: 'creada', entregas: 3, excepciones: [] });
    expect(sin.entregas.map((e) => e.rol)).toEqual(['operador', 'coordinador', 'rh']);
  });

  it('sin coordinador asignado => 3 entregas y excepción coordinador_sin_correo', async () => {
    const b = banco({ coordinador: null });
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r).toMatchObject({ estado: 'creada', entregas: 3, excepciones: ['coordinador_sin_correo'] });
    expect(b.entregas.map((e) => e.rol)).toEqual(['operador', 'rh', 'archivo']);
  });

  it('nada de importes ni nombres en el detalle de las excepciones', async () => {
    const b = banco({ correoOperador: null, coordinador: null });
    await recibirDesglose(TENANT, desglose(), b.deps);
    const texto = JSON.stringify(b.excepciones);
    expect(texto).not.toContain(f.operador.nombre);
    expect(texto).not.toMatch(/\d{4}\.\d{2}|4850/);
  });
});

describe('recibirDesglose: fallos', () => {
  it('fallo de Storage => lanza y NO deja fila, desglose, evento ni entregas', async () => {
    const b = banco({ fallaStorage: true });
    await expect(recibirDesglose(TENANT, desglose(), b.deps)).rejects.toThrow('storage caído');
    expect(b.liquidaciones).toHaveLength(0);
    expect(b.desgloses).toHaveLength(0);
    expect(b.eventos).toHaveLength(0);
    expect(b.entregas).toHaveLength(0);
    expect(b.orden).toEqual(['subir']);
  });

  it('un desglose que no cumple el contrato lanza CampoInvalido antes de tocar nada', async () => {
    const b = banco();
    await expect(recibirDesglose(TENANT, desglose({ bitacora: '' }), b.deps)).rejects.toBeInstanceOf(CampoInvalido);
    expect(b.subidas).toHaveLength(0);
    expect(b.liquidaciones).toHaveLength(0);
  });

  it('reintentar tras el fallo de Storage (ya sano) crea todo una sola vez', async () => {
    const b = banco({ fallaStorage: true });
    await expect(recibirDesglose(TENANT, desglose(), b.deps)).rejects.toThrow();
    const sano = banco();
    const r1 = await recibirDesglose(TENANT, desglose(), sano.deps);
    const r2 = await recibirDesglose(TENANT, desglose(), sano.deps);
    expect(r1.estado).toBe('creada');
    expect(r2.estado).toBe('idempotente');
    expect(sano.liquidaciones).toHaveLength(1);
  });
});

describe('renombresDeConfig', () => {
  it('convierte el JSON de la config y descarta entradas rotas sin lanzar', () => {
    const r = renombresDeConfig([
      { patron: 'diesel|urea', a: 'Otros', fusionar: true },
      { patron: '([', a: 'Mala' },
      { patron: 'x' },
      null,
      'texto',
      { patron: /taxi/i, a: 'Transporte' },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ a: 'Otros', fusionar: true });
    expect(r[0].patron.test('Diesel')).toBe(true);
    expect(r[1].a).toBe('Transporte');
  });
});

beforeEach(() => { vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// Hallazgo A35-A1-01: la recepción es atómica (RPC 0857) y lo que quedó a medias se rescata.
// ═══════════════════════════════════════════════════════════════════════════

type Pedido = import('./repo_correo').PedidoRecepcionAtomica;

/** Agrega al banco una RPC atómica en memoria: o guarda todo junto, o no guarda nada (como la transacción real). */
/** `ok0933`: la RPC redefinida por la 0933 (una retenida admite SOLO la entrega al revisor); `ok`, la de la 0929. */
function conAtomica(b: Banco, modo: 'ok' | 'ok0933' | 'ausente' | 'falla'): { llamadas: Pedido[] } {
  const llamadas: Pedido[] = [];
  b.deps.desgloseIncompleto = async (_t, id) => {
    const tiene = b.desgloses.some((x) => x.liquidacionExternaId === id);
    const retenida = b.desgloses.some((x) => x.liquidacionExternaId === id && x.retenidaMotivo);
    return !tiene || (!retenida && !b.entregas.some((e) => e.liquidacionExternaId === id));
  };
  b.deps.recibirAtomico = async (_t, p) => {
    llamadas.push(p);
    if (modo === 'ausente') return { ok: false, motivo: 'no_disponible' };
    if (modo === 'falla') throw new Error('liqcorreo.recibir_atomico: corte a mitad'); // la transacción revierte: nada se guarda
    b.orden.push('atomica');
    let liq = b.liquidaciones.find((l) => l.claveExterna === p.liquidacion.datos.claveExterna);
    const creada = !liq;
    if (!liq) {
      liq = { id: `liq-${b.liquidaciones.length + 1}`, tenantId: p.liquidacion.tenantId, claveExterna: p.liquidacion.datos.claveExterna,
        huella: p.liquidacion.huella, total: p.liquidacion.datos.total } as unknown as LiquidacionExterna;
      b.liquidaciones.push(liq);
    }
    const id = liq.id;
    const faltaDesglose = !b.desgloses.some((x) => x.liquidacionExternaId === id);
    if (faltaDesglose) { b.desgloses.push({ liquidacionExternaId: id, ...p.meta }); b.eventos.push('recibida'); }
    const hayEntregas = b.entregas.some((e) => e.liquidacionExternaId === id);
    let n = 0;
    const admitidas = p.meta.retenidaMotivo ? (modo === 'ok0933' ? p.entregas.filter((e) => e.rol === 'revisor') : []) : p.entregas;
    if (!hayEntregas && admitidas.length > 0) { for (const e of admitidas) b.entregas.push({ liquidacionExternaId: id, ...e }); n = admitidas.length; }
    return { ok: true, valor: { liquidacionId: id, creada, reparada: !creada && (faltaDesglose || n > 0), entregas: n } };
  };
  return { llamadas };
}

describe('recibirDesglose: recepción atómica (RPC 0857)', () => {
  it('con la RPC: una sola llamada lleva liquidación, encabezado, evento y las 4 entregas; no hay inserciones sueltas', async () => {
    const b = banco();
    const sueltas = vi.fn();
    b.deps.insertarLiquidacion = sueltas; b.deps.insertarDesglose = sueltas; b.deps.insertarEntregas = sueltas; b.deps.registrarEvento = sueltas;
    const { llamadas } = conAtomica(b, 'ok');
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(sueltas).not.toHaveBeenCalled();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].entregas.map((e) => e.rol)).toEqual(['operador', 'coordinador', 'rh', 'archivo']);
    expect(llamadas[0].meta).toMatchObject({ bitacora: 'B-0001', totalOrigen: 'tms', retenidaMotivo: null });
    expect(llamadas[0].evento).toMatchObject({ canal: 'correo', retenida: false });
    expect(b.orden).toEqual(['subir', 'atomica']);
    expect(r).toMatchObject({ estado: 'creada', entregas: 4, retenida: false });
  });

  it('retenida: la RPC va sin entregas y con el motivo; se abren las excepciones', async () => {
    const b = banco();
    const { llamadas } = conAtomica(b, 'ok');
    const r = await recibirDesglose(TENANT, desglose({ neto: -5, percepciones: [{ concepto: 'Sueldo', monto: 100 }], deducciones: [{ concepto: 'Anticipo', monto: 105 }] }), b.deps);
    expect(llamadas[0].entregas).toHaveLength(0);
    expect(llamadas[0].meta.retenidaMotivo).toBeTruthy();
    expect(r).toMatchObject({ estado: 'creada', retenida: true, entregas: 0 });
    expect(b.excepciones.map((e) => e.tipo)).toContain('neto_negativo');
  });

  it('un corte dentro de la RPC lanza y NO deja nada; el reintento crea todo una sola vez', async () => {
    const roto = banco();
    conAtomica(roto, 'falla');
    await expect(recibirDesglose(TENANT, desglose(), roto.deps)).rejects.toThrow('corte a mitad');
    expect([roto.liquidaciones.length, roto.desgloses.length, roto.eventos.length, roto.entregas.length]).toEqual([0, 0, 0, 0]);

    const sano = banco();
    conAtomica(sano, 'ok');
    const r1 = await recibirDesglose(TENANT, desglose(), sano.deps);
    const r2 = await recibirDesglose(TENANT, desglose(), sano.deps);
    expect(r1.estado).toBe('creada');
    expect(r2.estado).toBe('idempotente');
    expect(sano.entregas).toHaveLength(4);
    expect(sano.liquidaciones).toHaveLength(1);
  });

  it('la base aún no tiene la 0857: cae al camino anterior, lo avisa en el log y deja todo igual que antes', async () => {
    const { logger } = await import('@/lib/logger');
    (logger.warn as ReturnType<typeof vi.fn>).mockClear();
    const b = banco();
    const { llamadas } = conAtomica(b, 'ausente');
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(llamadas).toHaveLength(1);
    expect(b.orden).toEqual(['subir', 'insertar']);
    expect(r).toMatchObject({ estado: 'creada', entregas: 4 });
    expect(b.liquidaciones).toHaveLength(1);
    expect(b.desgloses).toHaveLength(1);
    expect(b.eventos).toEqual(['recibida']);
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toContain('liqcorreo.recepcion_no_atomica');
  });

  it('una carrera: otra recepción ya lo guardó completo => idempotente, sin excepciones ni reenvío', async () => {
    const b = banco();
    conAtomica(b, 'ok');
    await recibirDesglose(TENANT, desglose(), b.deps);
    b.deps.buscarPorClave = async () => null; // esta recepción no la vio al empezar
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r.estado).toBe('idempotente');
    expect(b.entregas).toHaveLength(4);
  });
});

describe('recibirDesglose: rescate de una recepción que quedó a medias', () => {
  /** Reproduce el estado que dejaba el camino anterior: la fila existe con la misma huella, sin encabezado ni entregas. */
  function aMedias(b: Banco): void {
    const liq = aLiquidacionExterna(desglose(), { sistemaOrigen: 'desglose-bitacora' }).liquidacion;
    b.liquidaciones.push({ id: 'liq-previa', tenantId: TENANT, claveExterna: liq.claveExterna, huella: huellaContenido(liq), total: liq.total } as unknown as LiquidacionExterna);
  }

  it('con la RPC: la misma huella sin encabezado ni entregas NO es idempotente: se completa sobre la misma fila', async () => {
    const b = banco();
    conAtomica(b, 'ok');
    aMedias(b);
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r).toMatchObject({ estado: 'creada', liquidacionId: 'liq-previa', entregas: 4 });
    expect(b.liquidaciones).toHaveLength(1);
    expect(b.desgloses).toHaveLength(1);
    expect(b.entregas).toHaveLength(4);
    expect(b.entregas.every((e) => e.liquidacionExternaId === 'liq-previa')).toBe(true);
    // ya completa: la siguiente es idempotente de verdad
    expect((await recibirDesglose(TENANT, desglose(), b.deps)).estado).toBe('idempotente');
  });

  it('sin la RPC (camino anterior): también se completa, sin insertar otra liquidación ni repetir el evento', async () => {
    const b = banco();
    conAtomica(b, 'ausente');
    aMedias(b);
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r).toMatchObject({ estado: 'creada', liquidacionId: 'liq-previa', entregas: 4 });
    expect(b.liquidaciones).toHaveLength(1);
    expect(b.desgloses).toHaveLength(1);
    expect(b.eventos).toHaveLength(0);
  });

  it('encabezado sin entregas y sin retención (corte justo antes de las entregas) => se crean las entregas', async () => {
    const b = banco();
    conAtomica(b, 'ok');
    aMedias(b);
    b.desgloses.push({ liquidacionExternaId: 'liq-previa', bitacora: 'B-0001', retenidaMotivo: null });
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r).toMatchObject({ estado: 'creada', entregas: 4 });
    expect(b.desgloses).toHaveLength(1);
  });

  it('una retenida legítima (encabezado con motivo, sin entregas) sigue siendo idempotente: no se envía sola', async () => {
    const b = banco();
    conAtomica(b, 'ok');
    aMedias(b);
    b.desgloses.push({ liquidacionExternaId: 'liq-previa', bitacora: 'B-0001', retenidaMotivo: 'neto negativo' });
    expect((await recibirDesglose(TENANT, desglose(), b.deps)).estado).toBe('idempotente');
    expect(b.entregas).toHaveLength(0);
  });

  it('sin el puerto de rescate (dobles anteriores) la misma huella sigue siendo idempotente', async () => {
    const b = banco();
    aMedias(b);
    expect((await recibirDesglose(TENANT, desglose(), b.deps)).estado).toBe('idempotente');
  });
});

describe('presentar: el renglón de viaje solo para foráneos (c3cc57d3 46:21)', () => {
  const conViaje = (tipo: 'foraneo' | 'local' | 'permisionario' | undefined) => desglose({
    tipoOperador: tipo,
    percepciones: [{ concepto: 'Sueldo', monto: 1000 }, { concepto: 'Viáticos', monto: 500 }, { concepto: 'Complemento', monto: 200 }],
  });
  const cfg: ConfigCorreo = { ...CONFIG, agruparViaje: true };

  it('foráneo: Sueldo + Viáticos se funden en «Pago de viaje»', () => {
    const v = presentar(conViaje('foraneo'), cfg);
    expect(v.percepciones.map((r) => r.concepto)).toEqual(['Pago de viaje', 'Complemento']);
  });

  it('local: conserva «Sueldo» y «Viáticos» sueltos aunque agrupar_viaje esté encendido', () => {
    const v = presentar(conViaje('local'), cfg);
    expect(v.percepciones.map((r) => r.concepto)).toEqual(['Sueldo', 'Viáticos', 'Complemento']);
  });

  it('agrupar_viaje apagado no cambia nada para nadie', () => {
    expect(presentar(conViaje('foraneo'), { ...CONFIG, agruparViaje: false }).percepciones.map((r) => r.concepto)).toEqual(['Sueldo', 'Viáticos', 'Complemento']);
  });
});

describe('recibirDesglose: modo primer mes — revisores por departamento (0933)', () => {
  const REVISORES = [{ departamento: 'nomina', correo: 'nomina.rev@ejemplo.test' }, { departamento: 'rh', correo: 'rh.rev@ejemplo.test' }];
  // El reloj del banco es 2026-10-15 (12:00 UTC ⇒ 15 de octubre en México).
  const PRIMER_MES = { revisores: REVISORES, primerMesHasta: '2026-11-14' };
  const retenible = () => desglose({ neto: -5, percepciones: [{ concepto: 'Sueldo', monto: 100 }], deducciones: [{ concepto: 'Anticipo', monto: 105 }] });

  it('desglose que SE ENVÍA: además de los 4 destinatarios, un correo al revisor de cada departamento', async () => {
    const b = banco({ config: PRIMER_MES });
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(b.entregas.map((e) => [e.rol, e.correo])).toEqual([
      ['operador', 'operador@ejemplo.test'], ['coordinador', 'coordinador@ejemplo.test'], ['rh', 'rh@ejemplo.test'], ['archivo', 'archivo@ejemplo.test'],
      ['revisor', 'nomina.rev@ejemplo.test'], ['revisor', 'rh.rev@ejemplo.test'],
    ]);
    expect(r).toMatchObject({ estado: 'creada', retenida: false, entregas: 6 });
  });

  it('desglose RETENIDO: al operador, coordinador, RH y archivo no sale nada, pero los revisores SÍ reciben su aviso', async () => {
    const b = banco({ config: PRIMER_MES });
    const r = await recibirDesglose(TENANT, retenible(), b.deps);
    expect(r).toMatchObject({ estado: 'creada', retenida: true, entregas: 0 });
    expect(b.entregas.map((e) => [e.rol, e.correo])).toEqual([['revisor', 'nomina.rev@ejemplo.test'], ['revisor', 'rh.rev@ejemplo.test']]);
    expect(b.excepciones.map((e) => e.tipo)).toContain('neto_negativo');
  });

  it('con la RPC de la 0933, la retenida deja a los revisores en la MISMA transacción y no hay inserción suelta', async () => {
    const b = banco({ config: PRIMER_MES });
    const sueltas = vi.fn();
    b.deps.insertarEntregas = sueltas;
    const { llamadas } = conAtomica(b, 'ok0933');
    await recibirDesglose(TENANT, retenible(), b.deps);
    expect(llamadas[0].entregas.map((e) => e.rol)).toEqual(['revisor', 'revisor']);
    expect(sueltas).not.toHaveBeenCalled();
    expect(b.entregas.map((e) => e.rol)).toEqual(['revisor', 'revisor']);
  });

  it('con la RPC ANTERIOR (sin la 0933) ignora las entregas de una retenida: el aviso al revisor se inserta aparte, sin duplicar', async () => {
    const b = banco({ config: PRIMER_MES });
    conAtomica(b, 'ok');
    await recibirDesglose(TENANT, retenible(), b.deps);
    expect(b.entregas.map((e) => e.rol)).toEqual(['revisor', 'revisor']);
  });

  it('un buzón que ya recibe el desglose por otro rol no recibe además la copia de revisión', async () => {
    const b = banco({ config: { ...PRIMER_MES, rhCorreos: ['nomina.rev@ejemplo.test'] } });
    await recibirDesglose(TENANT, desglose(), b.deps);
    expect(b.entregas.filter((e) => e.correo === 'nomina.rev@ejemplo.test').map((e) => e.rol)).toEqual(['rh']);
    expect(b.entregas.filter((e) => e.rol === 'revisor').map((e) => e.correo)).toEqual(['rh.rev@ejemplo.test']);
  });

  it('el modo se APAGA solo: después de «hasta» no hay revisores; y sin fecha o sin revisores, nunca', async () => {
    for (const config of [
      { revisores: REVISORES, primerMesHasta: '2026-10-14' },     // venció ayer
      { revisores: REVISORES, primerMesHasta: null },              // nunca se activó
      { revisores: [], primerMesHasta: '2026-11-14' },             // sin a quién mandar
    ]) {
      const b = banco({ config });
      await recibirDesglose(TENANT, desglose(), b.deps);
      expect(b.entregas.some((e) => e.rol === 'revisor'), JSON.stringify(config)).toBe(false);
    }
  });

  it('el último día es inclusivo', async () => {
    const b = banco({ config: { revisores: REVISORES, primerMesHasta: '2026-10-15' } });
    await recibirDesglose(TENANT, desglose(), b.deps);
    expect(b.entregas.filter((e) => e.rol === 'revisor')).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// OLA 10 · carril A · A1-01 (fecha de corte) y A1-02 (la corrección reemplaza a la original).
// «Saldría» = una entrega que NO nació `omitida` y cuya liquidación no fue omitida después: lo único que el cron de envío reclamaría.
// ═══════════════════════════════════════════════════════════════════════════
const saldria = (b: Banco) => b.entregas.filter((e) => e.estado !== 'omitida' && !b.omitidasIds.includes(e.liquidacionExternaId));

describe('A1-01: fecha de corte del arranque', () => {
  const CORTE = { noEnviarAntes: '2026-10-15' }; // el periodo de la bitácora sintética termina el 2026-10-14

  it('50 desgloses fechados antes del corte => 0 correos y 50 liquidaciones con todas sus entregas en «omitida»', async () => {
    const b = banco({ config: CORTE });
    for (let i = 1; i <= 50; i++) {
      const r = await recibirDesglose(TENANT, desglose({ bitacora: `B-${1000 + i}`, operador: { numeroEmpleado: `E-${i}` } }), b.deps);
      expect(r).toMatchObject({ estado: 'creada', omitida: 'anterior_al_corte', retenida: false });
    }
    expect(b.liquidaciones).toHaveLength(50);
    expect(saldria(b)).toHaveLength(0); // 0 correos
    expect(b.entregas.length).toBeGreaterThanOrEqual(50);
    expect(b.entregas.every((e) => e.estado === 'omitida')).toBe(true);
    expect(new Set(b.entregas.map((e) => e.liquidacionExternaId)).size).toBe(50); // las 50 tienen sus entregas omitidas
    expect(b.entregas[0].ultimoError).toMatch(/fecha de corte/);
    expect(b.detallesEvento[0]).toMatchObject({ omitida: 'anterior_al_corte' });
  });

  it('el día del corte SÍ sale (el periodo termina el mismo día de arranque); un día antes, no', async () => {
    const b = banco({ config: { noEnviarAntes: '2026-10-14' } });
    expect(await recibirDesglose(TENANT, desglose(), b.deps)).toMatchObject({ estado: 'creada', entregas: 4 });
    expect(saldria(b)).toHaveLength(4);
    const c = banco({ config: { noEnviarAntes: '2026-10-15' } });
    await recibirDesglose(TENANT, desglose(), c.deps);
    expect(saldria(c)).toHaveLength(0);
  });

  it('sin fecha de corte se envía como siempre (compatibilidad)', async () => {
    const b = banco({ config: { noEnviarAntes: null } });
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r).toMatchObject({ estado: 'creada', entregas: 4 });
    expect((r as { omitida?: string }).omitida).toBeUndefined();
    expect(saldria(b)).toHaveLength(4);
  });

  it('enviadoOrigen = true: el sistema de origen ya lo mandó, no se vuelve a mandar (aun sin fecha de corte)', async () => {
    const b = banco();
    const r = await recibirDesglose(TENANT, desglose({ enviadoOrigen: true }), b.deps);
    expect(r).toMatchObject({ estado: 'creada', omitida: 'enviado_por_origen' });
    expect(saldria(b)).toHaveLength(0);
    expect(b.entregas[0].ultimoError).toMatch(/origen/);
  });

  it('el revisor del primer mes tampoco recibe copia de lo omitido', async () => {
    const b = banco({ config: { ...CORTE, revisores: [{ departamento: 'nomina', correo: 'nomina.rev@ejemplo.test' }], primerMesHasta: '2026-11-14' } });
    await recibirDesglose(TENANT, desglose(), b.deps);
    expect(b.entregas.some((e) => e.rol === 'revisor')).toBe(true); // la fila existe...
    expect(saldria(b)).toHaveLength(0); // ...pero nace omitida
  });

  it('una omitida con una guarda que RETIENE sigue retenida y abre su excepción (lo prohibido no sale ni liberando después)', async () => {
    const b = banco({ config: { ...CORTE, conceptosProhibidos: ['Retención uno'] } });
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r).toMatchObject({ estado: 'creada', retenida: true, omitida: 'anterior_al_corte' });
    expect(b.excepciones.map((e) => e.tipo)).toContain('concepto_prohibido');
    expect(saldria(b)).toHaveLength(0);
  });

  it('atómica con RPC anterior a la 0940 (ignora «estado»): tras guardar se pasan a omitida las entregas que quedaron pendientes', async () => {
    const b = banco({ config: CORTE });
    b.deps.recibirAtomico = async (_t, pedido) => {
      b.liquidaciones.push({ id: 'liq-atom', tenantId: TENANT, claveExterna: pedido.liquidacion.datos.claveExterna, huella: pedido.liquidacion.huella } as unknown as LiquidacionExterna);
      return { ok: true, valor: { liquidacionId: 'liq-atom', creada: true, reparada: false, entregas: pedido.entregas.length } };
    };
    await recibirDesglose(TENANT, desglose(), b.deps);
    expect(b.omitidasIds).toEqual(['liq-atom']);
    expect(b.motivosOmision[0]).toMatch(/fecha de corte/);
  });

  describe('vista previa (simular): lee todo, no escribe nada', () => {
    it('cuenta los correos que saldrían y los omitidos, sin Storage, sin base y sin excepciones', async () => {
      const b = banco();
      const r = await recibirDesglose(TENANT, desglose(), b.deps, { simular: true });
      expect(r).toEqual({ estado: 'simulada', claveExterna: 'BIT-T1-B-0001', correos: 4, omitidas: 0, retenida: false, omitida: null });
      const c = banco({ config: CORTE });
      expect(await recibirDesglose(TENANT, desglose(), c.deps, { simular: true })).toMatchObject({ estado: 'simulada', correos: 0, omitidas: 4, omitida: 'anterior_al_corte' });
      for (const x of [b, c]) {
        expect(x.subidas).toHaveLength(0);
        expect(x.liquidaciones).toHaveLength(0);
        expect(x.desgloses).toHaveLength(0);
        expect(x.entregas).toHaveLength(0);
        expect(x.eventos).toHaveLength(0);
        expect(x.orden).toEqual([]);
      }
    });

    it('un operador inexistente o una bitácora sin póliza no abren excepciones en la vista previa', async () => {
      const b = banco({ operador: 'inexistente' });
      expect(await recibirDesglose(TENANT, desglose(), b.deps, { simular: true })).toMatchObject({ estado: 'operador_no_encontrado' });
      expect(await recibirDesglose(TENANT, desglose({ poliza: null }), b.deps, { simular: true })).toMatchObject({ estado: 'sin_poliza' });
      expect(b.excepciones).toHaveLength(0);
    });

    it('lo ya recibido es idempotente (0 correos) y una retenida cuenta solo la copia del revisor', async () => {
      const b = banco();
      await recibirDesglose(TENANT, desglose(), b.deps);
      expect(await recibirDesglose(TENANT, desglose(), b.deps, { simular: true })).toMatchObject({ estado: 'idempotente' });
      const c = banco({ config: { conceptosProhibidos: ['Retención uno'], revisores: [{ departamento: 'nomina', correo: 'nomina.rev@ejemplo.test' }], primerMesHasta: '2026-11-14' } });
      expect(await recibirDesglose(TENANT, desglose(), c.deps, { simular: true })).toMatchObject({ estado: 'simulada', retenida: true, correos: 1 });
      expect(c.excepciones).toHaveLength(0);
    });
  });
});

describe('A1-02: una corrección -R<n> reemplaza a la original', () => {
  const distinto = () => desglose({ neto: 4000, percepciones: [{ concepto: 'Sueldo', monto: 9000 }], deducciones: [{ concepto: 'Retención uno', monto: 5000 }] });
  const OP = { correccion: { motivo: 'error de captura', actor: 'llave:administracion' } };

  it('con el original aún pendiente (ventana/espera): queda «omitida» ANTES de guardar la corrección y solo sale el correo de la -R1', async () => {
    const b = banco({ config: { enviarDesdeHora: 12 } });
    await recibirDesglose(TENANT, desglose(), b.deps); // original: 4 entregas pendientes esperando la ventana
    expect(saldria(b)).toHaveLength(4);
    b.orden.length = 0;
    const r = await recibirDesglose(TENANT, distinto(), b.deps, OP);
    expect(r).toMatchObject({ estado: 'creada', claveExterna: 'BIT-T1-B-0001-R1' });
    expect(b.omitidasIds).toEqual(['liq-1']);
    expect(b.motivosOmision[0]).toMatch(/corrección/);
    expect(b.orden.indexOf('omitir')).toBeLessThan(b.orden.indexOf('insertar')); // primero se apaga la original
    const salen = saldria(b);
    expect(salen).toHaveLength(4);
    expect(new Set(salen.map((e) => e.liquidacionExternaId))).toEqual(new Set(['liq-2'])); // un solo desglose: el corregido
  });

  it('-R2 reemplaza a la original Y a la -R1', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose(), b.deps);
    await recibirDesglose(TENANT, distinto(), b.deps, OP);
    b.omitidasIds.length = 0;
    const otra = desglose({ neto: 3000, percepciones: [{ concepto: 'Sueldo', monto: 8000 }], deducciones: [{ concepto: 'Retención uno', monto: 5000 }] });
    expect(await recibirDesglose(TENANT, otra, b.deps, OP)).toMatchObject({ claveExterna: 'BIT-T1-B-0001-R2' });
    expect(new Set(b.omitidasIds)).toEqual(new Set(['liq-1', 'liq-2']));
  });

  it('el original RETENIDO queda sin sus excepciones de retención (ya no se puede «liberar» lo reemplazado)', async () => {
    const b = banco({ config: { conceptosProhibidos: ['Retención uno'] } });
    await recibirDesglose(TENANT, desglose(), b.deps);
    expect(b.excepciones.map((e) => e.tipo)).toContain('concepto_prohibido');
    await recibirDesglose(TENANT, desglose({ deducciones: [{ concepto: 'Otro concepto', monto: 100 }], neto: 4000, percepciones: [{ concepto: 'Sueldo', monto: 4100 }] }), b.deps, OP);
    expect(b.resueltas).toEqual(expect.arrayContaining(['BIT-T1-B-0001|concepto_prohibido', 'BIT-T1-B-0001|neto_negativo', 'BIT-T1-B-0001|tipo_sin_regla', 'BIT-T1-B-0001|correccion_pendiente']));
  });

  it('reintentar una corrección ya guardada (idempotente) vuelve a omitir al original: un corte entre guardar y omitir no deja dos correos', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose(), b.deps);
    await recibirDesglose(TENANT, distinto(), b.deps, OP);
    b.omitidasIds.length = 0;
    expect(await recibirDesglose(TENANT, distinto(), b.deps, OP)).toMatchObject({ estado: 'idempotente', claveExterna: 'BIT-T1-B-0001-R1' });
    expect(b.omitidasIds).toEqual(['liq-1']);
  });

  it('si omitir falla se LANZA y no se guarda la corrección (nunca dos correos en silencio)', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose(), b.deps);
    b.deps.omitirPendientes = async () => { throw new Error('base caída'); };
    await expect(recibirDesglose(TENANT, distinto(), b.deps, OP)).rejects.toThrow('base caída');
    expect(b.liquidaciones).toHaveLength(1);
  });

  it('sin corrección pedida (la pendiente solo se abre) no se omite nada del original', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose(), b.deps);
    await recibirDesglose(TENANT, distinto(), b.deps);
    expect(b.omitidasIds).toEqual([]);
    expect(saldria(b)).toHaveLength(4);
  });
});
