import { redirect } from 'next/navigation';
import { requireOperador } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { MarcoChofer } from './marco';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA DEL PANEL DEL CHOFER.
//
// `requireOperador()` ya es la puerta de /mis-viajes y hace exactamente lo que
// hace falta aquí, así que se reusa en vez de escribir una segunda:
//   · sin sesión         → /login
//   · rol ≠ operador     → /dashboard (SÍ tiene panel, es otro)
//   · operador sin liga  → /sin-acceso (alta a medias: no hay de dónde colgar
//                          sus viajes, y enseñarle un panel vacío se leería
//                          como que no ha hecho ninguno)
//
// VA EN EL LAYOUT **Y** EN CADA PÁGINA. No es redundancia por gusto: un layout
// de Next no se vuelve a ejecutar en cada navegación entre segmentos hijos, y
// además las páginas necesitan de todas formas el `operadorId` para consultar.
// Que la autorización viva junto a la consulta que protege es lo que impide que
// una página nueva de /chofer nazca sin puerta.
//
// EL PROXY YA NOMBRA /chofer (src/proxy.ts, `RUTAS_CON_SESION`), así que esta
// vuelve a ser la SEGUNDA capa y no la única. La diferencia importa para el
// "sin sesión": el proxy ve la URL completa y devuelve al chofer a la pantalla
// exacta del enlace de WhatsApp que abrió; aquí solo se conoce `/chofer`.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `viewport-fit=cover` para que `env(safe-area-inset-bottom)` deje de valer 0.
 *
 * Sin esto, en un iPhone con gesto de inicio la barra de pestañas se dibuja
 * DEBAJO de la rayita del sistema y el último botón no se puede tocar. El
 * layout raíz no lo pone porque el resto del producto se ve en escritorio; se
 * declara aquí, que es la única sección pensada para un teléfono.
 */
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' as const };

export default async function ChoferLayout({ children }: { children: React.ReactNode }) {
  // El destino del rebote se PASA, ya no se corrige a mano con un
  // `getSessionTenant()` de más: `requireOperador(destino)` (guard.ts) arma
  // `/login?next=<destino>` con lo que reciba. Antes tenía la constante
  // `%2Fmis-viajes` escrita adentro y todo /chofer aterrizaba, tras iniciar
  // sesión, en la pantalla vieja de solo lectura.
  const { nombre } = await requireOperador('/chofer');

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/login');
  }

  return (
    <MarcoChofer nombre={nombre} cerrarSesion={cerrarSesion}>
      {children}
    </MarcoChofer>
  );
}
