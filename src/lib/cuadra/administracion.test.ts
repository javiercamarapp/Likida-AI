// ═══════════════════════════════════════════════════════════════════════════
// LAS CUATRO ALTAS QUE ANTES SE HACÍAN CON SQL A MANO.
//
// Cada una tiene un modo de fallo que NO truena y por eso hay que fijarlo:
//
//   · RFC malo      → la validación de receptor queda apagada en silencio y
//                     ninguna factura se rechaza por estar a nombre de otro.
//   · Teléfono repetido en otra flota → `resolveOperador` no filtra por tenant,
//                     así que devuelve una fila arbitraria y el gasto se anota
//                     en la flota equivocada. Dinero de A en los libros de B.
//   · Política guardada de golpe → borra los hermanos de `config` (estímulos,
//                     hidrocarburos) y el motor los lee con `if (x != null)`:
//                     no falla, SE SALTA el tope fiscal.
//   · Reabrir sin borrar la liquidación → el trigger de la 0036 mira si existe
//                     esa fila, no el estatus. Cuatro veces se dijo "ya lo
//                     reabrí" sobre un viaje que no aceptaba ni un gasto.
//
// Los cuatro son silenciosos. Ninguno lanza, ninguno aparece en un log de
// errores, y los cuatro se descubren semanas después mirando cifras raras.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [])) }),
}));

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

vi.mock('./config', () => ({ getConfig: vi.fn() }));

const { crearFlota, crearOperador, guardarPolitica, reabrirViaje, DatoInvalido, armarPolitica, mensajeParaPantalla } =
  await import('./administracion');

/** Nodo encadenable: `.select().eq().in().limit().maybeSingle()` → `resultado`. */
function cadena(resultado: unknown) {
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'limit', 'order']) nodo[m] = () => nodo;
  nodo.maybeSingle = () => Promise.resolve(resultado);
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado).then(r);
  return nodo;
}

beforeEach(() => {
  from.mockReset();
  for (const f of Object.values(logger)) f.mockReset();
});

describe('crearFlota', () => {
  it('RECHAZA un RFC con dígito verificador malo, en vez de aceptarlo y apagar la validación', async () => {
    // El modo de fallo que esto impide: `getConfig` detecta el RFC inválido
    // pero para entonces solo puede loguear y seguir con la comprobación de
    // receptor APAGADA. La flota cree que se valida a nombre de quién vienen
    // sus facturas, y no se valida ninguna.
    await expect(crearFlota({ nombre: 'Transportes Prueba', rfc: 'GMX0902279XX' }))
      .rejects.toThrow(DatoInvalido);
    // Y no llegó a tocar la base: se rechaza antes de insertar nada.
    expect(from).not.toHaveBeenCalled();
  });

  it('acepta un RFC válido y crea el tenant', async () => {
    from.mockImplementation((tabla: string) =>
      tabla === 'tenant'
        ? { insert: () => cadena({ data: { id: 't-1' }, error: null }) }
        : { insert: () => Promise.resolve({ error: null }) });

    const r = await crearFlota({ nombre: 'Transportes Prueba', rfc: 'GMX0902279I1' });
    expect(r.tenantId).toBe('t-1');
  });

  it('un nombre de dos letras no pasa', async () => {
    await expect(crearFlota({ nombre: 'AB' })).rejects.toThrow(DatoInvalido);
  });
});

describe('crearOperador', () => {
  it('RECHAZA un teléfono que ya existe en OTRA flota', async () => {
    // Es la fuga entre tenants: `resolveOperador` busca por teléfono sin
    // filtrar por tenant, así que con el número repetido el gasto se anota en
    // la flota que salga primero.
    from.mockImplementation(() => cadena({ data: [{ id: 'o-9', tenant_id: 'OTRA', nombre: 'Pedro' }], error: null }));

    await expect(crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '9993700779' }))
      .rejects.toThrow(/OTRA flota/i);
  });

  it('y también si ya está en LA MISMA flota, con un mensaje distinto', async () => {
    from.mockImplementation(() => cadena({ data: [{ id: 'o-9', tenant_id: 't-1', nombre: 'Pedro' }], error: null }));

    await expect(crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '9993700779' }))
      .rejects.toThrow(/ya está registrado en esta flota/i);
  });

  it('FALLA CERRADO: si no se puede comprobar el duplicado, no da de alta', async () => {
    // Sin esto, un bache de red convertiría la comprobación en un "no hay
    // nadie" y crearía justo el duplicado que evita.
    from.mockImplementation(() => cadena({ data: null, error: { message: 'timeout' } }));

    await expect(crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '9993700779' }))
      .rejects.toThrow(/no se pudo comprobar/i);
  });

  it('normaliza 10 dígitos a la forma que Meta usa para enviar (52 + 10, sin el 1)', async () => {
    let guardado: Record<string, unknown> | undefined;
    from.mockImplementation((tabla: string) => {
      if (tabla === 'operador') {
        return {
          select: () => cadena({ data: [], error: null }),
          insert: (fila: Record<string, unknown>) => { guardado = fila; return cadena({ data: { id: 'o-1' }, error: null }); },
        };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    });

    await crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '999 370 0779' });
    expect(guardado?.telefono).toBe('529993700779');
  });

  it('un teléfono de 7 dígitos se rechaza con el conteo a la vista', async () => {
    await expect(crearOperador('t-1', { nombre: 'Juan Pérez', telefono: '370 0779' }))
      .rejects.toThrow(/7 dígitos/);
  });
});

describe('guardarPolitica', () => {
  it('NO borra los hermanos de `config` — lee, modifica y escribe', async () => {
    // El bug que esto fija: `update({config: {politica}})` se lleva por delante
    // estimulos e hidrocarburos, y el motor los lee con `if (x != null)`. No
    // truena: se salta el tope de $750/día de LISR 28-V y la liquidación sale
    // declarando todo deducible.
    const configPrevia = {
      estimulos: { topeAlimentacionDiaMxn: 750, peajeFactor: 0.5 },
      hidrocarburos: { claves: ['15101505'] },
      politica: [{ concepto: 'diesel', topeMonto: 4000 }],
    };
    let escrito: Record<string, unknown> | undefined;

    from.mockImplementation(() => ({
      select: () => cadena({ data: { config: configPrevia }, error: null }),
      update: (fila: Record<string, unknown>) => { escrito = fila; return cadena({ error: null }); },
      insert: () => Promise.resolve({ error: null }),
    }));

    await guardarPolitica('t-1', [{ concepto: 'caseta', topeMonto: 1500 }]);

    const cfg = escrito?.config as Record<string, unknown>;
    expect(cfg.politica).toEqual([{ concepto: 'caseta', topeMonto: 1500 }]);
    // Lo que importa: los otros dos SIGUEN AHÍ.
    expect(cfg.estimulos).toEqual(configPrevia.estimulos);
    expect(cfg.hidrocarburos).toEqual(configPrevia.hidrocarburos);
  });

  it('rechaza un tope negativo', async () => {
    await expect(guardarPolitica('t-1', [{ concepto: 'diesel', topeMonto: -1 }]))
      .rejects.toThrow(DatoInvalido);
  });

  it('rechaza un renglón sin concepto', async () => {
    await expect(guardarPolitica('t-1', [{ concepto: '  ' }]))
      .rejects.toThrow(DatoInvalido);
  });
});

describe('reabrirViaje', () => {
  it('sin confirmar no hace nada: borra un PDF que ya pudo entregarse', async () => {
    await expect(reabrirViaje('t-1', 'VJ-2026-0848', false)).rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });

  it('BORRA LA LIQUIDACIÓN antes de tocar el estatus — el trigger mira la fila, no el estatus', async () => {
    // Los cuatro "ya lo reabrí" que no reabrían nada salían de hacer solo el
    // update de estatus. El orden también importa: si el borrado falla, el
    // viaje se queda liquidado y coherente en vez de abierto pero incapaz de
    // recibir un gasto.
    const orden: string[] = [];
    from.mockImplementation((tabla: string) => {
      if (tabla === 'viaje') {
        return {
          select: () => cadena({ data: { id: 'v-1', estatus: 'liquidado' }, error: null }),
          update: () => { orden.push('viaje.update'); return cadena({ error: null }); },
        };
      }
      if (tabla === 'liquidacion') {
        return {
          select: () => cadena({ data: { id: 'l-1', pdf_url: 'tenant/abc.pdf' }, error: null }),
          delete: () => { orden.push('liquidacion.delete'); return cadena({ error: null }); },
        };
      }
      if (tabla === 'wa_conversacion') {
        return { update: () => { orden.push('conv.update'); return cadena({ error: null }); } };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    });

    const r = await reabrirViaje('t-1', 'VJ-2026-0848', true);

    expect(orden[0]).toBe('liquidacion.delete');
    expect(orden[1]).toBe('viaje.update');
    // Y devuelve QUÉ PDF se perdió, para poder decírselo a quien lo tenga.
    expect(r.pdfPerdido).toBe('tenant/abc.pdf');
  });

  it('un folio de otra flota no se reabre', async () => {
    from.mockImplementation(() => ({ select: () => cadena({ data: null, error: null }) }));
    await expect(reabrirViaje('t-1', 'VJ-DE-OTRA', true)).rejects.toThrow(/No existe el viaje/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE LAS PANTALLAS DE ALTA PONEN ENCIMA (4-ago-2026).
//
// Las cuatro funciones de arriba ya existían y estaban probadas; lo que no
// existía era la PANTALLA. Al cablearlas aparecieron dos piezas nuevas con su
// propio modo de fallo silencioso, y las dos viven aquí y no en la vista
// justamente para poder fijarlas.
// ═══════════════════════════════════════════════════════════════════════════

describe('armarPolitica — lo que se guarda es la política ENTERA', () => {
  it('vacío es SIN TOPE y 0 es TOPE DE CERO: no se confunden', () => {
    // Number('') da 0. Si se confundieran, un campo que el dueño dejó en blanco
    // PROHIBIRÍA el concepto entero sin que nadie lo pidiera.
    const r = armarPolitica([
      { concepto: 'caseta', tope: '', exigeCfdi: true },
      { concepto: 'diesel', tope: '0', exigeCfdi: false },
    ]);
    expect(r.find((p) => p.concepto === 'caseta')!.topeMonto).toBeUndefined();
    expect(r.find((p) => p.concepto === 'diesel')!.topeMonto).toBe(0);
  });

  it('CONSERVA las reglas por ruta, que el formulario no manda', () => {
    // fusionarConfig reemplaza el arreglo completo: lo que no vuelva aquí, se
    // borró. Sin esta reposición, guardar cualquier tope le borraba a la flota
    // sus reglas por ruta en silencio.
    const porRuta = [{ concepto: 'caseta', ruta: 'GDL-MTY', topeMonto: 900 }];
    const r = armarPolitica([{ concepto: 'diesel', tope: '5000', exigeCfdi: true }], porRuta);
    expect(r).toContainEqual({ concepto: 'caseta', ruta: 'GDL-MTY', topeMonto: 900 });
    expect(r).toHaveLength(2);
  });

  it('un renglón que no dice nada no se guarda', () => {
    expect(armarPolitica([{ concepto: 'otro', tope: '', exigeCfdi: false }])).toEqual([]);
  });

  it('un tope negativo o no numérico se rechaza con el concepto en el mensaje', () => {
    expect(() => armarPolitica([{ concepto: 'diesel', tope: '-5', exigeCfdi: false }])).toThrow(DatoInvalido);
    expect(() => armarPolitica([{ concepto: 'caseta', tope: 'mil', exigeCfdi: false }])).toThrow(/caseta/);
  });

  it('sin renglones y sin reglas de ruta devuelve una política vacía, no revienta', () => {
    expect(armarPolitica([])).toEqual([]);
  });
});

describe('mensajeParaPantalla — qué ve quien llenó el formulario', () => {
  beforeEach(() => logger.error.mockClear());

  it('un DatoInvalido se enseña VERBATIM: es lo único que dice qué corregir', () => {
    const e = new DatoInvalido('Ese teléfono ya está registrado en OTRA flota.');
    expect(mensajeParaPantalla(e, 'registrar al operador')).toBe('Ese teléfono ya está registrado en OTRA flota.');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('cualquier otro error NO filtra el mensaje de Postgres, pero sí se loguea', () => {
    // El texto crudo describe la forma del esquema y no le dice nada a un dueño
    // de flota. Callarlo del todo sería peor: dejaría a alguien creyendo que el
    // alta se hizo.
    const salida = mensajeParaPantalla(new Error('duplicate key value violates unique constraint "operador_pkey"'), 'registrar al operador');
    expect(salida).not.toMatch(/constraint|duplicate key/);
    expect(salida).toMatch(/registrar al operador/);
    expect(salida).toMatch(/falla del sistema/);
    expect(logger.error).toHaveBeenCalledWith('administracion.falla', expect.objectContaining({
      operacion: 'registrar al operador',
    }));
  });

  it('algo que ni siquiera es Error tampoco tumba la pantalla', () => {
    expect(mensajeParaPantalla('se cayó', 'dar de alta la flota')).toMatch(/dar de alta la flota/);
  });
});
