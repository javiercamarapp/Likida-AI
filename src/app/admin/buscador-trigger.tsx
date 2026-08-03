'use client';

import { Search } from 'lucide-react';

/** Botón "Buscar" del sidebar — dispara el mismo evento que ⌘K
 *  (command-palette.tsx) para quien prefiere el clic al atajo. */
export default function BuscadorTrigger() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event('likida:abrir-buscador'))}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hairline hover:opacity-70 transition-opacity"
      style={{ color: 'var(--muted)' }}>
      <Search width={14} height={14} strokeWidth={1.75} />
      Buscar…
      <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--canvas)' }}>⌘K</kbd>
    </button>
  );
}
