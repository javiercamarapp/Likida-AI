'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export default function PerfilMenu({ nombre, cerrarSesion }: { nombre: string; cerrarSesion: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function fuera(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hairline hover:opacity-80 transition-opacity">
        <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
          style={{ background: 'var(--ink)', color: 'white' }}>
          {nombre.charAt(0).toUpperCase()}
        </span>
        <span className="text-sm font-medium hidden md:inline">{nombre}</span>
        <ChevronDown width={13} height={13} style={{ color: 'var(--muted)' }} />
      </button>
      {abierto && (
        <div className="absolute right-0 mt-2 w-48 rounded-xl overflow-hidden z-20 glass-panel">
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <div className="text-sm font-medium">{nombre}</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>Superadmin</div>
          </div>
          <form action={cerrarSesion}>
            <button type="submit" className="w-full text-left px-4 py-2.5 text-sm hover:bg-[color-mix(in_srgb,var(--muted)_8%,transparent)]">
              Cerrar sesión
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
