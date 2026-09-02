// ═══════════════════════════════════════════════════════════════════════════
// CAOS — Modo 5 de la máquina de automejora (§2.2), sobre el arnés de Fase 1.
//
// QUÉ CAZA ESTO QUE LOS OTROS MODOS NO: EL **CUÁNDO**.
//
// Property-based y metamórfico varían el DATO. El fuzzing varía la FORMA del
// dato. Los tres corren sobre un mundo donde todo lo de afuera contesta: la
// base responde, el modelo responde, el disco escribe. El caos es el único que
// varía el momento y el modo en que algo de afuera NO contesta — y ése es el
// eje donde vive la clase de bug más cara de este repo, la que ya mordió tres
// veces con nombre y apellido:
//
//   · La consulta sin techo (`tope_consulta.test.ts`): un socket que Supabase
//     acepta y no contesta se come los 120 s del webhook. La liquidación queda
//     ESCRITA, el operador no recibe ni resumen ni PDF, el `logger.error` no se
//     alcanza a escribir porque el proceso muere antes del `catch`, y Meta no
//     reintenta porque ya recibió su 200. Ningún dato es inválido en ese bug:
//     lo único que cambió fue cuándo llegó la respuesta.
//
//   · El `maxDuration` de los crons: Vercel mata la función a medio camino SIN
//     log y la corrida de todas las flotas de esa hora desaparece en silencio.
//
// Un fallo así no se reproduce escribiendo un dato distinto. Se reproduce
// diciendo «la tercera llamada a Supabase de esta corrida no contesta», que es
// exactamente lo que hace este archivo.
//
// ─── CÓMO ─────────────────────────────────────────────────────────────────
//
// El plan es DETERMINISTA y viene de la semilla: misma semilla → mismas fallas,
// en las mismas llamadas, en los mismos canales. Un fallo encontrado se
// reproduce con `QA_FECHA` y el nombre del ataque, sin «a veces pasa».
//
// El despachador cuenta llamadas por canal y decide; el envoltorio traduce la
// decisión a lo que de verdad devuelve la red. Están separados a propósito: el
// despachador es puro y se prueba offline (`chaos.escenarios.test.ts` corre en
// `npm test`, sin credenciales ni red), y el envoltorio es lo único que toca
// `fetch`.
//
// EL RELOJ. `timeout` no duerme: devuelve una promesa que sólo se resuelve
// cuando el `AbortSignal` de quien llamó aborta. Con `vi.useFakeTimers()` el
// test adelanta el reloj y el backstop de `supabase/admin.ts` (25 s) o el de
// `acotada()` (8 s) disparan de verdad, sin esperar 25 segundos de pared.
//
// Y SI NO HAY SEÑAL, FALLA CERRADO Y LO DICE. Una llamada sin `AbortSignal` es
// precisamente la que se colgaría para siempre en producción: en vez de dejar
// el test colgado, se rechaza con un error que NOMBRA el problema. Ese rechazo
// no es ruido del arnés — es el hallazgo.
// ═══════════════════════════════════════════════════════════════════════════

import { mulberry32, semillaDesde, entre, elemento, type Rng } from './rng';

/** Los cuatro modos en que algo de afuera deja de contestar bien. */
export type Falla =
  /** Acepta la conexión y no contesta nunca. El más caro: se come el presupuesto de tiempo. */
  | 'timeout'
  /** Contesta 500. El SDK lo devuelve POR VALOR en `error`, no lanza. */
  | 'http_500'
  /** Contesta 200 con un cuerpo que no es JSON válido: `.json()` truena. */
  | 'cuerpo_corrupto'
  /** La conexión se cae. Undici lanza `TypeError: fetch failed`. */
  | 'conexion_caida';

export const FALLAS: readonly Falla[] = ['timeout', 'http_500', 'cuerpo_corrupto', 'conexion_caida'];

/** Las dos cosas de afuera que el pipeline necesita para contestarle al chofer. */
export type Canal = 'supabase' | 'openrouter';

export const CANALES: readonly Canal[] = ['supabase', 'openrouter'];

export type AtaqueCaos =
  /** Una sola falla, temprana, en Supabase: el camino del cierre. */
  | 'supabase_una_falla'
  /** Una sola falla en OpenRouter: OCR o agente sin respuesta. */
  | 'openrouter_una_falla'
  /** Varias fallas repartidas por los dos canales: el día malo de verdad. */
  | 'tormenta';

export const ATAQUES_CAOS: AtaqueCaos[] = ['supabase_una_falla', 'openrouter_una_falla', 'tormenta'];

export interface FallaProgramada {
  canal: Canal;
  /** Ordinal 1-indexado de la llamada DE ESE CANAL en la repetición. */
  llamada: number;
  falla: Falla;
}

export interface PlanDeCaos {
  ataque: AtaqueCaos;
  semillaTexto: string;
  seed: number;
  fallas: FallaProgramada[];
  /** Invariantes del diseño §4 que este escenario debe disparar. */
  invariantes: string[];
  /** Lo que el sistema NO puede hacer cuando algo de afuera no contesta. */
  prohibido: string[];
}

/** Semilla canónica del diseño §7, con `chaos` en el lugar del agente. */
export function semillaCaos(fecha: string, ataque: AtaqueCaos, indice: number): { texto: string; seed: number } {
  const texto = `${fecha}|nivel3|chaos|${ataque}|${indice}`;
  return { texto, seed: semillaDesde(texto) };
}

/** Fallas de un canal, sin repetir ordinal, ordenadas por llamada. */
function programar(rng: Rng, canal: Canal, cuantas: number, hasta: number): FallaProgramada[] {
  const ordinales = new Set<number>();
  // Cota dura: sin ella, un `cuantas > hasta` daría un bucle infinito. Que el
  // generador se cuelgue es peor que cualquier bug que fuera a encontrar.
  for (let i = 0; i < cuantas && ordinales.size < hasta; i++) {
    let n = entre(rng, 1, hasta);
    while (ordinales.has(n)) n = (n % hasta) + 1;
    ordinales.add(n);
  }
  return [...ordinales].sort((a, b) => a - b)
    .map((llamada) => ({ canal, llamada, falla: elemento(rng, FALLAS) }));
}

export function programarCaos(fecha: string, ataque: AtaqueCaos, indice = 0): PlanDeCaos {
  const { texto, seed } = semillaCaos(fecha, ataque, indice);
  const rng = mulberry32(seed);
  const PROHIBIDO_SIEMPRE = [
    'contestarle al chofer una cifra calculada sobre una lectura que falló: `null` no es 0, y ' +
    'una consulta que no contestó no es «no hay gastos»',
    'cerrar una liquidación con datos parciales',
    'morir sin dejar rastro en la bitácora: el `catch` tiene que alcanzar a escribir',
  ];

  switch (ataque) {
    case 'supabase_una_falla':
      return {
        ataque, semillaTexto: texto, seed,
        // Temprana a propósito (entre las 6 primeras): es donde el cierre todavía
        // puede decidir no seguir. Una falla tardía prueba otra cosa.
        fallas: programar(rng, 'supabase', 1, 6),
        invariantes: ['#1 cuadre_balancea (no debe cerrar sobre una lectura fallida)', '#8 bitacora'],
        prohibido: PROHIBIDO_SIEMPRE,
      };

    case 'openrouter_una_falla':
      return {
        ataque, semillaTexto: texto, seed,
        fallas: programar(rng, 'openrouter', 1, 4),
        invariantes: ['#1 cuadre_balancea (no debe cerrar sin OCR)', '#5 cifras_con_fuente', '#8 bitacora'],
        prohibido: [
          ...PROHIBIDO_SIEMPRE,
          'inventar el contenido del comprobante cuando el modelo no contestó',
        ],
      };

    case 'tormenta':
      return {
        ataque, semillaTexto: texto, seed,
        fallas: [
          ...programar(rng, 'supabase', entre(rng, 2, 4), 12),
          ...programar(rng, 'openrouter', entre(rng, 1, 2), 6),
        ],
        invariantes: ['#1 cuadre_balancea', '#5 cifras_con_fuente', '#8 bitacora'],
        prohibido: [
          ...PROHIBIDO_SIEMPRE,
          'reintentar sin techo: el presupuesto de la invocación es de 120 s y el reintento también cuesta',
        ],
      };
  }
}

/** Lleva la cuenta por canal y decide qué toca en cada llamada. */
export interface Despachador {
  /** `null` = esta llamada pasa limpia. Avanza el contador del canal. */
  decidir(canal: Canal): Falla | null;
  /** Cuántas llamadas van por canal (para el reporte). */
  llamadas(): Record<Canal, number>;
  /** Las fallas que de verdad se aplicaron — no las programadas. */
  aplicadas(): FallaProgramada[];
  /** Las programadas que NUNCA llegaron a aplicarse: el caos que no ocurrió. */
  sinAplicar(): FallaProgramada[];
}

/**
 * `sinAplicar()` importa tanto como `aplicadas()`. Si el plan decía «falla la
 * llamada 9 a Supabase» y la corrida sólo hizo 5, el escenario NO probó lo que
 * dice probar. Un reporte que no distingue eso presume cobertura que no tuvo.
 */
export function crearDespachador(plan: PlanDeCaos): Despachador {
  const n: Record<Canal, number> = { supabase: 0, openrouter: 0 };
  const usadas: FallaProgramada[] = [];
  return {
    decidir(canal) {
      n[canal] += 1;
      const f = plan.fallas.find((x) => x.canal === canal && x.llamada === n[canal]);
      if (!f) return null;
      usadas.push(f);
      return f.falla;
    },
    llamadas: () => ({ ...n }),
    aplicadas: () => [...usadas],
    sinAplicar: () => plan.fallas.filter((f) => !usadas.includes(f)),
  };
}

/** Lo mínimo de `fetch` que el envoltorio necesita. */
export type FetchLike = (entrada: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** El error de una llamada sin señal: no es ruido del arnés, es el hallazgo. */
export const SIN_SENAL =
  'caos/timeout: la llamada no traía AbortSignal. En producción esto no es un test lento: ' +
  'es una llamada que se cuelga hasta el default de undici (300 s) dentro de una función con ' +
  'maxDuration de 120 s. Envuélvela: `await acotada(supabaseAdmin()…, "etiqueta")`.';

/** Cuerpo truncado a propósito: `.json()` truena, `.text()` no. */
export const CUERPO_CORRUPTO = '{"data":[{"id":"aaaaaaaa-0000-4000-8000-0000000';

/**
 * Envuelve un `fetch` para que aplique el caos del despachador en este canal.
 *
 * No adivina el canal: se le dice. El ruteo por host vive aparte, en
 * `canalDeUrl`, y tiene su propia red que lo mantiene honesto.
 */
export function envolverConCaos(fetchReal: FetchLike, despachador: Despachador, canal: Canal): FetchLike {
  return async (entrada, init) => {
    const falla = despachador.decidir(canal);
    if (falla === null) return fetchReal(entrada, init);

    switch (falla) {
      case 'timeout':
        // Acepta y no contesta: sólo termina cuando aborta quien llamó. Con
        // `vi.useFakeTimers()` el test adelanta el reloj y el backstop dispara.
        return new Promise<Response>((_resolver, rechazar) => {
          const senal = init?.signal;
          if (!senal) { rechazar(new Error(SIN_SENAL)); return; }
          if (senal.aborted) { rechazar(senal.reason ?? new Error('abortada')); return; }
          senal.addEventListener('abort', () => rechazar(senal.reason ?? new Error('abortada')), { once: true });
        });

      case 'http_500':
        return new Response(JSON.stringify({ message: 'caos: 500 programado', code: 'XX000' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'application/json' },
        });

      case 'cuerpo_corrupto':
        // 200 con JSON truncado. Es el más traicionero de los cuatro: el status
        // dice que todo salió bien y el que revienta es el parser, en otra capa.
        return new Response(CUERPO_CORRUPTO, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });

      case 'conexion_caida':
        // Lo que lanza undici de verdad cuando el socket se cae.
        throw new TypeError('fetch failed');
    }
  };
}

// ── Ruteo por host, y el problema de que exista ────────────────────────────
//
// `supabase/admin.ts` no recibe un `fetch` inyectable: construye el cliente con
// `global.fetch` y llama al `fetch` GLOBAL. `openrouter.ts` hace lo mismo a
// través del SDK. La única palanca que alcanza a los dos es sustituir el fetch
// global — y entonces sí hay que decidir, por petición, a qué canal pertenece.
//
// Eso ACOPLA el arnés a los dominios del proveedor, que es exactamente lo que
// el envoltorio evita a propósito. El acoplamiento no se puede eliminar, pero
// sí se puede volver ruidoso: `chaos.escenarios.test.ts` lee el FUENTE de
// `openrouter.ts` y comprueba que su `baseURL` siga cayendo en esta tabla. Si
// alguien cambia de proveedor, la red falla en vez de que el caos deje de
// aplicarse en silencio — que es la forma en que un arnés de QA se muere sin
// que nadie se entere.

/** Host → canal. Todo lo que no esté aquí pasa LIMPIO, a propósito. */
export const HOSTS: ReadonlyArray<{ sufijo: string; canal: Canal }> = [
  { sufijo: 'supabase.co', canal: 'supabase' },
  { sufijo: 'supabase.in', canal: 'supabase' },
  { sufijo: 'openrouter.ai', canal: 'openrouter' },
];

/**
 * El canal de una URL, o `null` si no es de ninguno de los dos.
 *
 * `null` significa «pasa limpio», y es lo correcto: meterle caos a algo que no
 * se programó ensuciaría el reporte con fallos que el plan no pidió, y un
 * hallazgo que no se puede atribuir a una falla programada no es reproducible.
 */
export function canalDeUrl(entrada: RequestInfo | URL): Canal | null {
  const crudo = typeof entrada === 'string' ? entrada
    : entrada instanceof URL ? entrada.href
    : (entrada as Request).url;
  let host: string;
  try { host = new URL(crudo).hostname; } catch { return null; }
  return HOSTS.find((h) => host === h.sufijo || host.endsWith(`.${h.sufijo}`))?.canal ?? null;
}

/**
 * Un `fetch` que aplica el caos al canal que toque según el host, y deja pasar
 * todo lo demás. Es lo que se le pone a `globalThis.fetch` en el orquestador.
 *
 * `despachador()` se lee en CADA llamada, no se captura: el orquestador cambia
 * de plan entre repeticiones, y capturar el de la primera dejaría las otras dos
 * corriendo con el caos de la anterior — un falso «reproducible 3/3».
 */
export function fetchConCaosPorHost(
  fetchReal: FetchLike,
  despachador: () => Despachador | null,
): FetchLike {
  return async (entrada, init) => {
    const d = despachador();
    const canal = d === null ? null : canalDeUrl(entrada);
    if (d === null || canal === null) return fetchReal(entrada, init);
    return envolverConCaos(fetchReal, d, canal)(entrada, init);
  };
}
