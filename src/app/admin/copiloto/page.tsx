import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import AgenteConversacion from '../../dashboard/chat/agente-conversacion';
// El chrome de /admin no trae el CSS del chat (solo /dashboard lo importa en su layout).
import '../../ui-v2/graficas.css';
import '../../ui-v2/movimiento.css';
import '../../ui-v2/chat.css';

export const dynamic = 'force-dynamic';

/**
 * /admin/copiloto — la página del Copiloto del fundador (Fase 2 del blueprint). La puerta es doble a propósito: aquí `requireSuperadmin`
 * (esta página redirige) y otra vez en /api/admin/copiloto (una ruta /api no pasa por el layout y es su propia puerta). El componente es
 * el MISMO de «Pregunta a tus datos» en modo superadmin, cliente puro sin datos precargados: TODO dato llega por tools del endpoint — no
 * hay cifra que servir desde aquí que el copiloto no deba citar con fuente. Solo cruzan props serializables (modo y variante).
 */
export default async function PaginaCopiloto() {
  await requireSuperadmin();
  // El MISMO contenedor que «Pregunta a tus datos» del dashboard (`.rv-chat-pagina`, ui-v2/chat.css): llena el alto del marco, el hilo
  // scrollea por dentro y el chat queda con los márgenes del sistema. El envoltorio anterior (`.rv-agente-pagina`: borde, radio y
  // altura fija) hacía una tarjeta dentro de otra y dejaba el botón «Historial» pegado a la esquina.
  return (
    <main className="rv-chat-pagina">
      <AgenteConversacion modo="superadmin" variante="pagina" />
    </main>
  );
}

export const metadata: Metadata = { title: 'Copiloto' };
