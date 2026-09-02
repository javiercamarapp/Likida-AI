import type { CampoInventariado, InventarioPagina } from './adaptadores/playwright_base';

// ════════════════════════════════════════════════════════════════════════════
// LOS CORTES DUROS DEL RE-LOGIN — dónde se para la máquina y empieza la
// persona. Puro: sin base, sin navegador, sin modelo.
//
// El re-login automático (`relogin.ts`) existe para quitarle a la flota el
// toque humano de «se cayó la sesión, vuelve a entrar». Lo que NO hace es
// convertirse en un intento de entrar a cualquier precio: hay cinco muros que
// una máquina no debe pasar, y este archivo los reconoce ANTES y DESPUÉS de
// escribir para que la corrida se detenga con el motivo exacto en vez de
// insistir.
//
// ── POR QUÉ VIVE APARTE ──────────────────────────────────────────────────
//
// Por lo mismo que `vinculo_senales.ts`: quien decide si hay un CAPTCHA no
// necesita Chromium ni Supabase para decidirlo, y si viviera junto al
// repositorio cada prueba de un corte arrastraría el cliente de la base.
// Aquí no se actúa: se lee lo que la página enseña y se dice qué significa.
//
// ── LOS CINCO MUROS, Y EL PORQUÉ DE CADA UNO ─────────────────────────────
//
//   1. CAPTCHA. NO SE RESUELVE NI SE RODEA. Nunca, ni con un servicio de
//      terceros, ni con visión, ni «probando a ver». Dos razones y las dos
//      son del cliente: (a) un reCAPTCHA es la declaración explícita del
//      portal de que ese acceso es para personas, y rodearlo es operar contra
//      sus términos con la cuenta del cliente; (b) la cuenta que el portal
//      suspende NO es la de Likida, es la de la flota, y con ella se le cae
//      la facturación del mes. Es la misma regla de `piloto_vision.ts` y no
//      se relaja porque ahora haya contraseña disponible — al contrario:
//      tener con qué insistir es exactamente cuando hace falta el candado.
//   2. SEGUNDO FACTOR. El código llega al teléfono o al correo de una
//      persona. No hay nada que la máquina pueda hacer salvo esperar a que
//      esa persona lo teclee, y esperar con un navegador abierto no es
//      esperar: es un intento fallido que cuenta contra la cuenta.
//   3. PREGUNTA DE SEGURIDAD. La respuesta no está en el cofre y NO se
//      adivina: adivinar mal es la vía rápida al bloqueo.
//   4. CAMBIO DE CONTRASEÑA OBLIGATORIO. Cambiar la contraseña de la cuenta
//      de un cliente es un acto que solo el cliente puede autorizar, y además
//      dejaría el cofre desincronizado con el portal — el peor final posible
//      para un automatismo pensado para ahorrar trabajo.
//   5. CUENTA BLOQUEADA. Insistir sobre una cuenta ya bloqueada alarga el
//      bloqueo. Se para y se avisa.
//
// El SEXTO caso —«credenciales inválidas»— NO vive con los cinco y tiene su
// propia función: solo se puede leer DESPUÉS de enviar el formulario, y
// mirarlo antes convertiría el mensaje que dejó un intento humano fallido en
// un candado que nadie pidió.
// ════════════════════════════════════════════════════════════════════════════

/** El catálogo CERRADO de cortes. El mismo dominio que el CHECK de la 0233. */
export type ClaseDeCorte =
  | 'captcha'
  | 'segundo_factor'
  | 'pregunta_seguridad'
  | 'cambio_contrasena'
  | 'cuenta_bloqueada'
  | 'credencial_invalida';

export interface CorteDeRelogin {
  clase: ClaseDeCorte;
  /** Qué se vio, en español. Va a la pantalla y al aviso. Nunca un secreto. */
  motivo: string;
}

// ── Las señales, en el orden en que se miran ───────────────────────────────

/** Marcas de CAPTCHA en `src`/`class` de iframes y divs, o en id/name/texto. */
const MARCA_CAPTCHA = /recaptcha|hcaptcha|h-captcha|turnstile|cf-chl|captcha/i;

/**
 * Segundo factor. Se escribe con las palabras que estos portales usan de
 * verdad —«código de verificación», «te enviamos un código»— y con las
 * inglesas de las plantillas compradas. Un `token` a secas NO cuenta: medio
 * formulario ASP.NET trae un `__RequestVerificationToken` oculto y contarlo
 * detendría todos los re-logins del mundo por un campo antifalsificación.
 */
const MARCA_2FA =
  /c(ó|o)digo de (verificaci(ó|o)n|seguridad|acceso|confirmaci(ó|o)n)|c(ó|o)digo que (te |le )?(enviamos|mandamos)|(te|le) (enviamos|mandamos|hemos enviado) un c(ó|o)digo|verificaci(ó|o)n en dos pasos|autenticaci(ó|o)n (en dos pasos|de dos factores)|segundo factor|doble factor|two[-\s]?factor|verification code|one[-\s]?time (code|password)|\botp\b/i;

/** El campo de un segundo factor, por su seña. Sin `token` suelto, ver arriba. */
const CAMPO_2FA = /^(otp|mfa|2fa|totp|codigo|c(ó|o)digo|verificationcode|codigoverificacion|smscode|authcode)/i;

const MARCA_PREGUNTA = /pregunta (de seguridad|secreta)|respuesta secreta|security question/i;

/**
 * Cambio de contraseña obligatorio. Además del texto, la FORMA lo delata: dos
 * campos `password` visibles en la misma pantalla son «nueva» y «confírmala»,
 * no un login (un login tiene uno). Esa señal es la que caza a los portales
 * que ponen la pantalla en inglés o sin texto explicativo.
 */
//
// Los cuantificadores van ACOTADOS (`{1,3}`, `{0,40}`) y no con `+`/`*`
// abiertos. No es estilo: estas expresiones corren sobre texto que viene de un
// portal ajeno —hasta 1800 caracteres de `inv.texto`— y un `\s*` seguido de un
// grupo opcional es la receta del retroceso catastrófico. Un re-login que se
// cuelga analizando la pantalla de error de un portal es peor que uno que no
// detecta el corte: el primero se lleva el presupuesto de tiempo del lote.
const MARCA_CAMBIO_CONTRASENA =
  /(debes?|tienes?|necesitas?|hay que)[^.\n]{0,20}(cambiar|actualizar|restablecer)[^.\n]{0,12}contrase(ñ|n)a|contrase(ñ|n)a[^.\n]{0,12}(expir|caduc|venc)(ó|o|ada|ado|ida|ido)|cambio de contrase(ñ|n)a (obligatorio|requerido)|nueva contrase(ñ|n)a|confirmar? (la |tu )?(nueva )?contrase(ñ|n)a|must change your password|password (has )?expired|new password/i;

const MARCA_BLOQUEADA =
  /cuenta (bloqueada|suspendida|inhabilitada|deshabilitada|desactivada|cancelada)|(usuario|acceso) (bloqueado|suspendido|inhabilitado)|demasiados intentos|excedi(ó|o|ste) el n(ú|u)mero de intentos|intentos fallidos|account (is )?(locked|blocked|suspended|disabled)|too many (failed )?attempts/i;

/**
 * Credenciales rechazadas. SOLO se mira después de enviar. Deliberadamente
 * estrecho: cada falso positivo aquí apaga el re-login de una flota que sí
 * tenía bien la contraseña, y cada falso negativo la manda a reintentar con
 * una mala. Entre los dos errores, el segundo es el que bloquea la cuenta del
 * cliente — así que ante la duda, se corta.
 */
//
// El `[^.\n]{0,40}` del medio es lo que cubre las mil formas de decirlo
// («usuario o contraseña incorrectos», «el correo y la contraseña no
// coinciden», «los datos de acceso son incorrectos») sin encadenar grupos
// opcionales con `\s*`, que es exactamente lo que hacía a esta expresión
// vulnerable al retroceso catastrófico. Acotado, y sin cuantificador anidado.
const MARCA_INVALIDA =
  /(usuario|contrase(ñ|n)a|credenciales|credencial|datos de acceso|correo)[^.\n]{0,40}(incorrect|inv(á|a)lid|err(ó|o)ne|no coinciden|no son v(á|a)lid)|invalid (username|user|password|credentials|login)|incorrect (username|password)|login (failed|incorrecto|fallido)|authentication failed/i;

/** ¿Algo del inventario —texto, etiquetas, botones— casa con esta señal? */
function enLaPagina(inv: InventarioPagina, re: RegExp): string | null {
  const m = re.exec(inv.texto);
  if (m) return recorte(inv.texto, m.index);
  for (const b of inv.botones) if (b.visible && re.test(b.texto)) return `el botón «${b.texto}»`;
  for (const c of inv.campos) {
    if (!c.visible) continue;
    if (re.test(c.etiqueta)) return `el campo «${c.etiqueta}»`;
    if (re.test(c.placeholder)) return `el campo «${c.placeholder}»`;
  }
  return null;
}

/** El pedazo de texto donde saltó la señal. Corto: acaba en una pantalla. */
function recorte(texto: string, desde: number): string {
  const ini = Math.max(0, desde - 40);
  return `«${texto.slice(ini, desde + 120).replace(/\s+/g, ' ').trim()}»`;
}

/** Los campos de contraseña VISIBLES. Los ocultos no cuentan (ver `pantallaDeLogin`). */
function camposDeContrasena(inv: InventarioPagina): CampoInventariado[] {
  return inv.campos.filter((c) => c.type === 'password' && c.visible);
}

/**
 * ¿Hay un muro que la máquina NO debe pasar? Se llama ANTES de escribir nada
 * y otra vez DESPUÉS de enviar (un portal puede pedir el segundo factor solo
 * después de aceptar la contraseña, que es lo normal).
 *
 * Devuelve el PRIMERO que encuentra, y el orden no es casual: cuenta bloqueada
 * va delante de todo lo demás porque un portal que bloqueó la cuenta suele
 * enseñar también su formulario de login, y llamarle «captcha» a un bloqueo
 * mandaría al contralor a resolver el muro equivocado.
 */
export function corteDuro(inv: InventarioPagina): CorteDeRelogin | null {
  const bloqueada = enLaPagina(inv, MARCA_BLOQUEADA);
  if (bloqueada) {
    return {
      clase: 'cuenta_bloqueada',
      motivo: `El portal dice que la cuenta está bloqueada o que hubo demasiados intentos (${bloqueada}). No se vuelve a intentar: insistir alarga el bloqueo.`,
    };
  }

  // El CAPTCHA se mira en las marcas que el inventario ya extrae (iframes,
  // clases) Y en las señas de campos y botones: algunos portales montan el
  // widget en un `div` con id `g-recaptcha` sin que el `src` del iframe llegue
  // al inventario todavía.
  const marca = inv.captcha.find((s) => MARCA_CAPTCHA.test(s))
    ?? inv.campos.find((c) => MARCA_CAPTCHA.test(c.id) || MARCA_CAPTCHA.test(c.name))?.id
    ?? inv.botones.find((b) => MARCA_CAPTCHA.test(b.id) || MARCA_CAPTCHA.test(b.name))?.id;
  if (marca) {
    return {
      clase: 'captcha',
      motivo: `El portal pide resolver un CAPTCHA (${marca}) para entrar. Likida NO resuelve ni rodea CAPTCHAs — es la cuenta de la flota la que el portal suspende si alguien lo intenta —, así que este login lo abre una persona.`,
    };
  }

  const segundo = enLaPagina(inv, MARCA_2FA)
    ?? (inv.campos.some((c) => c.visible && (CAMPO_2FA.test(c.id) || CAMPO_2FA.test(c.name)))
      ? 'un campo de código de verificación'
      : null);
  if (segundo) {
    return {
      clase: 'segundo_factor',
      motivo: `El portal pide un código de verificación (${segundo}), y ese código llega al teléfono o al correo de una persona. Aquí se detiene.`,
    };
  }

  const pregunta = enLaPagina(inv, MARCA_PREGUNTA);
  if (pregunta) {
    return {
      clase: 'pregunta_seguridad',
      motivo: `El portal pide una pregunta de seguridad (${pregunta}). Esa respuesta no está guardada y NO se adivina: adivinarla mal bloquea la cuenta.`,
    };
  }

  const dosContrasenas = camposDeContrasena(inv).length >= 2;
  const cambio = enLaPagina(inv, MARCA_CAMBIO_CONTRASENA);
  if (dosContrasenas || cambio) {
    return {
      clase: 'cambio_contrasena',
      motivo: dosContrasenas
        ? 'El portal enseña DOS campos de contraseña en la misma pantalla, o sea que está pidiendo cambiarla. Cambiar la contraseña de la cuenta de la flota no lo decide Likida.'
        : `El portal exige cambiar la contraseña antes de entrar (${cambio}). Ese cambio lo hace la flota, no Likida — y hay que volver a guardarla después.`,
    };
  }

  return null;
}

/**
 * ¿El portal RECHAZÓ lo que se tecleó? Solo se llama después de enviar.
 *
 * Es el candado más importante del archivo, y es innegociable: reintentar con
 * una contraseña mala es la forma más rápida de que le bloqueen la cuenta al
 * cliente. Quien recibe esto NO reintenta, marca `credencial_invalida` y
 * avisa; hasta que una persona guarde la contraseña buena, el re-login de ese
 * portal queda detenido.
 */
export function credencialRechazada(inv: InventarioPagina): CorteDeRelogin | null {
  const visto = enLaPagina(inv, MARCA_INVALIDA);
  if (!visto) return null;
  return {
    clase: 'credencial_invalida',
    motivo: `El portal rechazó el usuario o la contraseña guardados (${visto}). NO se vuelve a intentar: reintentar con una contraseña mala es lo que hace que el portal bloquee la cuenta. Hay que guardar la contraseña correcta.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUÉ CAMPOS SE LLENAN — el formulario de entrar, leído del inventario.
//
// No hay mapeo escrito por portal a propósito: son ~37 comercios y escribir 37
// mapeos de login exige 37 pre-vuelos. Un formulario de login, en cambio, es
// la pantalla más estandarizada de la web — un campo de contraseña y el campo
// de texto que lo acompaña — y eso SÍ se puede leer.
//
// La contraseña se identifica por `type="password"`, que es lo único que no
// miente. El usuario, por el campo de texto VISIBLE que está antes de ella; si
// hay varios, gana el que se llame como un usuario. Si no se encuentran los
// dos, NO se inventa: se corta con `sin_campos` y entra una persona.
// ═══════════════════════════════════════════════════════════════════════════

const SENA_USUARIO = /usuario|user|login|correo|email|mail|rfc|cuenta|account|identificador/i;

export interface CamposDeEntrada {
  /** Selector del campo de usuario, armado con id o name REALES. */
  usuario: string;
  /** Selector del campo de contraseña. */
  contrasena: string;
  /** El botón de enviar, si la página lo declara. `null` = se manda con Enter. */
  boton: string | null;
}

/** `#id` si lo hay, `[name="…"]` si no, `null` si el campo no tiene ni uno. */
function selectorDe(c: { id: string; name: string }): string | null {
  if (c.id) return `#${c.id}`;
  if (c.name) return `[name="${c.name}"]`;
  return null;
}

/**
 * Los dos campos del login y su botón, leídos de la página. `null` si no se
 * pueden identificar los dos con certeza — y ahí el re-login se detiene en vez
 * de escribir a ciegas en un formulario que no entendió.
 */
export function camposDeEntrada(inv: InventarioPagina): CamposDeEntrada | null {
  const pass = camposDeContrasena(inv)[0];
  if (!pass) return null;
  const selPass = selectorDe(pass);
  if (!selPass) return null;

  const candidatos = inv.campos.filter(
    (c) => c.visible && c.tag === 'input' && ['', 'text', 'email', 'tel'].includes(c.type) && selectorDe(c) !== null,
  );
  if (candidatos.length === 0) return null;

  // Primero el que se NOMBRA como usuario; si ninguno, el último campo de
  // texto antes de la contraseña, que es donde vive en un formulario normal.
  const porNombre = candidatos.find(
    (c) => SENA_USUARIO.test(c.id) || SENA_USUARIO.test(c.name) || SENA_USUARIO.test(c.etiqueta) || SENA_USUARIO.test(c.placeholder),
  );
  const iPass = inv.campos.indexOf(pass);
  const anteriores = candidatos.filter((c) => inv.campos.indexOf(c) < iPass);
  const elegido = porNombre ?? anteriores[anteriores.length - 1];
  if (!elegido) return null;

  const selUsuario = selectorDe(elegido);
  if (!selUsuario) return null;

  const boton = inv.botones.find(
    (b) => b.visible && selectorDe(b) !== null
      && /entrar|iniciar|acceder|ingresar|login|log in|sign in|continuar|aceptar|enviar/i.test(b.texto),
  );

  return { usuario: selUsuario, contrasena: selPass, boton: boton ? selectorDe(boton) : null };
}
