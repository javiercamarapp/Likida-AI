import Script from 'next/script';
import { turnstileSiteKey } from '@/lib/seguridad/turnstile';

/**
 * S-03: el widget de Cloudflare Turnstile del formulario de correo. NO renderiza nada (ni carga el script de Cloudflare)
 * si TURNSTILE_ACTIVO no es '1' o falta NEXT_PUBLIC_TURNSTILE_SITE_KEY: apagado por omision. Con render implicito, el
 * script detecta `.cf-turnstile` y agrega solo el campo oculto `cf-turnstile-response` DENTRO del formulario, que es lo
 * que lee `entrarConEmail`. Es solo marcado (sin hooks): `VistaLogin` se llama como funcion en las pruebas.
 *
 * CSP: cuando esta encendido, `construirCsp` agrega https://challenges.cloudflare.com a script-src, frame-src y
 * connect-src (ver `lib/seguridad/csp.ts`); apagado, la politica no cambia ni un caracter.
 */
export function TurnstileWidget() {
  const llave = turnstileSiteKey();
  if (!llave) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" async defer />
      <div className="cf-turnstile" data-sitekey={llave} data-theme="light" data-language="es" />
    </>
  );
}
