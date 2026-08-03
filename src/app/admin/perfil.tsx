'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ChevronDown, UserRound, LogOut } from 'lucide-react';

/**
 * Antes el menú abría HACIA ABAJO (`mt-2`) — como este botón vive en la
 * fila de hasta abajo del sidebar, el menú se salía del `overflow-hidden`
 * del `<aside>` y quedaba invisible (pedido explícito: "que no aparezca
 * abajo porque no se ve"). Ahora abre HACIA ARRIBA (`bottom-full mb-2`,
 * anclado al borde de ABAJO del botón) con una transición de opacidad +
 * deslizamiento — mismo criterio `animate-in`/easeOutQuint que el resto
 * de /admin, no una librería nueva.
 */
export default function PerfilMenu({
  nombre, avatarUrl, cerrarSesion,
}: { nombre: string; avatarUrl?: string | null; cerrarSesion: () => void }) {
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
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar de usuario, no next/image en el resto del repo
          <img src={avatarUrl} alt={nombre} className="w-7 h-7 rounded-full object-cover shrink-0" />
        ) : (
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
            style={{ background: 'var(--ink)', color: 'white' }}>
            {nombre.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="text-sm font-medium hidden md:inline">{nombre}</span>
        <ChevronDown width={13} height={13} style={{ color: 'var(--muted)' }} />
      </button>

      {abierto && (
        <div
          // `left-0` a propósito, no `right-0`: el botón vive pegado al
          // borde IZQUIERDO del sidebar (la campana ocupa la derecha con
          // `ml-auto`), así que anclar el menú por la derecha lo hacía
          // salirse por la izquierda del sidebar entero — se veía flotando
          // fuera de su propia tarjeta.
          className="absolute left-0 bottom-full mb-2 w-52 rounded-xl overflow-hidden z-20 glass-panel origin-bottom-left"
          style={{ animation: 'perfil-menu-in 200ms cubic-bezier(0.22, 1, 0.36, 1) both' }}
        >
          <div className="px-4 py-3 border-b flex items-center gap-2.5" style={{ borderColor: 'var(--line)' }}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={nombre} className="w-8 h-8 rounded-full object-cover shrink-0" />
            ) : (
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                style={{ background: 'var(--ink)', color: 'white' }}>
                {nombre.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{nombre}</div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Superadmin</div>
            </div>
          </div>

          <Link href="/admin/mi-perfil" onClick={() => setAbierto(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-[color-mix(in_srgb,var(--muted)_8%,transparent)] transition-colors">
            <UserRound width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
            Mi perfil
          </Link>

          <form action={cerrarSesion} className="border-t" style={{ borderColor: 'var(--line)' }}>
            <button type="submit"
              className="w-full flex items-center gap-2.5 text-left px-4 py-2.5 text-sm hover:bg-[color-mix(in_srgb,var(--muted)_8%,transparent)] transition-colors">
              <LogOut width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              Cerrar sesión
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
