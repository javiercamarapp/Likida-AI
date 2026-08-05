'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Maximize2, Minimize2, Sparkles } from 'lucide-react';
import ChatFlota from './chat';
import type { DashboardKpis, Acreditables } from '@/lib/cuadra/analytics';
import { mxn } from '@/lib/formato';

// El ancho vive en `marco.ts`, compartido con /admin: eran 300 aquí y 276
// allá, así que el asistente cambiaba de tamaño al saltar de panel.
import { ANCHO_ASISTENTE, MARCO_ASISTENTE, MARCO_ASISTENTE_EXPANDIDO } from '../marco';
const DURACION = '480ms cubic-bezier(0.22, 1, 0.36, 1)';

interface Datos {
  nombre: string | null;
  tenantNombre: string | null;
  kpis: DashboardKpis | null;
  acred: Acreditables | null;
  anomalias: Array<{ detalle: string; monto: number }> | null;
  errorCarga?: boolean;
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

  const [expandido, setExpandido] = useState(false);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);

  // La marca que el CSS lee para retirar la columna del centro (globals.css).
  // Se limpia al desmontar: si el rail desaparece con la marca puesta, el
  // contenido se queda invisible para siempre y la página se ve vacía.
  useEffect(() => {
    const raiz = document.documentElement;
    if (expandido) raiz.dataset.asistente = 'expandido';
    else delete raiz.dataset.asistente;
    return () => { delete raiz.dataset.asistente; };
  }, [expandido]);

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
  // AUDITORÍA 12, BAJO (backend): el server ahora distingue "no hay datos" de
  // "no se pudo leer" (errorCarga). Un bache de Supabase ya no deja el widget
  // en blanco sin rastro: se dice que no se pudo leer, en vez de pintar nada.
  const errorCarga = datos?.errorCarga ?? false;


  return (
    // EXPANDIDO SE SALE DEL FLUJO, no crece dentro de él.
    //
    // Antes pedía `width: 100%` siendo hermano flex del sidebar y del
    // contenido: sidebar + 100% + gaps no cabe, el rail se desbordaba a la
    // derecha y el botón de contraer —pegado al borde con `ml-auto`— quedaba
    // FUERA de la pantalla. El síntoma no era "no responde" sino "no lo veo",
    // y por eso no se podía cerrar.
    //
    // Expandido se vuelve `fixed`, así sale del cálculo del flex: ocupa el
    // viewport, que es lo que "pantalla completa" quiere decir, y el botón
    // siempre cae dentro (ver MARCO_ASISTENTE_EXPANDIDO en marco.ts).
    <aside
      className={`glass-panel shrink-0 hidden xl:flex flex-col ${
        expandido ? MARCO_ASISTENTE_EXPANDIDO : `${MARCO_ASISTENTE} top-4`
      }`}
      style={expandido ? undefined : { width: ANCHO_ASISTENTE, transition: `width ${DURACION}` }}
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
              : `Hola ${datos?.nombre ?? 'de nuevo'}${datos?.tenantNombre ? ` — viendo ${datos.tenantNombre}` : ''}. Pregúntame lo que quieras de tu operación.`}
          </div>

          {/* Smart Insight — solo con un hallazgo REAL. Un recuadro verde que
              dice "todo bien" cuando no se revisó nada entrena a ignorarlo. */}
          {errorCarga ? (
            <div className="rounded-lg p-2.5" style={{ background: 'color-mix(in srgb, var(--color-warn) 10%, transparent)' }}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-warn)' }}>
                <Sparkles width={11} height={11} strokeWidth={2} /> Smart Insight
              </div>
              <p className="text-[13px] leading-snug">No se pudieron leer las cifras ahora mismo. Recarga en un momento.</p>
            </div>
          ) : anomalias && anomalias.length > 0 ? (
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
