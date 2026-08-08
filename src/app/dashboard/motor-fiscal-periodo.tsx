'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { mxn } from '@/lib/formato';

const BOTON = 'w-4 h-4 rounded flex items-center justify-center transition-opacity disabled:opacity-30 hover:bg-black/5 disabled:hover:bg-transparent';

type Modo = 'semanal' | 'mensual' | 'historico';
const MODOS: Modo[] = ['semanal', 'mensual', 'historico'];
const ETIQUETA_MODO: Record<Modo, string> = {
  semanal: 'últimos 7 días', mensual: 'últimos 30 días', historico: 'histórico',
};

interface ResumenSimple { montoPerdido: number; montoEnRiesgo: number; montoRecuperable: number }

/**
 * "En riesgo/perdido" y "Recuperable pidiendo factura" a nivel de KPI, con
 * flechas ‹ › propias — dirección del 8-ago-2026: antes vivían solo dentro
 * de "Tu motor fiscal" (más abajo, fijas al ejercicio); Javier pidió
 * subirlas al mismo nivel de prominencia que Gasto total/Costo por viaje Y
 * que también ciclen semanal/mensual/histórico, igual que esas dos. En la
 * MISMA línea que "Diésel elegible", ocupando todo el ancho disponible
 * (`flex-1`, no anchos fijos) — por eso este componente NO envuelve las 2
 * tarjetas en su propio grid: `page.tsx` las mete junto con Diésel en un
 * solo `flex flex-wrap`, y cada una crece a lo que le toque.
 *
 * `series` ya trae los 3 `ResumenPerdidas` PRE-CALCULADOS por el servidor
 * (`page.tsx`) — este componente solo elige cuál mostrar. `resumirPerdidas`
 * vive en `fiscal.ts`, que importa `supabaseAdmin` a nivel de módulo: un
 * Client Component no puede importar ese archivo en tiempo de ejecución
 * (arrastraría el service-role al bundle del navegador), así que el cálculo
 * tiene que llegar ya hecho, como datos planos.
 */
export function MotorFiscalPeriodo({ series }: { series: Record<Modo, ResumenSimple> | null }) {
  const [modoIdx, setModoIdx] = useState(0);
  const modo = MODOS[modoIdx];

  if (!series) {
    return <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo leer el motor fiscal en este momento.</p>;
  }
  const r = series[modo];

  return (
    <>
      <div className="rounded-2xl p-4 flex-1 min-w-[200px]" style={{ background: 'color-mix(in srgb, var(--color-bad) 10%, transparent)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium" style={{ color: 'var(--muted)' }}>En riesgo / perdido</div>
          <div className="flex items-center gap-0 shrink-0">
            <button type="button" aria-label="Periodo más corto" disabled={modoIdx <= 0}
              onClick={() => setModoIdx((i) => Math.max(i - 1, 0))} className={BOTON} style={{ color: 'var(--muted)' }}>
              <ChevronLeft width={12} height={12} strokeWidth={2} />
            </button>
            <button type="button" aria-label="Periodo más largo" disabled={modoIdx >= MODOS.length - 1}
              onClick={() => setModoIdx((i) => Math.min(i + 1, MODOS.length - 1))} className={BOTON} style={{ color: 'var(--muted)' }}>
              <ChevronRight width={12} height={12} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="text-xl font-semibold tracking-tight tabular mt-1" style={{ color: 'var(--color-bad)' }}>
          {mxn(r.montoEnRiesgo + r.montoPerdido)}
        </div>
        <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>{ETIQUETA_MODO[modo]}</div>
      </div>
      <div className="rounded-2xl p-4 flex-1 min-w-[200px]" style={{ background: 'color-mix(in srgb, var(--color-ok) 10%, transparent)' }}>
        <div className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Recuperable pidiendo factura</div>
        <div className="text-xl font-semibold tracking-tight tabular mt-1" style={{ color: 'var(--color-ok)' }}>
          {mxn(r.montoRecuperable)}
        </div>
        <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>{ETIQUETA_MODO[modo]}</div>
      </div>
    </>
  );
}
