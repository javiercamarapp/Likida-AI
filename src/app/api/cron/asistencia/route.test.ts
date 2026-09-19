import { describe, it, expect, vi, beforeEach } from 'vitest';
import { margenUnidadAtomicaMs, TECHO_PASO_CONSULTA_MS, TECHO_ENVIO_WHATSAPP_MS, COLCHON_LATIDO_CRON_MS } from '@/lib/likida/presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DEL RELOJ MUERTO OBEDECE LA PALANCA DESDE SU PRIMER DÍA.
//
// La lección del PR #80 (wa-outbox nació sin leer el interruptor y fue el
// único de 7 crons que seguía mandando con el sistema apagado) no se repite:
// este cron nace con el contrato de la palanca fijado por prueba, palabra por
// palabra el de los demás — apagado → 200 saltado sin tocar nada; ilegible →
// 500 con código sin tocar nada; encendido → escala.
// ═══════════════════════════════════════════════════════════════════════════

let interruptor: 'encendido' | 'apagado' | 'ilegible' = 'encendido';
/** Lo que tarda el prólogo antes de que la ruta fije su plazo. En producción
 *  `leerInterruptor` es una consulta a Supabase y `puertaCron` otra: las dos
 *  pueden costar hasta `TECHO_PASO_CONSULTA_MS`. Aquí basta con que NO sea 0
 *  para que el ancla del reloj sea observable. */
let demoraInterruptorMs = 0;
vi.mock('@/lib/likida/interruptores', () => ({
  leerInterruptor: async () => {
    if (demoraInterruptorMs > 0) await new Promise((r) => setTimeout(r, demoraInterruptorMs));
    return interruptor;
  },
}));

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger }));

const registrarLatido = vi.fn(async () => {});
vi.mock('@/lib/admin/salud', () => ({
  registrarLatido: (...a: unknown[]) => registrarLatido(...(a as [])),
  puertaCron: async (_c: string, req: Request) =>
    req.headers.get('authorization') === 'Bearer secreto-de-prueba'
      ? null
      : new Response(null, { status: 401 }),
}));

const escalarAsistenciasPendientes = vi.fn(async () => ({
  revisadas: 2, escaladas: 1, diferidas: 1, fallosAviso: 0, cortadosPorReloj: 0,
}));
vi.mock('@/lib/likida/asistencia_escalamiento', () => ({
  escalarAsistenciasPendientes: (...a: unknown[]) => escalarAsistenciasPendientes(...(a as [])),
  EXTRA_LATIDO_MS: TECHO_PASO_CONSULTA_MS - COLCHON_LATIDO_CRON_MS,
}));

const alertarOperador = vi.fn(async () => {});
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [])),
}));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'codigo-prueba' }));

import { GET, maxDuration } from './route';
import { EXTRA_LATIDO_MS } from '@/lib/likida/asistencia_escalamiento';

const CON_SECRETO = { headers: { authorization: 'Bearer secreto-de-prueba' } };
const URL_CRON = 'https://likida.ai/api/cron/asistencia';

describe('cron asistencia — kill switch y contrato de fallo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interruptor = 'encendido';
  });

  it('APAGADO: no escala nada — 200 con saltado, latido saltado', async () => {
    interruptor = 'apagado';
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(escalarAsistenciasPendientes).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ corrio: false, saltado: 'interruptor global' });
    expect(registrarLatido).toHaveBeenCalledWith('asistencia', 'saltado', expect.anything());
  });

  it('ILEGIBLE: 500 con código, y no escala — "no sé si está apagado" no es permiso', async () => {
    interruptor = 'ilegible';
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(escalarAsistenciasPendientes).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ codigo: 'interruptor_ilegible', interruptor: 'global' });
  });

  it('ENCENDIDO: escala y reporta el conteo; con trabajo diferido/fallos el latido es parcial', async () => {
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ escaladas: 1, diferidas: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('asistencia', 'ok', expect.anything());
  });

  it('motor reventado → 500 y alerta, nunca un verde de mentira', async () => {
    escalarAsistenciasPendientes.mockRejectedValueOnce(new Error('boom'));
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(500);
    expect(alertarOperador).toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('asistencia', 'fallo', expect.anything());
  });

  it('sin secreto no corre', async () => {
    const res = await GET(new Request(URL_CRON));
    expect(res.status).toBe(401);
    expect(escalarAsistenciasPendientes).not.toHaveBeenCalled();
  });

  it('fallosAviso > 0 → latido parcial (un aviso que no salió no es una corrida sana)', async () => {
    escalarAsistenciasPendientes.mockResolvedValueOnce({
      revisadas: 1, escaladas: 1, diferidas: 0, fallosAviso: 1, cortadosPorReloj: 0,
    });
    await GET(new Request(URL_CRON, CON_SECRETO));
    expect(registrarLatido).toHaveBeenCalledWith('asistencia', 'parcial', expect.anything());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL RELOJ RESERVA LA UNIDAD ATÓMICA COMPLETA (REN-31-C1, auditoría 31).
//
// El margen era el literal `15` y la unidad que despacha vale 91.5 s: una
// escalada admitida a 1 s de `venceEn` se muere a mitad de camino — y se muere
// DESPUÉS del claim (`reclamarEscalacionAsistencia` escribe `nivel_escalado =
// objetivo` antes de mandar el WhatsApp), así que la consulta del barrido
// siguiente —`.lt('nivel_escalado', NIVEL_MAXIMO)`— ya no la lista. Un nivel 4
// que muere ahí no se reintenta NUNCA: el dueño con un chofer lesionado no
// recibe el aviso y no queda una fila que diga que no lo recibió.
//
// Es la misma lección de REN-A4/REN-A5 (auditoría 28) que `gps` y
// `descarga-sat` ya aprendieron: el margen se DERIVA de los techos de la
// cadena real, no se teclea. El precio es la ventana de despacho — con la
// cadena completa (8 consultas, 2 envíos y el latido del cierre) quedan
// ~14.5 s de los 120 para admitir trabajo, y lo que no entra cae en
// `cortadosPorReloj` y lo agarra la corrida de 5 minutos después, que es
// exactamente el contrato que el comentario de la ruta ya declaraba.
// ═══════════════════════════════════════════════════════════════════════════

describe('cron asistencia — el reloj reserva la unidad atómica (REN-31-C1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interruptor = 'encendido';
  });

  // La cadena más cara de `escalarUna`, contada sobre el código:
  //   0. leerConfigCobranza, la ventana de la flota, en el camino ÁMBAR
  //      (`asistencia_escalamiento.ts:278`) — ANTES del claim  → 1 consulta
  //   1. reclamarEscalacionAsistencia (RPC del claim)      → 1 consulta
  //   2. polizaVigenteDe                                   → 1 consulta
  //   3. select de `viaje` (operador_id, si falta)         → 1 consulta
  //   4. contactoSiLesionadosDe                            → 1 consulta
  //   5. telefonoDeRol('flota_admin')                      → 1 consulta
  //   6. telefonoJefeDe (el dueño sin teléfono)            → 1 consulta
  //   7. anotarEventoIncidencia                            → 1 consulta
  //   8. sendButtons al destinatario                       → 1 envío
  //   9. alertarOperador (nivel 4 o aviso fallido) que,
  //      con ALERTA_WA puesto, manda WhatsApp              → 1 envío
  //                                        TOTAL: 8 consultas, 2 envíos
  //
  // La octava (la ventana de cobranza) la encontró la continuación 2 de la
  // auditoría 31: el `{consultas: 7}` original no la contaba, y el auditor de
  // pruebas demostró que una consulta de más pasaba con 31/31 verdes.
  const PEOR_CASO_ESCALADA_MS = 8 * TECHO_PASO_CONSULTA_MS + 2 * TECHO_ENVIO_WHATSAPP_MS;

  it('una escalada admitida en el último instante cabe ENTERA antes del maxDuration', async () => {
    const antes = Date.now();
    await GET(new Request(URL_CRON, CON_SECRETO));

    const opts = (escalarAsistenciasPendientes.mock.calls[0] as unknown[])[1] as { venceEn: number };
    // El corazón del hallazgo: si el peor caso de UNA unidad no cabe entre
    // `venceEn` y el `maxDuration`, Vercel mata la función con el claim ya
    // quemado y sin `sendButtons`, sin `alertarOperador` y sin bitácora.
    expect(
      opts.venceEn + PEOR_CASO_ESCALADA_MS,
      'una escalada que arranque justo en `venceEn` tiene que terminar antes del hachazo de Vercel',
    ).toBeLessThanOrEqual(antes + maxDuration * 1000);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // REN-31-C1, PARTE RESTANTE (auditoría 31 cont.). El arreglo `f4fde69`
  // cerró el modo de falla —`sendButtons` siempre se alcanza— y NO el techo.
  // El auditor que lo reauditó lo midió: hasta 130.2 s contra `maxDuration =
  // 120`, por dos huecos que la prueba de arriba no ve porque sus mocks
  // contestan en 0 ms.
  // ═════════════════════════════════════════════════════════════════════════

  it('el reloj arranca al ENTRAR la petición, no después de la puerta y el interruptor', async () => {
    // El hachazo de Vercel cuenta desde que ENTRÓ la petición. Anclar `venceEn`
    // después del prólogo le regala a la corrida todo lo que el prólogo tardó.
    demoraInterruptorMs = 60;
    const margen = margenUnidadAtomicaMs({ consultas: 8, envios: 2, extraMs: EXTRA_LATIDO_MS });
    const antes = Date.now();
    await GET(new Request(URL_CRON, CON_SECRETO));
    demoraInterruptorMs = 0;

    const opts = (escalarAsistenciasPendientes.mock.calls[0] as unknown[])[1] as { venceEn: number };
    // AUDITORÍA 32 (continuación 17-sep), PRU32C-A1, la segunda mitad. Tal como
    // estaba, esta aserción se reducía a `entrada <= antes` —`venceEn` y el lado
    // derecho restan el MISMO `margen`—, y `entrada` (`route.ts:42`) se toma
    // DESPUÉS de este `Date.now()`: holgura CERO, y roja cada vez que el reloj
    // avanzaba 1 ms entre las dos lecturas.
    //
    // Aquí NO se puede congelar Date como en la prueba de abajo: lo que este caso
    // mide es justamente que el ancla se mueva si alguien la recorre detrás del
    // prólogo, y con Date congelado ese movimiento sería invisible. Lo que se
    // acota es el costo de despacho, que es lo único que separa `antes` de
    // `entrada` cuando el código está bien.
    //
    // La tolerancia conserva los dientes porque es MUY inferior a la demora que
    // este caso inyecta: si `entrada` se recorriera detrás de `leerInterruptor`,
    // `venceEn` llegaría 60 ms tarde, más del doble del margen que se perdona.
    const TOLERANCIA_DESPACHO_MS = 25;
    expect(TOLERANCIA_DESPACHO_MS * 2, 'la tolerancia tiene que quedar MUY por debajo de la demora inyectada, o la prueba deja de ver el defecto')
      .toBeLessThan(60);
    expect(
      opts.venceEn,
      'el plazo se corrió tanto como tardó el prólogo: en producción son dos consultas, hasta 9.5 s cada una',
    ).toBeLessThanOrEqual(antes + maxDuration * 1000 - margen + TOLERANCIA_DESPACHO_MS);
  });

  it('el peor caso REAL cabe entero: 8 consultas —la ventana de cobranza es la octava—, 2 envíos y el latido del cierre', async () => {
    // Dos cosas que la cuenta de `f4fde69` dejaba fuera:
    //  · `escalarUna` consulta `leerConfigCobranza` en el camino ámbar
    //    (`asistencia_escalamiento.ts:278`) ANTES del claim — una octava
    //    consulta que el `{consultas: 7}` no contaba.
    //  · `registrarLatido` corre DESPUÉS del bucle y es una escritura a
    //    Supabase: cuesta hasta `TECHO_PASO_CONSULTA_MS`, no los 5.0 s que
    //    `COLCHON_LATIDO_CRON_MS` reserva.
    const PEOR_CASO_REAL_MS = 8 * TECHO_PASO_CONSULTA_MS + 2 * TECHO_ENVIO_WHATSAPP_MS;

    // AUDITORÍA 32 (continuación 17-sep), PRU32C-A1. Esta prueba era una moneda
    // al aire: medida sobre HEAD pristino, **4 de 10 corridas en rojo** (la 32 la
    // estimó en 1 de 5 y la dejó anotada sin tocar). No era ruido del runner, y
    // la aritmética lo dice exacto:
    //
    //   margen        = 8·TPC + 2·TEW + EXTRA_LATIDO + COLCHÓN
    //                 = 8·TPC + 2·TEW + (TPC − COLCHÓN) + COLCHÓN = 9·TPC + 2·TEW
    //   peor caso aquí= 8·TPC + 2·TEW + TPC                       = 9·TPC + 2·TEW
    //
    // Son la MISMA cifra —105,500 ms—, que es justo lo que `route.ts:80-88`
    // declara («el peor caso queda en 120.0 s exactos contra maxDuration = 120»).
    // La holgura es CERO, así que comparar contra un `Date.now()` tomado ANTES de
    // la llamada exige que el reloj no avance ni 1 ms entre ese instante y el
    // `entrada` de `route.ts:42`. Cuando avanza, la prueba se cae sin que nada
    // del código esté mal.
    //
    // Congelar Date deja δ = 0 y la aserción queda EXACTAMENTE la que era —el
    // invariante real, `margen ≥ peor caso`, que se cumple con igualdad—, sin
    // aflojar un solo milisegundo: si alguien baja el margen o sube un techo, se
    // pone roja igual. Se congela SOLO `Date` (`toFake: ['Date']`), no los
    // temporizadores: este caso corre con `demoraInterruptorMs = 0` y no usa
    // ninguno, y falsear los timers colgaría el `await` de la ruta.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const antes = Date.now();
      await GET(new Request(URL_CRON, CON_SECRETO));

      const opts = (escalarAsistenciasPendientes.mock.calls[0] as unknown[])[1] as { venceEn: number };
      expect(
        opts.venceEn + PEOR_CASO_REAL_MS + TECHO_PASO_CONSULTA_MS,
        'una escalada ámbar admitida en el último instante, más su latido, tiene que terminar antes del hachazo',
      ).toBeLessThanOrEqual(antes + maxDuration * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('usa el margen DERIVADO de los techos, no un literal que se le parezca', async () => {
    const margen = margenUnidadAtomicaMs({ consultas: 8, envios: 2, extraMs: EXTRA_LATIDO_MS });
    expect(margen, 'el margen derivado tiene que cubrir el peor caso de la cadena')
      .toBeGreaterThan(PEOR_CASO_ESCALADA_MS);

    const antes = Date.now();
    await GET(new Request(URL_CRON, CON_SECRETO));

    const opts = (escalarAsistenciasPendientes.mock.calls[0] as unknown[])[1] as { venceEn: number };
    expect(opts.venceEn).toBeGreaterThanOrEqual(antes + maxDuration * 1000 - margen);
    expect(opts.venceEn).toBeLessThanOrEqual(Date.now() + maxDuration * 1000 - margen);
  });
});
