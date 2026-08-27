import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL LECTOR DEL COTIZADOR — comportamiento con la base doblada (molde de
// mantenimiento_cerrar.test.ts): lo que se prueba es el CONTRATO de cada
// escritura y lectura, no la llamada por la llamada:
//   · la config valida con las cotas del CHECK antes de tocar la base;
//   · las casetas medidas promedian SOLO viajes con gasto caseta;
//   · crearCotizacion rebota lo insano ANTES de escribir, la medición gana
//     sobre la captura manual, el pacto del cliente gana sobre el de flota,
//     y un precio de $0 se persiste como 0 (no como "sin capturar");
//   · la decisión es un claim: el segundo tap recibe la verdad;
//   · convertir sin precio se rechaza ANTES del claim, y si crearViaje
//     falla el claim se suelta (compensación).
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data?: unknown; error?: { message: string } | null };
let respuestas: Record<string, Resp[]>;
let escrituras: Array<{ tabla: string; op: string; payload: unknown; filtros: string[] }>;

function responder(tabla: string, op: string, payload: unknown, filtros: string[]): Resp {
  escrituras.push({ tabla, op, payload, filtros });
  const cola = respuestas[tabla];
  if (!cola || cola.length === 0) throw new Error(`sin respuesta preparada para ${tabla}`);
  return cola.length > 1 ? cola.shift()! : cola[0];
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let payload: unknown = null;
      let op = 'select';
      const filtros: string[] = [];
      const b: Record<string, unknown> = {};
      const enc = (nombre: string) => (...args: unknown[]) => {
        filtros.push(`${nombre}:${args.map((a) => JSON.stringify(a)).join(',')}`);
        return b;
      };
      Object.assign(b, {
        select: (..._a: unknown[]) => b,
        insert: (fila: unknown) => { op = 'insert'; payload = fila; return b; },
        update: (fila: unknown) => { op = 'update'; payload = fila; return b; },
        upsert: (fila: unknown) => { op = 'upsert'; payload = fila; return b; },
        eq: enc('eq'), neq: enc('neq'), is: enc('is'), in: enc('in'),
        gte: enc('gte'), not: enc('not'), or: enc('or'),
        order: () => b, range: () => b, limit: () => b,
        maybeSingle: () => b, single: () => b,
        then: (res: (r: Resp) => unknown, rej: (e: unknown) => unknown) => {
          try { return Promise.resolve(responder(tabla, op, payload, filtros)).then(res, rej); } catch (e) { return Promise.reject(e).catch(rej); }
        },
      });
      return b;
    },
  }),
}));

// `traerTodo` real pagina; el doble ejecuta la consulta UNA vez y respeta el
// contrato de error-por-valor → throw, que es lo que el lector espera.
vi.mock('../pg', async (orig) => ({
  ...(await orig() as object),
  traerTodo: async (fn: (d: number, h: number) => PromiseLike<Resp>) => {
    const r = await fn(0, 999);
    if (r.error) throw new Error(r.error.message);
    return (r.data as unknown[]) ?? [];
  },
}));
vi.mock('../presupuesto', async (orig) => ({
  ...(await orig() as object),
  acotada: (q: unknown) => q,
}));

const politicas = vi.fn();
vi.mock('../estadias/lector', () => ({ politicasDetencion: politicas }));

const crearViaje = vi.fn();
vi.mock('../operacion', () => ({ crearViaje }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const {
  getConfigCotizador, guardarConfigCotizador, casetasMedidasPorRuta,
  getPanelCotizador, crearCotizacion, marcarEnviada, marcarPerdida, convertirEnViaje,
  falloDefinitivoAlCrearViaje,
} = await import('./lector');

beforeEach(() => {
  vi.clearAllMocks();
  respuestas = {};
  escrituras = [];
  politicas.mockResolvedValue({ flota: null, porCliente: new Map() });
});

// Lo mínimo que crearCotizacion consulta en el camino feliz.
function prepararCotizar() {
  respuestas['cotizador_config'] = [{ data: { diesel_por_km: 10, salario_dia: 500, viaticos_dia: 100, fijos_por_km: 2, factor_regreso_vacio: 2, margen_objetivo_pct: 10 }, error: null }];
  respuestas['liquidacion'] = [{ data: [], error: null }];    // nada liquidado en la ventana
  respuestas['viaje'] = [{ data: [], error: null }];          // sin histórico de la ruta
  respuestas['tarifa'] = [{ data: [], error: null }];         // sin catálogo
  respuestas['cotizacion'] = [{ data: { id: 'q-1' }, error: null }];
}

describe('la config declarada', () => {
  it('lee números y respeta el NULL como "no declarado"', async () => {
    respuestas['cotizador_config'] = [{ data: { diesel_por_km: '12.5', salario_dia: null, viaticos_dia: 0, fijos_por_km: undefined, factor_regreso_vacio: 2, margen_objetivo_pct: 15 }, error: null }];
    const c = await getConfigCotizador('t1');
    expect(c.dieselPorKm).toBe(12.5);
    expect(c.salarioDia).toBeNull();
    expect(c.viaticosDia).toBe(0);       // 0 declarado NO es null
    expect(c.fijosPorKm).toBeNull();
  });

  it('sin fila todavía, todo es null — no un default inventado', async () => {
    respuestas['cotizador_config'] = [{ data: null, error: null }];
    const c = await getConfigCotizador('t1');
    expect(Object.values(c).every((v) => v === null)).toBe(true);
  });

  it('rebota el factor de regreso fuera de 1–3 ANTES de tocar la base', async () => {
    await expect(guardarConfigCotizador('t1', {
      dieselPorKm: 10, salarioDia: null, viaticosDia: null, fijosPorKm: null,
      factorRegresoVacio: 4, margenObjetivoPct: null,
    }, 'u1')).rejects.toThrow(/regreso/);
    expect(escrituras).toEqual([]);
  });

  it('rebota el margen fuera de 0–90 y el costo negativo, también antes', async () => {
    await expect(guardarConfigCotizador('t1', {
      dieselPorKm: null, salarioDia: null, viaticosDia: null, fijosPorKm: null,
      factorRegresoVacio: null, margenObjetivoPct: 200,
    }, 'u1')).rejects.toThrow(/margen/);
    await expect(guardarConfigCotizador('t1', {
      dieselPorKm: -1, salarioDia: null, viaticosDia: null, fijosPorKm: null,
      factorRegresoVacio: null, margenObjetivoPct: null,
    }, 'u1')).rejects.toThrow(/diésel/);
    expect(escrituras).toEqual([]);
  });

  it('guarda con upsert por tenant y conserva los null tal cual', async () => {
    respuestas['cotizador_config'] = [{ data: null, error: null }];
    await guardarConfigCotizador('t1', {
      dieselPorKm: 12, salarioDia: null, viaticosDia: 0, fijosPorKm: 3,
      factorRegresoVacio: 1.5, margenObjetivoPct: 20,
    }, 'u1');
    const e = escrituras.find((x) => x.tabla === 'cotizador_config');
    expect(e?.op).toBe('upsert');
    expect(e?.payload).toMatchObject({
      tenant_id: 't1', diesel_por_km: 12, salario_dia: null, viaticos_dia: 0,
      factor_regreso_vacio: 1.5, margen_objetivo_pct: 20, actualizado_por: 'u1',
    });
  });
});

describe('las casetas medidas de la ruta', () => {
  it('promedia SOLO los viajes con gasto caseta, con la ruta normalizada', async () => {
    // La ventana se recorre por LIQUIDACIÓN (c6-13): `v1` con dos
    // liquidaciones sigue contando UNA vez.
    respuestas['liquidacion'] = [{ data: [
      { viaje_id: 'v1' }, { viaje_id: 'v1' }, { viaje_id: 'v2' }, { viaje_id: 'v3' },
    ], error: null }];
    respuestas['viaje'] = [{ data: [
      { id: 'v1', origen: 'León', destino: 'CDMX' },
      { id: 'v2', origen: 'leon ', destino: ' cdmx' },
      { id: 'v3', origen: 'León', destino: 'Monterrey' },   // otra ruta: fuera
    ], error: null }];
    // v1 con dos casetas (600+400=1000), v2 SIN gasto caseta → no cuenta.
    respuestas['gasto'] = [{ data: [
      { viaje_id: 'v1', monto: 600 }, { viaje_id: 'v1', monto: 400 },
    ], error: null }];
    const m = await casetasMedidasPorRuta('t1', 'leon', 'CDMX', '2026-08-27');
    expect(m).toEqual({ promedio: 1000, viajes: 1 });
  });

  it('la ventana la marca la FECHA DE LIQUIDACIÓN, no el alta del viaje (c6-13)', async () => {
    respuestas['liquidacion'] = [{ data: [{ viaje_id: 'v1' }], error: null }];
    respuestas['viaje'] = [{ data: [{ id: 'v1', origen: 'León', destino: 'CDMX' }], error: null }];
    respuestas['gasto'] = [{ data: [{ viaje_id: 'v1', monto: 800 }], error: null }];
    await casetasMedidasPorRuta('t1', 'León', 'CDMX', '2026-08-27');

    // El `gte` de la ventana cuelga de `liquidacion.created_at`…
    const liq = escrituras.find((e) => e.tabla === 'liquidacion');
    expect(liq?.filtros.some((f) => f.startsWith('gte:"created_at"'))).toBe(true);
    // …y la consulta de viajes ya NO filtra por su propia fecha de alta: solo
    // resuelve la ruta de los ids que la ventana ya eligió.
    const viajes = escrituras.find((e) => e.tabla === 'viaje');
    expect(viajes?.filtros.some((f) => f.startsWith('gte:'))).toBe(false);
    expect(viajes?.filtros.some((f) => f.startsWith('in:"id"'))).toBe(true);
  });

  it('sin nada liquidado en la ventana, o sin casetas registradas → null, jamás $0', async () => {
    respuestas['liquidacion'] = [{ data: [], error: null }];
    expect(await casetasMedidasPorRuta('t1', 'León', 'CDMX', '2026-08-27')).toBeNull();
    respuestas['liquidacion'] = [{ data: [{ viaje_id: 'v1' }], error: null }];
    respuestas['viaje'] = [{ data: [{ id: 'v1', origen: 'León', destino: 'CDMX' }], error: null }];
    respuestas['gasto'] = [{ data: [], error: null }];
    expect(await casetasMedidasPorRuta('t1', 'León', 'CDMX', '2026-08-27')).toBeNull();
  });
});

describe('el panel', () => {
  it('mapea la lista con su desglose citable, y un jsonb roto cae a null (no revienta)', async () => {
    respuestas['cotizador_config'] = [{ data: null, error: null }];
    respuestas['cotizacion'] = [{ data: [
      {
        id: 'q1', folio: 'COT-1', cliente_id: 'c1', origen: 'León', destino: 'CDMX', km: 400,
        costo_estimado: '1000.5', precio: 0, estado: 'borrador', vigente_hasta: null, viaje_id: null,
        desglose: { lineas: [{ concepto: 'Diésel', monto: 100, supuesto: 'x' }], costoTotal: 100, faltantes: [], precioSugerido: 110, notas: [], tarifaCatalogo: { monto: 900, porque: 'De lista', ambigua: false } },
        creada_en: '2026-08-27T00:00:00Z',
      },
      { id: 'q2', folio: null, cliente_id: null, origen: 'A', destino: 'B', km: null, costo_estimado: null, precio: null, estado: 'enviada', vigente_hasta: null, viaje_id: null, desglose: 'basura', creada_en: '2026-08-27T00:00:00Z' },
    ], error: null }];
    respuestas['cliente'] = [{ data: [{ id: 'c1', nombre: 'Choco' }], error: null }];
    const p = await getPanelCotizador('t1');
    expect(p.cotizaciones[0].clienteNombre).toBe('Choco');
    expect(p.cotizaciones[0].precio).toBe(0);            // $0 cotizado es un precio real
    expect(p.cotizaciones[0].costoEstimado).toBe(1000.5);
    expect(p.cotizaciones[0].tarifaCatalogo?.monto).toBe(900);
    expect(p.cotizaciones[1].desglose).toBeNull();       // jsonb roto: null dicho, no crash
    expect(p.clientes).toEqual([{ id: 'c1', nombre: 'Choco' }]);
  });
});

describe('crearCotizacion — los candados de entrada', () => {
  const base = {
    clienteId: null, origen: 'León', destino: 'CDMX', km: 400, dias: 2,
    casetasManual: null, precio: null, folio: null, vigenteHasta: null,
  };

  it('rebota ruta vacía, km/días/precio insanos ANTES de escribir', async () => {
    await expect(crearCotizacion('t1', { ...base, origen: '  ' }, 'u1')).rejects.toThrow(/origen y destino/);
    await expect(crearCotizacion('t1', { ...base, km: 0 }, 'u1')).rejects.toThrow(/km/);
    await expect(crearCotizacion('t1', { ...base, dias: 0 }, 'u1')).rejects.toThrow(/días/i);
    await expect(crearCotizacion('t1', { ...base, precio: -5 }, 'u1')).rejects.toThrow(/precio/);
    expect(escrituras.filter((e) => e.op === 'insert')).toEqual([]);
  });

  it('el cliente ajeno se rebota — el <select> es UI, no servidor', async () => {
    respuestas['cliente'] = [{ data: null, error: null }];
    await expect(crearCotizacion('t1', { ...base, clienteId: 'c-de-otro' }, 'u1'))
      .rejects.toThrow(/no pertenece/);
  });

  it('la medición GANA sobre la captura manual, y el desglose persistido lo dice', async () => {
    prepararCotizar();
    // La ventana la abre `liquidacion` desde c6-13.
    respuestas['liquidacion'] = [{ data: [{ viaje_id: 'v1' }], error: null }];
    respuestas['viaje'] = [{ data: [{ id: 'v1', origen: 'León', destino: 'CDMX' }], error: null }];
    respuestas['gasto'] = [{ data: [{ viaje_id: 'v1', monto: 800 }], error: null }];
    await crearCotizacion('t1', { ...base, casetasManual: 999 }, 'u1');
    const ins = escrituras.find((e) => e.tabla === 'cotizacion' && e.op === 'insert');
    const desglose = (ins?.payload as { desglose: { lineas: Array<{ concepto: string; monto: number | null; supuesto: string }> } }).desglose;
    const casetas = desglose.lineas.find((l) => l.concepto === 'Casetas')!;
    expect(casetas.monto).toBe(800);
    expect(casetas.supuesto).toContain('MEDIDO');
  });

  it('el pacto del CLIENTE gana sobre el de flota en la nota', async () => {
    prepararCotizar();
    politicas.mockResolvedValue({
      flota: { horasLibres: 4, tarifaHora: 100, moneda: 'MXN' },
      porCliente: new Map([['c1', { horasLibres: 8, tarifaHora: 350, moneda: 'MXN' }]]),
    });
    respuestas['cliente'] = [{ data: { id: 'c1' }, error: null }];
    await crearCotizacion('t1', { ...base, clienteId: 'c1' }, 'u1');
    const ins = escrituras.find((e) => e.tabla === 'cotizacion' && e.op === 'insert');
    const notas = (ins?.payload as { desglose: { notas: string[] } }).desglose.notas;
    expect(notas.some((n) => n.includes('pactado con este cliente') && n.includes('8 h libres'))).toBe(true);
  });

  it('un precio de $0 se persiste como 0 — cortesía, no "sin capturar"', async () => {
    prepararCotizar();
    await crearCotizacion('t1', { ...base, precio: 0 }, 'u1');
    const ins = escrituras.find((e) => e.tabla === 'cotizacion' && e.op === 'insert');
    expect((ins?.payload as { precio: number | null }).precio).toBe(0);
    expect((ins?.payload as { estado: string }).estado).toBe('borrador');
    expect((ins?.payload as { creada_por: string }).creada_por).toBe('u1');
  });
});

describe('decidir — el claim resuelve el doble tap', () => {
  it('marcarEnviada solo mueve borradores; 0 filas = la verdad dicha', async () => {
    respuestas['cotizacion'] = [{ data: [], error: null }];
    await expect(marcarEnviada('t1', 'q1')).rejects.toThrow(/borrador/);
  });

  it('marcarPerdida estampa el claim y el filtro lo exige NULL', async () => {
    respuestas['cotizacion'] = [{ data: [{ id: 'q1' }], error: null }];
    await marcarPerdida('t1', 'q1', 'vencida', 'u1');
    const e = escrituras.find((x) => x.tabla === 'cotizacion');
    expect(e?.payload).toMatchObject({ estado: 'vencida', decidida_por: 'u1' });
    expect(e?.filtros).toContainEqual('is:"decidida_en",null');
  });

  it('el segundo tap de perdida recibe "ya fue decidida"', async () => {
    respuestas['cotizacion'] = [{ data: [], error: null }];
    await expect(marcarPerdida('t1', 'q1', 'perdida', 'u1')).rejects.toThrow(/ya fue decidida/);
  });
});

describe('convertirEnViaje — claim, viaje y compensación', () => {
  it('sin precio se rechaza ANTES del claim (el CHECK de la 0051 lo rebotaría igual)', async () => {
    respuestas['cotizacion'] = [{ data: { origen: 'A', destino: 'B', km: 100, precio: null, cliente_id: null, estado: 'borrador' }, error: null }];
    await expect(convertirEnViaje('t1', 'q1', 'u1')).rejects.toThrow(/Sin precio/);
    expect(crearViaje).not.toHaveBeenCalled();
    expect(escrituras.filter((e) => e.op === 'update')).toEqual([]);
  });

  it('una ganada/perdida ya no se convierte', async () => {
    respuestas['cotizacion'] = [{ data: { origen: 'A', destino: 'B', km: 100, precio: 500, cliente_id: null, estado: 'perdida' }, error: null }];
    await expect(convertirEnViaje('t1', 'q1', 'u1')).rejects.toThrow(/ya no se convierte/);
  });

  it('claim perdido = "alguien ya está decidiendo" — sin viaje creado', async () => {
    respuestas['cotizacion'] = [
      { data: { origen: 'A', destino: 'B', km: 100, precio: 500, cliente_id: null, estado: 'enviada' }, error: null },
      { data: [], error: null },   // el claim no tomó filas
    ];
    await expect(convertirEnViaje('t1', 'q1', 'u1')).rejects.toThrow(/ya está decidiendo/);
    expect(crearViaje).not.toHaveBeenCalled();
  });

  it('camino feliz: claim → crearViaje con el precio como ingreso → ganada', async () => {
    respuestas['cotizacion'] = [
      { data: { origen: 'León', destino: 'CDMX', km: 400, precio: 18000, cliente_id: 'c1', estado: 'enviada' }, error: null },
      { data: [{ id: 'q1' }], error: null },   // claim ganado
      { data: null, error: null },             // update a ganada
    ];
    crearViaje.mockResolvedValue('viaje-9');
    const id = await convertirEnViaje('t1', 'q1', 'u1');
    expect(id).toBe('viaje-9');
    expect(crearViaje).toHaveBeenCalledWith('t1', {
      origen: 'León', destino: 'CDMX', clienteId: 'c1', ingresoFlete: 18000, kmRecorridos: 400,
    });
    const gana = escrituras.filter((e) => e.tabla === 'cotizacion' && e.op === 'update').at(-1);
    expect(gana?.payload).toMatchObject({ estado: 'ganada', viaje_id: 'viaje-9' });
  });

  // ── c6-4: el claim SOLO se suelta con prueba de que no hay viaje ─────────

  it('fallo DEFINITIVO y viaje inexistente: el claim se SUELTA', async () => {
    respuestas['cotizacion'] = [
      { data: { origen: 'A', destino: 'B', km: 100, precio: 500, cliente_id: null, estado: 'borrador' }, error: null },
      { data: [{ id: 'q1' }], error: null },   // claim ganado
      { data: null, error: null },             // soltar claim
    ];
    respuestas['viaje'] = [{ data: [], error: null }];   // se COMPROBÓ que no existe
    crearViaje.mockRejectedValue(new Error('el operador no pertenece a esta flota'));
    await expect(convertirEnViaje('t1', 'q1', 'u1')).rejects.toThrow(/no pertenece/);
    const suelta = escrituras.filter((e) => e.tabla === 'cotizacion' && e.op === 'update').at(-1);
    expect(suelta?.payload).toEqual({ decidida_en: null, decidida_por: null });
    expect(suelta?.filtros).toContainEqual('neq:"estado","ganada"');
  });

  it('fallo AMBIGUO (timeout): el claim NO se suelta — la cotización queda «decidiéndose»', async () => {
    respuestas['cotizacion'] = [
      { data: { origen: 'A', destino: 'B', km: 100, precio: 500, cliente_id: null, estado: 'borrador' }, error: null },
      { data: [{ id: 'q1' }], error: null },   // claim ganado
    ];
    respuestas['viaje'] = [{ data: [], error: null }];   // no aparece el viaje
    crearViaje.mockRejectedValue(new Error('crearViaje: sin respuesta en 8000 ms (tope de consulta)'));
    await expect(convertirEnViaje('t1', 'q1', 'u1')).rejects.toThrow(/No se pudo confirmar/);
    // Ni un solo UPDATE después del claim: soltar habilitaría un SEGUNDO viaje.
    const updates = escrituras.filter((e) => e.tabla === 'cotizacion' && e.op === 'update');
    expect(updates).toHaveLength(1);   // solo el claim
    expect(logger.error).toHaveBeenCalledWith('cotizador.conversion_ambigua', expect.objectContaining({ definitivo: false }));
  });

  it('si NO se pudo comprobar la existencia del viaje, tampoco se suelta', async () => {
    respuestas['cotizacion'] = [
      { data: { origen: 'A', destino: 'B', km: 100, precio: 500, cliente_id: null, estado: 'borrador' }, error: null },
      { data: [{ id: 'q1' }], error: null },
    ];
    respuestas['viaje'] = [{ data: null, error: { message: 'red caída' } }];
    crearViaje.mockRejectedValue(new Error('el operador no pertenece a esta flota'));
    await expect(convertirEnViaje('t1', 'q1', 'u1')).rejects.toThrow(/No se pudo confirmar/);
    expect(escrituras.filter((e) => e.tabla === 'cotizacion' && e.op === 'update')).toHaveLength(1);
  });

  it('el viaje SÍ se creó pese al error: se consolida como ganada y se devuelve su id', async () => {
    respuestas['cotizacion'] = [
      { data: { origen: 'A', destino: 'B', km: 100, precio: 500, cliente_id: null, estado: 'borrador' }, error: null },
      { data: [{ id: 'q1' }], error: null },   // claim
      { data: null, error: null },             // update a ganada
    ];
    respuestas['viaje'] = [{ data: [{ id: 'viaje-fantasma' }], error: null }];
    crearViaje.mockRejectedValue(new Error('crearViaje: el insert no devolvió id'));
    await expect(convertirEnViaje('t1', 'q1', 'u1')).resolves.toBe('viaje-fantasma');
    const gana = escrituras.filter((e) => e.tabla === 'cotizacion' && e.op === 'update').at(-1);
    expect(gana?.payload).toMatchObject({ estado: 'ganada', viaje_id: 'viaje-fantasma' });
  });

  it('la clasificación del fallo: pertenencia y constraint son definitivos; timeout no', () => {
    expect(falloDefinitivoAlCrearViaje(new Error('el cliente no pertenece a esta flota'))).toBe(true);
    expect(falloDefinitivoAlCrearViaje(new Error('violates check constraint "x"'))).toBe(true);
    expect(falloDefinitivoAlCrearViaje(new Error('duplicate key value'))).toBe(true);
    expect(falloDefinitivoAlCrearViaje(new Error('sin respuesta en 8000 ms (tope de consulta)'))).toBe(false);
    expect(falloDefinitivoAlCrearViaje(new Error('el insert no devolvió id'))).toBe(false);
    expect(falloDefinitivoAlCrearViaje('algo raro')).toBe(false);
  });
});
