// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 23 · REN-1 (CRÍTICO) — EL ARREGLO DE AYER PAGINA SIN `ORDER BY`, Y
// `count` LE FIRMA LA LECTURA COMO COMPLETA.
//
// La 22 arregló que `mandarInformePdf` sumara anticipos sin paginar: con 1,500
// viajes abiertos imprimía la suma de 1,000 como «Anticipos en la calle», en un
// PDF firmado que el dueño reenvía a su contador. El arreglo metió `traerTodo`.
//
// Pero `traerTodo` pagina por POSICIÓN (`.range(desde, hasta)`), y su contrato
// lo dice en mayúsculas (`pg.ts:131-135`):
//
//   «LA CONSULTA TIENE QUE VENIR ORDENADA POR ALGO ÚNICO. El cursor es un
//    `range` por posición: con un `order` que empate (una fecha, un rol), dos
//    páginas pueden repetir una fila y saltarse otra. Todos los llamadores
//    desempatan con `id`.»
//
// La consulta de `oficina_wa.ts` no traía `order` NINGUNO. Sin `ORDER BY`,
// Postgres devuelve las filas en el orden físico del heap, y ese orden CAMBIA
// entre una página y la siguiente en cuanto alguien actualiza una fila: un
// `UPDATE` reescribe la tupla al final del heap. En una tabla de `viaje` de una
// flota viva eso pasa todo el tiempo — un chofer manda un comprobante, el
// anticipo se recalcula, la fila se mueve.
//
// ── POR QUÉ ES SILENCIOSO, Y POR QUÉ `traerTodo` NO PUEDE ATRAPARLO ───────
// `traerTodo` se defiende comparando cuántas filas leyó contra el `count` que
// el servidor mandó. Cuando una fila se mueve, una página REPITE una fila y se
// SALTA otra: el total leído sigue cuadrando con `count`, así que no lanza
// `LecturaIncompleta`. Lee 1,500 filas de 1,500 y suma mal.
//
// Es peor que el bug que sustituyó: aquél imprimía una cifra corta (detectable
// contra el panel), éste imprime una cifra con el número de viajes correcto y
// el dinero equivocado.
//
// ── LO QUE EMULA ESTE ARNÉS ──────────────────────────────────────────────
// El mock sirve la primera página desde el orden físico A y las siguientes
// desde el orden B (= A con su primera fila movida al final, que es justo lo
// que hace un UPDATE). Si la consulta pide `.order(...)`, el servidor honra ese
// orden y las páginas son estables — como en Postgres de verdad.
//
// Un mock que devolviera siempre la misma rebanada no podría fallar por este
// bug, y no serviría de nada: es la lección que la propia 22 dejó escrita
// cuando descubrió que su arnés de `oficina_wa` devolvía el array entero sin
// mirar el rango pedido.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** 1,500 viajes abiertos con anticipos DISTINTOS: $100, $200, … $150,000. */
const VIAJES = Array.from({ length: 1500 }, (_, i) => ({ id: `v-${String(i).padStart(4, '0')}`, anticipo: (i + 1) * 100 }));
const SUMA_VERDADERA = VIAJES.reduce((a, v) => a + v.anticipo, 0); // $112,575,000

/** Orden físico tras un UPDATE sobre la primera fila: se reescribe al final. */
const HEAP_MOVIDO = [...VIAJES.slice(1), VIAJES[0]];

let pidioOrden = false;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { nombre: 'Transportes Prueba' }, error: null }),
          in: () => {
            const constructor = () => ({
              order: () => { pidioOrden = true; return constructor(); },
              range: (desde: number, hasta: number) => {
                // Con `ORDER BY` el servidor da un orden estable. Sin él, la
                // segunda página ya ve el heap movido.
                const fuente = pidioOrden || desde === 0 ? VIAJES : HEAP_MOVIDO;
                return Promise.resolve({
                  data: fuente.slice(desde, hasta + 1).map((v) => ({ anticipo: v.anticipo })),
                  error: null,
                  count: VIAJES.length,
                });
              },
            });
            return constructor();
          },
        }),
      }),
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: 'https://firmada/x.pdf' }, error: null }),
      }),
    },
  }),
}));

vi.mock('./operacion', () => ({
  getTableroOperacion: async () => ({ viajesActivos: 1500, sinUnidad: 0, podPendientes: 0 }),
}));
vi.mock('@/lib/meta/client', () => ({
  sendDocument: async () => ({ ok: true, id: 'wamid-1' }),
}));

/** El informe se arma con `secciones`; capturamos el que se manda a PDF. */
let seccionesVistas: Array<{ titulo?: string; filas?: string[][]; parrafos?: string[] }> = [];
vi.mock('./informes/pdf', () => ({
  generarInformePDF: async (informe: { secciones: typeof seccionesVistas }) => {
    seccionesVistas = informe.secciones;
    return Buffer.from('%PDF-1.4 fake');
  },
}));

beforeEach(() => {
  pidioOrden = false;
  seccionesVistas = [];
});

describe('REN-1 (aud. 23): la paginación del informe del jefe exige un orden único', () => {
  it('la consulta de anticipos pide un `order`; sin él, dos páginas repiten una fila y se saltan otra', async () => {
    const { mandarInformePdf } = await import('./oficina_wa');

    await mandarInformePdf(
      { tenantId: 't-1', rol: 'flota_admin', nombre: 'Javier' } as Parameters<typeof mandarInformePdf>[0],
      '5219991111111',
    );

    expect(
      pidioOrden,
      'la consulta de anticipos llegó a `traerTodo` SIN `.order(...)`. El contrato de pg.ts:131-135 lo ' +
      'exige en mayúsculas: el cursor es un `range` por posición, así que sin un orden único dos páginas ' +
      'pueden repetir una fila y saltarse otra. Y `traerTodo` no puede atraparlo: el total leído sigue ' +
      'cuadrando con `count`, así que no lanza LecturaIncompleta — lee 1,500 de 1,500 y suma mal.',
    ).toBe(true);
  });

  it('la suma impresa en el PDF firmado es la verdadera, no una con una fila repetida y otra perdida', async () => {
    const { mandarInformePdf } = await import('./oficina_wa');
    const { mxn } = await import('@/lib/formato');

    await mandarInformePdf(
      { tenantId: 't-1', rol: 'flota_admin', nombre: 'Javier' } as Parameters<typeof mandarInformePdf>[0],
      '5219991111111',
    );

    const dinero = seccionesVistas.find((s) => s.titulo === 'Dinero');
    expect(dinero, 'no se pintó la sección de Dinero').toBeDefined();
    const anticipos = dinero!.filas?.find((f) => f[0] === 'Anticipos en la calle');

    expect(
      anticipos?.[1],
      'la cifra impresa no es la suma real de los 1,500 anticipos. Con el heap movido entre páginas, ' +
      'la fila v-1000 nunca se leyó y v-0000 se leyó dos veces — y como el conteo cuadra, nada avisa. ' +
      'Es una cifra incompleta con cara de completa, en un PDF firmado que el dueño reenvía a su contador.',
    ).toBe(mxn(SUMA_VERDADERA));

    // Y el conteo de viajes sigue siendo el correcto, que es lo que hacía este
    // bug indistinguible de una lectura sana desde el panel.
    expect(dinero!.filas?.find((f) => f[0] === 'Viajes sin liquidar')?.[1]).toBe('1,500');
  });
});
