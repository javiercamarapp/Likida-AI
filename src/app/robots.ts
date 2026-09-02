// Lo público se indexa; el software (paneles, API, auth) no — no porque lo
// proteja robots.txt (lo protege la sesión), sino para que un buscador no
// llene sus resultados de páginas de login.
import type { MetadataRoute } from 'next';
import { appUrl } from '@/lib/env';


export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/blog', '/calculadora', '/privacidad', '/terminos', '/aviso/prospectos'],
        disallow: ['/admin', '/dashboard', '/api', '/login', '/auth', '/cuenta', '/vendedor'],
      },
    ],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
