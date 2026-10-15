import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatoInvalido } from '../errores';
import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { DESGLOSE_SINTETICO } from './desglose.fixture';
import type { DesgloseBitacora } from './desglose_contrato';
import { huellaContenido } from './esquema';
import { aLiquidacionExterna } from './desglose_contrato';
import type { LiquidacionExterna, NuevaLiquidacionExterna } from './repo';
import { CONFIG_CORREO_POR_DEFECTO, type ConfigCorreo, type NuevaEntrega } from './repo_correo';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('la base no debe tocarse en estas pruebas'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { recibirDesglose, renombresDeConfig } = await import('./desglose_recibir');
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
  subidas: Array<{ ruta: string; bytes: Uint8Array }>;
  orden: string[];
}

function banco(opciones: {
  config?: Partial<ConfigCorreo>;
  operador?: 'ok' | 'inexistente';
  correoOperador?: string | null;
  coordinador?: { correo: string; activo: boolean } | null;
  fallaStorage?: boolean;
} = {}): Banco {
  const b: Banco = { deps: null as unknown as Deps, liquidaciones: [], desgloses: [], entregas: [], excepciones: [], eventos: [], subidas: [], orden: [] };
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
    abrirExcepcion: async (_t, clave, tipo, detalle) => {
      b.excepciones.push({ clave, tipo, detalle });
      return { id: b.excepciones.length, nueva: true };
    },
    registrarEvento: async (_t, _id, tipo) => { b.eventos.push(tipo); },
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
    expect(b.excepciones[0]).toMatchObject({ tipo: 'correccion_pendiente', detalle: { bitacora: 'B-0001', netoAntes: 4850, netoDespues: 4000 } });
  });

  it('la huella que se guarda es la del contrato (no la del Excel renombrado)', async () => {
    const b = banco({ config: { renombres: [{ patron: 'taxi', a: 'Otros' }] } });
    await recibirDesglose(TENANT, desglose(), b.deps);
    const esperada = huellaContenido(aLiquidacionExterna(desglose(), { sistemaOrigen: 'desglose-bitacora' }).liquidacion);
    expect(b.liquidaciones[0].huella).toBe(esperada);
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

describe('recibirDesglose: operador y destinatarios', () => {
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
