// ═══════════════════════════════════════════════════════════════════════════
// LOS CORREOS DE ACCESO — los únicos que quedaban fuera de la marca.
//
// Hasta el 18-ago-2026 el correo más importante del producto —el que abre la
// sesión— lo redactaba Supabase con su plantilla de fábrica: en inglés, sin
// logo, sin pie, con un "Sign in" azul de navegador y un "expires shortly" que
// no dice cuándo. El resto del correo transaccional (avisos, invitaciones,
// pruebas) ya salía por `plantilla.ts` con el wordmark incrustado y el pie
// obligatorio. O sea: el primer correo que ve un contralor de flota era el
// único que no parecía Likida.
//
// Este módulo redacta esos correos con la MISMA plantilla que todo lo demás.
// Quien los manda es el hook `POST /api/auth/correo` (Send Email Hook de
// Supabase Auth), que le quita el envío a Supabase y lo pasa por Resend.
//
// ── LO QUE AQUÍ SE DECIDE, Y POR QUÉ ─────────────────────────────────────
//
//  1. **La liga se arma aquí, no se recibe.** El hook recibe un `token_hash`,
//     no una URL. La URL de verificación se construye contra el proyecto de
//     Supabase; el `redirect_to` que viene en el payload se pasa por una lista
//     de permitidos ANTES de meterlo en la liga. Sin ese filtro, quien lograra
//     que Supabase emitiera un magic link con `redirect_to` ajeno tendría un
//     correo NUESTRO, con nuestro remitente y nuestro logo, llevando a un sitio
//     suyo con un token válido: el peor phishing posible es el que firma la
//     víctima.
//  2. **Nunca se muestra un código que no se pueda teclear en ningún lado.**
//     Supabase manda también un OTP de 6 dígitos, y hoy `/login` no tiene
//     dónde capturarlo: pintarlo sería un callejón sin salida con aire de
//     instrucción. El único correo que lo lleva es el de reautenticación, que
//     por diseño de Supabase NO trae liga — ahí el código es el mecanismo.
//  3. **La liga va también en texto.** Ver `enlaceLiteral` en `plantilla.ts`:
//     los escaneadores de correo corporativo reescriben (y a veces visitan)
//     el href, y un enlace de un solo uso ya visitado deja fuera al humano.
//  4. **Se responde por TODAS las acciones**, incluso las que la app no
//     dispara hoy (alta, recuperación, invitación, cambio de correo). Con el
//     hook encendido, Supabase deja de mandar por su cuenta: una acción sin
//     redactar aquí no llegaría con la plantilla fea — no llegaría.
// ═══════════════════════════════════════════════════════════════════════════
import type { Correo } from './plantilla';

/**
 * Las acciones que Supabase Auth manda por correo (`email_action_type`).
 *
 * `magiclink` Y `login` son la MISMA acción con dos nombres, y aquí están las
 * dos a propósito. Medido en producción el 18-ago-2026: el hook recibió
 * `"magiclink"` — el nombre de GoTrue de toda la vida—, no `"login"`, que es
 * como aparece en parte de la documentación. Aceptar uno solo costó el
 * incidente que dejó esta línea escrita: el endpoint contestaba 400, Supabase
 * traducía a 500 y NADIE PODÍA ENTRAR, con el error apareciendo del lado de
 * Supabase, lejos de la causa.
 */
export type AccionAuth =
  | 'magiclink'
  | 'login'
  | 'signup'
  | 'invite'
  | 'recovery'
  | 'email_change'
  | 'email_change_current'
  | 'email_change_new'
  | 'reauthentication';

/**
 * El `type` que entiende `/auth/v1/verify` NO es el mismo string que llega en
 * el payload: el hook manda `login` para el magic link y separa el cambio de
 * correo en dos mitades, mientras que el verificador espera `magiclink` y un
 * solo `email_change`. Traducir mal aquí produce un enlace que abre y falla,
 * que es el fallo más caro de depurar porque parece un problema de sesión.
 */
const TIPO_VERIFY: Record<AccionAuth, string> = {
  magiclink: 'magiclink',
  login: 'magiclink',
  signup: 'signup',
  invite: 'invite',
  recovery: 'recovery',
  email_change: 'email_change',
  email_change_current: 'email_change',
  email_change_new: 'email_change',
  reauthentication: 'reauthentication',
};

/**
 * Cuánto dura el enlace, en minutos.
 *
 * NO es un número inventado ni una promesa nuestra: es el `mailer_otp_exp` del
 * proyecto de Supabase (Auth → Emails → Email OTP Expiration), cuyo default de
 * fábrica son 3600 s. El hook no lo recibe en el payload, así que se declara
 * aquí y se puede pisar con `AUTH_CORREO_CADUCIDAD_MIN` si el proyecto lo
 * cambia. El runbook (`docs/correo-de-acceso.md`) manda cotejar los dos.
 *
 * Decir "caduca pronto" —lo que decía la plantilla de fábrica— es lo que se
 * está corrigiendo: quien recibe un enlace no sabe si correr o si puede
 * terminar la llamada primero.
 */
export function minutosDeCaducidad(): number {
  const crudo = process.env.AUTH_CORREO_CADUCIDAD_MIN;
  const n = crudo ? Number(crudo) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 24 * 60 ? Math.round(n) : 60;
}

/** "60 minutos", "1 hora", "24 horas" — el mismo dato, dicho como lo diría una
 *  persona. Un "caduca en 1440 minutos" se lee como error de programación. */
export function caducidadEnPalabras(minutos: number): string {
  if (minutos < 60) return `${minutos} minutos`;
  const horas = minutos / 60;
  if (!Number.isInteger(horas)) return `${minutos} minutos`;
  return horas === 1 ? '1 hora' : `${horas} horas`;
}

/**
 * A dónde puede apuntar el `redirect_to` de la liga.
 *
 * Solo el propio dominio de la app. Un `redirect_to` ajeno convierte nuestro
 * correo en el vehículo perfecto de un robo de sesión: el token es válido, el
 * remitente es nuestro y el logo también. Cuando no cuadra, NO se rechaza el
 * correo —dejaríamos a alguien sin poder entrar por un parámetro— sino que se
 * cae al destino de siempre, `/auth/callback`.
 */
export function destinoPermitido(redirectTo: string | undefined, base: string): string {
  const suelo = `${base.replace(/\/+$/, '')}/auth/callback`;
  if (!redirectTo) return suelo;
  try {
    const destino = new URL(redirectTo);
    const propio = new URL(base);
    // Se compara ORIGEN completo (esquema + host + puerto). Comparar solo el
    // host dejaría pasar `http://` en producción; comparar por `startsWith`
    // dejaría pasar `https://app.likida.ai.evil.com`.
    return destino.origin === propio.origin ? destino.toString() : suelo;
  } catch {
    return suelo;
  }
}

/**
 * ¿Está puesto el secreto del hook?
 *
 * Lo que esto prueba y lo que NO: prueba que el endpoint puede verificar una
 * firma. NO prueba que el hook esté encendido en Supabase — eso vive en su
 * panel y no hay forma de medirlo desde aquí sin la Management API. El rótulo
 * de la consola dice exactamente eso y no "conectado": el verde de adorno es
 * un bug catalogado en este repo (salud-sistema, D3).
 *
 * La combinación cara es la inversa —hook encendido allá, secreto ausente
 * aquí—: el endpoint contesta 500 y NADIE puede entrar. Por eso la consola lo
 * pinta en ámbar en vez de callarse.
 */
export function hookDeCorreoConfigurado(): boolean {
  return Boolean(process.env.SUPABASE_AUTH_HOOK_SECRET);
}

export interface DatosLiga {
  /** La URL del proyecto de Supabase (`NEXT_PUBLIC_SUPABASE_URL`). */
  supabaseUrl: string;
  tokenHash: string;
  accion: AccionAuth;
  /** El `redirect_to` tal como llegó en el payload. Se filtra aquí dentro. */
  redirectTo?: string;
  /** El dominio de la app, para la lista de permitidos. */
  base: string;
}

/** La URL que abre la sesión: el verificador de Supabase, con el hash del
 *  token y el destino ya filtrado. */
export function urlDeVerificacion(d: DatosLiga): string {
  const verify = new URL('/auth/v1/verify', d.supabaseUrl);
  verify.searchParams.set('token', d.tokenHash);
  verify.searchParams.set('type', TIPO_VERIFY[d.accion]);
  verify.searchParams.set('redirect_to', destinoPermitido(d.redirectTo, d.base));
  return verify.toString();
}

export interface DatosCorreoAuth {
  accion: AccionAuth;
  /** La liga ya armada por `urlDeVerificacion`. Vacía en reautenticación. */
  liga: string;
  /** El OTP de 6 dígitos. Solo se pinta en reautenticación (ver cabecera). */
  codigo: string;
  minutos: number;
  /** El correo NUEVO, en un cambio de dirección. Se muestra para que la
   *  persona vea a dónde se está mudando su cuenta antes de aprobarlo. */
  correoNuevo?: string;
}

const PORQUE = 'Recibes este correo porque alguien pidió este acceso a Likida con esta dirección.';

/** La línea que hace inofensivo un correo que no pediste. Va en TODOS: es la
 *  única defensa real contra el phishing que imita esta misma plantilla. */
const NO_FUISTE_TU =
  'Si no fuiste tú, ignora este correo: sin abrir el enlace nadie entra. Likida jamás te va a pedir este enlace ni un código por WhatsApp, por teléfono ni por correo.';

/**
 * Redacta el correo de una acción de Auth.
 *
 * Devuelve el `Correo` de `plantilla.ts` —no HTML— para que el resultado se
 * pueda probar por sus partes y para que el logo, el pie y el escapado sigan
 * viviendo en un solo lugar.
 */
export function correoDeAuth(d: DatosCorreoAuth): Correo {
  const dura = caducidadEnPalabras(d.minutos);
  const base: Pick<Correo, 'porQueLoRecibes' | 'nota' | 'enlaceLiteral'> = {
    porQueLoRecibes: PORQUE,
    nota: NO_FUISTE_TU,
    enlaceLiteral: true,
  };

  switch (d.accion) {
    case 'magiclink':
    case 'login':
      return {
        ...base,
        asunto: 'Tu acceso a Likida',
        avance: `Entra sin contraseña. El enlace sirve una vez y caduca en ${dura}.`,
        titulo: 'Entra a Likida',
        parrafos: [
          'Likida no usa contraseña: este enlace es la llave. Ábrelo desde el mismo dispositivo donde quieres trabajar.',
          `Sirve UNA sola vez y caduca en ${dura}. Si se te pasa, pide otro desde la pantalla de inicio de sesión.`,
        ],
        boton: { texto: 'Entrar a Likida', href: d.liga },
      };

    case 'signup':
      return {
        ...base,
        asunto: 'Confirma tu correo — Likida',
        avance: `Un clic para confirmar tu dirección. Caduca en ${dura}.`,
        titulo: 'Confirma tu correo',
        parrafos: [
          'Falta un paso para dejar lista tu cuenta: confirmar que esta dirección es tuya.',
          `El enlace sirve una sola vez y caduca en ${dura}.`,
        ],
        boton: { texto: 'Confirmar mi correo', href: d.liga },
      };

    case 'invite':
      return {
        ...base,
        asunto: 'Te dieron acceso a Likida',
        avance: `Tu cuenta ya existe. Entra con este enlace — caduca en ${dura}.`,
        titulo: 'Ya tienes acceso a Likida',
        parrafos: [
          'Alguien de tu empresa te dio de alta en Likida, donde se liquidan los viajes de la flota. Tu cuenta ya existe: solo falta que entres la primera vez.',
          `El enlace sirve una sola vez y caduca en ${dura}.`,
        ],
        boton: { texto: 'Entrar por primera vez', href: d.liga },
        porQueLoRecibes: 'Recibes este correo porque te dieron de alta como usuario de Likida.',
      };

    case 'recovery':
      return {
        ...base,
        asunto: 'Recupera tu acceso a Likida',
        avance: `Vuelve a entrar con este enlace. Caduca en ${dura}.`,
        titulo: 'Recupera tu acceso',
        parrafos: [
          'Pediste volver a entrar a Likida. Este enlace abre tu sesión directo, sin contraseña.',
          `Sirve una sola vez y caduca en ${dura}.`,
        ],
        boton: { texto: 'Recuperar mi acceso', href: d.liga },
      };

    case 'email_change':
    case 'email_change_current':
    case 'email_change_new': {
      const destino = d.correoNuevo
        ? `Tu cuenta de Likida quedaría a nombre de ${d.correoNuevo}.`
        : 'Tu cuenta de Likida quedaría a nombre de la dirección nueva.';
      return {
        ...base,
        asunto: 'Confirma el cambio de tu correo — Likida',
        avance: `Aprueba el cambio de dirección. Caduca en ${dura}.`,
        titulo: 'Confirma el cambio de correo',
        parrafos: [
          `Se pidió cambiar la dirección de correo de tu cuenta. ${destino}`,
          `Confirma solo si fuiste tú: a partir de ahí, los accesos y los avisos llegan a la dirección nueva. El enlace caduca en ${dura}.`,
        ],
        boton: { texto: 'Confirmar el cambio', href: d.liga },
        tono: 'atencion',
        nota: 'Si no pediste este cambio, NO abras el enlace y escríbenos: alguien con acceso a tu sesión está intentando mudar tu cuenta.',
      };
    }

    case 'reauthentication':
      return {
        // Sin liga: Supabase no manda una para esta acción, y por eso es el
        // único correo donde el código ES el mecanismo y no un adorno.
        asunto: 'Tu código de confirmación — Likida',
        avance: 'Confirma que eres tú con este código de un solo uso.',
        titulo: 'Confirma que eres tú',
        parrafos: [
          'Estás por hacer un cambio sensible en tu cuenta. Teclea este código en la pantalla que lo está pidiendo.',
          `Sirve una sola vez y caduca en ${dura}.`,
        ],
        codigo: d.codigo,
        nota: 'Si no estabas haciendo ningún cambio, no teclees el código en ningún lado y avísanos: alguien más está dentro de tu sesión.',
        porQueLoRecibes: PORQUE,
      };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS AVISOS DE SEGURIDAD — las siete plantillas que nadie mira hasta que
// importan.
//
// Supabase manda un correo cada vez que algo toca el ACCESO de una cuenta:
// se ligó un método de entrada, se quitó un segundo factor, cambió la
// dirección. Se descubrieron el 18-ago-2026 leyendo la configuración del
// proyecto por la Management API: seguían en inglés y con el HTML de fábrica,
// porque no aparecen en la lista de plantillas que uno espera.
//
// Cuáles pueden dispararse HOY en Likida: el cambio de correo, el alta y baja
// de segundo factor (`lib/auth/mfa.ts`) y el ligado de una identidad de
// Google. Las de contraseña y teléfono no deberían dispararse nunca —Likida
// entra por enlace, sin contraseña—, y por eso su texto NO finge que sí:
// dicen lo que significaría verlas, que es que alguien le puso una contraseña
// a una cuenta que no debería tenerla.
//
// No llevan botón ni código: no hay nada que confirmar. Llevan los datos del
// cambio y la línea de qué hacer si no fuiste tú. Y NO se pueden desactivar,
// lo cual se dice en el pie: un aviso de seguridad silenciable no es un aviso.
// ═══════════════════════════════════════════════════════════════════════════

export type AvisoAuth =
  | 'email_changed'
  | 'password_changed'
  | 'phone_changed'
  | 'mfa_enrolled'
  | 'mfa_unenrolled'
  | 'identity_linked'
  | 'identity_unlinked';

/** Qué hacer si el cambio no fue tuyo. Sin dirección de soporte inventada:
 *  Likida no tiene una hoy, y mandar a un buzón que nadie lee es peor que
 *  mandar a la persona que sí puede quitar el acceso. */
const NO_FUISTE_TU_AVISO =
  'Si no fuiste tú, alguien más está dentro de tu cuenta: entra a Likida, quítale el acceso a ese método y avísale de inmediato a quien administra la cuenta de tu empresa.';

const PORQUE_AVISO =
  'Recibes este correo porque cambió algo en el acceso a tu cuenta de Likida. Estos avisos no se pueden desactivar: son la única señal de que alguien tocó tu entrada.';

/**
 * Redacta un aviso de seguridad de Auth.
 *
 * Los valores llevan las variables Go de Supabase tal cual (`{{ .Provider }}`)
 * porque estas plantillas las rellena SU motor, no el nuestro. Pasan intactas
 * por `esc()` —no traen `<`, `&` ni comillas—, así que no hace falta ningún
 * sentinela como en las plantillas con liga.
 */
export function correoDeAvisoAuth(tipo: AvisoAuth): Correo {
  const base = { porQueLoRecibes: PORQUE_AVISO, nota: NO_FUISTE_TU_AVISO };

  switch (tipo) {
    case 'email_changed':
      return {
        ...base,
        asunto: 'Cambió el correo de tu cuenta — Likida',
        avance: 'Los accesos y los avisos ahora llegan a la dirección nueva.',
        titulo: 'Cambió el correo de tu cuenta',
        parrafos: ['La dirección de tu cuenta de Likida se cambió. A partir de ahora, los enlaces de acceso y los avisos llegan a la nueva.'],
        datos: [['Antes', '{{ .OldEmail }}'], ['Ahora', '{{ .Email }}']],
        tono: 'atencion',
      };

    case 'password_changed':
      return {
        ...base,
        asunto: 'Se puso una contraseña en tu cuenta — Likida',
        avance: 'Likida entra por enlace, sin contraseña. Esto no debería pasar.',
        titulo: 'Se registró una contraseña en tu cuenta',
        parrafos: [
          'Likida no usa contraseña: se entra con el enlace de acceso que llega a tu correo.',
          'Que este aviso exista significa que alguien le puso una contraseña a tu cuenta. Revísalo.',
        ],
        tono: 'urgente',
      };

    case 'phone_changed':
      return {
        ...base,
        asunto: 'Cambió el teléfono de tu cuenta — Likida',
        avance: 'El teléfono ligado a tu cuenta ya no es el mismo.',
        titulo: 'Cambió el teléfono de tu cuenta',
        parrafos: ['El número ligado a tu cuenta de Likida se cambió.'],
        datos: [['Antes', '{{ .OldPhone }}'], ['Ahora', '{{ .Phone }}']],
        tono: 'atencion',
      };

    case 'mfa_enrolled':
      return {
        ...base,
        asunto: 'Agregaste un segundo factor — Likida',
        avance: 'Tu cuenta ahora pide un paso más para entrar.',
        titulo: 'Se agregó un segundo factor a tu cuenta',
        parrafos: ['A partir de ahora, entrar a Likida pide este paso extra además del enlace de acceso.'],
        datos: [['Método', '{{ .FactorType }}']],
      };

    case 'mfa_unenrolled':
      return {
        ...base,
        asunto: 'Se quitó un segundo factor — Likida',
        avance: 'Tu cuenta quedó con un candado menos.',
        titulo: 'Se quitó un segundo factor de tu cuenta',
        parrafos: ['Tu cuenta de Likida quedó con un candado menos: ya no pide este paso extra para entrar.'],
        datos: [['Método', '{{ .FactorType }}']],
        tono: 'atencion',
      };

    case 'identity_linked':
      return {
        ...base,
        asunto: 'Nueva forma de entrar a tu cuenta — Likida',
        avance: 'Se ligó un método de acceso a tu cuenta.',
        titulo: 'Se ligó una nueva forma de entrar',
        parrafos: ['Ahora también se puede entrar a tu cuenta de Likida con este método.'],
        datos: [['Método', '{{ .Provider }}'], ['Cuenta', '{{ .Email }}']],
      };

    case 'identity_unlinked':
      return {
        ...base,
        asunto: 'Se quitó una forma de entrar — Likida',
        avance: 'Ese método ya no sirve para entrar a tu cuenta.',
        titulo: 'Se quitó una forma de entrar',
        parrafos: ['Ese método ya no sirve para entrar a tu cuenta de Likida.'],
        datos: [['Método', '{{ .Provider }}'], ['Cuenta', '{{ .Email }}']],
        tono: 'atencion',
      };
  }
}
