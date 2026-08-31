import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mxn, numero } from '@/lib/formato';

// ═══ El IO del ciclo de oficina (informe PDF + pregunta libre) ═════════════

const enviado: Array<{ tel: string; url: string; nombre: string }> = [];
// El contrato REAL de `sendDocument` (meta/client.ts:371): un objeto
// discriminado, nunca un string. El mock devolvía `'wamid-1'` —el contrato
// viejo— y por eso la suite no podía ver que `if (!enviado)` es código muerto.
let respuestaEnvio: { ok: true; id: string | null } | { ok: false; error: string; codigo?: number } =
  { ok: true, id: 'wamid-1' };
let subida: { error: { message: string } | null } = { error: null };
let firmada: { data: { signedUrl: string } | null; error: null } = { data: { signedUrl: 'https://firmada/x.pdf' }, error: null };
let anticipos: { data: Array<{ anticipo: number }> | null; error: { message: string } | null } = { data: [{ anticipo: 8000 }, { anticipo: 5000 }], error: null };

// ── EL RECORTE DE PostgREST, EMULADO (AUDITORÍA 22, REN-1) ────────────────
// `max-rows` corta la respuesta a 1,000 filas EN SILENCIO: no hay `error`, no
// hay bandera, la lista simplemente llega corta. Un mock que devuelve el array
// entero sin importar el rango pedido no puede ver ese modo de falla — y no lo
// vio. Aquí `in()` sin `range` entrega solo las primeras 1,000, que es lo que
// hace el servidor de verdad, y `range(desde, hasta)` entrega su rebanada.
const TOPE_PG = 1000;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (_tabla: string) => ({
      select: (_cols?: string, _opts?: { count?: string }) => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { nombre: 'Transportes Prueba' }, error: null }),
          in: () => {
            const todas = anticipos.data ?? [];
            const respuesta = (desde: number, hasta: number) => ({
              data: anticipos.error ? null : todas.slice(desde, hasta + 1),
              error: anticipos.error,
              count: anticipos.error ? null : todas.length,
            });
            // AUDITORÍA 23, REN-1: `order` entró a la cadena real (`traerTodo`
            // pagina por posición y exige un orden único, `pg.ts:131-135`), así
            // que el arnés tiene que aceptarlo. Aquí solo encadena; el arnés que
            // sí distingue «con orden» de «sin orden» —y que por eso puede
            // fallar por ese bug— es `oficina_wa_orden.test.ts`.
            const constructor = () => ({
              order: () => constructor(),
              range: (desde: number, hasta: number) => Promise.resolve(respuesta(desde, hasta)),
              // Sin `range`: el servidor recorta a `max-rows` y no lo dice.
              then: (r: (v: unknown) => unknown) => Promise.resolve(respuesta(0, TOPE_PG - 1)).then(r),
            });
            return constructor();
          },
        }),
      }),
    }),
    storage: {
      from: () => ({
        upload: async () => subida,
        createSignedUrl: async () => firmada,
      }),
    },
  }),
}));
vi.mock('./operacion', () => ({
  getTableroOperacion: async () => ({ viajesActivos: 3, sinUnidad: 1, podPendientes: 2 }),
}));
vi.mock('@/lib/meta/client', () => ({
  sendDocument: async (tel: string, url: string, nombre: string) => { enviado.push({ tel, url, nombre }); return respuestaEnvio; },
}));
const analista = vi.fn(async (_o: unknown) => ({ bloques: [{ tipo: 'texto', texto: 'Van bien.' }] }));
vi.mock('@/lib/agents/analista', () => ({ ejecutarAnalista: (o: unknown) => analista(o) }));
let gastoHoyUsd = 0;
const costosRegistrados: unknown[] = [];
vi.mock('@/app/api/dashboard/chat/tope', () => ({
  gastoChatHoyUsd: async () => gastoHoyUsd,
  topeDiaUsd: () => 5,
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: async (c: unknown) => { costosRegistrados.push(c); },
  faseDeModelo: () => 'chat',
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// El informe que se arma, capturado: es donde se puede leer la CIFRA que el
// dueño va a ver, sin depender de renderizar un PDF de verdad.
const informes: Array<{ secciones: Array<{ titulo: string; filas?: string[][]; parrafos?: string[] }> }> = [];
vi.mock('./informes/pdf', () => ({
  generarInformePDF: async (inf: { secciones: Array<{ titulo: string; filas?: string[][]; parrafos?: string[] }> }) => {
    informes.push(inf);
    return Buffer.from('%PDF-falso');
  },
}));
const seccionDinero = () => informes.at(-1)?.secciones.find((s) => s.titulo === 'Dinero');

const { mandarInformePdf, atenderPreguntaLibre } = await import('./oficina_wa');

const DUENO = { tenantId: 't-1', rol: 'flota_admin' as const, userId: 'u-1', nombre: 'Javier' };
const ENCARGADO = { tenantId: 't-1', rol: 'encargado' as const, userId: 'u-2', nombre: 'Lupe' };

beforeEach(() => {
  enviado.length = 0;
  informes.length = 0;
  subida = { error: null };
  firmada = { data: { signedUrl: 'https://firmada/x.pdf' }, error: null };
  anticipos = { data: [{ anticipo: 8000 }, { anticipo: 5000 }], error: null };
  respuestaEnvio = { ok: true, id: 'wamid-1' };
  analista.mockClear();
});

describe('mandarInformePdf — el reporte formal por el canal', () => {
  it('al dueño: arma el PDF (con dinero), lo sube, firma y manda como documento', async () => {
    const acuse = await mandarInformePdf(DUENO, '52155');
    expect(enviado).toHaveLength(1);
    expect(enviado[0]).toMatchObject({ tel: '52155', url: 'https://firmada/x.pdf' });
    expect(acuse).toContain('informe');
  });

  // ── AUDITORÍA 22 · REN-1 (CRÍTICO) ──────────────────────────────────────
  // La consulta de anticipos no paginaba. PostgREST recorta a 1,000 filas EN
  // SILENCIO —sin `error`, sin bandera—, así que una flota con 1,500 viajes sin
  // cerrar recibía la suma de 1,000 de ellos impresa como «Anticipos en la
  // calle», y el renglón «Viajes sin liquidar» decía 1,000.
  //
  // El comentario de esa consulta prometía «fallar cerrado: nunca un cero con
  // cara de medición». Manejaba `error`, que es la mitad del problema: el
  // recorte no llega como error, llega como una lista más corta. Una cifra
  // incompleta presentada como completa es la regla mayor del producto rota,
  // y esta va en un PDF firmado que el dueño reenvía.
  it('con 1,500 viajes abiertos el informe suma los 1,500, no los primeros 1,000', async () => {
    anticipos = { data: Array.from({ length: 1500 }, () => ({ anticipo: 100 })), error: null };
    await mandarInformePdf(DUENO, '52155');
    const dinero = seccionDinero();
    expect(dinero).toBeDefined();
    const filas = Object.fromEntries((dinero!.filas ?? []).map((f) => [f[0], f[1]]));
    // Lo que rompía: $100,000 (mil filas) presentado como la cifra completa.
    expect(filas['Anticipos en la calle']).toBe(mxn(150_000));
    expect(filas['Viajes sin liquidar']).toBe(numero(1500));
  });

  it('si la lectura de anticipos no se puede completar, lo DICE en vez de imprimir una suma corta', async () => {
    anticipos = { data: null, error: { message: 'PostgREST 500' } };
    await mandarInformePdf(DUENO, '52155');
    const dinero = seccionDinero();
    expect(dinero?.filas).toBeUndefined();
    expect(dinero?.parrafos?.join(' ')).toContain('no se pudieron leer');
  });

  it('al ENCARGADO el documento sale SIN la sección de dinero (misma matriz que el panel)', async () => {
    anticipos = { data: null, error: { message: 'no debió consultarse' } };
    // Si intentara leer anticipos, la sección diría "no se pudo" — pero para
    // el encargado NI se consulta: el envío sale limpio.
    const acuse = await mandarInformePdf(ENCARGADO, '52166');
    expect(enviado).toHaveLength(1);
    expect(acuse).toContain('informe');
  });

  // AUDITORÍA 18, ALTO: `sendDocument` devuelve `{ok:false}` cuando Meta rechaza
  // —no lanza, no devuelve null—, así que el `if (!enviado)` de oficina_wa.ts
  // era código muerto sobre un objeto siempre truthy: con un 131030 el dueño
  // leía «Ahí te va tu informe en PDF 📊» y no llegaba nada. Es el mismo
  // criterio que processor.ts:2493 y avisar_cierre.ts:129 ya aplican.
  it('si Meta RECHAZA el documento, LANZA — no se acusa un PDF que no llegó', async () => {
    respuestaEnvio = { ok: false, error: 'Re-engagement message', codigo: 131030 };
    await expect(mandarInformePdf(DUENO, '52155')).rejects.toThrow('WhatsApp no aceptó');
  });

  it('si storage no firma, LANZA — el llamador contesta el fallo, nunca silencio', async () => {
    firmada = { data: null, error: null };
    await expect(mandarInformePdf(DUENO, '52155')).rejects.toThrow('firmar');
    expect(enviado).toHaveLength(0);
  });
});

describe('atenderPreguntaLibre — el analista del panel, en el chat', () => {
  it('dueño: pasa por el analista con su rol y devuelve el texto', async () => {
    const r = await atenderPreguntaLibre(DUENO, '¿cuánto llevamos de diésel?');
    expect(r).toContain('Van bien.');
    expect(analista).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't-1', usuario: expect.objectContaining({ rol: 'flota_admin' }),
    }));
  });

  it('encargado: null SIN llamar al analista (sus tools devuelven pesos)', async () => {
    expect(await atenderPreguntaLibre(ENCARGADO, '¿cuánto llevamos?')).toBeNull();
    expect(analista).not.toHaveBeenCalled();
  });

  it('si el analista truena: null (cae al saludo que orienta), jamás un error pelón', async () => {
    analista.mockRejectedValueOnce(new Error('modelo caído'));
    expect(await atenderPreguntaLibre(DUENO, '¿cómo vamos?')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · REN-A1 (ALTO) — el mismo analista, sin freno ni cuenta.
//
// `atenderPreguntaLibre` corre el analista COMPLETO (hasta nueve completions
// con tools) y no registraba un centavo en `llm_costo` ni pasaba por el tope
// diario. El chat del panel ejecuta EXACTAMENTE el mismo agente y hace las dos
// cosas. O sea: el mismo gasto, por otro canal, invisible para el panel de
// costo y para el freno — y WhatsApp es el canal que el producto empuja como
// principal.
// ═══════════════════════════════════════════════════════════════════════════
describe('REN-A1: la pregunta libre por WhatsApp cuenta y se frena', () => {
  const conCosto = { bloques: [{ tipo: 'texto', texto: 'Van bien.' }], costoPorModelo: { 'x-ai/grok': { tokensIn: 1200, tokensOut: 340, cost: 0.0042 } } };

  it('registra el costo POR MODELO, como el chat del panel', async () => {
    costosRegistrados.length = 0;
    gastoHoyUsd = 0;
    analista.mockResolvedValueOnce(conCosto as never);

    await atenderPreguntaLibre(DUENO, '¿cuánto llevo gastado este mes?');

    // Lo que rompía: cero filas de `llm_costo` por una corrida de hasta nueve
    // completions.
    expect(costosRegistrados).toHaveLength(1);
    expect(costosRegistrados[0]).toMatchObject({
      tenantId: 't-1', modelo: 'x-ai/grok', tokensIn: 1200, tokensOut: 340, costoUsd: 0.0042,
    });
  });

  it('agotado el tope diario NO llama al analista, y lo dice sin tecnicismos', async () => {
    costosRegistrados.length = 0;
    analista.mockClear();
    gastoHoyUsd = 99;

    const r = await atenderPreguntaLibre(DUENO, '¿cómo vamos?');

    expect(analista).not.toHaveBeenCalled();
    expect(r).toMatch(/tope diario/i);
    gastoHoyUsd = 0;
  });
});
