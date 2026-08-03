'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Maximize2, Minimize2, Sparkles, ReceiptText, ScanText, TrendingUp, Truck,
} from 'lucide-react';
import ChatFlota from './chat';
import type { DashboardKpis, Acreditables } from '@/lib/cuadra/analytics';
import { mxn } from '@/lib/formato';

const ANCHO = 300;
const DURACION = '480ms cubic-bezier(0.22, 1, 0.36, 1)';

interface Datos {
  nombre: string | null;
  tenantNombre: string | null;
  kpis: DashboardKpis | null;
  acred: Acreditables | null;
  anomalias: Array<{ detalle: string; monto: number }> | null;
}

/**
 * El rail del Asistente, ahora FIJO en las 20 páginas (vive en `chrome.tsx`,
 * el marco del layout) en vez de solo en Inicio.
 *
 * Es cliente porque necesita dos cosas que un layout server no tiene: la URL
 * (`?tenant=`, para saber de qué flota hablar cuando un superadmin mira a un
 * cliente) y el estado de expandir/contraer. Los datos los pide a
 * `/api/dashboard/asistente`, que rehace la autorización completa —el
 * `?tenant=` que va en la petición NO se cree por sí solo.
 */
export default function RailAsistente() {
  const sp = useSearchParams();
  const tenant = sp.get('tenant');
  const vista = sp.get('vista');
  const sufijo = tenant ? `?tenant=${tenant}` : vista ? `?vista=${vista}` : '';

  const [expandido, setExpandido] = useState(false);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);

  // Sin `setCargando(true)` síncrono aquí: llamar setState en el cuerpo del
  // efecto encadena un render de más (regla `react-hooks/set-state-in-effect`).
  // El estado ya arranca en `true`, y al cambiar de tenant el `finally` lo
  // vuelve a poner en `false` cuando la nueva respuesta llega — mientras
  // tanto se sigue viendo la anterior, que es mejor que un parpadeo a vacío.
  useEffect(() => {
    let vivo = true;
    fetch(`/api/dashboard/asistente${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setDatos(d); })
      .catch(() => { /* el rail es accesorio: si falla, se queda sin datos, no rompe la página */ })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [tenant]);

  const kpis = datos?.kpis ?? null;
  const acred = datos?.acred ?? null;
  const anomalias = datos?.anomalias ?? null;

  const accesos = [
    { href: `/dashboard/cuadre${sufijo}`, Icono: ReceiptText, titulo: 'Cuadre / Liquidación', sub: kpis ? `${kpis.viajesLiquidados} cerradas` : 'Detalle por viaje' },
    { href: `/dashboard/documentos${sufijo}`, Icono: ScanText, titulo: 'Documentos (OCR)', sub: 'Comprobantes procesados' },
    { href: `/dashboard/valor-ahorro${sufijo}`, Icono: TrendingUp, titulo: 'Valor & Ahorro', sub: 'Lo que Likida te ahorra' },
    { href: `/dashboard/viajes${sufijo}`, Icono: Truck, titulo: 'Viajes', sub: 'Estado de la operación' },
  ];

  return (
    <aside
      className="glass-panel shrink-0 hidden xl:flex flex-col sticky top-4 self-start h-[calc(100dvh-2rem)]"
      style={{ width: expandido ? '100%' : ANCHO, transition: `width ${DURACION}` }}
    >
      <div className="flex items-center gap-2 px-3.5 pt-3.5 shrink-0">
        <Sparkles width={14} height={14} strokeWidth={1.75} />
        <span className="font-semibold text-[13px]">Asistente de negocio</span>
        <button type="button" onClick={() => setExpandido((v) => !v)}
          aria-label={expandido ? 'Contraer chat' : 'Expandir chat a pantalla completa'}
          className="ml-auto w-6 h-6 rounded-md hairline flex items-center justify-center hover:opacity-70 transition-opacity"
          style={{ background: 'var(--surface)' }}>
          {expandido
            ? <Minimize2 width={12} height={12} strokeWidth={1.75} />
            : <Maximize2 width={12} height={12} strokeWidth={1.75} />}
        </button>
      </div>

      {!expandido && (
        <div className="flex-1 min-w-0 overflow-y-auto px-3.5 pt-2 space-y-2.5">
          <div className="rounded-lg p-2.5 text-[13px] leading-snug" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
            {cargando
              ? 'Cargando lo de hoy…'
              : `Hola ${datos?.nombre ?? 'de nuevo'}${datos?.tenantNombre ? ` — viendo ${datos.tenantNombre}` : ''}. Aquí tienes accesos rápidos.`}
          </div>

          <div className="space-y-1">
            {accesos.map((a) => (
              <Link key={a.titulo} href={a.href}
                className="flex items-center gap-2 p-2 rounded-lg hairline transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)]">
                <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                  <a.Icono width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
                </div>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium truncate leading-tight">{a.titulo}</span>
                  <span className="block text-[11px] truncate" style={{ color: 'var(--muted)' }}>{a.sub}</span>
                </span>
              </Link>
            ))}
          </div>

          {/* Smart Insight — solo con un hallazgo REAL. Un recuadro verde que
              dice "todo bien" cuando no se revisó nada entrena a ignorarlo. */}
          {anomalias && anomalias.length > 0 ? (
            <div className="rounded-lg p-2.5" style={{ background: 'color-mix(in srgb, var(--color-ok) 10%, transparent)' }}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-ok)' }}>
                <Sparkles width={11} height={11} strokeWidth={2} /> Smart Insight
              </div>
              <p className="text-[13px] leading-snug">
                {anomalias.length} comprobante{anomalias.length === 1 ? '' : 's'} en más de un viaje,
                por {mxn(anomalias.reduce((s, a) => s + a.monto, 0))}. Coincidencia detectada, no un veredicto.
              </p>
            </div>
          ) : kpis && kpis.viajesLiquidados > 0 ? (
            <div className="rounded-lg p-2.5" style={{ background: 'color-mix(in srgb, var(--color-ok) 10%, transparent)' }}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-ok)' }}>
                <Sparkles width={11} height={11} strokeWidth={2} /> Smart Insight
              </div>
              <p className="text-[13px] leading-snug">
                Tasa de cuadre {kpis.tasaCuadre}% — {kpis.viajesLiquidados - kpis.conDiferencias - kpis.porRevisar} de {kpis.viajesLiquidados} cerraron sin diferencias.
              </p>
            </div>
          ) : null}
        </div>
      )}

      <div className={expandido ? 'flex-1 min-w-0 flex flex-col px-3.5 pb-3.5 pt-2 overflow-hidden' : 'shrink-0 px-3.5 py-2.5 border-t'}
        style={expandido ? undefined : { borderColor: 'var(--line)' }}>
        {expandido ? (
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <ChatFlota kpis={kpis} acred={acred} />
          </div>
        ) : (
          <ChatFlota kpis={kpis} acred={acred} compacto />
        )}
      </div>
    </aside>
  );
}
