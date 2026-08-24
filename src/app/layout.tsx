import type { Metadata } from 'next';
import { Inter, Inter_Tight, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { exigirLegalEnProduccion } from '@/lib/legal/config';

// Inter de default en todo el sitio. El 12-ago-2026
// Javier pidió una tipografía más corporativa para los
// paneles, con DOS voces más aparte del Inter de texto:
//
//  - Titulares en una grotesca APRETADA ("Payments Validation Agent") —
//    Inter Tight es esa misma voz con licencia clara (Google Fonts, OFL);
//    reemplaza a Manrope, que era la alternativa a Satoshi de la landing
//    vieja y se leía redonda, no corporativa.
//  - Micro-rótulos y cifras de tabla en MONO ("POLICIES MONITORED",
//    "$9,242.88") — IBM Plex Mono, la voz que hace que un panel se lea
//    como estado de cuenta. Se usa vía `.etiqueta-mono` (globals.css).
const inter = Inter({ subsets: ['latin'], variable: '--font-sans-ui' });
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

// Aplica el tema guardado ANTES del primer paint — sin esto, quien eligió
// oscuro ve un flash blanco en cada navegación dura. Corre SOLO en el panel:
// la landing, el login y el PDF se quedan claros (nunca se diseñaron en
// oscuro y el naranja de marca vive sobre fondos claros). La misma
// resolución de "sistema" que selector-tema.tsx, duplicada a propósito:
// esto tiene que ser un string síncrono sin imports.
const SCRIPT_TEMA = `(function(){try{if(location.pathname.indexOf('/dashboard')!==0)return;var t=localStorage.getItem('likida-tema');var d=t==='oscuro'||(t==='sistema'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  exigirLegalEnProduccion();
  return (
    <html lang="es" className={`${inter.variable} ${interTight.variable} ${plexMono.variable}`}>
      <body>
        <script id="likida-theme-init" dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
        {children}
      </body>
    </html>
  );
}
