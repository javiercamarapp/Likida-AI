'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { numero } from '@/lib/formato';
import { TablaViajes, TituloSeccion, type FilaViaje } from './resumen-visual';

/**
 * La tarjeta "Viajes recientes" con su botón de abrir (pedido del 12-ago):
 * colapsada enseña 6; el botón despliega las filas ya cargadas (el tope de
 * 100 de `getViajes`) ahí mismo.
 *
 * ── FE-5 (22-ago-2026): "Ver los 100" NO puede sonar a "ver todos" ─────────
 *
 * El botón decía "Ver los {filas.length}", y con el tope siempre lleno eso es
 * literalmente "Ver los 100" — que a 50,000 viajes/mes se lee como el total
 * de la flota y son los últimos ~90 minutos. El rótulo ahora dice "más
 * recientes" cuando el tope está tocado, y al lado va el link al registro
 * completo, que es donde sí están todos (con su paginación por cursor).
 */
const TOPE_CARGADAS = 100;

export function ViajesRecientes({ filas, sufijo }: { filas: FilaViaje[]; sufijo: string }) {
  const [abierto, setAbierto] = useState(false);
  const visibles = abierto ? filas : filas.slice(0, 6);
  // Tope tocado = casi seguro hay más de las que se ven. No se AFIRMA cuántas
  // (nadie las contó aquí): se dice que éstas son las más recientes y se
  // ofrece la puerta a la lista real.
  const topeTocado = filas.length >= TOPE_CARGADAS;

  return (
    <div className="card p-3 mt-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <TituloSeccion>Viajes recientes</TituloSeccion>
        <div className="flex items-center gap-2 shrink-0">
          {topeTocado && (
            <Link href={`/dashboard/viajes${sufijo}`}
              className="text-[11px] hover:opacity-70 transition-opacity" style={{ color: 'var(--muted)' }}>
              Ver el registro completo →
            </Link>
          )}
          {filas.length > 6 && (
            <button type="button" onClick={() => setAbierto((v) => !v)}
              className="hairline inline-flex items-center gap-1 text-[12px] font-medium px-2.5 h-7 rounded-lg transition-colors hover:bg-[var(--canvas)] shrink-0">
              {abierto
                ? <>Ver menos <ChevronUp width={13} height={13} strokeWidth={2} /></>
                : (
                  <>
                    Ver {topeTocado ? `las ${numero(filas.length)} más recientes` : `las ${numero(filas.length)}`}
                    <ChevronDown width={13} height={13} strokeWidth={2} />
                  </>
                )}
            </button>
          )}
        </div>
      </div>
      {/* Abierta, la lista NO estira la tarjeta: scrollea adentro con el
          encabezado pegado (sticky en TablaViajes). */}
      <div className={abierto ? 'max-h-[300px] overflow-y-auto pr-1' : ''}>
        <TablaViajes viajes={visibles} sufijo={sufijo} />
      </div>
    </div>
  );
}
