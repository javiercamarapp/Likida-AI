// ═══════════════════════════════════════════════════════════════════════════
// EL MOTIVO DEL FALLO DE ENTRADA — para que /login deje de mentir por omisión.
//
// Hasta el 19-ago-2026, TODO fallo del magic link acababa en el mismo
// «Algo falló. Intenta otra vez.» — incluido el caso más común de todos: un
// enlace de un solo uso que ya se usó (o caducó a los 60 minutos). «Intenta
// otra vez» ahí es un consejo activamente malo: reintentar EL MISMO enlace
// falla siempre, y la persona concluye que el login está roto (pasó de
// verdad, con el superadmin, el 19-ago-2026).
//
// Este módulo traduce las dos señales de fallo a un motivo con nombre:
//
//  · Lo que Supabase pega al `redirect_to` cuando el verificador rechaza el
//    token ANTES de emitir un code (`?error=…&error_code=otp_expired&…`).
//  · Lo que `exchangeCodeForSession` devuelve cuando el code llegó pero el
//    canje falla — donde vive el fallo de PKCE: el `code_verifier` es una
//    cookie del navegador que PIDIÓ el correo, así que abrir el enlace en
//    otro navegador (el visor de Gmail del teléfono, un perfil distinto de
//    Chrome) falla aunque el enlace sea perfectamente válido.
//
// QUÉ SE DICE Y QUÉ NO: los motivos hablan del estado del ENLACE, nunca de la
// cuenta. El oráculo de enumeración que `/login` cierra con esCorreoSinCuenta
// (un correo sin cuenta responde igual que uno con cuenta) no se reabre aquí:
// para tener un enlace en la mano, el correo ya existía.
//
// Vive en lib y no en la ruta porque un `route.ts` del app router solo puede
// exportar handlers, y la traducción merece su prueba al lado.
// ═══════════════════════════════════════════════════════════════════════════

/** Los valores que viajan en `/login?error=…`. `generico` se serializa como
 *  `1` por compatibilidad: todos los redirects previos a este módulo ya lo
 *  mandan así y no hay razón para romperlos. */
export type MotivoLogin = 'caducado' | 'navegador' | 'generico';

/**
 * El motivo cuando el callback llegó SIN `code`: el verificador de Supabase
 * rechazó el token y pegó el porqué como query params al `redirect_to`.
 *
 * `otp_expired` es el código de GoTrue tanto para «caducó» como para «ya se
 * usó» — un token de un solo uso consumido deja de existir, así que desde
 * fuera son el mismo estado. Cualquier otro error con nombre (server_error,
 * access_denied sin código…) no tiene mejor consejo que el genérico.
 */
export function motivoSinCode(errorCode: string | null): MotivoLogin {
  return errorCode === 'otp_expired' ? 'caducado' : 'generico';
}

/**
 * El motivo cuando `exchangeCodeForSession` falló con el code en la mano.
 *
 * Se mira `code` y también el mensaje, por la misma razón que
 * `esCorreoSinCuenta` en `/login`: el `code` estructurado solo existe en las
 * versiones nuevas del SDK, y los textos («both auth code and code verifier
 * should be non-empty», «invalid flow state») son lo único estable hacia
 * atrás.
 *
 *  · Sin `code_verifier` → el enlace se abrió en un navegador que no es el
 *    que pidió el correo. El enlace puede seguir siendo válido: el consejo es
 *    abrirlo donde se pidió, no pedir otro.
 *  · `flow_state_not_found` / `flow_state_expired` → el flujo ya se consumió
 *    o venció del lado de Supabase: mismo consejo que un enlace caducado.
 */
export function motivoDeIntercambio(error: { code?: string; message?: string }): MotivoLogin {
  const mensaje = error.message ?? '';
  if (error.code === 'validation_failed' || /code verifier/i.test(mensaje)) return 'navegador';
  if (
    error.code === 'flow_state_not_found' ||
    error.code === 'flow_state_expired' ||
    /flow state/i.test(mensaje)
  ) {
    return 'caducado';
  }
  return 'generico';
}

/** El valor que viaja en la URL. Centralizado para que la ruta y la pantalla
 *  no puedan divergir en cómo se escribe un motivo. */
export function aParametro(motivo: MotivoLogin): string {
  return motivo === 'generico' ? '1' : motivo;
}

/**
 * Lo que la pantalla dice por cada motivo. El texto del enlace caducado evita
 * «intenta otra vez» a propósito: reintentar ese enlace es exactamente lo que
 * no funciona.
 */
export function mensajeDeError(parametro: string): string {
  if (parametro === 'caducado') {
    return 'Ese enlace ya se usó o ya caducó. Pide uno nuevo con tu correo.';
  }
  if (parametro === 'navegador') {
    return 'Ese enlace se pidió desde otro navegador. Ábrelo en el navegador donde escribiste tu correo, o pide uno nuevo desde aquí.';
  }
  return 'Algo falló. Intenta otra vez.';
}
