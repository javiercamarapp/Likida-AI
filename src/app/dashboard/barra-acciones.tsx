'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Sparkles, Bell } from 'lucide-react';

/**
 * Los tres controles de la barra superior de la referencia FlowAI —
 * búsqueda, "Ask AI" y campana — construidos sobre lo que SÍ existe:
 *
 *  · La búsqueda busca entre los VIAJES reales de la flota (folio, ruta,
 *    operador). Un resultado con liquidación navega a su detalle; uno sin
 *    liquidación se enseña igual pero dice que aún no tiene — encontrar el
 *    folio y saber su estado también es una respuesta.
 *  · "Preguntar a la IA" navega a `/dashboard/chat` — la página hero del
 *    asistente (estilo usehandle.ai), reconstruida el 12-ago. No es un chat
 *    nuevo: es la casa grande del que ya contesta.
 *  · La campana enseña los PENDIENTES reales (liquidaciones por revisar,
 *    comprobantes duplicados). Sin sistema de notificaciones inventado:
 *    cuando no hay nada, dice que no hay nada.
 */

export interface ItemBusqueda {
  etiqueta: string;
  detalle: string;
  /** null = el viaje aún no tiene liquidación a la cual navegar. */
  href: string | null;
}

const BOTON_BARRA = 'hairline h-8 rounded-lg inline-flex items-center justify-center gap-1.5 text-[13px] font-medium transition-colors hover:bg-[var(--canvas)] shrink-0';

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function BarraAcciones({ items, pendientes, hrefAsistente = '/dashboard/chat' }: { items: ItemBusqueda[]; pendientes: string[]; hrefAsistente?: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<'busqueda' | 'campana' | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  // Cerrar al hacer clic fuera — un dropdown que se queda pegado se lee
  // como interfaz rota.
  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(null);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const nq = normalizar(q.trim());
  const resultados = nq.length === 0 ? [] : items.filter((i) =>
    normalizar(`${i.etiqueta} ${i.detalle}`).includes(nq)).slice(0, 8);

  return (
    <div ref={raiz} className="flex items-center gap-2 shrink-0 relative">
      {/* ── Búsqueda ── */}
      <div className="relative hidden md:block">
        <Search width={14} height={14} strokeWidth={1.75} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--faint)' }} />
        <input
          type="text" value={q} placeholder="Buscar un viaje..."
          onChange={(e) => { setQ(e.target.value); setAbierto('busqueda'); }}
          onFocus={() => setAbierto('busqueda')}
          className="hairline h-8 w-56 rounded-lg pl-8 pr-3 text-[13px] outline-none focus:border-[var(--muted)] transition-colors"
          style={{ background: 'var(--surface)' }}
        />
        {abierto === 'busqueda' && nq.length > 0 && (
          <div className="absolute right-0 top-9 w-80 card p-1.5 z-30 max-h-72 overflow-y-auto">
            {resultados.length === 0 ? (
              <p className="text-[13px] px-2.5 py-2" style={{ color: 'var(--muted)' }}>
                Ningún viaje coincide con «{q.trim()}».
              </p>
            ) : resultados.map((r) => (
              <button key={`${r.etiqueta}-${r.detalle}`} type="button"
                disabled={!r.href}
                onClick={() => { if (r.href) { setAbierto(null); setQ(''); router.push(r.href); } }}
                className="w-full text-left px-2.5 py-2 rounded-lg transition-colors hover:bg-[var(--canvas)] disabled:hover:bg-transparent disabled:cursor-default">
                <span className="text-[13px] font-medium block">{r.etiqueta}</span>
                <span className="text-xs block mt-0.5" style={{ color: 'var(--muted)' }}>
                  {r.detalle}{!r.href && ' · aún sin liquidación'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Preguntar a la IA — abre SU página (/dashboard/chat, estilo
          usehandle.ai), pedido del 12-ago; antes expandía el rail. ── */}
      <button type="button" className={`${BOTON_BARRA} px-3`}
        onClick={() => { setAbierto(null); router.push(hrefAsistente); }}>
        <Sparkles width={14} height={14} strokeWidth={1.75} />
        Preguntar a la IA
      </button>

      {/* ── Pendientes reales ── */}
      <div className="relative">
        <button type="button" aria-label="Pendientes" className={`${BOTON_BARRA} w-8`}
          onClick={() => setAbierto(abierto === 'campana' ? null : 'campana')}>
          <Bell width={14} height={14} strokeWidth={1.75} />
          {pendientes.length > 0 && (
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--bad)' }} />
          )}
        </button>
        {abierto === 'campana' && (
          <div className="absolute right-0 top-9 w-72 card p-1.5 z-30">
            {pendientes.length === 0 ? (
              <p className="text-[13px] px-2.5 py-2" style={{ color: 'var(--muted)' }}>Sin pendientes por ahora.</p>
            ) : pendientes.map((p) => (
              <div key={p} className="px-2.5 py-2 text-[13px] flex items-start gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: 'var(--warn)' }} />
                {p}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
