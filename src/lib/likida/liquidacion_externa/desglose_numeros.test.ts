import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { DatoInvalido } from '../errores';
import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { DESGLOSE_SINTETICO } from './desglose.fixture';
import {
  aLiquidacionExterna, claveDeBitacora, claveDeLiquidacion, UnidadesMezcladas, validarDesgloseBitacora, type DesgloseBitacora,
} from './desglose_contrato';
import { generarDesgloseXlsx } from './desglose_xlsx';
import type { LiquidacionExterna, NuevaLiquidacionExterna } from './repo';
import { CONFIG_CORREO_POR_DEFECTO, type ConfigCorreo, type NuevaEntrega } from './repo_correo';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('la base no debe tocarse en estas pruebas'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { recibirDesglose } = await import('./desglose_recibir');
type Deps = import('./desglose_recibir').DependenciasDesglose;

// ═══════════════════════════════════════════════════════════════════════════
// T-A1-41: número de liquidación, número de pago y varias bitácoras de la misma unidad. Dobles en memoria, datos sintéticos.
// La liquidación es por unidad (una unidad con dos viajes se liquida junta); la fuente manda los renglones ya agregados.
// ═══════════════════════════════════════════════════════════════════════════

const TENANT = '00000000-0000-4000-8000-000000000001';
const OP_ID = '00000000-0000-4000-8000-0000000000a1';
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

const CONFIG: ConfigCorreo = { ...CONFIG_CORREO_POR_DEFECTO, canal: 'correo', activa: true, rhCorreos: ['rh@ejemplo.test'], archivoCorreo: 'archivo@ejemplo.test' };

interface Banco {
  deps: Deps;
  liquidaciones: LiquidacionExterna[];
  viajes: string[][];
  desgloses: Array<Record<string, unknown>>;
  entregas: NuevaEntrega[];
  excepciones: Array<{ clave: string; tipo: string; detalle: Record<string, unknown> }>;
  subidas: Uint8Array[];
}

function banco(): Banco {
  const b: Banco = { deps: null as unknown as Deps, liquidaciones: [], viajes: [], desgloses: [], entregas: [], excepciones: [], subidas: [] };
  b.deps = {
    ahora: () => new Date('2026-10-15T12:00:00Z'),
    leerConfig: async () => CONFIG,
    buscarPorClave: async (_t, clave) => b.liquidaciones.find((l) => l.claveExterna === clave) ?? null,
    resolverOperador: async () => ({ id: OP_ID, nombre: f.operador.nombre, telefono: '5210000000000', activo: true }),
    resolverViajeIds: async () => [],
    leerContacto: async () => ({ operadorId: OP_ID, correo: 'operador@ejemplo.test', correoRebotadoEn: null, coordinadorId: null }),
    leerCoordinador: async () => { throw new DatoInvalido('sin coordinador'); },
    subirXlsx: async (t, clave, huella, bytes) => { b.subidas.push(bytes); return `${t}/${clave}-${huella.slice(0, 8)}.xlsx`; },
    insertarLiquidacion: async (n: NuevaLiquidacionExterna) => {
      const l = {
        id: `liq-${b.liquidaciones.length + 1}`, tenantId: n.tenantId, claveExterna: n.datos.claveExterna, huella: n.huella,
        sistemaOrigen: n.datos.sistemaOrigen, operadorId: n.operadorId, total: n.datos.total, pdfRuta: n.pdfRuta, pdfOrigen: n.pdfOrigen,
        estado: 'pendiente', generacion: 1,
      } as unknown as LiquidacionExterna;
      b.liquidaciones.push(l);
      b.viajes.push(n.datos.viajes);
      return l;
    },
    insertarDesglose: async (_t, m) => { b.desgloses.push({ ...m }); return true; },
    insertarEntregas: async (_t, filas) => { b.entregas.push(...filas); return filas.length; },
    abrirExcepcion: async (_t, clave, tipo, detalle) => { b.excepciones.push({ clave, tipo, detalle }); return { id: b.excepciones.length, nueva: true }; },
    registrarEvento: async () => {},
  };
  return b;
}

const DOS = (extra: Partial<DesgloseBitacora> = {}): DesgloseBitacora =>
  desglose({ numeroLiquidacion: '1228', numeroPago: '10', bitacoras: [f.bitacora, 'B-0002'], ...extra });

describe('varias bitácoras de la misma unidad', () => {
  it('dos bitácoras de una unidad => UNA liquidación, UN desglose, UN solo juego de correos y UN Excel', async () => {
    const b = banco();
    const r = await recibirDesglose(TENANT, DOS(), b.deps);
    expect(r.estado).toBe('creada');
    expect(b.liquidaciones).toHaveLength(1);
    expect(b.desgloses).toHaveLength(1);
    expect(b.subidas).toHaveLength(1);
    // operador + RH + archivo (sin coordinador): una entrega por destino, no por bitácora
    expect(b.entregas.map((e) => e.rol).sort()).toEqual(['archivo', 'operador', 'rh']);
    expect(new Set(b.entregas.map((e) => e.xlsxRuta)).size).toBe(1);
    // la liquidación cubre las dos bitácoras y la clave sale del número de liquidación
    expect(b.viajes[0]).toEqual([f.bitacora, 'B-0002']);
    expect(b.liquidaciones[0]!.claveExterna).toBe('LIQ-T1-1228');
    expect(b.desgloses[0]).toMatchObject({ numeroLiquidacion: '1228', numeroPago: '10', bitacoras: [f.bitacora, 'B-0002'], bitacora: f.bitacora });
  });

  it('Likida no recalcula: el neto es el de la fuente, no la suma de las bitácoras', async () => {
    const b = banco();
    await recibirDesglose(TENANT, DOS({ neto: f.esperado.neto }), b.deps);
    expect(b.liquidaciones[0]!.total).toBe(f.esperado.neto);
  });

  it('el mismo número de liquidación reenviado es idempotente: no inserta, no sube ni envía otra vez', async () => {
    const b = banco();
    await recibirDesglose(TENANT, DOS(), b.deps);
    const entregas = b.entregas.length;
    const excepciones = b.excepciones.length;
    const r = await recibirDesglose(TENANT, DOS(), b.deps);
    expect(r.estado).toBe('idempotente');
    expect(b.liquidaciones).toHaveLength(1);
    expect(b.desgloses).toHaveLength(1);
    expect(b.subidas).toHaveLength(1);
    expect(b.entregas).toHaveLength(entregas);
    expect(b.excepciones).toHaveLength(excepciones);
  });

  it('el mismo número con otro contenido NO se sobrescribe: abre correccion_pendiente y no envía', async () => {
    const b = banco();
    await recibirDesglose(TENANT, DOS(), b.deps);
    const entregas = b.entregas.length;
    const previas = b.excepciones.length;
    const r = await recibirDesglose(TENANT, DOS({ neto: f.esperado.neto + 100, percepciones: [...desglose().percepciones, { concepto: 'Bono', monto: 100 }] }), b.deps);
    expect(r.estado).toBe('correccion_pendiente');
    expect(b.liquidaciones).toHaveLength(1);
    expect(b.entregas).toHaveLength(entregas);
    expect(b.excepciones.slice(previas).map((e) => e.tipo)).toEqual(['correccion_pendiente']);
  });

  it('otro número de liquidación de la misma bitácora principal es otra liquidación', async () => {
    const b = banco();
    await recibirDesglose(TENANT, DOS(), b.deps);
    const r = await recibirDesglose(TENANT, DOS({ numeroLiquidacion: '1229' }), b.deps);
    expect(r.estado).toBe('creada');
    expect(b.liquidaciones.map((l) => l.claveExterna)).toEqual(['LIQ-T1-1228', 'LIQ-T1-1229']);
  });

  it('el Excel que recibe el operador junta las bitácoras en el encabezado', async () => {
    const b = banco();
    await recibirDesglose(TENANT, DOS(), b.deps);
    const hoja = XLSX.read(b.subidas[0]!, { type: 'array' });
    const texto = JSON.stringify(XLSX.utils.sheet_to_json(hoja.Sheets[hoja.SheetNames[0]!]!, { header: 1 }));
    expect(texto).toContain(`${f.bitacora}, B-0002`);
    expect(texto).toContain('1228');
  });
});

describe('unidades mezcladas', () => {
  it('bitácoras de unidades distintas => excepción unidades_mezcladas, nada guardado ni enviado', async () => {
    const b = banco();
    const mezclado = DOS({ bitacoras: [{ bitacora: f.bitacora, unidad: f.unidad }, { bitacora: 'B-0002', unidad: '0002' }] });
    await expect(recibirDesglose(TENANT, mezclado, b.deps)).rejects.toBeInstanceOf(UnidadesMezcladas);
    expect(b.excepciones).toEqual([{ clave: 'LIQ-T1-1228', tipo: 'unidades_mezcladas', detalle: { bitacora: f.bitacora, unidades: 2 } }]);
    expect(b.liquidaciones).toHaveLength(0);
    expect(b.desgloses).toHaveLength(0);
    expect(b.subidas).toHaveLength(0);
    expect(b.entregas).toHaveLength(0);
  });

  it('una bitácora de otra unidad que la del encabezado también es mezcla', () => {
    expect(() => validarDesgloseBitacora(DOS({ bitacoras: [f.bitacora, { bitacora: 'B-0002', unidad: '0099' }] }))).toThrow(UnidadesMezcladas);
  });

  it('la misma unidad repetida en cada bitácora no es mezcla', () => {
    const d = validarDesgloseBitacora(DOS({ bitacoras: [{ bitacora: f.bitacora, unidad: f.unidad }, { bitacora: 'B-0002', unidad: f.unidad }] }));
    expect(d.bitacoras).toEqual([f.bitacora, 'B-0002']);
  });

  it('la excepción es un CampoInvalido: la API responde 400 con un mensaje llano', () => {
    const e = (() => { try { validarDesgloseBitacora(DOS({ bitacoras: [f.bitacora, { bitacora: 'B-0002', unidad: '0099' }] })); } catch (x) { return x; } })();
    expect(e).toBeInstanceOf(CampoInvalido);
    expect((e as Error).message).toMatch(/unidades_mezcladas.*por unidad/);
  });
});

describe('sin los campos nuevos todo se comporta como hoy', () => {
  it('sin número ni lista: clave por bitácora, un viaje y un desglose sin columnas nuevas', async () => {
    const b = banco();
    const r = await recibirDesglose(TENANT, desglose(), b.deps);
    expect(r.estado).toBe('creada');
    expect(b.liquidaciones[0]!.claveExterna).toBe(claveDeBitacora('T1', f.bitacora));
    expect(b.viajes[0]).toEqual([f.bitacora]);
    expect(b.desgloses[0]).not.toHaveProperty('numeroLiquidacion');
    expect(b.desgloses[0]).not.toHaveProperty('numeroPago');
    expect(b.desgloses[0]).not.toHaveProperty('bitacoras');
  });

  it('el número solo (sin lista) cambia la clave a la de la liquidación pero conserva un viaje', async () => {
    const b = banco();
    await recibirDesglose(TENANT, desglose({ numeroLiquidacion: '77' }), b.deps);
    expect(b.liquidaciones[0]!.claveExterna).toBe('LIQ-T1-77');
    expect(b.viajes[0]).toEqual([f.bitacora]);
  });

  it('el Excel sin números es byte a byte el de antes', () => {
    const base = {
      operador: 'Operador Ejemplo Uno', unidad: '0001', bitacora: 'B-0001', desde: '2026-10-09', hasta: '2026-10-14',
      percepciones: [{ concepto: 'Sueldo', monto: 100 }], deducciones: [],
    };
    expect(Buffer.from(generarDesgloseXlsx({ ...base }))).toEqual(Buffer.from(generarDesgloseXlsx({ ...base, numeroLiquidacion: undefined, numeroPago: undefined })));
    expect(Buffer.from(generarDesgloseXlsx({ ...base }))).not.toEqual(Buffer.from(generarDesgloseXlsx({ ...base, numeroLiquidacion: '1228', numeroPago: '10' })));
  });

  it('el Excel con números los muestra en el encabezado', () => {
    const bytes = generarDesgloseXlsx({
      operador: 'Operador Ejemplo Uno', unidad: '0001', bitacora: 'B-0001', numeroLiquidacion: '1228', numeroPago: '10',
      desde: '2026-10-09', hasta: '2026-10-14', percepciones: [{ concepto: 'Sueldo', monto: 100 }], deducciones: [],
    });
    const hoja = XLSX.read(bytes, { type: 'array' });
    const ws = hoja.Sheets[hoja.SheetNames[0]!]!;
    const valores = Object.entries(ws).filter(([k]) => !k.startsWith('!')).map(([, c]) => String((c as { v: unknown }).v));
    expect(valores).toEqual(expect.arrayContaining(['Liquidación:', '1228', 'Pago:', '10']));
  });
});

describe('contrato: validación de los campos nuevos', () => {
  it('acepta el número como entero o como texto, siempre lo guarda como texto', () => {
    const d = validarDesgloseBitacora(desglose({ numeroLiquidacion: 1228 as unknown as string, numeroPago: ' 10 ' }));
    expect(d.numeroLiquidacion).toBe('1228');
    expect(d.numeroPago).toBe('10');
  });

  it('un número vacío equivale a no mandarlo', () => {
    const d = validarDesgloseBitacora(desglose({ numeroLiquidacion: '  ' }));
    expect(d).not.toHaveProperty('numeroLiquidacion');
  });

  it.each([
    ['número con espacios o símbolos raros', { numeroLiquidacion: '12 28' }],
    ['número de más de 40 caracteres', { numeroPago: '9'.repeat(41) }],
    ['número negativo', { numeroLiquidacion: -3 as unknown as string }],
    ['número booleano', { numeroPago: true as unknown as string }],
    ['lista vacía', { bitacoras: [] }],
    ['lista que no incluye la principal', { bitacoras: ['B-0002'] }],
    ['bitácora repetida', { bitacoras: [f.bitacora, f.bitacora] }],
    ['elemento que no es folio ni objeto', { bitacoras: [f.bitacora, 7 as unknown as string] }],
    ['elemento con campo desconocido', { bitacoras: [f.bitacora, { bitacora: 'B-0002', color: 'rojo' } as never] }],
    ['más de 100 bitácoras', { bitacoras: [f.bitacora, ...Array.from({ length: 100 }, (_, i) => `X-${i}`)] }],
    ['folio con salto de línea', { bitacoras: [f.bitacora, 'B-0002\nX'] }],
  ])('rechaza %s', (_n, extra) => {
    expect(() => validarDesgloseBitacora(desglose(extra as Partial<DesgloseBitacora>))).toThrow(CampoInvalido);
  });

  it('la clave de la liquidación es determinista y distinta de la de la bitácora', () => {
    expect(claveDeLiquidacion('T1', '1228')).toBe('LIQ-T1-1228');
    expect(claveDeLiquidacion(undefined, '1228')).toBe('LIQ-1228');
    expect(claveDeLiquidacion('T 1', '1228')).toBe('LIQ-T_1-1228');
    expect(claveDeLiquidacion('T1', '1228')).not.toBe(claveDeBitacora('T1', f.bitacora));
  });

  it('la conversión cubre todas las bitácoras en `viajes` y valida con el esquema vigente', () => {
    const c = aLiquidacionExterna(DOS(), { sistemaOrigen: 'prueba' });
    expect(c.liquidacion.viajes).toEqual([f.bitacora, 'B-0002']);
    expect(c.liquidacion.claveExterna).toBe('LIQ-T1-1228');
  });
});
