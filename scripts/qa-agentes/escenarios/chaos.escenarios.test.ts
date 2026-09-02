import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ATAQUES_CAOS, CANALES, FALLAS, CUERPO_CORRUPTO, SIN_SENAL,
  programarCaos, semillaCaos, crearDespachador, envolverConCaos,
  canalDeUrl, fetchConCaosPorHost,
  type FetchLike, type Despachador,
} from './chaos.escenarios';

// ═══════════════════════════════════════════════════════════════════════════
// EL CAOS SE PRUEBA OFFLINE — y la parte que importa es que sea REPRODUCIBLE.
//
// Un arnés de caos que no repite el mismo fallo con la misma semilla no es un
// arnés: es ruido con permiso. Y el arnés que lo usa (`npm run qa:nocturno`)
// exige credenciales y gasta dinero, así que si esto no se vigila aquí no se
// vigila en ningún lado.
//
// El reloj se maneja con `vi.useFakeTimers()`: el `timeout` no duerme, sólo
// termina cuando aborta quien llamó. Adelantar el reloj falso dispara el
// backstop real (`supabase/admin.ts`, 25 s) sin esperar 25 segundos de pared.
// ═══════════════════════════════════════════════════════════════════════════

const FECHA = '2026-08-28';

afterEach(() => { vi.useRealTimers(); });

describe('el plan de caos es determinista', () => {
  it.each(ATAQUES_CAOS)('%s se repite con la misma semilla', (ataque) => {
    expect(JSON.stringify(programarCaos(FECHA, ataque, 0)))
      .toBe(JSON.stringify(programarCaos(FECHA, ataque, 0)));
  });

  it('la fecha y el índice cambian el plan (si no, la corrida nocturna repetiría el mismo día)', () => {
    expect(programarCaos('2026-08-28', 'tormenta', 0).seed)
      .not.toBe(programarCaos('2026-08-29', 'tormenta', 0).seed);
    expect(semillaCaos(FECHA, 'tormenta', 0).seed).not.toBe(semillaCaos(FECHA, 'tormenta', 1).seed);
  });

  it('la semilla es auditable y no choca con la del Operador ni con la del fuzzer', () => {
    const p = programarCaos(FECHA, 'tormenta', 2);
    expect(p.semillaTexto).toBe(`${FECHA}|nivel3|chaos|tormenta|2`);
    expect(p.seed).toBe(semillaCaos(FECHA, 'tormenta', 2).seed);
  });
});

describe('todo plan programa algo, y algo alcanzable', () => {
  it.each(ATAQUES_CAOS)('%s', (ataque) => {
    const p = programarCaos(FECHA, ataque, 0);
    expect(p.fallas.length).toBeGreaterThan(0);
    expect(p.invariantes.length).toBeGreaterThan(0);
    expect(p.prohibido.length).toBeGreaterThan(0);
    for (const f of p.fallas) {
      expect(CANALES).toContain(f.canal);
      expect(FALLAS).toContain(f.falla);
      // Ordinal 1-indexado: una falla en la «llamada 0» nunca se aplicaría.
      expect(f.llamada).toBeGreaterThanOrEqual(1);
    }
  });

  it('no hay dos fallas para el mismo ordinal del mismo canal', () => {
    // La segunda no se aplicaría nunca (`find` devuelve la primera) y el
    // reporte presumiría un caos que no ocurrió.
    for (const ataque of ATAQUES_CAOS) {
      for (let i = 0; i < 40; i++) {
        const p = programarCaos(FECHA, ataque, i);
        const claves = p.fallas.map((f) => `${f.canal}#${f.llamada}`);
        expect(new Set(claves).size, `${ataque}/${i} repite ordinal`).toBe(claves.length);
      }
    }
  });

  it('la tormenta golpea LOS DOS canales: es lo que la separa de las otras dos', () => {
    for (let i = 0; i < 20; i++) {
      const canales = new Set(programarCaos(FECHA, 'tormenta', i).fallas.map((f) => f.canal));
      expect(canales).toEqual(new Set(['supabase', 'openrouter']));
    }
  });

  it('los ataques de una sola falla programan exactamente una, en su canal', () => {
    for (let i = 0; i < 20; i++) {
      const a = programarCaos(FECHA, 'supabase_una_falla', i);
      expect(a.fallas).toHaveLength(1);
      expect(a.fallas[0].canal).toBe('supabase');
      // Temprana a propósito: donde el cierre todavía puede decidir no seguir.
      expect(a.fallas[0].llamada).toBeLessThanOrEqual(6);

      const b = programarCaos(FECHA, 'openrouter_una_falla', i);
      expect(b.fallas).toHaveLength(1);
      expect(b.fallas[0].canal).toBe('openrouter');
    }
  });

  it('con suficientes semillas salen los CUATRO modos de falla', () => {
    // Si el generador sólo produjera `http_500`, tres cuartas partes del caos
    // no se probarían nunca y nadie lo notaría.
    const vistos = new Set(
      Array.from({ length: 60 }, (_, i) => programarCaos(FECHA, 'tormenta', i).fallas.map((f) => f.falla)).flat(),
    );
    expect(vistos).toEqual(new Set(FALLAS));
  });
});

describe('el despachador cuenta por canal y no se confunde', () => {
  it('aplica la falla en la llamada que dice el plan, y sólo en ésa', () => {
    const plan = { ...programarCaos(FECHA, 'tormenta', 0), fallas: [
      { canal: 'supabase' as const, llamada: 2, falla: 'http_500' as const },
      { canal: 'openrouter' as const, llamada: 1, falla: 'timeout' as const },
    ] };
    const d = crearDespachador(plan);
    expect(d.decidir('supabase')).toBeNull();      // 1ª de supabase: limpia
    expect(d.decidir('openrouter')).toBe('timeout'); // 1ª de openrouter: cae
    expect(d.decidir('supabase')).toBe('http_500'); // 2ª de supabase: cae
    expect(d.decidir('supabase')).toBeNull();
    expect(d.llamadas()).toEqual({ supabase: 3, openrouter: 1 });
    expect(d.aplicadas()).toHaveLength(2);
    expect(d.sinAplicar()).toEqual([]);
  });

  it('`sinAplicar` delata el caos que NUNCA ocurrió', () => {
    // Es la mitad honesta del reporte: un plan que decía «falla la llamada 9»
    // en una corrida que hizo 2 no probó lo que dice probar, y presumirlo como
    // ✅ es exactamente la clase de mentira que esta máquina existe para evitar.
    const plan = { ...programarCaos(FECHA, 'supabase_una_falla', 0), fallas: [
      { canal: 'supabase' as const, llamada: 9, falla: 'timeout' as const },
    ] };
    const d = crearDespachador(plan);
    d.decidir('supabase');
    d.decidir('supabase');
    expect(d.aplicadas()).toEqual([]);
    expect(d.sinAplicar()).toHaveLength(1);
  });
});

describe('el envoltorio traduce la decisión a lo que de verdad devuelve la red', () => {
  const limpio: FetchLike = async () => new Response('{"ok":true}', { status: 200 });

  function conFalla(falla: 'timeout' | 'http_500' | 'cuerpo_corrupto' | 'conexion_caida'): FetchLike {
    const plan = { ...programarCaos(FECHA, 'supabase_una_falla', 0), fallas: [{ canal: 'supabase' as const, llamada: 1, falla }] };
    return envolverConCaos(limpio, crearDespachador(plan), 'supabase');
  }

  it('sin falla programada, pasa el fetch real intacto', async () => {
    const plan = { ...programarCaos(FECHA, 'supabase_una_falla', 0), fallas: [] };
    const f = envolverConCaos(limpio, crearDespachador(plan), 'supabase');
    expect((await f('https://x/')).status).toBe(200);
  });

  it('http_500 llega POR VALOR: status 500, cuerpo JSON — el SDK no lanza', async () => {
    // Es la forma en que supabase-js reporta un error: `{ data: null, error }`.
    // Si el envoltorio lanzara, se probaría un camino de código distinto.
    const r = await conFalla('http_500')('https://x/');
    expect(r.status).toBe(500);
    expect(r.ok).toBe(false);
    await expect(r.json()).resolves.toMatchObject({ code: 'XX000' });
  });

  it('cuerpo_corrupto es el traicionero: 200 y el que truena es el parser', async () => {
    const r = await conFalla('cuerpo_corrupto')('https://x/');
    expect(r.status).toBe(200);
    expect(r.ok).toBe(true);            // el status MIENTE, y ése es el ataque
    await expect(r.json()).rejects.toThrow();
    await expect(new Response(CUERPO_CORRUPTO).text()).resolves.toBe(CUERPO_CORRUPTO);
  });

  it('conexion_caida lanza lo que lanza undici de verdad', async () => {
    await expect(conFalla('conexion_caida')('https://x/')).rejects.toThrow(TypeError);
    await expect(conFalla('conexion_caida')('https://x/')).rejects.toThrow('fetch failed');
  });

  it('timeout NO contesta: sólo termina cuando aborta quien llamó (reloj falso)', async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const pendiente = conFalla('timeout')('https://x/', { signal: ac.signal });

    // No se resolvió por sí sola: el socket sigue abierto y mudo.
    let asentada = false;
    void pendiente.then(() => { asentada = true; }, () => { asentada = true; });
    await Promise.resolve();
    expect(asentada).toBe(false);

    ac.abort(new Error('backstop de 25 s'));
    await expect(pendiente).rejects.toThrow('backstop de 25 s');
  });

  it('un backstop por reloj dispara al adelantar el reloj falso, no en 25 s de pared', async () => {
    // ═════════════════════════════════════════════════════════════════════
    // OJO: `AbortSignal.timeout(25_000)` NO SE PUEDE FALSEAR.
    //
    // Es el mecanismo real de `supabase/admin.ts:37`, y sería lo natural de
    // escribir aquí. No funciona: su temporizador vive en el runtime de Node,
    // no en `globalThis.setTimeout`, así que `vi.useFakeTimers()` no lo
    // intercepta y `advanceTimersByTimeAsync` no lo dispara. Medido el
    // 28-ago-2026: el test se queda colgado y muere por el `testTimeout` de
    // 5 s de vitest, no por el backstop.
    //
    // Lo que sí se puede falsear es un `setTimeout` propio sobre un
    // `AbortController`, que es la MISMA forma —una señal que aborta al
    // vencer un plazo— y prueba lo que aquí toca probar: que el envoltorio de
    // caos suelta la promesa cuando la señal aborta, y que el reloj falso
    // manda. Que el backstop de producción de verdad exista y esté bien
    // cableado lo prueba `supabase/admin.test.ts`, con su propio método.
    // ═════════════════════════════════════════════════════════════════════
    vi.useFakeTimers();
    const ac = new AbortController();
    const vencer = () => ac.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    setTimeout(vencer, 25_000);

    const capturada = conFalla('timeout')('https://x/', { signal: ac.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(24_999);
    expect(ac.signal.aborted, 'abortó antes de tiempo').toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect((await capturada as Error).name).toBe('TimeoutError');
  });

  it('una llamada SIN señal falla cerrado y NOMBRA el problema', async () => {
    // No se cuelga el test: se rechaza diciendo que en producción esa llamada
    // se colgaría hasta el default de undici. El rechazo ES el hallazgo.
    await expect(conFalla('timeout')('https://x/')).rejects.toThrow(SIN_SENAL);
  });
});

describe('el ruteo por host, y la red que lo mantiene honesto', () => {
  it.each([
    ['https://abcdefgh.supabase.co/rest/v1/viaje?select=*', 'supabase'],
    ['https://abcdefgh.supabase.co/storage/v1/object/comprobantes/x.png', 'supabase'],
    ['https://openrouter.ai/api/v1/chat/completions', 'openrouter'],
    ['https://api.github.com/repos/x/y', null],
    ['https://graph.facebook.com/v21.0/123/messages', null],
    ['no-es-una-url', null],
  ])('%s → %s', (url, esperado) => {
    expect(canalDeUrl(url as string)).toBe(esperado);
  });

  it('acepta URL y Request, no sólo string', () => {
    expect(canalDeUrl(new URL('https://x.supabase.co/rest/v1/'))).toBe('supabase');
    expect(canalDeUrl(new Request('https://openrouter.ai/api/v1/x'))).toBe('openrouter');
  });

  it('la baseURL REAL de OpenRouter sigue cayendo en la tabla', () => {
    // El acoplamiento a los dominios del proveedor no se puede evitar (el fetch
    // global es la única palanca que alcanza a los dos), pero sí volverlo
    // ruidoso. Si alguien cambia de proveedor, esto falla — en vez de que el
    // caos deje de aplicarse en silencio y la corrida nocturna reporte ✅ sobre
    // un OpenRouter que nunca falló porque nadie lo tocó.
    const src = readFileSync('src/lib/llm/openrouter.ts', 'utf8');
    const m = /baseURL:\s*'([^']+)'/.exec(src);
    expect(m, 'no se encontró el baseURL en openrouter.ts').not.toBeNull();
    expect(canalDeUrl(m![1])).toBe('openrouter');
  });

  it('el fetch global sólo ensucia lo que el plan pidió', async () => {
    const limpio: FetchLike = async (e) => new Response(String(e), { status: 200 });
    const plan = { ...programarCaos(FECHA, 'supabase_una_falla', 0), fallas: [
      { canal: 'supabase' as const, llamada: 1, falla: 'http_500' as const },
    ] };
    const d = crearDespachador(plan);
    const f = fetchConCaosPorHost(limpio, () => d);

    // Un host ajeno no cuenta como llamada del canal ni recibe caos.
    expect((await f('https://graph.facebook.com/v21.0/x')).status).toBe(200);
    expect(d.llamadas()).toEqual({ supabase: 0, openrouter: 0 });
    // Y la primera de Supabase sí.
    expect((await f('https://x.supabase.co/rest/v1/viaje')).status).toBe(500);
  });

  it('sin despachador activo NO hay caos: entre repeticiones el arnés queda limpio', () => {
    const limpio: FetchLike = async () => new Response('ok', { status: 200 });
    const f = fetchConCaosPorHost(limpio, () => null);
    return expect(f('https://x.supabase.co/rest/v1/viaje').then((r) => r.status)).resolves.toBe(200);
  });

  it('el despachador se lee en CADA llamada, no se captura al envolver', async () => {
    // Capturarlo dejaría la repetición 2 y 3 corriendo con el caos de la 1 —
    // y el reporte diría «reproducible 3/3» sobre una sola corrida de verdad.
    const limpio: FetchLike = async () => new Response('ok', { status: 200 });
    let activo: Despachador | null = null;
    const f = fetchConCaosPorHost(limpio, () => activo);
    expect((await f('https://x.supabase.co/a')).status).toBe(200);
    activo = crearDespachador({ ...programarCaos(FECHA, 'supabase_una_falla', 0), fallas: [
      { canal: 'supabase', llamada: 1, falla: 'http_500' },
    ] });
    expect((await f('https://x.supabase.co/a')).status).toBe(500);
  });
});
