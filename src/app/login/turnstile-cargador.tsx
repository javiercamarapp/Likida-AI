'use client';

import { useEffect } from 'react';

const URL_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

/**
 * Carga el script externo de Cloudflare Turnstile desde el cliente. Se inserta con document.createElement (no con un
 * `<script>` en el marcado ni con next/script): la CSP por nonce confia en el, via 'strict-dynamic', porque lo inserta
 * un script propio ya autorizado. Asi el UNICO `<script>` inline del repo sigue siendo el del tema.
 * Hosts de CSP requeridos (solo con TURNSTILE_ACTIVO): https://challenges.cloudflare.com en script-src, frame-src y
 * connect-src (ver `lib/seguridad/csp.ts`).
 */
export function TurnstileCargador() {
  useEffect(() => {
    if (document.querySelector(`script[src="${URL_TURNSTILE}"]`)) return;
    const s = document.createElement('script');
    s.src = URL_TURNSTILE;
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }, []);
  return null;
}
