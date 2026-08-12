import type { Metadata } from 'next';
import { Inter, Inter_Tight, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// La MISMA familia que usehandle.ai, leída de su propio CSS computado
// (capturado 2-ago-2026): Inter de default en todo el sitio. El 12-ago-2026
// Javier pidió la tipografía "más corporativa, tipo usehandle.ai" para los
// paneles, y la referencia tiene DOS voces más aparte del Inter de texto:
//
//  - Titulares en una grotesca APRETADA ("Payments Validation Agent") —
//    Inter Tight es esa misma voz con licencia clara (Google Fonts, OFL);
//    reemplaza a Manrope, que era la alternativa a Satoshi de la landing
//    vieja y se leía redonda, no corporativa.
//  - Micro-rótulos y cifras de tabla en MONO ("POLICIES MONITORED",
//    "$9,242.88") — IBM Plex Mono, la voz que hace que un panel se lea
//    como estado de cuenta. Se usa vía `.etiqueta-mono` (globals.css).
const inter = Inter({ subsets: ['latin'], variable: '--font-sans-handle' });
const interTight = Inter_Tight({ subsets: ['latin'], variable: '--font-display' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Likida — Liquidación de viajes',
  description: 'Automatiza el cierre diario de operaciones logísticas por WhatsApp.',
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

// FALTABA, Y SE VE MIRANDO LA PÁGINA EN UN TELÉFONO. Sin `<meta name="viewport">`
// los navegadores móviles maquetan contra un lienzo de 980 px y luego encogen: el
// texto sale cortado por la derecha y hay scroll horizontal en todo el sitio.
//
// Se descubrió capturando `/aviso/[tenant]` a 430 px de ancho — la página que un
// operador SÍ abre desde el celular, con mala señal, mientras espera. Las cuatro
// pruebas del contenido estaban verdes y el defecto no lo veía ninguna, porque
// ninguna renderiza.
export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${interTight.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
