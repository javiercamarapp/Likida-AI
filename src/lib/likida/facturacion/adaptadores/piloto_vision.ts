import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { generateStructured } from '@/lib/llm/openrouter';
import { createLlmBudget } from '@/lib/llm/budget';
import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import type { AdaptadorPortal, ModoAgente, ResultadoAgente } from '../agente';
import type { CampoListo } from '../pendientes';
import type { Comercio } from '../comercios';
import { clasificarFallo, escrituraPermitida, pantallaDeLogin } from '../vinculo_senales';
import type { FabricaDePagina, InventarioPagina, PaginaConInventario, PaginaPortal } from './playwright_base';

// ═══════════════════════════════════════════════════════════════════════════
// EL PILOTO DE VISIÓN — un adaptador para los portales que nadie ha mapeado.
//
// De los ~37 comercios del registro, adaptadores de selector hay UNO (CAPUFE).
// El resto iba con el encargado por `sin_robot`: portal reconocido, datos
// leídos, y el hueco era NUESTRO — faltaba el adaptador. Escribir 36 mapeos a
// mano exige 36 pre-vuelos; mientras tanto, este piloto opera cualquier ficha:
// mira la pantalla (captura + inventario del DOM), decide UNA acción por paso
// —escribir tal valor en tal selector, clic aquí— y la ejecuta con las MISMAS
// primitivas que un adaptador escrito.
//
// El comentario de `agente.ts` que dice "no hace falta un modelo para escribir
// un folio que ya está en la base" sigue siendo verdad donde hay selector: un
// adaptador escrito cuesta $0 por corrida y este piloto paga ~8-14 llamadas de
// visión. El piloto es el RESPALDO para donde el selector no existe todavía —
// exactamente el papel que ese comentario le reservó a la visión— y cada
// portal que se gradúe con su pre-vuelo y su mapeo se sale de aquí.
//
// ── LAS CUATRO REGLAS QUE NO SE NEGOCIAN ─────────────────────────────────
//
// 1. EL PILOTO NO EMITE. NUNCA, ni en modo `emitir`. Llena el formulario,
//    captura la pantalla y se detiene ANTES de cualquier botón que cree el
//    CFDI. Un CFDI es irreversible ante el SAT, y la evidencia de que un
//    modelo de visión eligió bien un botón es exactamente la que no se tiene
//    en el primer portal que ve. Para emitir hace falta adaptador escrito —
//    con su pre-vuelo, su mapeo y su botón conocido. La doble guarda: el
//    modelo declara `esBotonQueEmite` Y el piloto veta por texto del botón
//    (emitir/generar/timbrar/facturar); cualquiera de las dos detiene.
//
// 2. CAPTCHA = PERSONA. Si el inventario trae señales de captcha, se devuelve
//    `requiereCaptcha: true` y el ticket sale por el camino de siempre (fuera
//    de la cola, aviso al encargado). No se rodea, no se reintenta. El porqué,
//    entero, en el bloque CAPTCHA de más abajo.
//
// 3. EL PILOTO NO TECLEA CONTRASEÑAS. NI EL MODELO NI ESTE CÓDIGO.
//
//    Hasta el 27-ago-2026 esta regla decía otra cosa: el modelo recibía los
//    marcadores «USUARIO» y «CONTRASEÑA» y este archivo los SUSTITUÍA por la
//    credencial real sacada del cofre antes de escribirla en el formulario.
//    El secreto no viajaba al modelo —eso era cierto— pero sí se descifraba
//    en cada corrida, se tecleaba en un portal ajeno y vivía en memoria de la
//    función mientras durara el lote. Eso rompe la regla dura de la casa
//    («Likida nunca maneja contraseñas en claro») y se retiró.
//
//    En su lugar, el MODO ASISTIDO: cuando la pantalla pide entrar, la
//    corrida se detiene con `requiereVinculacion` y el contralor hace el
//    login él mismo UNA vez. De ahí sale el `storageState` que
//    `sesion_portal.ts` guarda cifrado, y las corridas siguientes entran
//    solas con esa sesión. La persona abre la puerta; el robot hace lo
//    repetitivo.
//
//    LA GUARDA ES DE CÓDIGO, NO DE PROMPT: escribir en un campo
//    `type="password"` está prohibido aquí abajo pase lo que pase, aunque el
//    modelo lo pida y aunque el valor venga en claro en la acción.
//
// 4. UN SELECTOR SALE DEL INVENTARIO, no de la imaginación. El modelo ve la
//    captura Y la lista real de campos/botones con sus id/name; una acción
//    sobre un selector que no está en el inventario se rechaza sin tocar la
//    página. Es el mismo principio del pre-vuelo: la apuesta mala se mata
//    antes de ejecutarla.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// CAPTCHA — EL LÍMITE, ESCRITO DONDE SE APLICA.
//
// LIKIDA NO RESUELVE NI BURLA CAPTCHAS. Ni con un servicio de terceros, ni
// con visión, ni "probando a ver". Dos razones, y las dos son del cliente:
//
//   1. LOS TÉRMINOS DEL PORTAL. Un reCAPTCHA es una declaración explícita de
//      que ese acceso es para personas. Rodearlo es operar contra los
//      términos del servicio de un tercero —con la cuenta del cliente—.
//   2. QUIÉN PAGA EL RIESGO. La cuenta que el portal suspende no es la de
//      Likida: es la del cliente, y con ella se le cae la facturación de todo
//      el mes. Un ahorro de treinta segundos no vale eso.
//
// LO QUE SÍ SE HACE: la corrida se detiene con `requiereCaptcha` (que es
// `requiere_humano` visto desde el enrutador), el ticket sale de la cola
// automática y el contralor recibe la pantalla con TODO prellenado —portal,
// campos leídos, monto, folio— para resolverlo en segundos. La corrida
// siguiente continúa por donde iba.
//
// Y por eso mismo el captcha del LOGIN dejó de doler: se paga una vez por
// vinculación (la persona entra, la sesión se guarda cifrada) en vez de una
// vez por ticket.
// ═══════════════════════════════════════════════════════════════════════════

/** Techo de pasos por sesión. Un formulario típico son 6-10 acciones; llegar
 *  aquí es estar dando vueltas, y cada vuelta cuesta una llamada de visión. */
export const PASOS_MAXIMOS = 14;

/** Lo que el portal exige saber del receptor. Mismos campos que todo adaptador. */
export interface ReceptorPiloto {
  rfc: string;
  nombre: string;
  codigoPostal: string;
  regimenFiscal: string;
  usoCfdi: string;
  correo: string;
}

const Accion = z.object({
  /** Una línea: qué ve y por qué esta acción. Va al log, no a la pantalla. */
  veo: z.string(),
  hayCaptcha: z.boolean(),
  tipo: z.enum(['escribir', 'clic', 'seleccionar', 'terminado', 'no_puedo']),
  /** Selector CSS armado con los id/name DEL INVENTARIO. */
  selector: z.string().nullable(),
  valor: z.string().nullable(),
  /** ¿Este clic dispararía la emisión del CFDI? El piloto se detiene ahí. */
  esBotonQueEmite: z.boolean(),
  /** Para `terminado`/`no_puedo`: qué quedó, o qué faltó. */
  motivo: z.string().nullable(),
});
type AccionPiloto = z.infer<typeof Accion>;

/** Texto de botón que huele a emisión. Veto propio, aparte del juicio del modelo. */
const HUELE_A_EMITIR = /emitir|generar|timbrar|facturar|crear\s*(mi\s*)?(cfdi|factura)/i;

export interface OpcionesPiloto {
  /** Tenant de la corrida; sin él se mantiene el piloto en modo no persistido. */
  tenantId?: string;
  comercio: Comercio;
  receptor: ReceptorPiloto;
  abrirPagina: FabricaDePagina;
  /**
   * ¿El navegador de este lote arrancó con la sesión guardada de este portal?
   *
   * Es lo único que separa «se te venció la sesión» de «nunca has vinculado
   * este portal»: los dos se ven igual desde la pantalla de login, y mandan al
   * contralor a leer cosas distintas. Ver `clasificarFallo` en
   * `vinculo_portal.ts`.
   */
  arrancoConSesion?: boolean;
  /**
   * OPCIONAL: qué existe SOLO estando dentro de este portal (el nombre de la
   * cuenta, «Cerrar sesión»). Sin esto, la caducidad se detecta por campo de
   * contraseña y por la dirección, que es lo que cubre a los portales de hoy.
   */
  senaDeAdentro?: string;
}

/**
 * Un `AdaptadorPortal` guiado por visión para la ficha de UN comercio.
 *
 * Se registra por flota igual que cualquier adaptador (los datos del receptor
 * van dentro), así que todas las guardas de tenant de `agente.ts` aplican.
 */
export function crearPilotoVision(op: OpcionesPiloto): AdaptadorPortal {
  return {
    comercio: op.comercio.clave,
    portal: op.comercio.portal,
    facturar: (campos, modo) => volar(op, campos, modo),
  };
}

async function volar(op: OpcionesPiloto, campos: CampoListo[], modo: ModoAgente): Promise<ResultadoAgente> {
  // La normalización de siempre: cualquier cosa que no sea la palabra exacta
  // es ensayo. Y aunque sea `emitir`, la regla 1 manda: el piloto llena y se
  // detiene. Se deja dicho en el log para que nadie busque un UUID que este
  // camino no puede producir.
  const modoReal: ModoAgente = modo === 'emitir' ? 'emitir' : 'ensayo';
  if (modoReal === 'emitir') {
    logger.warn('piloto.no_emite', { comercio: op.comercio.clave, detalle: 'el piloto de visión llena y se detiene; emitir exige adaptador escrito' });
  }

  const pagina = await op.abrirPagina();
  const capturado: Record<string, string> = {};
  const historial: string[] = [];
  let captura: string | undefined;

  try {
    if (!tieneInventario(pagina)) {
      return { modo: modoReal, ok: false, capturado, error: 'Esta página no sabe levantar inventario, y sin inventario el piloto no elige selectores reales. Es un hueco de plataforma, no del portal.' };
    }
    await pagina.abrir(op.comercio.portal);

    let anterior: string | null = null;
    let terminado: AccionPiloto | null = null;

    for (let paso = 1; paso <= PASOS_MAXIMOS; paso++) {
      const inv = await pagina.inventario();

      // Regla 3: ¿esta pantalla es la de entrar? Se mira ANTES que nada más
      // —incluso antes del captcha— porque cuando las dos cosas coinciden (el
      // login de Megasur trae reCAPTCHA) lo ACCIONABLE es la vinculación: el
      // contralor entra una vez, resuelve él ese captcha y la sesión queda
      // guardada. Decir solo "hay captcha" lo mandaría a resolver un muro por
      // ticket en vez de una vez por portal.
      const login = pantallaDeLogin(inv, op.senaDeAdentro);
      if (login) {
        const fallo = clasificarFallo({ loginVisto: login, arrancoConSesion: op.arrancoConSesion === true });
        captura = await capturaSegura(pagina);
        logger.info('piloto.pide_vinculacion', {
          comercio: op.comercio.clave, clase: fallo?.clase, evidencia: login, paso,
        });
        return {
          modo: modoReal, ok: false, capturado, captura,
          requiereVinculacion: true,
          ...(fallo?.clase === 'sesion_caducada' ? { sesionCaducada: true } : {}),
          // El captcha del login SÍ se declara además: es la razón por la que
          // esto no lo puede hacer la máquina, y el aviso lo dice tal cual.
          ...(inv.captcha.length > 0 ? { requiereCaptcha: true } : {}),
          error: `${op.comercio.nombre} pide iniciar sesión (${login}). ${fallo?.queHacer ?? ''}`.trim(),
        };
      }

      // Regla 2: el captcha se declara y se sale. También si lo declara el
      // modelo y el DOM no lo enseña (un checkbox de reCAPTCHA en iframe).
      if (inv.captcha.length > 0) {
        captura = await capturaSegura(pagina);
        return {
          modo: modoReal, ok: false, capturado, captura, requiereCaptcha: true,
          error: `El portal enseña un CAPTCHA (${inv.captcha[0]}), así que lo factura una persona. Likida no resuelve ni burla CAPTCHAs: es el acceso del cliente el que se suspende si alguien lo intenta.`,
        };
      }

      captura = await capturaSegura(pagina);
      const accion = await decidir(op, campos, inv, captura, historial, paso);
      logger.info('piloto.paso', { comercio: op.comercio.clave, paso, tipo: accion.tipo, selector: accion.selector, veo: accion.veo.slice(0, 120) });

      if (accion.hayCaptcha) {
        return {
          modo: modoReal, ok: false, capturado, captura, requiereCaptcha: true,
          error: 'El piloto vio un CAPTCHA en pantalla, así que lo factura una persona.',
        };
      }
      if (accion.tipo === 'no_puedo') {
        return { modo: modoReal, ok: false, capturado, captura, error: `El piloto no pudo con este portal: ${accion.motivo ?? accion.veo}` };
      }
      if (accion.tipo === 'terminado') { terminado = accion; break; }

      // Loop-guard: la misma acción dos veces seguidas es estar atorado, y
      // cada vuelta cuesta una llamada de visión y un riesgo en un formulario
      // fiscal. Se corta y se dice.
      const firma = `${accion.tipo}|${accion.selector}|${accion.valor}`;
      if (firma === anterior) {
        return { modo: modoReal, ok: false, capturado, captura, error: `El piloto repitió la misma acción dos veces (${accion.tipo} en ${accion.selector}) y se detuvo: repetirla una tercera daría lo mismo.` };
      }
      anterior = firma;

      const problema = await ejecutar(pagina, op, accion, modoReal, capturado, inv);
      if (problema) {
        // `detenido_antes_de_emitir` es el ÚNICO problema que termina bien.
        if (problema === 'detenido_antes_de_emitir') {
          terminado = accion;
          break;
        }
        // La guarda dura de la regla 3: el modelo quiso teclear en un campo de
        // contraseña. No es "no pude", es "no se hace" — y sale con el mismo
        // estado declarado que la pantalla de login, porque el arreglo es el
        // mismo: que entre una persona.
        if (problema === CONTRASENA_NO) {
          return {
            modo: modoReal, ok: false, capturado, captura,
            requiereVinculacion: true,
            error: `${op.comercio.nombre} pide una contraseña y Likida no teclea contraseñas. El login lo hace una persona UNA vez desde el panel («Vincular ahora») y la sesión queda guardada cifrada para las corridas siguientes.`,
          };
        }
        return { modo: modoReal, ok: false, capturado, captura, error: problema };
      }
      historial.push(`${paso}. ${accion.tipo} ${accion.selector ?? ''} ${accion.valor ?? ''}`.trim());
    }

    if (!terminado && historial.length >= PASOS_MAXIMOS) {
      return { modo: modoReal, ok: false, capturado, captura, error: `El piloto agotó sus ${PASOS_MAXIMOS} pasos sin terminar el formulario. El historial quedó en el log.` };
    }

    // La captura FINAL es la evidencia del ensayo: qué quedó escrito en qué
    // campo. Sin ella, "ok" solo diría que ningún selector reventó.
    captura = await capturaSegura(pagina);
    const llenoAlgo = Object.keys(capturado).length > 0;
    return {
      modo: modoReal,
      ok: llenoAlgo,
      capturado,
      captura,
      ...(llenoAlgo
        ? {}
        : { error: 'El piloto terminó sin llenar un solo campo — eso no es un formulario listo, y se dice.' }),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('piloto.fallo', { comercio: op.comercio.clave, error });
    return { modo: modoReal, ok: false, capturado, captura, error };
  } finally {
    await pagina.cerrar?.().catch(() => undefined);
  }
}

function tieneInventario(p: PaginaPortal): p is PaginaConInventario {
  return typeof (p as PaginaConInventario).inventario === 'function';
}

/** La captura nunca tumba el vuelo: es evidencia, no requisito. */
async function capturaSegura(p: PaginaPortal): Promise<string | undefined> {
  try {
    return await p.captura();
  } catch {
    return undefined;
  }
}

/**
 * Ejecuta UNA acción. Devuelve `null` si salió, o el problema en palabras.
 *
 * Aquí viven las guardas 1, 3 y 4: el veto al botón que emite, la sustitución
 * local de la credencial y el rechazo del selector que no está en el
 * inventario.
 */
async function ejecutar(
  pagina: PaginaConInventario,
  op: OpcionesPiloto,
  a: AccionPiloto,
  modo: ModoAgente,
  capturado: Record<string, string>,
  inv: InventarioPagina,
): Promise<string | null> {
  if (!a.selector) return `La acción ${a.tipo} vino sin selector.`;

  // Regla 4: el selector tiene que nombrar algo que el inventario haya visto.
  // No se exige igualdad literal —el modelo arma `#id` o `[name="…"]`— sino
  // que el id o el name que usa EXISTAN en la página.
  if (!selectorDelInventario(a.selector, inv)) {
    return `El selector ${a.selector} no corresponde a ningún campo o botón del inventario de la página. Un selector inventado no se ejecuta.`;
  }

  if (a.tipo === 'clic') {
    // Regla 1, con las dos guardas. La del texto mira el inventario: qué botón
    // casa con ese selector y qué dice encima.
    const boton = inv.botones.find((b) => (b.id && a.selector!.includes(b.id)) || (b.name && a.selector!.includes(b.name)));
    if (a.esBotonQueEmite || HUELE_A_EMITIR.test(boton?.texto ?? '') || HUELE_A_EMITIR.test(a.selector)) {
      logger.info('piloto.detenido_antes_de_emitir', { comercio: op.comercio.clave, selector: a.selector, boton: boton?.texto, modo });
      return 'detenido_antes_de_emitir';
    }
    await pagina.hacerClic(a.selector);
    return null;
  }

  if (a.valor === null || a.valor === '') return `La acción ${a.tipo} en ${a.selector} vino sin valor.`;

  // REGLA 3, LA GUARDA DURA. Un campo `type="password"` no se escribe NUNCA
  // DESDE AQUÍ, venga el valor de donde venga. La guarda vive en
  // `vinculo_senales.ts` (una sola copia, probable sin navegador) y admite UNA
  // puerta —`permitirCampoPassword`— que este camino NO pasa y no puede pasar:
  // el piloto factura tickets, y facturar dejó de tener acceso al cofre en el
  // #146. Quien la pasa es `reconectarPortal`, que corre aparte, a lo sumo una
  // vez por caducidad y solo con el consentimiento escrito de la flota.
  if (!escrituraPermitida(a.selector, inv)) {
    logger.warn('piloto.contrasena_rechazada', { comercio: op.comercio.clave, selector: a.selector, modo });
    return CONTRASENA_NO;
  }

  if (a.tipo === 'seleccionar') {
    if (typeof pagina.seleccionar === 'function') await pagina.seleccionar(a.selector, a.valor);
    else await pagina.escribir(a.selector, a.valor);
  } else {
    await pagina.escribir(a.selector, a.valor);
  }
  capturado[a.selector] = a.valor;
  return null;
}

/** El código que `volar` reconoce para el rechazo de la regla 3. */
const CONTRASENA_NO = 'contrasena_no_se_teclea';

/** ¿El selector usa un id/name que la página de verdad tiene? */
function selectorDelInventario(selector: string, inv: InventarioPagina): boolean {
  const señas = [
    ...inv.campos.flatMap((c) => [c.id, c.name]),
    ...inv.botones.flatMap((b) => [b.id, b.name]),
  ].filter(Boolean);
  return señas.some((s) => selector.includes(s));
}

/** Una llamada de visión: pantalla + inventario → la siguiente acción. */
async function decidir(
  op: OpcionesPiloto,
  campos: CampoListo[],
  inv: InventarioPagina,
  captura: string | undefined,
  historial: string[],
  paso: number,
): Promise<AccionPiloto> {
  const datosTicket = campos
    .map((c) => `· ${c.etiqueta}${c.requerido ? ' (requerido)' : ''}: ${c.valor ?? '(sin leer)'}`)
    .join('\n');
  const r = op.receptor;

  const system = [
    `Eres el piloto que llena el portal de facturación de ${op.comercio.nombre} (${op.comercio.portal}) para emitir el CFDI de un ticket. Decides UNA acción por paso, en JSON, y nada más.`,
    '',
    'REGLAS, en orden de importancia:',
    '1. NUNCA aprietes un botón que emita/genere/timbre la factura. Cuando el formulario esté completo y solo falte ese botón, marca el clic con esBotonQueEmite=true (el sistema se detiene ahí y una persona revisa la pantalla). Si no queda nada más que hacer, tipo=terminado.',
    '2. Si ves un CAPTCHA (reCAPTCHA, hCaptcha, Turnstile, una imagen con letras), hayCaptcha=true. No intentes resolverlo.',
    '3. El selector lo armas SOLO con los id/name que trae el inventario: `#id` o `[name="…"]`. Si lo que necesitas no está en el inventario, tipo=no_puedo con el motivo.',
    '4. NUNCA escribas un usuario ni una contraseña, ni inventados ni de ningún lado: el inicio de sesión de este portal lo hace una persona, no tú. Si la pantalla pide entrar, tipo=no_puedo con motivo "pide iniciar sesión". El sistema rechaza cualquier escritura en un campo de contraseña aunque la pidas.',
    '5. Llena únicamente con los datos de abajo. Un dato que no tengas NO se inventa: tipo=no_puedo y el motivo dice qué falta.',
    '6. No te registres, no des de alta cuentas nuevas, no cambies datos de la cuenta: solo facturar el ticket.',
    '',
    'DATOS DEL RECEPTOR (la empresa a la que se factura):',
    `· RFC: ${r.rfc}`,
    `· Razón social: ${r.nombre}`,
    `· Código postal: ${r.codigoPostal}`,
    `· Régimen fiscal (clave SAT): ${r.regimenFiscal}`,
    `· Uso CFDI: ${r.usoCfdi}`,
    `· Correo para recibir el CFDI: ${r.correo}`,
    '',
    'DATOS DEL TICKET (lo que el portal pide de la compra):',
    datosTicket || '· (este portal no pide campos del ticket)',
    '',
    op.arrancoConSesion
      ? 'ESTE NAVEGADOR YA TRAE LA SESIÓN que una persona inició en este portal: deberías estar DENTRO. Si aun así ves la pantalla de entrar, tipo=no_puedo con motivo "la sesión caducó".'
      : 'ESTE NAVEGADOR NO TIENE SESIÓN en este portal. Si para facturar hay que entrar, tipo=no_puedo con motivo "pide iniciar sesión".',
  ].join('\n');

  const usuario = [
    `Paso ${paso} de ${PASOS_MAXIMOS}.`,
    historial.length ? `Lo ya hecho:\n${historial.join('\n')}` : 'Todavía no se ha hecho nada.',
    '',
    `Inventario de la página (${inv.url} — «${inv.titulo}»):`,
    JSON.stringify({ campos: inv.campos.filter((c) => c.visible || c.type === 'hidden'), botones: inv.botones.filter((b) => b.visible) }),
    '',
    `Texto visible:\n${inv.texto}`,
    '',
    'La captura de pantalla va adjunta. ¿Cuál es la siguiente acción?',
  ].join('\n');

  const { data } = await generateStructured<AccionPiloto>({
    role: 'piloto',
    system,
    messages: [{ role: 'user', content: usuario }],
    schema: Accion,
    schemaName: 'accion_piloto',
    images: captura?.startsWith('data:') ? [captura] : captura ? [await comoDataUri(captura)] : undefined,
    maxTokens: 700,
    temperature: 0,
    budget: op.tenantId ? createLlmBudget(op.tenantId, randomUUID(), 'ocr_lote') : undefined,
  });
  return data;
}

/** En la Mac la captura es una RUTA en disco; el modelo necesita el data-uri. */
async function comoDataUri(ruta: string): Promise<string> {
  const buf = await readFile(ruta);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
