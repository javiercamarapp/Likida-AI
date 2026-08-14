import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LAS TOOLS DEL ANALISTA — la caja por la que el chat toca los datos.
//
// Lo que se prueba aquí NO es la aritmética de `analytics.ts` ni la de
// `fiscal.ts`: cada una tiene sus pruebas. Se prueba el CONTRATO de la caja:
//
//   1. que las diez sigan registradas —si una desaparece, el chat deja de
//      poder contestar esa pregunta SIN que nada falle: el modelo simplemente
//      ya no ve la herramienta, y el síntoma es "el asistente se volvió tonto";
//   2. que ninguna acepte texto libre —esta caja es la alternativa deliberada
//      a texto→SQL, y un parámetro de texto que llegue a una consulta es
//      exactamente la puerta que no debe existir;
//   3. que TODAS anclen al `ctx.tenantId` y a ninguna otra flota;
//   4. que el resultado que ve el modelo diga su moneda y no arrastre campos
//      que el cliente no debe ver.
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = Date.parse('2026-08-14T18:00:00Z');

const espias = {
  getKpis: vi.fn(async () => ({ viajesLiquidados: 12, montoComprobado: 340_000, porRevisar: 3, tasaCuadre: 0.91 })),
  getAcreditables: vi.fn(async () => ({ iva: 54_400, peaje: 12_000, litrosDiesel: 8_200 })),
  detectarAnomalias: vi.fn(async () => [{ folio: 'VJ-1', monto: 900, motivo: 'mismo folio en dos viajes' }]),
  getViajes: vi.fn(async () => Array.from({ length: 30 }, (_, i) => ({
    folio: `VJ-${i}`, origen: 'Nuevo Laredo', destino: 'CDMX', estatus: 'abierto',
    anticipo: 5_000, operadorNombre: 'Juan', fechaInicio: '2026-08-01',
    // Campos que el lector devuelve y la tool NO debe reenviar al modelo:
    tenantId: 'flota-a', costoIaMxn: 1.42,
  }))),
  getLiquidaciones: vi.fn(async () => Array.from({ length: 25 }, (_, i) => ({
    folio: `VJ-${i}`, comprobado: 4_800, diferencia: -200, estatus: 'con_diferencias',
    creadoEn: '2026-08-02', costoIaMxn: 0.88,
  }))),
  getGastoPorSemanaSeries: vi.fn(async () => {
    const bloque = { categorias: ['Diésel', 'Casetas'], series: [{ nombre: 'Diésel', valores: [100, 200, 300] }, { nombre: 'Casetas', valores: [10, 20, 30] }] };
    return { semanal: bloque, mensual: bloque, historico: bloque };
  }),
  getLiquidadoPorSemanaSeries: vi.fn(async () => {
    const puntos = Array.from({ length: 80 }, (_, i) => ({ etiqueta: `S${i}`, valor: i * 100 }));
    return { semanal: puntos, mensual: puntos, historico: puntos };
  }),
  getTopRutasPorGastoSeries: vi.fn(async () => {
    const rutas = [{ ruta: 'NLD→CDMX', valor: 90_000 }];
    return { semanal: rutas, mensual: rutas, historico: rutas };
  }),
};

vi.mock('@/lib/likida/analytics', () => espias);
vi.mock('@/lib/likida/config', () => ({ getConfig: vi.fn(async () => ({ politica: {} })) }));
vi.mock('@/lib/likida/fiscal', () => ({
  resolverPeriodo: vi.fn(() => ({ desde: '2026-01-01', hasta: '2026-08-14', etiqueta: 'ejercicio 2026' })),
  getGastosFiscales: vi.fn(async () => []),
  resumirPerdidas: vi.fn(() => ({
    montoPerdido: 1_000, montoEnRiesgo: 2_000, montoRecuperable: 3_000,
    porCausa: Array.from({ length: 12 }, (_, i) => ({ causa: `c${i}`, monto: i })),
  })),
  opcionesDe: vi.fn(() => ({})),
}));
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => AHORA }));

await import('./chat-tools');
const { toolSchemas, makeExecutor } = await import('@/lib/llm/tool-executor');
const { proyectarPuntos } = await import('./chat-tools');

const TOOLS = [
  'kpis_flota', 'acreditables_periodo', 'motor_fiscal', 'viajes_flota',
  'liquidaciones_flota', 'serie_gasto', 'serie_liquidado', 'top_rutas',
  'proyectar_serie', 'duplicados_detectados',
];

/** Los args mínimos válidos de cada tool. Las que no llevan parámetros van con `{}`. */
const ARGS: Record<string, Record<string, unknown>> = {
  serie_gasto: { modo: 'mensual' },
  serie_liquidado: { modo: 'mensual' },
  top_rutas: { modo: 'historico' },
  proyectar_serie: { serie: 'gasto', modo: 'mensual' },
};

const TENANT = 'flota-de-prueba';
const correr = (nombre: string, args: Record<string, unknown> = ARGS[nombre] ?? {}) =>
  makeExecutor({ tenantId: TENANT })(nombre, args);

/** `ChatCompletionTool` es una unión (`function` | `custom`). Se estrecha aquí
 *  y de paso se AFIRMA que las diez son del tipo `function`: una tool `custom`
 *  no lleva JSON Schema, así que ninguna de las reglas de abajo —enum cerrado,
 *  sin propiedades extra— la alcanzaría, y pasaría de largo sin fallar. */
function funciones() {
  const todas = toolSchemas(TOOLS);
  const fns = todas.filter((s) => s.type === 'function');
  expect(fns).toHaveLength(todas.length);
  return fns;
}

describe('el registro: las diez siguen ahí y con la forma correcta', () => {
  it('las diez están registradas', () => {
    expect(toolSchemas(TOOLS)).toHaveLength(TOOLS.length);
  });

  it('un nombre desconocido no devuelve un schema fantasma', () => {
    expect(toolSchemas(['kpis_flota', 'inventada'])).toHaveLength(1);
  });

  it('NINGUNA admite texto libre — es la alternativa deliberada a texto→SQL', () => {
    for (const s of funciones()) {
      const params = s.function.parameters as { properties?: Record<string, { type?: string; enum?: unknown[] }> } | undefined;
      for (const [clave, def] of Object.entries(params?.properties ?? {})) {
        if (def.type === 'string') {
          expect(def.enum, `${s.function.name}.${clave} es string SIN enum`).toBeDefined();
        }
      }
    }
  });

  it('ninguna acepta propiedades extra', () => {
    // Sin `additionalProperties: false` el modelo puede inventar un parámetro
    // que algún handler lea por accidente.
    for (const s of funciones()) {
      const p = s.function.parameters as { additionalProperties?: boolean } | undefined;
      expect(p?.additionalProperties, s.function.name).toBe(false);
    }
  });

  it('ninguna toma un tenant por parámetro: el tenant sale del contexto', () => {
    // Si el modelo pudiera nombrar la flota, una inyección en el mensaje del
    // usuario leería los datos de otra empresa.
    for (const s of funciones()) {
      const params = s.function.parameters as { properties?: Record<string, unknown> } | undefined;
      for (const clave of Object.keys(params?.properties ?? {})) {
        expect(clave.toLowerCase(), s.function.name).not.toMatch(/tenant|flota|empresa|cliente/);
      }
    }
  });
});

describe('las diez CORREN y devuelven algo utilizable', () => {
  it.each(TOOLS)('%s responde con éxito', async (nombre) => {
    const r = await correr(nombre);
    expect(r.success, r.error ?? '').toBe(true);
    expect(r.result).toBeTruthy();
  });

  it('todas las que hablan de dinero declaran la moneda', async () => {
    // El modelo redacta sobre el JSON que recibe. Sin `moneda` acaba diciendo
    // "dólares" en una flota mexicana, que es exactamente la cifra inventada
    // que el producto no se permite.
    for (const nombre of TOOLS) {
      const r = await correr(nombre);
      expect((r.result as { moneda?: string }).moneda, nombre).toBe('MXN');
    }
  });
});

describe('cada tool consulta la flota del contexto y ninguna otra', () => {
  it('el tenantId que llega al lector es el del contexto', async () => {
    espias.getKpis.mockClear();
    espias.getViajes.mockClear();
    espias.detectarAnomalias.mockClear();

    await correr('kpis_flota');
    await correr('viajes_flota');
    await correr('duplicados_detectados');

    expect(espias.getKpis).toHaveBeenCalledWith(TENANT);
    expect(espias.getViajes).toHaveBeenCalledWith(TENANT);
    expect(espias.detectarAnomalias).toHaveBeenCalledWith(TENANT);
  });
});

describe('el resultado se RECORTA antes de llegar al modelo', () => {
  // No es cosmético: cada campo que viaja son tokens que el cliente paga y que
  // el modelo puede repetir en pantalla.
  it('viajes_flota corta en 25 y dice cuántos hay en total', async () => {
    const r = (await correr('viajes_flota')).result as { total: number; mostrando: number; viajes: unknown[] };
    expect(r.total).toBe(30);
    expect(r.mostrando).toBe(25);
    expect(r.viajes).toHaveLength(25);
  });

  it('liquidaciones_flota corta en 20', async () => {
    const r = (await correr('liquidaciones_flota')).result as { total: number; mostrando: number; liquidaciones: unknown[] };
    expect(r.total).toBe(25);
    expect(r.mostrando).toBe(20);
    expect(r.liquidaciones).toHaveLength(20);
  });

  it('el COSTO DE IA no viaja al modelo en ninguna tool', async () => {
    // La regla de producto: el cliente ve valor, nunca lo que a Likida le
    // cuesta atenderlo. Los lectores traen `costoIaMxn` y las tools lo dejan
    // fuera al mapear; esta prueba es la que impide que un `...v` lo reabra.
    for (const nombre of TOOLS) {
      const json = JSON.stringify((await correr(nombre)).result);
      expect(json, nombre).not.toMatch(/costoIa|costo_ia|tokens|openrouter/i);
    }
  });

  it('motor_fiscal no manda las 12 causas, manda 6', async () => {
    const r = (await correr('motor_fiscal')).result as { porCausa: unknown[] };
    expect(r.porCausa).toHaveLength(6);
  });

  it('serie_liquidado corta la serie en 60 puntos', async () => {
    const r = (await correr('serie_liquidado')).result as { puntos: unknown[] };
    expect(r.puntos).toHaveLength(60);
  });

  it('duplicados_detectados manda 10 y el total real', async () => {
    const r = (await correr('duplicados_detectados')).result as { total: number; anomalias: unknown[] };
    expect(r.total).toBe(1);
    expect(r.anomalias).toHaveLength(1);
  });
});

describe('el modo es un enum cerrado, y lo que no cuadra cae en semanal', () => {
  it('un modo inventado no truena: cae en semanal', async () => {
    // El modelo puede mandar cualquier cosa pese al enum. Fallar cerrado aquí
    // es devolver la ventana más corta, no reventar el turno.
    const r = (await correr('serie_gasto', { modo: 'trimestral' })).result as { modo: string };
    expect(r.modo).toBe('semanal');
  });

  it('el modo pedido viaja de vuelta en el resultado', async () => {
    const r = (await correr('top_rutas', { modo: 'historico' })).result as { modo: string };
    expect(r.modo).toBe('historico');
  });
});

describe('proyectar_serie declara que es estimación', () => {
  it('el supuesto viaja EN el resultado, no solo en el prompt', async () => {
    // La regla del producto: una estimación se muestra declarada. Si el
    // supuesto viviera solo en el system prompt, cualquier edición del prompt
    // convertiría la proyección en una cifra que se lee como medición.
    const r = (await correr('proyectar_serie', { serie: 'gasto', modo: 'mensual' })).result as { supuesto?: string };
    expect(r.supuesto).toContain('promedio simple');
    expect(r.supuesto).toContain('no considera estacionalidad');
  });

  it('proyecta también sobre liquidado', async () => {
    const r = (await correr('proyectar_serie', { serie: 'liquidado', modo: 'semanal' })).result as { serie: string; cortesConDatos?: number };
    expect(r.serie).toBe('liquidado');
    expect(r.cortesConDatos).toBeGreaterThan(0);
  });

  it('el gasto se proyecta sobre el TOTAL del corte, no sobre una categoría', async () => {
    // Diésel [100,200,300] + Casetas [10,20,30] → totales [110,220,330].
    const r = (await correr('proyectar_serie', { serie: 'gasto', modo: 'mensual' })).result as { sumaObservada: number };
    expect(r.sumaObservada).toBe(660);
  });
});

describe('proyectarPuntos — la aritmética de la estimación', () => {
  it('sin un solo corte con datos, lo dice y no proyecta cero', () => {
    // Un `0` proyectado se lee como "vas a gastar nada". `sinDatos` obliga a la
    // pantalla a decir qué falta.
    expect(proyectarPuntos([])).toEqual({ sinDatos: true });
    expect(proyectarPuntos([0, 0, 0])).toEqual({ sinDatos: true });
  });

  it('promedia solo los últimos 4 cortes CON datos', () => {
    // Los ceros del arranque de una flota nueva hundirían el promedio y la
    // proyección diría la mitad de lo real.
    const r = proyectarPuntos([0, 0, 100, 200, 300, 400]) as { promedioPorCorte: number; cortesConDatos: number };
    expect(r.cortesConDatos).toBe(4);
    expect(r.promedioPorCorte).toBe(250);
  });

  it('la suma observada SÍ incluye los ceros: es lo medido', () => {
    const r = proyectarPuntos([0, 100, 200]) as { sumaObservada: number };
    expect(r.sumaObservada).toBe(300);
  });

  it('proyectar 4 cortes es el promedio por cuatro', () => {
    const r = proyectarPuntos([100, 100]) as { proyeccionSiguienteCorte: number; proyeccionSiguientes4: number };
    expect(r.proyeccionSiguienteCorte).toBe(100);
    expect(r.proyeccionSiguientes4).toBe(400);
  });

  it('redondea a centavos, no arrastra flotantes', () => {
    const r = proyectarPuntos([10.005, 20.004, 30.003]) as { promedioPorCorte: number };
    expect(Number.isFinite(r.promedioPorCorte)).toBe(true);
    expect(String(r.promedioPorCorte).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

describe('un lector caído NO tumba el turno', () => {
  it('el error se captura y vuelve como fallo, no como excepción', async () => {
    // `executeTool` es el que garantiza esto, pero la garantía importa AQUÍ:
    // una consulta que revienta durante una respuesta del chat dejaría al
    // usuario con un turno vacío en vez de un "no pude leer eso".
    espias.getKpis.mockRejectedValueOnce(new Error('PostgREST 503'));
    const r = await correr('kpis_flota');
    expect(r.success).toBe(false);
    expect(r.result).toBeNull();
    expect(r.error).toBeTruthy();
  });
});
