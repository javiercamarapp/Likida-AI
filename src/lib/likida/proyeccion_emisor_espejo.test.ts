import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// ARQ32C4-C2 / FIS-C4 (auditoría 32, continuación 20-sep, CRÍTICO)
//
// UNA FUNCIÓN, DOS RESPUESTAS, SEGÚN QUIÉN LA LLAME. El 19-sep `790900d` le
// enseñó a `copiasDeComprobante` (engine.ts:516) que el folio se reinicia por
// emisor: dos tickets de $2,500 con folio 1234 de gasolineras DISTINTAS son
// dos comprobantes. La llave del predicado pasó a mirar `rfcEmisor`.
//
// `rfcEmisor` es OPCIONAL en `Gasto`, y con razón: el OCR puede perderlo
// (`intake/ocr.ts:560`). Pero eso vuelve indistinguibles dos cosas que no son
// lo mismo:
//
//   · «el OCR no pudo leer el emisor»       → la 0358 dice: trátalo como copia
//   · «el llamador no lo pidió en su SELECT» → no es información, es un hueco
//
// El camino del motor y del PDF sí lo pide (`getGastos`, repo.ts:992 y :1012).
// Estas dos proyecciones NO lo pedían, así que sobre LAS MISMAS DOS FILAS:
//
//   PDF / panel fiscal            2 comprobantes · $5,000
//   chofer por WhatsApp           1 comprobante  · $2,500 + «una copia excluida»
//   tool `estado_viaje`           1 comprobante  · $2,500
//
// Es textualmente lo que CLAUDE.md prohíbe: «una cifra fiscal que se lee
// distinto en dos pantallas se lee como dos cálculos». Y le dice al chofer que
// le faltan $2,500 por comprobar cuando ya los mandó.
//
// POR QUÉ ESTE MOCK RESPETA LA PROYECCIÓN, y es el punto del archivo. El mock
// de `consulta_chofer.test.ts` devuelve las filas que la prueba le da, ignore
// el `select` lo que ignore: con él, una columna que falte en la consulta sigue
// llegando al código y la prueba pasa igual. Aquí el mock RECORTA cada fila a
// las columnas que el `select` nombra, que es lo que PostgREST hace de verdad.
// Sin eso esta prueba sería decoración: pasaría con el bug puesto.
// ═══════════════════════════════════════════════════════════════════════════

/** Las dos filas del escenario: mismo concepto, folio y monto; DOS estaciones. */
const DOS_ESTACIONES = [
  {
    id: 'g1', concepto: 'diesel', monto: 2500, folio: '1234', folio_norm: '1234',
    cfdi_uuid: null, cfdi_orden: null, ocr_extra: null, ocr_confianza: 0.9,
    rfc_emisor: 'CCO8605231N4', created_at: '2026-03-10T10:00:00Z',
  },
  {
    id: 'g2', concepto: 'diesel', monto: 2500, folio: '1234', folio_norm: '1234',
    cfdi_uuid: null, cfdi_orden: null, ocr_extra: null, ocr_confianza: 0.9,
    rfc_emisor: 'ESB040404DDD', created_at: '2026-03-10T11:00:00Z',
  },
];

const VIAJE = { origen: 'CDMX', destino: 'Querétaro', anticipo: 6000, estatus: 'abierto' };

/** Columnas que el último `select()` de cada tabla pidió. */
const pedido: Record<string, string[]> = {};

/** Nodo encadenable que RECORTA la fila a lo proyectado, como PostgREST. */
function cadena(tabla: string, filas: () => unknown) {
  const nodo: Record<string, unknown> = {};
  nodo.select = (cols: string) => {
    pedido[tabla] = cols.split(',').map((c) => c.trim());
    return nodo;
  };
  for (const m of ['eq', 'is', 'not', 'limit', 'order']) nodo[m] = () => nodo;
  const recortar = () => {
    const cols = pedido[tabla] ?? [];
    const dato = filas();
    const unaFila = (f: Record<string, unknown>) =>
      Object.fromEntries(cols.filter((c) => c in f).map((c) => [c, f[c]]));
    return Array.isArray(dato)
      ? { data: dato.map((f) => unaFila(f as Record<string, unknown>)), error: null }
      : { data: dato === null ? null : unaFila(dato as Record<string, unknown>), error: null };
  };
  nodo.maybeSingle = () => Promise.resolve(recortar());
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(recortar()).then(r);
  return nodo;
}

const contenido: Record<string, unknown> = {};
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => cadena(tabla, () => contenido[tabla] ?? null),
  }),
}));

const { estadoDelViaje } = await import('./consulta_chofer');
await import('./tools'); // registra las tools al importarse
const { executeTool } = await import('@/lib/llm/tool-executor');

beforeEach(() => {
  for (const k of Object.keys(pedido)) delete pedido[k];
  contenido.viaje = VIAJE;
  contenido.gasto = DOS_ESTACIONES;
});

describe('ARQ32C4-C2 · el predicado del motor da UNA sola respuesta, la pida quien la pida', () => {
  it('el chofer por WhatsApp lee 2 comprobantes y $5,000, igual que el PDF', async () => {
    const estado = await estadoDelViaje('t1', 'v1');
    // ROJO antes del arreglo: comprobantes=1, comprobado=2500 — la consulta no
    // pedía `rfc_emisor`, así que las dos estaciones se leían como una foto
    // repetida y el chofer recibía «te faltan $2,500» habiéndolos mandado.
    expect(estado?.comprobantes).toBe(2);
    expect(estado?.comprobado).toBe(5000);
  });

  it('la tool `estado_viaje` lee lo mismo: 0 copias excluidas', async () => {
    const r = await executeTool('estado_viaje', {}, { tenantId: 't1', viajeId: 'v1' } as never);
    expect(r.error, String(r.error)).toBeUndefined();
    const v = r.result as { comprobado: number; comprobantes: number; copias_excluidas: number };
    expect(v.copias_excluidas).toBe(0);
    expect(v.comprobantes).toBe(2);
    expect(v.comprobado).toBe(5000);
  });

  it('mismo emisor SÍ es copia: la dirección que impide "arreglarlo" ignorando el emisor', async () => {
    contenido.gasto = [
      DOS_ESTACIONES[0],
      { ...DOS_ESTACIONES[1], rfc_emisor: 'CCO8605231N4' },
    ];
    const estado = await estadoDelViaje('t1', 'v1');
    expect(estado?.comprobantes).toBe(1);
    expect(estado?.comprobado).toBe(2500);
  });

  it('emisor perdido por el OCR en AMBAS: sigue siendo copia (la 4ª dirección de la 0358)', async () => {
    contenido.gasto = DOS_ESTACIONES.map((g) => ({ ...g, rfc_emisor: null }));
    const estado = await estadoDelViaje('t1', 'v1');
    expect(estado?.comprobantes).toBe(1);
    expect(estado?.comprobado).toBe(2500);
  });

  // EL CASO MIXTO, y es el que separa un arreglo bueno de uno que barre el
  // emisor bajo la alfombra: el OCR leyó el RFC en UNA de las dos fotos del
  // MISMO ticket. Sin él, la mutación «emisor a secas» —la semántica de la
  // 0357, la que costó los dos CRÍTICOS que cerraron la 0358 y la 0359— pasa
  // esta prueba entera sin despeinarse: medido, 4/4 verdes. Con él, muere.
  it('emisor en UNA y nulo en la otra: SIGUE siendo copia (la 0358, no la 0357)', async () => {
    contenido.gasto = [DOS_ESTACIONES[0], { ...DOS_ESTACIONES[1], rfc_emisor: null }];
    const estado = await estadoDelViaje('t1', 'v1');
    expect(estado?.comprobantes).toBe(1);
    expect(estado?.comprobado).toBe(2500);
  });
});
