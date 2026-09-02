// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 — lo que el registro tiene que aguantar con 800 tractos.
//
// `administracion.test.ts` (ajeno) fija las cuatro altas. Aquí van SOLO los
// hallazgos de esta auditoría, y todos son la misma familia de error:
//
//   · UN TOTAL QUE NO ES UN TOTAL. `getUnidades`/`getOperadoresDetalle`
//     traían el catálogo entero y la pantalla contaba el largo de la lista.
//     Ahora la base pagina y cuenta, y si el `total` se leyera del largo de la
//     página, el pie diría «25 de 25» sobre un padrón de 800 — y nadie
//     buscaría la página 2 de algo que dice tener 25.
//   · UN CERO QUE NO ES UNA MEDICIÓN. Un conteo que no se pudo leer tiene que
//     salir `null` y pintarse «—». Un 0 dice «no hay ninguna licencia
//     vencida», que es la afirmación más cara que esta pantalla puede hacer
//     en falso.
//   · UNA LECTURA CAÍDA QUE SE VE COMO UNA FLOTA VACÍA. La página LANZA; la
//     pantalla lo atrapa y lo dice. Media lista se ve igual que la lista
//     entera, solo que más corta.
//   · EL TELÉFONO EDITABLE (FE-4). Es la identidad del chofer frente al bot:
//     cambiarlo sin comprobar que esté libre cruza dos choferes en una flota.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [])), rpc: (...a: unknown[]) => rpc(...a) }),
}));

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('./config', () => ({ getConfig: vi.fn() }));
vi.mock('./conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  acquireViajeLock: vi.fn(async () => true),
  releaseViajeLock: vi.fn(),
}));
const anotarBitacora = vi.fn(async (_e: Record<string, unknown>) => {});
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (e: unknown) => anotarBitacora(e as Record<string, unknown>) }));

const {
  papelMasProximo, getUnidadesRegistro, getUnidadesConteos,
  getOperadoresRegistro, getOperadoresConteos, actualizarOperador,
  UNIDADES_POR_PAGINA,
} = await import('./administracion');
const { DatoInvalido } = await import('./errores');
const { PAPELES_UNIDAD } = await import('./vigencias');

beforeEach(() => {
  from.mockReset();
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  for (const f of Object.values(logger)) f.mockReset();
  anotarBitacora.mockClear();
});

// ── El papel que vence antes ───────────────────────────────────────────────

describe('papelMasProximo — la misma regla que `getUnidades`, no otra', () => {
  const HOY = '2026-09-01';

  it('elige el MÁS PRÓXIMO de los tres, no el primero que esté lleno', () => {
    // El caso que esto impide: enseñar «póliza al día» mientras el permiso
    // SICT lleva un mes vencido.
    const r = papelMasProximo({
      polizaVence: '2027-01-31',
      permisoSictVence: '2026-08-01',
      verificacionVence: '2026-12-15',
    }, HOY);
    expect(r.queVence).toBe('Permiso SICT');
    expect(r.diasAlVencimiento).toBe(-31);
  });

  it('los nombres son los de `PAPELES_UNIDAD`, no unos escritos aparte', () => {
    expect(papelMasProximo({ polizaVence: '2026-10-01', permisoSictVence: null, verificacionVence: null }, HOY).queVence)
      .toBe(PAPELES_UNIDAD[0]);
    expect(papelMasProximo({ polizaVence: null, permisoSictVence: '2026-10-01', verificacionVence: null }, HOY).queVence)
      .toBe(PAPELES_UNIDAD[1]);
    expect(papelMasProximo({ polizaVence: null, permisoSictVence: null, verificacionVence: '2026-10-01' }, HOY).queVence)
      .toBe(PAPELES_UNIDAD[2]);
  });

  it('SIN NINGÚN PAPEL da `null`, no 0: sin dato NO es «vence hoy»', () => {
    expect(papelMasProximo({ polizaVence: null, permisoSictVence: null, verificacionVence: null }, HOY))
      .toEqual({ diasAlVencimiento: null, queVence: null });
  });

  it('una fecha ilegible se SALTA, no se cuenta como hoy', () => {
    // Contarla daría 0 días y pintaría de amarillo un papel que nadie capturó.
    const r = papelMasProximo({ polizaVence: 'ayer', permisoSictVence: '2026-10-01', verificacionVence: null }, HOY);
    expect(r.queVence).toBe('Permiso SICT');
    expect(r.diasAlVencimiento).toBe(30);
  });

  it('con dos papeles el MISMO día gana el primero de `PAPELES_UNIDAD` (igual que `getUnidades`)', () => {
    const r = papelMasProximo({ polizaVence: '2026-10-01', permisoSictVence: '2026-10-01', verificacionVence: null }, HOY);
    expect(r.queVence).toBe(PAPELES_UNIDAD[0]);
  });

  it('vencido da días NEGATIVOS, que es lo que separa «vencida» de «vence hoy»', () => {
    expect(papelMasProximo({ polizaVence: '2026-08-31', permisoSictVence: null, verificacionVence: null }, HOY).diasAlVencimiento).toBe(-1);
    expect(papelMasProximo({ polizaVence: HOY, permisoSictVence: null, verificacionVence: null }, HOY).diasAlVencimiento).toBe(0);
  });
});

// ── El registro de unidades ────────────────────────────────────────────────

const FILA_UNIDAD = {
  id: '11111111-2222-3333-4444-555555555555',
  numeroEconomico: 'T-042', placas: 'ABC-123-4', marca: 'Kenworth', modelo: 'T680',
  anio: 2019, estado: 'disponible', kmActual: null,
  polizaVence: '2026-08-01', permisoSictVence: null, verificacionVence: null,
  gpsProveedor: null, gpsDeviceId: null, gpsVistoEn: null,
  activo: true, terminalId: null, terminalNombre: null, ordenesAbiertas: 0,
};

describe('getUnidadesRegistro', () => {
  it('el `total` es el que CONTÓ la base, NUNCA el largo de la página', async () => {
    // El error que esto impide: con 800 unidades y páginas de 25, un total
    // leído del largo diría «25 de 25» y nadie buscaría la página 2.
    rpc.mockResolvedValue({ data: { total: 837, filas: [FILA_UNIDAD] }, error: null });
    const r = await getUnidadesRegistro('t-1', '2026-09-01');
    expect(r.total).toBe(837);
    expect(r.filas).toHaveLength(1);
    expect(r.paginas).toBe(Math.ceil(837 / UNIDADES_POR_PAGINA));
  });

  it('pide la página que le toca a la base, con su desplazamiento — no rebana en memoria', async () => {
    rpc.mockResolvedValue({ data: { total: 100, filas: [] }, error: null });
    await getUnidadesRegistro('t-1', '2026-09-01', { pagina: 3, porPagina: 25 });
    expect(rpc).toHaveBeenCalledWith('unidades_registro_tenant', expect.objectContaining({
      p_tenant: 't-1', p_desde: 50, p_limite: 25, p_activo: true,
    }));
  });

  it('un `?p=` más allá del final cae a la ÚLTIMA página real, no a una vacía', async () => {
    // Un link viejo no merece una pantalla en blanco que parezca «sin unidades».
    rpc.mockResolvedValue({ data: { total: 30, filas: [FILA_UNIDAD] }, error: null });
    const r = await getUnidadesRegistro('t-1', '2026-09-01', { pagina: 99, porPagina: 25 });
    expect(r.pagina).toBe(2);
    expect(rpc).toHaveBeenLastCalledWith('unidades_registro_tenant', expect.objectContaining({ p_desde: 25 }));
  });

  it('los comodines del LIKE se escapan: buscar «100%» busca eso y no «todo»', async () => {
    rpc.mockResolvedValue({ data: { total: 0, filas: [] }, error: null });
    await getUnidadesRegistro('t-1', '2026-09-01', { q: '100%_x' });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_q: '100\\%\\_x' });
  });

  it('calcula el vencimiento de cada fila con la regla compartida', async () => {
    rpc.mockResolvedValue({ data: { total: 1, filas: [FILA_UNIDAD] }, error: null });
    const r = await getUnidadesRegistro('t-1', '2026-09-01');
    expect(r.filas[0].queVence).toBe('Póliza');
    expect(r.filas[0].diasAlVencimiento).toBe(-31);
  });

  it('`anio` y `kmActual` ausentes se quedan en `null`, NO en 0', async () => {
    // Un 0 diría que la unidad es del año cero y que tiene cero kilómetros.
    rpc.mockResolvedValue({ data: { total: 1, filas: [{ ...FILA_UNIDAD, anio: null, kmActual: null }] }, error: null });
    const r = await getUnidadesRegistro('t-1', '2026-09-01');
    expect(r.filas[0].anio).toBeNull();
    expect(r.filas[0].kmActual).toBeNull();
  });

  it('FALLA CERRADO: un error de la base LANZA, no devuelve una lista vacía', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'se cayó' } });
    await expect(getUnidadesRegistro('t-1', '2026-09-01')).rejects.toThrow(/getUnidadesRegistro/);
  });

  it('una respuesta con OTRA forma (migración sin aplicar) también lanza, en vez de fingir cero', async () => {
    rpc.mockResolvedValue({ data: { nada: 1 }, error: null });
    await expect(getUnidadesRegistro('t-1', '2026-09-01')).rejects.toThrow(/0298/);
  });
});

describe('getUnidadesConteos', () => {
  it('devuelve los siete contadores de la FLOTA ENTERA', async () => {
    rpc.mockResolvedValue({
      data: { total: 800, activas: 795, bajas: 5, vencidos: 3, porVencer: 12, vigentes: 700, sinDato: 80 },
      error: null,
    });
    const c = await getUnidadesConteos('t-1', '2026-09-01', 30);
    expect(c).toEqual({ total: 800, activas: 795, bajas: 5, vencidos: 3, porVencer: 12, vigentes: 700, sinDato: 80 });
  });

  it('un error de lectura devuelve `null` — NO ceros que se lean como medición', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'se cayó' } });
    expect(await getUnidadesConteos('t-1', '2026-09-01', 30)).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('una respuesta a la que le falta un contador es `null` ENTERA, no un objeto a medias', async () => {
    // Medio semáforo es peor que ninguno: los tres números que sí llegaron se
    // leerían como completos.
    rpc.mockResolvedValue({ data: { total: 800, activas: 795, bajas: 5, vencidos: 3 }, error: null });
    expect(await getUnidadesConteos('t-1', '2026-09-01', 30)).toBeNull();
  });
});

// ── El registro de operadores ──────────────────────────────────────────────

const FILA_OPERADOR = {
  operadorId: 'o-1', nombre: 'Juan Pérez', telefono: '525512345678', numeroEmpleado: null,
  rfc: null, activo: true, viajes: 2, licencia: null, licenciaTipo: null,
  licenciaVence: null, terminalId: null, terminalNombre: null, avisoPrivacidadEn: null,
};

describe('getOperadoresRegistro', () => {
  it('el `total` es el que CONTÓ la base, no el largo de la página', async () => {
    rpc.mockResolvedValue({ data: { total: 412, filas: [FILA_OPERADOR] }, error: null });
    const r = await getOperadoresRegistro('t-1');
    expect(r.total).toBe(412);
    expect(r.filas).toHaveLength(1);
  });

  it('la búsqueda viaja a la base y sus comodines se escapan', async () => {
    rpc.mockResolvedValue({ data: { total: 0, filas: [] }, error: null });
    await getOperadoresRegistro('t-1', { q: '  ramirez  ', pagina: 2, porPagina: 10 });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_tenant: 't-1', p_q: 'ramirez', p_desde: 10, p_limite: 10 });
  });

  it('FALLA CERRADO: un error de la base LANZA', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'se cayó' } });
    await expect(getOperadoresRegistro('t-1')).rejects.toThrow(/getOperadoresRegistro/);
  });

  it('un teléfono ausente se queda `null`, no en cadena vacía', async () => {
    rpc.mockResolvedValue({ data: { total: 1, filas: [{ ...FILA_OPERADOR, telefono: '' }] }, error: null });
    const r = await getOperadoresRegistro('t-1');
    expect(r.filas[0].telefono).toBeNull();
  });
});

describe('getOperadoresConteos', () => {
  it('un error de lectura devuelve `null`, no ceros', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'se cayó' } });
    expect(await getOperadoresConteos('t-1', '2026-09-01', 30)).toBeNull();
  });
});

// ── FE-4: el teléfono de WhatsApp, editable ────────────────────────────────

describe('actualizarOperador — el teléfono (FE-4)', () => {
  it('rechaza un teléfono que no es de 10 dígitos ANTES de tocar la base', async () => {
    await expect(actualizarOperador('t-1', '11111111-2222-3333-4444-555555555555', { telefono: '123' }))
      .rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });

  it('un operadorId que no es uuid se rechaza sin consultar nada', async () => {
    await expect(actualizarOperador('t-1', 'no-es-uuid', { telefono: '5512345678' }))
      .rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });

  it('sin ningún cambio LANZA, en vez de decir «guardado» sobre un UPDATE vacío', async () => {
    await expect(actualizarOperador('t-1', '11111111-2222-3333-4444-555555555555', {}))
      .rejects.toThrow(DatoInvalido);
  });
});
