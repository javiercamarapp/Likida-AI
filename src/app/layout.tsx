import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import './ui-v2/fonts.css';
import { exigirLegalEnProduccion } from '@/lib/legal/config';
import { SCRIPT_TEMA } from '@/lib/seguridad/script_tema';

// TIPOGRAFÍA (identidad Rovaq, 10-nov-2026): solo Hanken Grotesk (local, `ui-v2/fonts.css`, la descarga el navegador únicamente si
// algún texto la usa) y IBM Plex Mono. Se retiraron Inter e Inter Tight de `next/font`: `fonts.css` ahora define `--font-sans-ui` y
// `--font-display` en `:root`, así que `.font-display`, /estado, el vendedor y las páginas públicas siguen teniendo familia sin
// bajar dos fuentes extra. IBM Plex Mono se queda: micro-rótulos y cifras de tabla (`.etiqueta-mono`, globals.css).
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

const DESCRIPCION = 'Automatiza el cierre diario de operaciones logísticas por WhatsApp.';

export const metadata: Metadata = {
  title: 'Likida — Liquidación de viajes',
  description: DESCRIPCION,
  applicationName: 'Likida',
  // Íconos: `favicon.ico`, `icon.svg` y `apple-icon.png` los sirve Next por convención de archivo (src/app). Aquí van los PNG del
  // manifest, para que el navegador y «Agregar a inicio» tengan 192/512 y la variante maskable.
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  manifest: '/site.webmanifest',
  appleWebApp: { capable: true, title: 'Likida', statusBarStyle: 'black-translucent' },
  openGraph: {
    type: 'website',
    siteName: 'Likida',
    title: 'Likida — Liquidación de viajes',
    description: DESCRIPCION,
    locale: 'es_MX',
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: 'Likida' }],
  },
  twitter: { card: 'summary', title: 'Likida — Liquidación de viajes', description: DESCRIPCION, images: ['/icons/icon-512.png'] },
  // Verificación de dominio de Meta (Business Manager → Seguridad de la marca →
  // Dominios). Meta exige que la etiqueta esté en el `<head>` del HTML que
  // devuelve el SERVIDOR: si la inyecta JavaScript en el cliente, la
  // verificación falla. `metadata.other` la emite en el HTML prerenderizado.
  //
  // Va en el layout raíz porque el rastreador solo mira la home (likida.ai/),
  // no las rutas internas.
  other: {
    'facebook-domain-verification': '5i7bo25fbjsm9oqoildqrlroq1aow5',
  },
};

// `width=device-width` FALTÓ una vez y se vio mirando la página en un teléfono (lienzo de 980 px, texto cortado, scroll horizontal).
// Ahora además: `viewportFit: 'cover'` (sin él `env(safe-area-inset-bottom)` vale 0 en iPhone con muesca y la barra inferior móvil queda
// bajo el indicador de inicio), `colorScheme` claro/oscuro, `themeColor` por esquema (#ffffff / #0e0e10, como Rovaq) e
// `interactiveWidget: 'resizes-content'` (el teclado redimensiona el contenido y no tapa los campos).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0e10' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // CSP con nonce en TODAS las rutas (Ola 9b): Next solo puede estampar el nonce por petición en páginas
  // dinámicas. `connection()` en el layout raíz las vuelve dinámicas (sin caché de CDN); decisión de Javier
  // del 2-oct-2026. Ver docs/operacion/csp.md. Las rutas /api y los metadatos (sitemap, robots) no pasan por aquí.
  await connection();
  exigirLegalEnProduccion();
  return (
    <html lang="es" className={plexMono.variable}>
      <body>
        <script id="likida-theme-init" dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
        {children}
      </body>
    </html>
  );
}
