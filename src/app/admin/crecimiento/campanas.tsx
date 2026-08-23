'use client';

import { useState, useTransition } from 'react';
import { StatusPill, type Estado } from '../ui/kit';
import { usd } from '@/lib/utils';
import { numero, fechaCorta } from '@/lib/formato';
import type { Campana, EstadoIntegracionAds } from '@/lib/admin/campanas';

// ═══════════════════════════════════════════════════════════════════════════
// EL CONTROL DE CAMPAÑAS (0123, §4) — la parte interactiva: pausar de un
// clic y refrescar el gasto. TODO LO QUE DECIDE VIVE EN EL SERVIDOR (server
// actions re-gateadas): aquí solo botones y la verdad en pantalla — el CPL
// real solo se calcula con gasto MEDIDO y leads reales, jamás proyectado.
// ═══════════════════════════════════════════════════════════════════════════

const PILL: Record<string, Estado> = { activa: 'ok', pausada: 'neutral', terminada: 'neutral' };

export type AccionCampana = { ok: true; mensaje: string } | { ok: false; error: string };

export function ControlCampanas({ campanas, integracion, leadsAds, pausar, refrescar }: {
  campanas: Campana[];
  integracion: EstadoIntegracionAds;
  /** Leads con fuente `ads` — el denominador REAL del CPL. */
  leadsAds: number;
  pausar: (id: string) => Promise<AccionCampana>;
  refrescar: () => Promise<AccionCampana>;
}) {
  const [pendiente, empezar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const correr = (fn: () => Promise<AccionCampana>) => {
    setAviso(null);
    empezar(async () => {
      const r = await fn();
      setAviso(r.ok ? { ok: true, texto: r.mensaje } : { ok: false, texto: r.error });
    });
  };

  return (
    <div>
      <p className="text-[11.5px] mt-1 m-0" style={{ color: 'var(--muted)' }}>{integracion.nota}</p>

      {campanas.length === 0 ? (
        <p className="text-sm mt-2 m-0" style={{ color: 'var(--muted)' }}>
          Cero campañas registradas. Activar una exige tu aprobación firmada (el candado es de
          base: sin aprobador no puede estar activa) — el agente de campañas solo PROPONE.
        </p>
      ) : (
        // FE-19: cinco columnas con nombre de campaña libre y cuatro cifras —
        // scrollea dentro de su bloque, no estira la página.
        <div className="overflow-x-auto mt-2">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: 'var(--line)' }}>
              <th className="py-1.5 text-[11px] uppercase font-semibold" style={{ color: 'var(--muted)' }}>Campaña</th>
              <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Presupuesto</th>
              <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Gasto real</th>
              <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>CPL real vs objetivo</th>
              <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {campanas.map((c) => {
              // CPL real SOLO con gasto medido y leads de ads reales.
              const cpl = c.gastoRealUsd !== null && leadsAds > 0 ? c.gastoRealUsd / leadsAds : null;
              return (
                <tr key={c.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}>
                  <td className="py-2">
                    <span className="font-medium">{c.nombre}</span>
                    <span className="block text-[10.5px]" style={{ color: 'var(--faint)' }}>
                      {c.canal}{c.aprobadoPorEmail ? ` · aprobada por ${c.aprobadoPorEmail}` : ''}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular">{usd(c.presupuestoAprobadoUsd)}</td>
                  <td className="py-2 text-right">
                    {c.gastoRealUsd !== null
                      ? <span className="tabular">{usd(c.gastoRealUsd)}<span className="block text-[10px]" style={{ color: 'var(--faint)' }}>medido {c.gastoMedidoEn ? fechaCorta(c.gastoMedidoEn) : ''}</span></span>
                      : <span style={{ color: 'var(--muted)' }}>sin medir</span>}
                  </td>
                  <td className="py-2 text-right">
                    {cpl !== null
                      ? <span className="tabular">{usd(cpl)} ({numero(leadsAds)} leads){c.cplObjetivoUsd !== null ? ` vs ${usd(c.cplObjetivoUsd)}` : ''}</span>
                      : <span style={{ color: 'var(--muted)' }}>{c.gastoRealUsd === null ? 'sin gasto medido' : 'cero leads de ads'}</span>}
                  </td>
                  <td className="py-2 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <StatusPill estado={PILL[c.estado] ?? 'neutral'}>{c.estado}</StatusPill>
                      {c.estado === 'activa' && (
                        <button type="button" disabled={pendiente}
                          onClick={() => correr(() => pausar(c.id))}
                          className="text-[11px] font-medium px-2 py-1 rounded-md hairline transition-colors hover:bg-[var(--canvas)] disabled:opacity-50"
                          style={{ color: 'var(--bad)' }}>
                          Pausar
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        {integracion.metaConfigurada && campanas.some((c) => c.canal === 'meta' && c.idExterno) && (
          <button type="button" disabled={pendiente}
            onClick={() => correr(refrescar)}
            className="text-[11.5px] font-medium px-3 py-1.5 rounded-full hairline transition-colors hover:bg-[var(--canvas)] disabled:opacity-50">
            {pendiente ? 'Midiendo…' : 'Actualizar gasto desde Meta'}
          </button>
        )}
        {aviso && (
          <p className="text-[12px] m-0" style={{ color: aviso.ok ? 'var(--ok)' : 'var(--bad)' }}>{aviso.texto}</p>
        )}
      </div>
    </div>
  );
}
