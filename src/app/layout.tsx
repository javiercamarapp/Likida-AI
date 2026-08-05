import type { Metadata } from 'next';
import { Inter, Manrope } from 'next/font/google';
import './globals.css';

// La MISMA familia que usehandle.ai, leída de su propio CSS computado
// (capturado 2-ago-2026): Inter de default en todo el sitio, y su clase
// `.display` usa Satoshi — una fuente de Fontshare que no está en Google
// Fonts y no tiene un next/font/google que la sirva con licencia clara.
// Manrope es la alternativa geométrica más cercana a Satoshi que sí se
// puede self-hostear aquí con licencia real (Google Fonts, SIL OFL).
const inter = Inter({ subsets: ['latin'], variable: '--font-sans-handle' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-display' });

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
    <html lang="es" className={`${inter.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  );
}
