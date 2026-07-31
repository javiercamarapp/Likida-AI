import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Likida — Liquidación de viajes',
  description: 'Automatiza el cierre diario de operaciones logísticas por WhatsApp.',
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
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
