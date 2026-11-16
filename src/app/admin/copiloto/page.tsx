import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import AgenteConversacion from '../../dashboard/chat/agente-conversacion';
import { MarcoPagina } from '../../ui-v2/componentes';
import { getT } from '@/lib/i18n/servidor';
import './copiloto.css';
// El chrome de /admin no trae el CSS del chat (solo /dashboard lo importa en su layout).
import '../../ui-v2/graficas.css';
import '../../ui-v2/movimiento.css';
import '../../ui-v2/chat.css';
// Medidas de la página de Rovaq /preguntale (736 px, descripción 13 px): las mismas que «Pregunta a tus datos».
import '../../dashboard/chat/chat-pagina.css';

export const dynamic = 'force-dynamic';

/**
 * /admin/copiloto — la página del Copiloto del fundador (Fase 2 del blueprint). La puerta es doble a propósito: aquí `requireSuperadmin`
 * (esta página redirige) y otra vez en /api/admin/copiloto (una ruta /api no pasa por el layout y es su propia puerta). El componente es
 * el MISMO de «Pregunta a tus datos» en modo superadmin, cliente puro sin datos precargados: TODO dato llega por tools del endpoint — no
 * hay cifra que servir desde aquí que el copiloto no deba citar con fuente. Solo cruzan props serializables (modo y variante).
 */
export default async function PaginaCopiloto() {
  await requireSuperadmin();
  const { t } = await getT('admin_agentes');
  // El marco único de pantalla (un solo h1, el nombre del menú) con la clase del chat: `.rv-chat-pagina` llena el alto, el hilo scrollea por
  // dentro y el chat queda con los márgenes del sistema. El encabezado del marco queda a disposición de los lectores de pantalla
  // (copiloto.css) porque el lienzo del agente es una portada a pantalla completa, igual que «Pregunta a tus datos».
  return (
    <MarcoPagina titulo={t('copiloto.titulo')} apoyo={t('copiloto.apoyo')} className="rv-chat-pagina rv-copiloto">
      <AgenteConversacion modo="superadmin" variante="pagina" />
    </MarcoPagina>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_agentes');
  return { title: t('copiloto.titulo') };
}
