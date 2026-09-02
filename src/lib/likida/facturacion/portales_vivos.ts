// ═══════════════════════════════════════════════════════════════════════════
// EL VIGILANTE DE PORTALES — porque el catálogo se pudre solo.
//
// ── EL HECHO QUE OBLIGA A ESCRIBIR ESTO ───────────────────────────────────
//
// El reconocimiento de campo del 28-ago-2026 visitó los 37 portales del
// catálogo uno por uno. **De las veinte URLs de la primera tanda, SEIS no
// llevaban a ningún portal**: tres sin registro DNS, una estacionada en
// GoDaddy, una que era un directorio de nueve operadores y una en 502.
//
// Ninguna estaba mal el día que se escribió. Se pudrieron solas, en silencio, y
// nadie se iba a enterar hasta que un ticket real fallara — o sea hasta que un
// operador ya hubiera mandado la foto, el plazo ya estuviera corriendo y la
// persona que revisa tuviera que averiguar si el problema era el adaptador, el
// OCR o el portal. Eso es lo que este módulo existe para adelantar.
//
// ── LAS DOS COSAS QUE ESTE VIGILANTE HACE DISTINTO ────────────────────────
//
// 1. **UN 200 NO ES SUFICIENTE, Y ESO SE MIDIÓ.** La URL de OXXO que el
//    catálogo traía —`…/facturacionElectronica-web/`— respondía **200 OK** con
//    el cuerpo del JSF sin procesar:
//
//        <f:view …><html><h:head></h:head><h:body>Pagina inicio</h:body></html></f:view>
//
//    Ni un campo. Un chequeo de salud por código HTTP la daba por sana para
//    siempre. Por eso aquí la pregunta no es «¿contesta?» sino **«¿sigue
//    habiendo un formulario?»**.
//
// 2. **UNA SPA VACÍA NO ES UN PORTAL ROTO**, y confundirlas convertiría al
//    vigilante en el que grita en falso. El portal de Circle K sirve **1.9 KB
//    de HTML** y su formulario no existe hasta que corre el JavaScript: por
//    HTML crudo se ve idéntico a la URL rota de OXXO. La diferencia medible es
//    que la SPA trae su bundle (`<script type="module" src="/assets/…">`) y la
//    página rota no trae nada. Cuando hay bundle y no hay formulario, este
//    módulo dice `sin_confirmar` —no puedo saberlo sin ejecutar JS— en vez de
//    acusar. Es la diferencia entre un vigilante que sirve y uno que se apaga.
//
// ── POR QUÉ NO USA UN NAVEGADOR ───────────────────────────────────────────
//
// Porque tiene que poder correr seguido y barato. Abrir Chromium para 30 URLs
// es un minuto largo y un presupuesto que compite con facturar de verdad. Con
// `fetch` cuesta segundos, y el precio es exactamente el punto 2: en las SPA no
// se puede confirmar el formulario. Se declara en vez de disimularse.
//
// ── FAIL-CLOSED, Y DICHO ──────────────────────────────────────────────────
//
// Si la comprobación falla por NUESTRO lado —se cayó la red de la función, se
// agotó el reloj— eso NO es «el portal se cayó»: es `no_medido`. La distinción
// no es sutil: sin ella, un tropiezo de red de treinta segundos manda un correo
// diciendo que los 30 portales del catálogo están muertos, y al tercer correo
// así nadie vuelve a leer al vigilante.
// ═══════════════════════════════════════════════════════════════════════════

import { COMERCIOS, type Comercio } from './comercios';

/** Qué se pudo medir de un portal, en esta pasada. */
export type EstadoPortal =
  /** Contesta y se ve un formulario. Lo que se espera. */
  | 'vivo'
  /** El nombre no resuelve. Es el modo en que murieron tres del catálogo. */
  | 'sin_dns'
  /** Resuelve pero no entrega una página utilizable (5xx, 4xx, timeout). */
  | 'no_responde'
  /**
   * Contesta 200 y NO hay formulario ni rastro de una app que lo dibuje.
   * Es el caso OXXO: la falla que un chequeo por código HTTP no ve.
   */
  | 'sin_formulario'
  /**
   * Contesta 200, no se ve formulario, pero sí el bundle de una SPA. NO se
   * puede afirmar nada sin ejecutar JavaScript, y no se afirma.
   */
  | 'sin_confirmar'
  /** La comprobación falló por NUESTRO lado. No dice nada del portal. */
  | 'no_medido';

export interface RevisionPortal {
  clave: string;
  url: string;
  estado: EstadoPortal;
  /** El código que devolvió, o `null` si no hubo respuesta. `null` ≠ 0. */
  http: number | null;
  /** Cuántos campos se vieron en el HTML, o `null` si no se pudo mirar. */
  campos: number | null;
  /** La cita que sostiene el veredicto. Un hallazgo sin evidencia es opinión. */
  evidencia: string;
}

/** Lo mínimo que este módulo necesita de `fetch`, para poder probarlo sin red. */
export type Traer = (url: string, init: { signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/** Cuánto se le da a un portal antes de darlo por no disponible. */
const TOPE_MS = 12_000;

/** Cuánto HTML se mira. Un portal que necesite más de esto para enseñar un
 *  campo tiene otro problema, y bajarlo evita arrastrar megas de bundle. */
const MAX_HTML = 400_000;

/**
 * ¿Este HTML enseña un formulario?
 *
 * Deliberadamente TOSCO: cuenta etiquetas, no interpreta. Un parser de verdad
 * aquí sería precisión falsa — lo que se quiere saber es si la página trae algo
 * donde teclear, y para eso `<input>` y `<select>` bastan.
 *
 * Se descartan los `input[type=hidden]` a propósito: la app WEBDEV de Grupo
 * Centra sirve cinco inputs y **los cinco son ocultos y del framework**
 * (`WD_BUTTON_CLICK_`, `WD_ACTION_`, `M3`…). Contarlos daría «vivo con 5
 * campos» sobre una pantalla que no tiene ni uno donde escribir.
 */
export function camposVisiblesEn(html: string): number {
  const inputs = html.match(/<input\b[^>]*>/gi) ?? [];
  const visibles = inputs.filter((t) => !/type\s*=\s*["']?hidden["']?/i.test(t));
  const selects = html.match(/<select\b/gi) ?? [];
  const areas = html.match(/<textarea\b/gi) ?? [];
  return visibles.length + selects.length + areas.length;
}

/**
 * ¿Esto es el esqueleto de una SPA que todavía no se ha dibujado?
 *
 * La señal es el bundle: `<script type="module" src="…">` o un `src` con el
 * patrón de un empaquetador (`/assets/index-XXXX.js`). Es lo que distingue el
 * portal vivo de Circle K —1.9 KB y un `/assets/index-BTbyAnH-.js`— de la URL
 * rota de OXXO, que no traía ni un script.
 */
export function pareceSpa(html: string): boolean {
  if (/<script[^>]+type\s*=\s*["']module["']/i.test(html)) return true;
  if (/<script[^>]+src\s*=\s*["'][^"']*\/assets\/[^"']+\.js/i.test(html)) return true;
  // Angular y AngularJS dejan su marca en el marcado, no en el nombre del
  // bundle: `libramientos_meta` y `office_depot` son de este tipo.
  //
  // Sin `\b` alrededor del grupo, a propósito: `<app-root` empieza por `<`, que
  // NO es carácter de palabra, así que un `\b` delante nunca casaría y la rama
  // quedaba muerta en silencio. Cada alternativa trae ya su propio delimitador
  // —el `<` de la etiqueta o el `-` del atributo—, que es lo que evita casar
  // dentro de una palabra más larga.
  if (/(\sng-app[=\s>]|\sng-controller[=\s>]|<app-root|<router-outlet)/i.test(html)) return true;
  return false;
}

/** ¿El error de `fetch` dice que el nombre no existe? */
function esDnsMuerto(e: unknown): boolean {
  // Node mete el código en `cause`; el mensaje se mira como red por si el
  // runtime cambia la forma. Los dos casos que importan son ENOTFOUND (no
  // existe) y EAI_AGAIN (el resolutor no contestó).
  const causa = (e as { cause?: { code?: string } })?.cause?.code;
  if (causa === 'ENOTFOUND' || causa === 'EAI_AGAIN') return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg);
}

/**
 * Mide UN portal. Nunca lanza: todo camino acaba en un `RevisionPortal` que
 * dice qué se vio. Un vigilante que lanza deja de vigilar a los que faltaban.
 */
export async function revisarPortal(
  clave: string,
  url: string,
  traer: Traer,
  topeMs: number = TOPE_MS,
): Promise<RevisionPortal> {
  const control = new AbortController();
  const alarma = setTimeout(() => control.abort(), topeMs);
  try {
    const r = await traer(url, { signal: control.signal });

    if (!r.ok) {
      return {
        clave, url, estado: 'no_responde', http: r.status, campos: null,
        evidencia: `HTTP ${r.status}`,
      };
    }

    const html = (await r.text()).slice(0, MAX_HTML);
    const campos = camposVisiblesEn(html);

    if (campos > 0) {
      return {
        clave, url, estado: 'vivo', http: r.status, campos,
        evidencia: `HTTP ${r.status}, ${campos} campo(s) en el HTML`,
      };
    }

    if (pareceSpa(html)) {
      return {
        clave, url, estado: 'sin_confirmar', http: r.status, campos: 0,
        evidencia: `HTTP ${r.status} y 0 campos, pero el HTML carga un bundle de SPA: el formulario se dibuja con JavaScript y esta comprobación no lo ejecuta`,
      };
    }

    return {
      clave, url, estado: 'sin_formulario', http: r.status, campos: 0,
      evidencia: `HTTP ${r.status} con 0 campos y sin bundle que los dibuje (${html.length} bytes de HTML). Es el modo de falla de OXXO: contesta 200 y no hay nada donde teclear`,
    };
  } catch (e) {
    if (esDnsMuerto(e)) {
      return {
        clave, url, estado: 'sin_dns', http: null, campos: null,
        evidencia: `el nombre no resuelve (${e instanceof Error ? e.message : String(e)})`,
      };
    }
    // Un abort es NUESTRO reloj, no una caída del portal: se dice como tal.
    const abortado = control.signal.aborted;
    return {
      clave, url,
      estado: abortado ? 'no_responde' : 'no_medido',
      http: null, campos: null,
      evidencia: abortado
        ? `no contestó en ${topeMs} ms`
        : `la comprobación falló de nuestro lado: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(alarma);
  }
}

/**
 * QUÉ PORTALES SE VIGILAN. No todos: solo los que prometen una página que
 * alguien —o algo— va a abrir.
 *
 * Se quedan fuera, y cada exclusión tiene su razón:
 *   · `portalPendiente` — su `portal` es cadena vacía por definición. No hay
 *     nada que comprobar y ya está declarado como tarea abierta.
 *   · `noAutomatizable` con muro anti-bot — golpearlos periódicamente es
 *     justo lo que gana un bloqueo de IP. El vigilante no puede ser el que
 *     provoque el problema que vino a detectar.
 */
export function portalesVigilables(comercios: readonly Comercio[] = COMERCIOS): Comercio[] {
  return comercios.filter((c) => {
    if (c.portalPendiente || !c.portal) return false;
    if (c.noAutomatizable?.razon === 'muro_anti_bot') return false;
    return true;
  });
}

/** Los estados que significan «esto está roto», frente a los que no afirman nada. */
const ROTOS: ReadonlySet<EstadoPortal> = new Set<EstadoPortal>(['sin_dns', 'no_responde', 'sin_formulario']);

export function estaRoto(r: RevisionPortal): boolean {
  return ROTOS.has(r.estado);
}

export interface ResultadoVigilancia {
  revisiones: RevisionPortal[];
  /** Los que se midieron rotos EN ESTA PASADA, ya confirmados. */
  rotos: RevisionPortal[];
  /** Cuántos no se pudieron medir. Se dice: no se cuentan como sanos. */
  noMedidos: number;
  /** Se acabó el reloj y quedaron portales sin mirar. Ni fallo ni «no había». */
  sinTurno: string[];
}

export interface OpcionesVigilancia {
  traer: Traer;
  /** `Date.now()` a partir del cual ya no se toman portales nuevos. */
  venceEn?: number;
  ahora?: () => number;
  comercios?: readonly Comercio[];
  topeMs?: number;
}

/**
 * LA PASADA COMPLETA.
 *
 * ── POR QUÉ CADA ROTO SE MIDE DOS VECES ───────────────────────────────────
 *
 * Es la regla que el PR #183 dejó asentada para los agentes de ingeniería
 * después de los cuatro correos falsos del 28-ago-2026: **sin escenario
 * concreto verificado, no es hallazgo**, y un agente se refuta a sí mismo antes
 * de gritar. Aquí eso se traduce en algo muy concreto: un 502 puede ser un
 * despliegue del portal a media pasada, y un timeout puede ser la red de la
 * función. Reintentar una vez y exigir que el síntoma se repita es la
 * refutación más barata que existe, y convierte «lo vi caído» en «lo vi caído
 * dos veces seguidas», que es lo mínimo para gastarle un correo a alguien.
 *
 * Lo que NO se reintenta es `sin_dns`: si el nombre no resuelve, no resuelve —
 * y `EAI_AGAIN` (el resolutor no contestó) ya se distingue en la evidencia.
 *
 * ── EL RELOJ ──────────────────────────────────────────────────────────────
 *
 * Se consulta ANTES de cada portal, no una vez al principio: el patrón de
 * `conRelojDuro` que el PR #152 dejó en el runner. Los que se quedan sin turno
 * se DICEN por su nombre, con `sinTurno`, en vez de desaparecer — un vigilante
 * que revisó 12 de 30 y reporta «todo bien» miente sobre los 18 que no miró.
 */
export async function vigilarPortales(op: OpcionesVigilancia): Promise<ResultadoVigilancia> {
  const ahora = op.ahora ?? Date.now;
  const lista = portalesVigilables(op.comercios ?? COMERCIOS);

  const revisiones: RevisionPortal[] = [];
  const sinTurno: string[] = [];

  for (const c of lista) {
    if (op.venceEn !== undefined && ahora() >= op.venceEn) {
      sinTurno.push(c.clave);
      continue;
    }

    let r = await revisarPortal(c.clave, c.portal, op.traer, op.topeMs);

    // La refutación: si salió roto y no es DNS, se vuelve a mirar. Solo si el
    // segundo intento coincide se sostiene el hallazgo.
    if (estaRoto(r) && r.estado !== 'sin_dns') {
      const segunda = await revisarPortal(c.clave, c.portal, op.traer, op.topeMs);
      if (!estaRoto(segunda)) {
        // Se contradijo a sí mismo. Gana la lectura buena, y la evidencia deja
        // dicho que hubo un tropiezo — para que un portal que parpadea semana
        // tras semana se pueda ver sin haber mandado un correo cada vez.
        r = {
          ...segunda,
          evidencia: `${segunda.evidencia} (el primer intento dio «${r.evidencia}»: no se sostiene)`,
        };
      } else {
        r = { ...segunda, evidencia: `${segunda.evidencia}; confirmado en dos intentos` };
      }
    }

    revisiones.push(r);
  }

  return {
    revisiones,
    rotos: revisiones.filter(estaRoto),
    noMedidos: revisiones.filter((r) => r.estado === 'no_medido').length,
    sinTurno,
  };
}

/**
 * El parte en palabras. Va al log y, si hay rotos, al correo del operador.
 *
 * Dice los NO MEDIDOS y los SIN TURNO aunque no haya rotos: son la diferencia
 * entre «los 30 están bien» y «miré 12, 3 no se dejaron medir y 15 se quedaron
 * sin turno», que es lo que de verdad pasó.
 */
export function redactarParte(r: ResultadoVigilancia): string {
  const lineas: string[] = [];
  const vivos = r.revisiones.filter((x) => x.estado === 'vivo').length;
  const sinConfirmar = r.revisiones.filter((x) => x.estado === 'sin_confirmar').length;

  lineas.push(
    `Portales revisados: ${r.revisiones.length} · ${vivos} con formulario a la vista · ` +
    `${sinConfirmar} SPA (no confirmable sin JS) · ${r.rotos.length} rotos · ` +
    `${r.noMedidos} no medidos · ${r.sinTurno.length} sin turno.`,
  );

  if (r.rotos.length > 0) {
    lineas.push('', 'ROTOS (confirmados en dos intentos, salvo DNS):');
    for (const x of r.rotos) lineas.push(`  · ${x.clave} — ${x.estado} — ${x.url} — ${x.evidencia}`);
  }

  if (r.noMedidos > 0) {
    lineas.push('', 'NO MEDIDOS (fallo de nuestro lado; NO dice nada del portal):');
    for (const x of r.revisiones.filter((y) => y.estado === 'no_medido')) {
      lineas.push(`  · ${x.clave} — ${x.evidencia}`);
    }
  }

  if (r.sinTurno.length > 0) {
    lineas.push('', `SIN TURNO (se acabó el reloj, NO se miraron): ${r.sinTurno.join(', ')}`);
  }

  lineas.push(
    '',
    'CÓMO LEER ESTO: un portal «sin_formulario» contesta 200 y no tiene dónde teclear — es el modo de falla que un chequeo por código HTTP no ve (la URL vieja de OXXO). Un «sin_confirmar» es una SPA: contesta y su formulario se dibuja con JavaScript, que esta comprobación no ejecuta.',
  );

  return lineas.join('\n');
}
