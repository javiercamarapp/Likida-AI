'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PanelRightClose, Sparkles, ExternalLink } from 'lucide-react';
import AgenteConversacion from '../dashboard/chat/agente-conversacion';
// El chrome de /admin no trae el CSS del chat (solo /dashboard lo importa en su layout); el panel vive en TODAS las pantallas de /admin.
import '../ui-v2/graficas.css';
import '../ui-v2/movimiento.css';
import '../ui-v2/chat.css';

// ═══════════════════════════════════════════════════════════════════════════
// EL PANEL LATERAL PERSISTENTE DEL COPILOTO — diseño §6: "las dos, y no es indecisión". La página (/admin/copiloto) es para sesiones
// largas; este panel es para preguntar «¿por qué subió esto?» SIN perder la pantalla que lo muestra. ⌘J lo abre y lo cierra sobre
// cualquier pantalla de /admin (⌘K → "Abrir el copiloto" hace lo mismo, vía el evento `likida:abrir-copiloto`).
//
// Envuelve el MISMO componente que «Pregunta a tus datos» (`AgenteConversacion`, modo superadmin, variante panel). VIVE EN EL CHROME y no
// en una página: el layout de /admin persiste entre navegaciones del cliente, así que la conversación SOBREVIVE al cambiar de pantalla —
// cerrado es ancho 0, no desmonte. Es puro dibujo: la puerta real es /api/admin/copiloto, que re-chequea superadmin en cada llamada (y el
// panel no pide nada a la red hasta que se usa: la lista del historial se carga al abrirlo).
// ═══════════════════════════════════════════════════════════════════════════

export default function CopilotoPanel() {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // ⌘J / ⌃J — el patrón de atajos del palette (command-palette.tsx).
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setAbierto((a) => !a);
      }
    }
    function onAbrir() { setAbierto(true); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('likida:abrir-copiloto', onAbrir);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('likida:abrir-copiloto', onAbrir);
    };
  }, []);

  return (
    <aside aria-label="Copiloto" className="rv-copiloto-panel" data-abierto={abierto} inert={!abierto}>
      <div className="rv-copiloto-panel__caja">
        <div className="rv-copiloto-panel__cab">
          <Sparkles width={14} height={14} strokeWidth={1.75} aria-hidden="true" />
          <strong>Copiloto</strong>
          <kbd>⌘J</kbd>
          <span className="rv-copiloto-panel__esp" />
          <Link href="/admin/copiloto" title="Abrir en página completa" aria-label="Abrir en página completa" className="rv-btn rv-btn--ghost rv-copiloto-panel__btn">
            <ExternalLink width={14} height={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <button type="button" onClick={() => setAbierto(false)} title="Cerrar" aria-label="Cerrar copiloto" className="rv-btn rv-btn--ghost rv-copiloto-panel__btn">
            <PanelRightClose width={14} height={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="rv-copiloto-panel__cuerpo">
          <AgenteConversacion modo="superadmin" variante="panel" marca="simbolo" />
        </div>
      </div>
    </aside>
  );
}
