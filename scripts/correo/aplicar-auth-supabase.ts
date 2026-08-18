// ═══════════════════════════════════════════════════════════════════════════
// DEJA EL CORREO DE ACCESO CONFIGURADO EN SUPABASE, POR API. Un solo comando.
//
//   SUPABASE_ACCESS_TOKEN=sbp_xxx npx vite-node scripts/correo/aplicar-auth-supabase.ts
//   SUPABASE_ACCESS_TOKEN=sbp_xxx npx vite-node scripts/correo/aplicar-auth-supabase.ts --con-hook
//
// Sin bandera: sube las TRECE plantillas y sus asuntos (Authentication →
// Emails): las seis con liga o código, y los siete avisos de seguridad. Es
// reversible, no toca el camino de entrada, y arregla el correo aunque el
// hook nunca se encienda.
//
// Con `--con-hook`: además enciende el Send Email Hook, que le quita el envío
// a Supabase y lo pasa por Resend con el logo incrustado.
//
// ── LOS TRES CANDADOS, y por qué cada uno ────────────────────────────────
//
//  1. **No enciende el hook si el endpoint no está listo.** Antes de tocarlo
//     prueba `POST /api/auth/correo` SIN firma: 401 significa que el
//     deployment tiene el secreto y verifica; 500 significa que la variable
//     no llegó al build. Encender el hook con el endpoint en 500 deja a TODO
//     EL MUNDO sin poder entrar, y el error aparecería del lado de Supabase,
//     lejos de donde está la causa.
//  2. **Relee y compara.** Después de cada PATCH vuelve a leer la config y
//     verifica que lo escrito sea lo que quedó. Un 200 de una API no prueba
//     que el campo se haya guardado con el nombre que uno cree.
//  3. **Coteja la caducidad.** Lee `mailer_otp_exp` del proyecto y lo compara
//     con lo que el correo PROMETE. Si no cuadran, lo dice y da el valor
//     exacto de `AUTH_CORREO_CADUCIDAD_MIN`: un correo que promete una hora y
//     caduca a los quince minutos es peor que uno que no promete nada.
// ═══════════════════════════════════════════════════════════════════════════
process.env.NEXT_PUBLIC_APP_URL = process.env.PLANTILLAS_BASE ?? 'https://app.likida.ai';

import { readFileSync } from 'node:fs';
import { armarHtml } from '../../src/lib/correo/plantilla';
import {
  correoDeAuth, correoDeAvisoAuth, minutosDeCaducidad,
  type AccionAuth, type AvisoAuth,
} from '../../src/lib/correo/auth';

const API = 'https://api.supabase.com/v1';
const ENDPOINT = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/correo`;
const LIGA = 'https://sentinela.likida.ai/liga';
const CODIGO = '000000';

/** Lee una variable de `.env.local` sin cargar el archivo entero al entorno:
 *  este script no debe heredar por accidente la configuración de desarrollo. */
function deEnvLocal(nombre: string): string | undefined {
  try {
    const linea = readFileSync('.env.local', 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith(`${nombre}=`));
    return linea?.slice(linea.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  } catch {
    return undefined;
  }
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Falta SUPABASE_ACCESS_TOKEN (sbp_…). Se genera en:');
  console.error('  https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

const urlSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? deEnvLocal('NEXT_PUBLIC_SUPABASE_URL');
const ref = urlSupabase?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref) {
  console.error('No se pudo deducir el project ref de NEXT_PUBLIC_SUPABASE_URL.');
  process.exit(1);
}

const conHook = process.argv.includes('--con-hook');
const secretoHook = process.env.SUPABASE_AUTH_HOOK_SECRET ?? deEnvLocal('SUPABASE_AUTH_HOOK_SECRET');

async function api(metodo: 'GET' | 'PATCH', cuerpo?: unknown) {
  const r = await fetch(`${API}/projects/${ref}/config/auth`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  if (!r.ok) {
    console.error(`✗ ${metodo} config/auth → HTTP ${r.status}: ${texto.slice(0, 300)}`);
    process.exit(1);
  }
  return JSON.parse(texto) as Record<string, unknown>;
}

/** El HTML de una acción, con las variables Go de Supabase ya puestas. */
function plantilla(accion: AccionAuth) {
  const correo = correoDeAuth({ accion, liga: LIGA, codigo: CODIGO, minutos: minutosDeCaducidad() });
  const html = armarHtml(correo, { logo: 'url' })
    .replaceAll(LIGA, '{{ .ConfirmationURL }}')
    .replaceAll(CODIGO, '{{ .Token }}');
  return { asunto: correo.asunto, html };
}

/** Cada acción con el par de campos que le toca en la Management API. */
const CAMPOS: Array<{ accion: AccionAuth; asunto: string; contenido: string; nombre: string }> = [
  { accion: 'login', asunto: 'mailer_subjects_magic_link', contenido: 'mailer_templates_magic_link_content', nombre: 'Magic Link' },
  { accion: 'signup', asunto: 'mailer_subjects_confirmation', contenido: 'mailer_templates_confirmation_content', nombre: 'Confirm signup' },
  { accion: 'invite', asunto: 'mailer_subjects_invite', contenido: 'mailer_templates_invite_content', nombre: 'Invite user' },
  { accion: 'recovery', asunto: 'mailer_subjects_recovery', contenido: 'mailer_templates_recovery_content', nombre: 'Reset password' },
  { accion: 'email_change', asunto: 'mailer_subjects_email_change', contenido: 'mailer_templates_email_change_content', nombre: 'Change email' },
  { accion: 'reauthentication', asunto: 'mailer_subjects_reauthentication', contenido: 'mailer_templates_reauthentication_content', nombre: 'Reauthentication' },
];

/**
 * Los SIETE avisos de seguridad. No aparecen en la lista de plantillas que uno
 * espera —se descubrieron leyendo la config por API el 18-ago— y seguían en
 * inglés con el HTML de fábrica. No llevan liga ni código: sus variables las
 * rellena el motor de Supabase y pasan intactas por el escapado.
 */
const AVISOS: Array<{ tipo: AvisoAuth; asunto: string; contenido: string; nombre: string }> = [
  { tipo: 'email_changed', asunto: 'mailer_subjects_email_changed_notification', contenido: 'mailer_templates_email_changed_notification_content', nombre: 'Correo cambiado' },
  { tipo: 'password_changed', asunto: 'mailer_subjects_password_changed_notification', contenido: 'mailer_templates_password_changed_notification_content', nombre: 'Contraseña' },
  { tipo: 'phone_changed', asunto: 'mailer_subjects_phone_changed_notification', contenido: 'mailer_templates_phone_changed_notification_content', nombre: 'Teléfono cambiado' },
  { tipo: 'mfa_enrolled', asunto: 'mailer_subjects_mfa_factor_enrolled_notification', contenido: 'mailer_templates_mfa_factor_enrolled_notification_content', nombre: 'Segundo factor +' },
  { tipo: 'mfa_unenrolled', asunto: 'mailer_subjects_mfa_factor_unenrolled_notification', contenido: 'mailer_templates_mfa_factor_unenrolled_notification_content', nombre: 'Segundo factor −' },
  { tipo: 'identity_linked', asunto: 'mailer_subjects_identity_linked_notification', contenido: 'mailer_templates_identity_linked_notification_content', nombre: 'Identidad ligada' },
  { tipo: 'identity_unlinked', asunto: 'mailer_subjects_identity_unlinked_notification', contenido: 'mailer_templates_identity_unlinked_notification_content', nombre: 'Identidad quitada' },
];

// ── 0. Estado actual ──────────────────────────────────────────────────────
const antes = await api('GET');
const otpSeg = Number(antes.mailer_otp_exp ?? 0);
console.log(`Proyecto ${ref}`);
console.log(`  OTP expiration del proyecto : ${otpSeg} s (${Math.round(otpSeg / 60)} min)`);
console.log(`  El correo promete           : ${minutosDeCaducidad()} min`);
console.log(`  Hook de correo              : ${antes.hook_send_email_enabled ? 'ENCENDIDO' : 'apagado'} ${antes.hook_send_email_uri ?? ''}`);

if (otpSeg && Math.round(otpSeg / 60) !== minutosDeCaducidad()) {
  console.log(`\n⚠  NO CUADRAN. Pon AUTH_CORREO_CADUCIDAD_MIN=${Math.round(otpSeg / 60)} en Vercel,`);
  console.log('   redespliega y vuelve a correr esto: el correo dice el número en voz alta.\n');
}

// ── 1. Las seis plantillas ────────────────────────────────────────────────
const patch: Record<string, string | boolean> = {};
for (const c of CAMPOS) {
  const { asunto, html } = plantilla(c.accion);
  patch[c.asunto] = asunto;
  patch[c.contenido] = html;
}
for (const a of AVISOS) {
  const correo = correoDeAvisoAuth(a.tipo);
  patch[a.asunto] = correo.asunto;
  patch[a.contenido] = armarHtml(correo, { logo: 'url' });
}
await api('PATCH', patch);

const despues = await api('GET');
let fallas = 0;
for (const c of [...CAMPOS, ...AVISOS]) {
  const ok = despues[c.contenido] === patch[c.contenido] && despues[c.asunto] === patch[c.asunto];
  console.log(`  ${ok ? '✓' : '✗'} ${c.nombre.padEnd(18)} ${String(patch[c.asunto])}`);
  if (!ok) fallas++;
}
if (fallas) {
  console.error(`\n✗ ${fallas} plantilla(s) no quedaron como se mandaron. Revisar a mano.`);
  process.exit(1);
}

// ── 2. El hook, con su candado ────────────────────────────────────────────
if (!conHook) {
  console.log('\nPlantillas listas. Para encender el hook (correo por Resend, logo incrustado):');
  console.log('  SUPABASE_ACCESS_TOKEN=… npx vite-node scripts/correo/aplicar-auth-supabase.ts --con-hook');
  process.exit(0);
}

if (!secretoHook) {
  console.error('\n✗ Falta SUPABASE_AUTH_HOOK_SECRET (en el entorno o en .env.local).');
  process.exit(1);
}

// EL CANDADO: 401 = el deployment tiene el secreto y verifica firmas. 500 =
// la variable no llegó al build, y encender el hook dejaría a todos fuera.
const sonda = await fetch(ENDPOINT, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
});
if (sonda.status !== 401) {
  console.error(`\n✗ ${ENDPOINT} contestó ${sonda.status}, no 401.`);
  console.error('  401 = desplegado y con el secreto. 500 = falta la variable en el build.');
  console.error('  NO se enciende el hook: con el endpoint así, nadie podría entrar.');
  process.exit(1);
}
console.log(`\n✓ ${ENDPOINT} contesta 401 sin firma: desplegado y con secreto.`);

await api('PATCH', {
  hook_send_email_enabled: true,
  hook_send_email_uri: ENDPOINT,
  hook_send_email_secrets: secretoHook,
});
const conf = await api('GET');
const encendido = conf.hook_send_email_enabled === true && conf.hook_send_email_uri === ENDPOINT;
console.log(`  ${encendido ? '✓' : '✗'} Hook ${encendido ? 'ENCENDIDO' : 'NO quedó encendido'} → ${conf.hook_send_email_uri}`);
if (!encendido) process.exit(1);

console.log('\nListo. Pide un magic link en /login y míralo llegar desde acceso@.');
console.log('Interruptor de pánico: Authentication → Hooks → apagar. Vuelve a las plantillas de arriba.');
