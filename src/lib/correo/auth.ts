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
import { trCorreo, marcoIdioma } from './tr';

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
export function caducidadEnPalabras(minutos: number, idioma?: unknown): string {
  const { t } = trCorreo(idioma);
  if (minutos < 60) return t('au.minutos', { n: minutos });
  const horas = minutos / 60;
  if (!Number.isInteger(horas)) return t('au.minutos', { n: minutos });
  return horas === 1 ? t('au.hora') : t('au.horas', { n: horas });
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
  /** El idioma del destinatario (`user_metadata.idioma`) si se conoce; si no, español. */
  idioma?: unknown;
}

/** La línea que hace inofensivo un correo que no pediste. Va en TODOS: es la
 *  única defensa real contra el phishing que imita esta misma plantilla. */
/**
 * Redacta el correo de una acción de Auth.
 *
 * Devuelve el `Correo` de `plantilla.ts` —no HTML— para que el resultado se
 * pueda probar por sus partes y para que el logo, el pie y el escapado sigan
 * viviendo en un solo lugar.
 */
export function correoDeAuth(d: DatosCorreoAuth): Correo {
  const tr = trCorreo(d.idioma);
  const { t } = tr;
  const dura = caducidadEnPalabras(d.minutos, d.idioma);
  const v = { dura };
  const base: Pick<Correo, 'porQueLoRecibes' | 'nota' | 'enlaceLiteral' | 'idioma'> = {
    porQueLoRecibes: t('au.porque'),
    nota: t('au.nofuiste'),
    enlaceLiteral: true,
    ...marcoIdioma(tr),
  };

  switch (d.accion) {
    case 'magiclink':
    case 'login':
      return {
        ...base,
        asunto: t('au.login.asunto'),
        avance: t('au.login.avance', v),
        titulo: t('au.login.titulo'),
        parrafos: [t('au.login.p1'), t('au.login.p2', v)],
        boton: { texto: t('au.login.boton'), href: d.liga },
      };

    case 'signup':
      return {
        ...base,
        asunto: t('au.signup.asunto'),
        avance: t('au.signup.avance', v),
        titulo: t('au.signup.titulo'),
        parrafos: [t('au.signup.p1'), t('au.signup.p2', v)],
        boton: { texto: t('au.signup.boton'), href: d.liga },
      };

    case 'invite':
      return {
        ...base,
        asunto: t('au.invite.asunto'),
        avance: t('au.invite.avance', v),
        titulo: t('au.invite.titulo'),
        parrafos: [t('au.invite.p1'), t('au.invite.p2', v)],
        boton: { texto: t('au.invite.boton'), href: d.liga },
        porQueLoRecibes: t('au.invite.porque'),
      };

    case 'recovery':
      return {
        ...base,
        asunto: t('au.recovery.asunto'),
        avance: t('au.recovery.avance', v),
        titulo: t('au.recovery.titulo'),
        parrafos: [t('au.recovery.p1'), t('au.recovery.p2', v)],
        boton: { texto: t('au.recovery.boton'), href: d.liga },
      };

    case 'email_change':
    case 'email_change_current':
    case 'email_change_new': {
      const destino = d.correoNuevo ? t('au.cambio.destino', { correo: d.correoNuevo }) : t('au.cambio.destino_nueva');
      return {
        ...base,
        asunto: t('au.cambio.asunto'),
        avance: t('au.cambio.avance', v),
        titulo: t('au.cambio.titulo'),
        parrafos: [t('au.cambio.p1', { destino }), t('au.cambio.p2', v)],
        boton: { texto: t('au.cambio.boton'), href: d.liga },
        tono: 'atencion',
        nota: t('au.cambio.nota'),
      };
    }

    case 'reauthentication':
      return {
        ...marcoIdioma(tr),
        porQueLoRecibes: t('au.porque'),
        // Sin liga: Supabase no manda una para esta acción, y por eso es el
        // único correo donde el código ES el mecanismo y no un adorno.
        asunto: t('au.reauth.asunto'),
        avance: t('au.reauth.avance'),
        titulo: t('au.reauth.titulo'),
        parrafos: [t('au.reauth.p1'), t('au.reauth.p2', v)],
        codigo: d.codigo,
        nota: t('au.reauth.nota'),
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

/**
 * Redacta un aviso de seguridad de Auth. «Qué hacer si el cambio no fue tuyo» no lleva dirección de soporte inventada:
 * Likida no tiene una hoy, y mandar a un buzón que nadie lee es peor que mandar a la persona que sí puede quitar el acceso.
 *
 * Los valores llevan las variables Go de Supabase tal cual (`{{ .Provider }}`)
 * porque estas plantillas las rellena SU motor, no el nuestro. Pasan intactas
 * por `esc()` —no traen `<`, `&` ni comillas—, así que no hace falta ningún
 * sentinela como en las plantillas con liga. El idioma es el del destinatario si se conoce.
 */
export function correoDeAvisoAuth(tipo: AvisoAuth, idioma?: unknown): Correo {
  const tr = trCorreo(idioma);
  const { t } = tr;
  const base = { porQueLoRecibes: t('as.porque'), nota: t('as.nofuiste'), ...marcoIdioma(tr) };
  const antes = t('as.dato.antes');
  const ahora = t('as.dato.ahora');
  const metodo = t('as.dato.metodo');
  const cuenta = t('as.dato.cuenta');

  switch (tipo) {
    case 'email_changed':
      return {
        ...base,
        asunto: t('as.email.asunto'),
        avance: t('as.email.avance'),
        titulo: t('as.email.titulo'),
        parrafos: [t('as.email.p1')],
        datos: [[antes, '{{ .OldEmail }}'], [ahora, '{{ .Email }}']],
        tono: 'atencion',
      };

    case 'password_changed':
      return {
        ...base,
        asunto: t('as.pwd.asunto'),
        avance: t('as.pwd.avance'),
        titulo: t('as.pwd.titulo'),
        parrafos: [t('as.pwd.p1'), t('as.pwd.p2')],
        tono: 'urgente',
      };

    case 'phone_changed':
      return {
        ...base,
        asunto: t('as.tel.asunto'),
        avance: t('as.tel.avance'),
        titulo: t('as.tel.titulo'),
        parrafos: [t('as.tel.p1')],
        datos: [[antes, '{{ .OldPhone }}'], [ahora, '{{ .Phone }}']],
        tono: 'atencion',
      };

    case 'mfa_enrolled':
      return {
        ...base,
        asunto: t('as.mfa_alta.asunto'),
        avance: t('as.mfa_alta.avance'),
        titulo: t('as.mfa_alta.titulo'),
        parrafos: [t('as.mfa_alta.p1')],
        datos: [[metodo, '{{ .FactorType }}']],
      };

    case 'mfa_unenrolled':
      return {
        ...base,
        asunto: t('as.mfa_baja.asunto'),
        avance: t('as.mfa_baja.avance'),
        titulo: t('as.mfa_baja.titulo'),
        parrafos: [t('as.mfa_baja.p1')],
        datos: [[metodo, '{{ .FactorType }}']],
        tono: 'atencion',
      };

    case 'identity_linked':
      return {
        ...base,
        asunto: t('as.id_alta.asunto'),
        avance: t('as.id_alta.avance'),
        titulo: t('as.id_alta.titulo'),
        parrafos: [t('as.id_alta.p1')],
        datos: [[metodo, '{{ .Provider }}'], [cuenta, '{{ .Email }}']],
      };

    case 'identity_unlinked':
      return {
        ...base,
        asunto: t('as.id_baja.asunto'),
        avance: t('as.id_baja.avance'),
        titulo: t('as.id_baja.titulo'),
        parrafos: [t('as.id_baja.p1')],
        datos: [[metodo, '{{ .Provider }}'], [cuenta, '{{ .Email }}']],
        tono: 'atencion',
      };
  }
}
