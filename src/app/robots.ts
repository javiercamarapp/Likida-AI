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
        allow: ['/blog', '/calculadora', '/privacidad', '/terminos', '/estado', '/aviso/prospectos'],
        // `/demo` y `/mcp` (W2): /demo es una simulación con una promesa de PDF que no
        // entrega y /mcp es documentación de una integración privada — no son páginas que
        // un buscador deba ofrecer como si fueran el producto.
        disallow: ['/admin', '/dashboard', '/api', '/login', '/auth', '/cuenta', '/vendedor', '/demo', '/mcp'],
      },
    ],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
