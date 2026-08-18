import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { verificarFirma } from '@/lib/correo/firma_entrante';
import { enviarCorreo } from '@/lib/correo/enviar';
import {
  correoDeAuth,
  minutosDeCaducidad,
  urlDeVerificacion,
  type AccionAuth,
} from '@/lib/correo/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// SEND EMAIL HOOK DE SUPABASE AUTH — el correo de acceso deja de ser de
// Supabase y pasa a ser de Likida.
//
// Con este hook encendido (Dashboard → Authentication → Hooks → Send Email),
// Supabase YA NO MANDA el correo: nos entrega los datos y espera 200. Lo que
// eso compra es que el magic link salga por Resend, con la plantilla de la
// marca, en español, con el logo incrustado y con el pie obligatorio — o sea,
// idéntico al resto del correo transaccional del producto.
//
// Lo que eso CUESTA, y hay que verlo de frente: este endpoint pasa a estar en
// el camino crítico del login. Si falla, nadie entra. Por eso:
//
//   · Falla CERRADO y RUIDOSO. Sin secreto, sin Resend o con un envío
//     rechazado se responde error —nunca 200 en falso—, para que Supabase le
//     diga a la persona que el correo no salió en vez de dejarla mirando una
//     bandeja vacía. El log lleva el motivo real.
//   · No hay estado, ni base, ni cola. Menos piezas que se puedan caer entre
//     el clic y el correo.
//   · La firma se verifica SIEMPRE (`verificarFirma`, el mismo verificador
//     Standard Webhooks del correo entrante). Sin ella, este endpoint sería
//     una máquina pública de mandar correos con nuestro remitente y nuestro
//     logo a cualquier dirección: phishing perfecto, firmado por nosotros.
//
// El runbook para encenderlo —y para apagarlo si algo sale mal, que es un
// switch en el panel de Supabase— está en `docs/correo-de-acceso.md`.
// ═══════════════════════════════════════════════════════════════════════════

/** El payload de Supabase. Solo se declara lo que se usa: cualquier campo
 *  nuevo de una versión futura se ignora sin romper nada. */
interface PayloadHook {
  user?: { email?: string; new_email?: string };
  email_data?: {
    token?: string;
    token_hash?: string;
    token_new?: string;
    token_hash_new?: string;
    redirect_to?: string;
    email_action_type?: string;
  };
}

const ACCIONES: readonly AccionAuth[] = [
  'magiclink', 'login', 'signup', 'invite', 'recovery',
  'email_change', 'email_change_current', 'email_change_new', 'reauthentication',
];

function esAccion(v: string | undefined): v is AccionAuth {
  return typeof v === 'string' && (ACCIONES as readonly string[]).includes(v);
}

/**
 * El formato que Supabase entiende como fallo. Un error suelto se registra
 * allá como "500 desconocido"; así el motivo aparece en sus logs de Auth, que
 * es donde alguien va a mirar cuando un cliente diga "no me llegó".
 */
function fallo(codigo: number, mensaje: string) {
  return NextResponse.json({ error: { http_code: codigo, message: mensaje } }, { status: codigo });
}

export async function POST(req: Request) {
  // El secreto lo genera Supabase al crear el hook y viene como
  // `v1,whsec_<base64>`. El verificador espera `whsec_<base64>`: el prefijo de
  // versión se quita aquí, y no en el verificador, porque ese lo comparte con
  // el webhook de Resend, que no lo lleva.
  const crudo = process.env.SUPABASE_AUTH_HOOK_SECRET;
  const secreto = crudo?.replace(/^v1,/, '');
  if (!secreto) {
    logger.error('auth.correo.sin_secreto', {});
    return fallo(500, 'SUPABASE_AUTH_HOOK_SECRET no está configurado.');
  }

  const cuerpo = await req.text();
  // Un payload de Auth son unos cientos de bytes. 32 KB es holgura de sobra y
  // corta de tajo el intento de hacernos gastar CPU en un HMAC gigante.
  if (cuerpo.length > 32 * 1024) return fallo(413, 'Payload demasiado grande.');

  const firma = verificarFirma(
    cuerpo,
    {
      id: req.headers.get('webhook-id'),
      timestamp: req.headers.get('webhook-timestamp'),
      signature: req.headers.get('webhook-signature'),
    },
    secreto,
    Date.now(),
  );
  if (!firma.ok) {
    // El motivo real solo al log: distinguir "fuera de tiempo" de "firma
    // inválida" desde fuera le enseña a quien prueba cómo ajustar su intento.
    logger.warn('auth.correo.firma_rechazada', { motivo: firma.motivo });
    return fallo(401, 'Firma no válida.');
  }

  let payload: PayloadHook;
  try {
    payload = JSON.parse(cuerpo) as PayloadHook;
  } catch {
    return fallo(400, 'JSON inválido.');
  }

  // UNA ACCIÓN QUE NO CONOCEMOS DEGRADA, NO TUMBA EL LOGIN.
  //
  // La primera versión contestaba 400 aquí, "por fallar cerrado". El 18-ago
  // eso costó el incidente: Supabase manda `magiclink` y este código esperaba
  // `login`, así que el endpoint rechazó el correo más importante del
  // producto, Supabase tradujo a 500 y nadie podía entrar — con el error
  // apareciendo de su lado, lejos de la causa.
  //
  // La lección no es "acepta lo que sea": es que en el camino crítico del
  // login, un nombre inesperado NO puede valer lo mismo que un ataque. Con
  // token en mano se manda el correo genérico —marca, liga buena, un solo
  // uso— y el error queda GRITADO en el log para arreglarlo con calma. Sin
  // token no hay correo que armar, y ahí sí se rechaza.
  const accionCruda = payload.email_data?.email_action_type;
  const conocida = esAccion(accionCruda);
  if (!conocida) logger.error('auth.correo.accion_desconocida', { accion: accionCruda ?? null });
  const accion: AccionAuth = conocida ? accionCruda : 'magiclink';

  // A quién se le manda. En el cambio de correo con verificación doble,
  // Supabase llama al hook dos veces: la mitad `email_change_new` va a la
  // dirección NUEVA y lleva su propio token (`token_hash_new`) — usar el otro
  // manda un enlace que abre y falla.
  const esMitadNueva = accion === 'email_change_new';
  const destino = (esMitadNueva ? payload.user?.new_email : payload.user?.email) || payload.user?.email;
  if (!destino) return fallo(400, 'El payload no trae destinatario.');

  const tokenHash = (esMitadNueva ? payload.email_data?.token_hash_new : payload.email_data?.token_hash)
    || payload.email_data?.token_hash;
  const codigo = (esMitadNueva ? payload.email_data?.token_new : payload.email_data?.token)
    || payload.email_data?.token || '';

  // La reautenticación es la única acción sin enlace: su mecanismo es el
  // código. Todas las demás sin `token_hash` no se pueden armar.
  if (accion === 'reauthentication') {
    if (!codigo) return fallo(400, 'El payload no trae código.');
  } else if (!tokenHash) {
    return fallo(400, 'El payload no trae token.');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    logger.error('auth.correo.sin_supabase_url', {});
    return fallo(500, 'NEXT_PUBLIC_SUPABASE_URL no está configurado.');
  }
  // El mismo suelo que `/login`: el dominio del SOFTWARE, no el de la landing.
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://app.likida.ai';

  const liga = accion === 'reauthentication'
    ? ''
    : urlDeVerificacion({
        supabaseUrl,
        tokenHash: tokenHash as string,
        accion,
        redirectTo: payload.email_data?.redirect_to,
        base,
      });

  const correo = correoDeAuth({
    accion,
    liga,
    codigo,
    minutos: minutosDeCaducidad(),
    correoNuevo: payload.user?.new_email,
  });

  // `acceso@`, no `avisos@`: es la llave de la cuenta, no un aviso del sistema.
  const envio = await enviarCorreo(destino, correo, { remitenteLocal: 'acceso' });
  if (!envio.ok) {
    logger.error('auth.correo.no_salio', { accion, motivo: envio.motivo });
    return fallo(
      500,
      envio.motivo === 'sin_configurar'
        ? 'El correo saliente no está configurado (RESEND_API_KEY / RESEND_EMAIL_DOMAIN).'
        : 'No se pudo enviar el correo de acceso.',
    );
  }

  // Sin la dirección en el log: este endpoint ve el correo de TODO el que
  // intenta entrar, y un log no es lugar para un dato personal (LFPDPPP).
  logger.info('auth.correo.enviado', { accion, id: envio.id });
  return NextResponse.json({});
}
