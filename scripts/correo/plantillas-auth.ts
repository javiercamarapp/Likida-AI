// ═══════════════════════════════════════════════════════════════════════════
// GENERA LAS PLANTILLAS DE AUTH — dos salidas del MISMO redactor.
//
//   npx vite-node scripts/correo/plantillas-auth.ts
//
//  1. `docs/correo-auth/*.html` — para pegar en Supabase → Authentication →
//     Emails. Es la RED por si el Send Email Hook está apagado: mientras el
//     hook no esté encendido, Supabase manda con estas, y sin ellas manda con
//     las de fábrica (inglés, sin logo). Llevan el logo ENLAZADO porque ese
//     correo sale por su SMTP y no puede adjuntar nada, y las variables Go de
//     Supabase (`{{ .ConfirmationURL }}`, `{{ .Token }}`).
//
//  2. `node_modules/.cache/correo-vista-previa/*.html` — para MIRAR el render,
//     con el logo como data-URI (lo que en el correo real viaja como `cid:`).
//     Va a la caché por lo mismo que el reporte de cobertura: es un GENERADO,
//     y un generado en la raíz acaba commiteado sin querer.
//
// La única fuente de la redacción es `src/lib/correo/auth.ts`. Este script no
// escribe una sola palabra del correo: si lo hiciera, el día que alguien
// corrigiera el texto habría dos versiones y una sería mentira.
// ═══════════════════════════════════════════════════════════════════════════
// EL DOMINIO SE FUERZA ANTES DE ARMAR NADA. Este script corre en la máquina
// de desarrollo, donde `NEXT_PUBLIC_APP_URL` vale `http://localhost:3000`: sin
// esta línea, las plantillas que se pegan en Supabase salen con el logo
// apuntando a localhost y el pie diciendo «localhost:3000». Se encontró
// MIRANDO el render, no leyendo el código.
process.env.NEXT_PUBLIC_APP_URL = process.env.PLANTILLAS_BASE ?? 'https://app.likida.ai';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { armarHtml } from '../../src/lib/correo/plantilla';
import {
  correoDeAuth, correoDeAvisoAuth, minutosDeCaducidad,
  type AccionAuth, type AvisoAuth,
} from '../../src/lib/correo/auth';
import { LOGO_PNG_BASE64, LOGO_CID } from '../../src/lib/correo/logo';

/** Sentinelas: se meten como URL/código válidos para que pasen por
 *  `hrefSeguro` y el escapado, y se cambian por la variable de Supabase al
 *  final. Meter `{{ .ConfirmationURL }}` directo lo tumbaría `hrefSeguro`,
 *  que exige http(s) — y con razón. */
const LIGA = 'https://sentinela.likida.ai/liga';
const CODIGO = '000000';

const ARCHIVO: Record<AccionAuth, string> = {
  // `magiclink` es el nombre que Supabase manda de verdad; `login` es el mismo
  // correo con el otro nombre. Un solo archivo para los dos.
  magiclink: 'magic-link',
  login: 'magic-link',
  signup: 'confirmar-alta',
  invite: 'invitacion',
  recovery: 'recuperar-acceso',
  email_change: 'cambio-de-correo',
  email_change_current: 'cambio-de-correo-actual',
  email_change_new: 'cambio-de-correo-nueva',
  reauthentication: 'reautenticacion',
};

/** Las seis plantillas que el panel de Supabase sabe editar. Las dos mitades
 *  del cambio de correo comparten plantilla allá. */
const PARA_EL_PANEL: AccionAuth[] = [
  'magiclink', 'signup', 'invite', 'recovery', 'email_change', 'reauthentication',
];

const minutos = minutosDeCaducidad();

const destino = process.argv[2] ?? 'docs/correo-auth';
mkdirSync(destino, { recursive: true });
const previa = process.argv[3] ?? 'node_modules/.cache/correo-vista-previa';
mkdirSync(previa, { recursive: true });

for (const accion of Object.keys(ARCHIVO) as AccionAuth[]) {
  const correo = correoDeAuth({
    accion,
    liga: LIGA,
    codigo: CODIGO,
    minutos,
    correoNuevo: accion.startsWith('email_change') ? 'nuevo@transportes.mx' : undefined,
  });

  // ── (1) La plantilla del panel: logo enlazado + variables de Supabase.
  if (PARA_EL_PANEL.includes(accion)) {
    const html = armarHtml(correo, { logo: 'url' })
      .replaceAll(LIGA, '{{ .ConfirmationURL }}')
      .replaceAll(CODIGO, '{{ .Token }}');
    writeFileSync(join(destino, `${ARCHIVO[accion]}.html`), html, 'utf8');
  }

  // ── (2) La vista previa: el mismo HTML que sale por Resend, con el logo
  //        resuelto para que el navegador lo pinte igual que un cliente que
  //        sí autoriza la imagen incrustada.
  const vista = armarHtml(correo)
    .replaceAll(`cid:${LOGO_CID}`, `data:image/png;base64,${LOGO_PNG_BASE64}`);
  writeFileSync(join(previa, `${ARCHIVO[accion]}.html`), vista, 'utf8');
}

// Los siete avisos de seguridad: sin liga ni código, con las variables Go
// tal cual. Van a las dos salidas por lo mismo que los demás.
const AVISOS: Record<AvisoAuth, string> = {
  email_changed: 'aviso-correo-cambiado',
  password_changed: 'aviso-contrasena',
  phone_changed: 'aviso-telefono-cambiado',
  mfa_enrolled: 'aviso-segundo-factor-agregado',
  mfa_unenrolled: 'aviso-segundo-factor-quitado',
  identity_linked: 'aviso-identidad-ligada',
  identity_unlinked: 'aviso-identidad-quitada',
};

for (const [tipo, archivo] of Object.entries(AVISOS) as Array<[AvisoAuth, string]>) {
  const correo = correoDeAvisoAuth(tipo);
  writeFileSync(join(destino, `${archivo}.html`), armarHtml(correo, { logo: 'url' }), 'utf8');
  writeFileSync(
    join(previa, `${archivo}.html`),
    armarHtml(correo).replaceAll(`cid:${LOGO_CID}`, `data:image/png;base64,${LOGO_PNG_BASE64}`),
    'utf8',
  );
}

console.log(`Plantillas del panel → ${destino}/ (${PARA_EL_PANEL.length + Object.keys(AVISOS).length})`);
console.log(`Vista previa         → ${previa}/ (${Object.keys(ARCHIVO).length})`);
console.log(`Caducidad declarada  → ${minutos} min (AUTH_CORREO_CADUCIDAD_MIN)`);
