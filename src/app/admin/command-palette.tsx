'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { TODAS_LAS_RUTAS } from './rutas';

/**
 * ⌘K (Ctrl+K en Windows/Linux) — buscador rápido de las 27 rutas de
 * /admin, pedido en el complemento de diseño (§B: CommandPalette). Sin
 * librería nueva: un `<dialog>`-like overlay a mano, filtrado por
 * substring sobre `TODAS_LAS_RUTAS` (la MISMA lista que arma el sidebar,
 * no una copia que se pueda desincronizar). Flechas ↑↓ + Enter navegan,
 * Esc cierra, clic fuera cierra.
 */
export default function CommandPalette() {
  const [abierto, setAbierto] = useState(false);
  const [abiertoPrevio, setAbiertoPrevio] = useState(abierto);
  const [consulta, setConsulta] = useState('');
  const [consultaPrevia, setConsultaPrevia] = useState(consulta);
  const [activo, setActivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Reiniciar consulta/activo al ABRIR, y reiniciar activo cada vez que
  // cambia el texto de búsqueda — ajuste de estado derivado de un cambio,
  // hecho EN el render con el mismo patrón de estado-anterior que
  // `contador-retro.tsx` (comparar contra un REF durante el render está
  // prohibido por el lint de este repo — `react-hooks/refs` —, así que el
  // "valor anterior" se guarda en estado, no en un ref). El efecto de
  // abajo solo hace la parte que sí es un timer/DOM real: enfocar el input.
  if (abierto !== abiertoPrevio) {
    setAbiertoPrevio(abierto);
    if (abierto) { setConsulta(''); setActivo(0); }
  }
  if (consulta !== consultaPrevia) {
    setConsultaPrevia(consulta);
    setActivo(0);
  }

  const resultados = useMemo(() => {
    const q = consulta.trim().toLowerCase();
    if (!q) return TODAS_LAS_RUTAS;
    return TODAS_LAS_RUTAS.filter((r) => r.nombre.toLowerCase().includes(q));
  }, [consulta]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAbierto((v) => !v);
      } else if (e.key === 'Escape') {
        setAbierto(false);
      }
    }
    // El botón "Buscar" del sidebar (layout.tsx) dispara este evento en vez
    // de compartir estado de React — es más simple que levantar el estado
    // hasta el layout (Server Component) solo para un botón.
    function onAbrir() { setAbierto(true); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('likida:abrir-buscador', onAbrir);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('likida:abrir-buscador', onAbrir);
    };
  }, []);

  useEffect(() => {
    if (!abierto) return;
    // Un tick para que el input ya esté montado (recién apareció el
    // overlay) antes de enfocarlo — timer real, sí pertenece a un efecto.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [abierto]);

  function ir(href: string) {
    setAbierto(false);
    router.push(href);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((i) => Math.min(i + 1, resultados.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (resultados[activo]) ir(resultados[activo].href); }
  }

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={() => setAbierto(false)}
    >
      <div className="w-full rounded-2xl overflow-hidden glass-panel" style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ borderColor: 'var(--line)' }}>
          <Search width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          <input
            ref={inputRef}
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Buscar página… (Inicio, Cuadre, Facturación…)"
            className="flex-1 min-w-0 text-sm bg-transparent outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded hairline shrink-0" style={{ color: 'var(--muted)' }}>Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1.5">
          {resultados.length === 0 ? (
            <div className="px-4 py-6 text-sm text-center" style={{ color: 'var(--muted)' }}>Sin resultados.</div>
          ) : (
            resultados.map(({ href, nombre, Icono }, i) => (
              <button key={href} type="button" onClick={() => ir(href)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors"
                style={i === activo ? { background: 'var(--ink)', color: 'white' } : undefined}
                onMouseEnter={() => setActivo(i)}
              >
                <Icono width={15} height={15} strokeWidth={1.75} style={{ color: i === activo ? 'white' : 'var(--muted)' }} />
                {nombre}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
