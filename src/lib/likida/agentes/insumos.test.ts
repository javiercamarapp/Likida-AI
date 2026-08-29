import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA BANDEJA DE CONTEXTO UNIVERSAL (Fase D, 0267) — los contratos:
//  · Cada agente acepta SOLO los tipos que su tabla declara (o el default de
//    su departamento, o el piso universal 'texto') — nunca "cualquier cosa".
//  · `insumosPendientes` es de PLATAFORMA (tenant_id is null) — es el filtro
//    que la capa 2 del aislamiento exige ver.
//  · `marcarInsumosProcesados` es idempotente: ancla a procesado_en is null,
//    como `resolverPieza` (bus.ts) — dos corridas no se pisan.
//  · Subir un archivo valida tipo/peso ANTES de tocar Storage.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data?: unknown; error?: { message: string; code?: string } | null; count?: number }>>();
const llamadas: Array<{ tabla: string; metodo: string; payload?: unknown }> = [];

function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null, count: 0 };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, in: () => b, order: () => b, limit: () => b, single: () => b,
    insert: (payload: unknown) => { llamadas.push({ tabla, metodo: 'insert', payload }); return b; },
    update: (payload: unknown) => { llamadas.push({ tabla, metodo: 'update', payload }); return b; },
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}

const storageUpload = vi.fn(async (..._a: unknown[]): Promise<{ data: { path: string } | null; error: { message: string } | null }> =>
  ({ data: { path: 'x' }, error: null }));
const storageCreateSignedUrl = vi.fn(async (..._a: unknown[]): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> =>
  ({ data: { signedUrl: 'https://firmado/x' }, error: null }));
const storageCreateSignedUrls = vi.fn(async (rutas: string[]): Promise<{
  data: Array<{ path: string; signedUrl: string | null; error: { message: string } | null }>;
}> => ({
  data: rutas.map((path) => ({ path, signedUrl: `https://firmado/${path}`, error: null })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => builder(t),
    storage: {
      from: () => ({
        upload: (...a: unknown[]) => storageUpload(...a),
        createSignedUrl: (...a: unknown[]) => storageCreateSignedUrl(...a),
        createSignedUrls: (...a: unknown[]) => storageCreateSignedUrls(a[0] as string[]),
      }),
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const {
  TIPOS_POR_AGENTE, TIPOS_POR_DEPARTAMENTO, tiposAceptadosPorAgente,
  aceptaArchivoInsumo, subirArchivoInsumo,
  crearInsumoArchivo, crearInsumoTexto,
  listarInsumosDeAgente, insumosPendientes, marcarInsumosProcesados,
  contarPendientesPorAgente, urlFirmadaInsumo, urlsFirmadasInsumos,
} = await import('./insumos');
const { DatoInvalido } = await import('../errores');

beforeEach(() => {
  respuestas.clear();
  llamadas.length = 0;
  storageUpload.mockClear();
  storageCreateSignedUrl.mockClear();
  storageCreateSignedUrls.mockClear();
});

describe('tiposAceptadosPorAgente', () => {
  it('usa el mapa explícito cuando existe (financieros: documentos y Exceles, no video)', () => {
    expect(tiposAceptadosPorAgente('control_costos', 'back_office')).toEqual(TIPOS_POR_AGENTE.control_costos);
    expect(tiposAceptadosPorAgente('control_costos', 'back_office')).not.toContain('video');
  });

  it('cae al default de DEPARTAMENTO cuando el agente no tiene entrada explícita', () => {
    // 'vigilante_calidad' SÍ tiene entrada explícita; se usa un id inventado
    // a propósito para probar el fallback sin depender de que la lista
    // explícita nunca lo incluya.
    expect(tiposAceptadosPorAgente('agente_nuevo_zzz', 'crecimiento')).toEqual(TIPOS_POR_DEPARTAMENTO.crecimiento);
  });

  it('cae al piso universal (texto libre) cuando ni el agente ni el departamento tienen entrada', () => {
    expect(tiposAceptadosPorAgente('agente_nuevo_zzz', 'departamento_inventado')).toEqual(['texto']);
  });
});

describe('aceptaArchivoInsumo', () => {
  it('rechaza un archivo vacío', () => {
    expect(aceptaArchivoInsumo('documento', { size: 0, type: 'application/pdf' })).toMatch(/vacío/);
  });
  it('rechaza un archivo demasiado pesado', () => {
    expect(aceptaArchivoInsumo('documento', { size: 50 * 1024 * 1024, type: 'application/pdf' })).toMatch(/pesa más de/);
  });
  it('rechaza un mimetype fuera del tipo declarado', () => {
    expect(aceptaArchivoInsumo('imagen', { size: 100, type: 'application/pdf' })).toMatch(/no se acepta/);
  });
  it('acepta un PDF para documento y una imagen para imagen', () => {
    expect(aceptaArchivoInsumo('documento', { size: 100, type: 'application/pdf' })).toBeNull();
    expect(aceptaArchivoInsumo('imagen', { size: 100, type: 'image/png' })).toBeNull();
  });
});

function archivoFalso(nombre: string, tipo: string, bytes = 100): File {
  return new File([new Uint8Array(bytes)], nombre, { type: tipo });
}

describe('subirArchivoInsumo', () => {
  it('LANZA DatoInvalido antes de tocar Storage si el archivo no pasa', async () => {
    await expect(subirArchivoInsumo('control_costos', archivoFalso('x.pdf', 'application/pdf', 0), 'documento'))
      .rejects.toThrow(DatoInvalido);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('sube al bucket agente-insumos bajo la carpeta del agente', async () => {
    storageUpload.mockResolvedValueOnce({ data: { path: 'x' }, error: null });
    const ruta = await subirArchivoInsumo('control_costos', archivoFalso('excel.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'documento');
    expect(ruta).toMatch(/^control_costos\/.+\.xlsx$/);
    expect(storageUpload).toHaveBeenCalledTimes(1);
  });

  it('LANZA si Storage devuelve error', async () => {
    storageUpload.mockResolvedValueOnce({ data: null, error: { message: 'bucket caído' } });
    await expect(subirArchivoInsumo('control_costos', archivoFalso('x.pdf', 'application/pdf'), 'documento'))
      .rejects.toThrow(/bucket caído/);
  });
});

describe('crearInsumoArchivo / crearInsumoTexto — validan el tipo ANTES de insertar', () => {
  it('rechaza un tipo que el agente no acepta (video para un financiero)', async () => {
    await expect(crearInsumoArchivo({
      agente: 'control_costos', departamento: 'back_office', titulo: 'x',
      tipo: 'video' as unknown as 'documento', storagePath: 'p', subidoPor: 'u1',
    })).rejects.toThrow(DatoInvalido);
    expect(llamadas).toHaveLength(0);
  });

  it('inserta con tenant_id null explícito (agente de plataforma)', async () => {
    respuestas.set('agente_insumo', [{ data: { id: 'ins-1' }, error: null }]);
    const id = await crearInsumoArchivo({
      agente: 'control_costos', departamento: 'back_office', titulo: 'Excel de gastos',
      tipo: 'documento', storagePath: 'control_costos/a.xlsx', subidoPor: 'u1',
    });
    expect(id).toBe('ins-1');
    expect(llamadas[0]).toMatchObject({ tabla: 'agente_insumo', metodo: 'insert', payload: { tenant_id: null, agente: 'control_costos', tipo: 'documento' } });
  });

  it('crearInsumoTexto rechaza un link para un agente que solo acepta texto', async () => {
    await expect(crearInsumoTexto({
      agente: 'scorer', departamento: 'leads', titulo: 'nota', tipo: 'link', contenido: 'https://x.com', subidoPor: 'u1',
    })).rejects.toThrow(DatoInvalido);
  });

  it('crearInsumoTexto acepta una idea de texto libre para cualquier agente (piso universal)', async () => {
    respuestas.set('agente_insumo', [{ data: { id: 'ins-2' }, error: null }]);
    const id = await crearInsumoTexto({
      agente: 'scorer', departamento: 'leads', titulo: 'idea', tipo: 'texto', contenido: 'prueba con más cuidado el giro X', subidoPor: 'u1',
    });
    expect(id).toBe('ins-2');
  });
});

describe('insumosPendientes — plataforma, fail-closed', () => {
  it('filtra por agente, tenant_id null y procesado_en null', async () => {
    respuestas.set('agente_insumo', [{ data: [{ id: 'i1', agente: 'control_costos', tenant_id: null, tipo: 'texto', titulo: 't', storage_path: null, contenido_texto: 'c', subido_por: 'u', subido_en: '2026-08-01T00:00:00Z', procesado_en: null, resumen_uso: null }], error: null }]);
    const r = await insumosPendientes('control_costos');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('i1');
  });

  it('LANZA si la lectura falla — nunca "no hay insumos" sobre un error real', async () => {
    respuestas.set('agente_insumo', [{ data: null, error: { message: 'timeout' } }]);
    await expect(insumosPendientes('control_costos')).rejects.toThrow(/timeout/);
  });
});

describe('marcarInsumosProcesados', () => {
  it('no hace nada con una lista vacía (sin tocar la base)', async () => {
    const n = await marcarInsumosProcesados([], 'x');
    expect(n).toBe(0);
    expect(llamadas).toHaveLength(0);
  });

  it('actualiza procesado_en y resumen_uso, anclado a procesado_en is null', async () => {
    respuestas.set('agente_insumo', [{ data: [{ id: 'i1' }, { id: 'i2' }], error: null }]);
    const n = await marcarInsumosProcesados(['i1', 'i2'], 'Incluido en el parte de Costos.');
    expect(n).toBe(2);
    expect(llamadas[0].metodo).toBe('update');
    expect((llamadas[0].payload as { resumen_uso: string }).resumen_uso).toBe('Incluido en el parte de Costos.');
  });

  it('una segunda llamada sobre lo ya marcado no cuenta nada (idempotente)', async () => {
    respuestas.set('agente_insumo', [{ data: [], error: null }]);
    const n = await marcarInsumosProcesados(['i1'], 'otra vez');
    expect(n).toBe(0);
  });
});

describe('contarPendientesPorAgente', () => {
  it('agrupa por agente sin fabricar ceros para agentes sin insumos', async () => {
    respuestas.set('agente_insumo', [{ data: [{ agente: 'control_costos' }, { agente: 'control_costos' }, { agente: 'guiones' }], error: null }]);
    const m = await contarPendientesPorAgente();
    expect(m.get('control_costos')).toBe(2);
    expect(m.get('guiones')).toBe(1);
    expect(m.has('tesoreria')).toBe(false);
  });
});

describe('listarInsumosDeAgente', () => {
  it('LANZA ante error de lectura — la tarjeta no puede fingir "sin insumos"', async () => {
    respuestas.set('agente_insumo', [{ data: null, error: { message: 'caída' } }]);
    await expect(listarInsumosDeAgente('control_costos')).rejects.toThrow(/caída/);
  });
});

describe('urlFirmadaInsumo / urlsFirmadasInsumos', () => {
  it('urlFirmadaInsumo devuelve null si Storage no pudo firmar', async () => {
    storageCreateSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'no' } });
    expect(await urlFirmadaInsumo('ruta/x.pdf')).toBeNull();
  });

  it('urlsFirmadasInsumos firma en UN solo lote y no revienta si falta una', async () => {
    storageCreateSignedUrls.mockResolvedValueOnce({
      data: [{ path: 'a', signedUrl: 'https://f/a', error: null }, { path: 'b', signedUrl: null, error: { message: 'no' } }],
    });
    const m = await urlsFirmadasInsumos(['a', 'b']);
    expect(m.get('a')).toBe('https://f/a');
    expect(m.has('b')).toBe(false);
    expect(storageCreateSignedUrls).toHaveBeenCalledTimes(1);
  });

  it('con una lista vacía no llama a Storage', async () => {
    const m = await urlsFirmadasInsumos([]);
    expect(m.size).toBe(0);
    expect(storageCreateSignedUrls).not.toHaveBeenCalled();
  });
});
