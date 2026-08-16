'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PanelRightClose, Sparkles, ExternalLink } from 'lucide-react';
import Copiloto from './copiloto';

// ═══════════════════════════════════════════════════════════════════════════
// EL PANEL LATERAL PERSISTENTE DEL COPILOTO — diseño §6: "las dos, y no es
// indecisión". La página (/admin/copiloto) es para sesiones largas; este
// panel es para preguntar «¿por qué subió esto?» SIN perder la pantalla que
// lo muestra. ⌘J lo abre y lo cierra sobre cualquier pantalla de /admin
// (⌘K → "Abrir el copiloto" hace lo mismo, vía el mismo puente de evento
// que el botón Buscar del sidebar).
//
// VIVE EN EL CHROME y no en una página: el layout de /admin persiste entre
// navegaciones del cliente, así que la conversación SOBREVIVE al cambiar de
// pantalla — cerrado es ancho 0, no desmonte. Es puro dibujo, como todo el
// chrome: la puerta real es /api/admin/copiloto, que re-chequea superadmin
// en cada llamada (y el panel no pide nada a la red hasta que se usa).
// ═══════════════════════════════════════════════════════════════════════════

const ANCHO = 400;

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
    <aside
      aria-label="Copiloto"
      className="shrink-0 sticky top-4 self-start h-[calc(100dvh-2rem)] overflow-hidden"
      // Cerrado cancela el gap-4 del marco con el margen negativo: un hijo
      // de ancho 0 en un flex con gap seguiría dejando su hueco de 16px.
      style={{
        width: abierto ? ANCHO : 0,
        marginLeft: abierto ? 0 : -16,
        transition: 'width 480ms cubic-bezier(0.22, 1, 0.36, 1), margin-left 480ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <div className="glass-panel h-full flex flex-col overflow-hidden" style={{ width: ANCHO }}>
        <div className="flex items-center gap-2 px-3 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
          <Sparkles width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
          <span className="text-[13px] font-medium">Copiloto</span>
          <kbd className="text-[10px] px-1.5 py-0.5 rounded hairline" style={{ color: 'var(--muted)' }}>⌘J</kbd>
          <span className="flex-1" />
          <Link href="/admin/copiloto" title="Abrir en página completa" aria-label="Abrir en página completa"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--canvas)]"
            style={{ color: 'var(--muted)' }}>
            <ExternalLink width={13} height={13} strokeWidth={1.75} />
          </Link>
          <button type="button" onClick={() => setAbierto(false)} title="Cerrar" aria-label="Cerrar copiloto"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--canvas)]"
            style={{ color: 'var(--muted)' }}>
            <PanelRightClose width={14} height={14} strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <Copiloto variante="panel" />
        </div>
      </div>
    </aside>
  );
}
