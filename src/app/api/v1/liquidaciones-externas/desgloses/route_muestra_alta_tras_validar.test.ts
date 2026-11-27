import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PADRON_MUESTRA } from '@/lib/likida/liquidacion_externa/desglose_muestra_tms.fixture';

// A62-BAK-01 · El sobre se valida ANTES de dar de alta operadores.
//
// `desglose_muestra_recepcion.ts` promete en su encabezado que un sobre inválido —campos desconocidos, versión no soportada, más de 100
// bitácoras o más de 100 renglones por bloque— da «400 y no se procesa NADA». El alta automática de operadores (`completarPadronConAltas`)
// ESCRIBE filas en `operador`, así que si corre antes de esas puertas, un 400 deja personas dadas de alta en el padrón del cliente.
//
// Sin Postgres: lo que toca la base se sustituye por dobles, y `insertar` es el testigo — si se llamó, hubo escritura.

const abrir = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => ({ ...((await orig()) as Record<string, unknown>), abrir: () => abrir() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));
vi.mock('@/lib/likida/interruptores', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  leerInterruptor: async () => 'encendido' as const,
}));
vi.mock('@/lib/likida/liquidacion_externa/repo_correo', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  leerConfigCorreo: async () => ({ ok: true, valor: { activa: true, canal: 'correo' } }),
  abrirExcepcion: async () => ({ id: 1, nueva: true }),
  listarExcepciones: async () => ({ ok: true, valor: [] }),
  resolverExcepcion: async () => true,
}));
vi.mock('@/lib/likida/liquidacion_externa/desglose_recibir', () => ({
  recibirDesglose: async (_t: string, d: { bitacora: string }) => ({ estado: 'sin_poliza', claveExterna: `BIT-${d.bitacora}` }),
}));

/** El testigo de la ESCRITURA: `insertarOperadorDesdeBitacora` inserta una fila en `operador`. */
const insertar = vi.fn(async (_t: string, nombre: string, numeroEmpleado: string) => ({ id: `op-${numeroEmpleado}`, nombre }));
vi.mock('@/lib/likida/liquidacion_externa/repo', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  leerPadronOperadores: async () => PADRON_MUESTRA as unknown as Array<{ numeroEmpleado: string; nombre: string }>,
  insertarOperadorDesdeBitacora: (...a: [string, string, string]) => insertar(...a),
}));
vi.mock('@/lib/likida/operador_sin_telefono_canal', () => ({ permiteAltaSinTelefono: async () => true }));

const { POST } = await import('./route');
const postear = (c: unknown) => POST(new Request('https://app.likida.ai/api/v1/liquidaciones-externas/desgloses',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) }));

/** Una bitácora con un `NumeroEmpleado` que NO está en el padrón: es lo que dispara el alta. */
const SIN_ALTA = '9001';
const bitacoraNueva = (extra: Record<string, unknown> = {}) => ({
  BitacoraID: 1027, NumeroEmpleado: SIN_ALTA, Operador: 'JUAN PEREZ GOMEZ', Unidad: 'U-1',
  Fecha: { Inicia: '2026-11-20 08:00:00', Termina: '2026-11-20 18:00:00' },
  Percepciones: [{ Descripcion: 'Sueldo', Monto: 1000 }], Deducciones: [],
  ...extra,
});

beforeEach(() => {
  insertar.mockClear();
  abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:administracion' });
  vi.stubEnv('LIKIDA_TMS_MUESTRA', 'si');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('A62-BAK-01 · un sobre inválido da 400 y NO da de alta a nadie', () => {
  it.each([
    [
      'bitácora suelta con la marca del sobre pegada',
      { ...bitacoraNueva(), formato: 'muestra-tms' },
    ],
    [
      'bitácora suelta con `version`',
      { ...bitacoraNueva(), version: 1 },
    ],
    [
      'sobre con un campo que el contrato no tiene',
      { formato: 'muestra-tms', version: 1, bitacoras: [bitacoraNueva()], Poliza: 'P-1' },
    ],
    [
      'versión no soportada',
      { formato: 'muestra-tms', version: 2, bitacoras: [bitacoraNueva()] },
    ],
    [
      'más de 100 renglones en un bloque',
      {
        formato: 'muestra-tms', version: 1,
        bitacoras: [bitacoraNueva({ Percepciones: Array.from({ length: 101 }, () => ({ Descripcion: 'Sueldo', Monto: 1 })) })],
      },
    ],
  ])('%s ⇒ 400 y cero inserciones en `operador`', async (_n, cuerpo) => {
    const r = await postear(cuerpo);
    expect(r.status).toBe(400);
    expect(insertar).not.toHaveBeenCalled();
  });

  it('más de 100 bitácoras ⇒ 400 y no se da de alta ni una de las 150', async () => {
    const bitacoras = Array.from({ length: 150 }, (_, i) => ({
      ...bitacoraNueva(), BitacoraID: 2000 + i, NumeroEmpleado: String(9100 + i),
    }));
    const r = await postear({ formato: 'muestra-tms', version: 1, bitacoras });
    expect(r.status).toBe(400);
    expect(insertar).not.toHaveBeenCalled();
  });

  it('el sobre VÁLIDO sigue dando de alta al operador sin número (el acuerdo del 17-nov no se rompe)', async () => {
    const r = await postear({ formato: 'muestra-tms', version: 1, bitacoras: [bitacoraNueva()] });
    expect(r.status).toBe(200);
    expect(insertar).toHaveBeenCalledWith('t-1', 'JUAN PEREZ GOMEZ', SIN_ALTA);
  });
});
