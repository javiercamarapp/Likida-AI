'use client';

import { useState } from 'react';
import { numero } from '@/lib/formato';
import { VIEWBOX, TRAZO_MEXICO, PUNTOS_MEXICO } from './mexico-geo';

export interface ViajeEnMapa {
  id: string;
  folio: string;
  operadorNombre: string | null;
  origenNombre: string;
  destinoNombre: string;
  ox: number; oy: number;
  dx: number; dy: number;
  /** Días desde `fecha_inicio` (medidos), o null si no hay fecha. */
  dias: number | null;
  fotos: number;
  escalado: boolean;
  /** Haversine, redondeado — SIEMPRE rotulado "en línea recta". */
  kmRecta: number;
}

/** El arco origen→destino: cuadrática con control perpendicular, siempre
 *  abombada hacia el norte — el lenguaje de los mapas de rutas. */
function arcoDe(v: ViajeEnMapa): string | null {
  const ddx = v.dx - v.ox, ddy = v.dy - v.oy;
  const dist = Math.hypot(ddx, ddy);
  if (dist < 2) return null; // viaje local: mismo punto, sin arco
  let px = -ddy / dist, py = ddx / dist;
  if (py > 0) { px = -px; py = -py; }
  const k = Math.min(dist * 0.24, 70);
  const mx = (v.ox + v.dx) / 2 + px * k;
  const my = (v.oy + v.dy) / 2 + py * k;
  return `M${v.ox},${v.oy} Q${mx.toFixed(1)},${my.toFixed(1)} ${v.dx},${v.dy}`;
}

/**
 * El mapa VIVO (F3): la matriz de puntos de México (el lenguaje del hero de
 * píxeles, en mapa), los viajes en curso como arcos, y UN camión animado
 * sobre el viaje activo. Hover o clic en una card lo cambia.
 *
 * HONESTIDAD DEL DIBUJO: el arco es trayecto ilustrativo en línea curva
 * entre ciudades — la leyenda lo dice junto al mapa. El punto que se mueve
 * es decorativo (ilustra "va en camino"), no una posición: por eso no lleva
 * marcas de tiempo ni porcentaje de avance.
 *
 * `prefers-reduced-motion` apaga todas las animaciones vía CSS.
 */
export function MapaVivo({ viajes }: { viajes: ViajeEnMapa[] }) {
  const [fijo, setFijo] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const activoId = hover ?? fijo ?? viajes[0]?.id ?? null;
  const activo = viajes.find((v) => v.id === activoId) ?? null;

  return (
    <section className="card p-4">
      <style>{`
        @keyframes mapa-flujo { to { stroke-dashoffset: -44; } }
        @keyframes mapa-camion { from { offset-distance: 0%; } to { offset-distance: 100%; } }
        @keyframes mapa-pulso { 0%, 100% { transform: scale(1); opacity: .35; } 50% { transform: scale(2.1); opacity: 0; } }
        .mapa-arco-activo { stroke-dasharray: 5 6; animation: mapa-flujo 1.2s linear infinite; }
        .mapa-camion { offset-rotate: 0deg; animation: mapa-camion 7s ease-in-out infinite; }
        .mapa-pulso { transform-box: fill-box; transform-origin: center; animation: mapa-pulso 2.4s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .mapa-arco-activo, .mapa-camion, .mapa-pulso { animation: none !important; }
        }
      `}</style>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-4">
        <div className="relative min-w-0">
          <svg viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`} className="w-full h-auto block" role="img"
            aria-label="Mapa de México con los viajes en curso">
            {/* La tierra: trazo tenue + la matriz de puntos */}
            <path d={TRAZO_MEXICO} fillRule="evenodd" fill="var(--g1)" stroke="var(--line2)" strokeWidth={0.7} />
            {PUNTOS_MEXICO.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={1.25} fill="var(--g3)" opacity={0.5} />
            ))}

            {/* Los arcos de fondo (todos los viajes menos el activo) */}
            {viajes.map((v) => {
              if (v.id === activoId) return null;
              const d = arcoDe(v);
              return (
                <g key={v.id} opacity={0.55} className="cursor-pointer" onMouseEnter={() => setHover(v.id)}
                  onMouseLeave={() => setHover(null)} onClick={() => setFijo(v.id)}>
                  {d && <path d={d} fill="none" stroke="var(--muted)" strokeWidth={1.1} />}
                  {/* Zona de clic generosa e invisible */}
                  {d && <path d={d} fill="none" stroke="transparent" strokeWidth={12} />}
                  <circle cx={v.ox} cy={v.oy} r={1.8} fill="var(--muted)" />
                  <circle cx={v.dx} cy={v.dy} r={1.8} fill="var(--muted)" />
                </g>
              );
            })}

            {/* El viaje activo, encima de todo */}
            {activo && (() => {
              const d = arcoDe(activo);
              return (
                <g>
                  {d && <path d={d} fill="none" stroke="var(--marca)" strokeWidth={2} className="mapa-arco-activo" />}
                  <circle cx={activo.ox} cy={activo.oy} r={3} fill="none" stroke="var(--marca)" strokeWidth={1.5} />
                  <circle cx={activo.dx} cy={activo.dy} r={3.2} fill="var(--marca)" />
                  <circle cx={activo.dx} cy={activo.dy} r={3.2} fill="var(--marca)" className="mapa-pulso" />
                  {d && (
                    <circle r={3.6} fill="var(--marca)" stroke="var(--surface)" strokeWidth={1.4}
                      className="mapa-camion" style={{ offsetPath: `path('${d}')` }} />
                  )}
                  <text x={activo.ox} y={activo.oy - 7} textAnchor="middle" fontSize={11.5} fontWeight={600}
                    fill="var(--ink)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">
                    {activo.origenNombre}
                  </text>
                  <text x={activo.dx} y={activo.dy - 7} textAnchor="middle" fontSize={11.5} fontWeight={600}
                    fill="var(--ink)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">
                    {activo.destinoNombre}
                  </text>
                </g>
              );
            })()}
          </svg>

          {viajes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="hairline rounded-xl px-4 py-2.5 text-[13px] text-center max-w-[36ch]"
                style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                Sin viajes en curso ahora mismo — el próximo que despaches se dibuja aquí.
              </p>
            </div>
          )}

          <p className="text-[11px] mt-2" style={{ color: 'var(--faint)' }}>
            Trayecto ilustrativo entre origen y destino — Likida no rastrea GPS; los viajes,
            sus días y sus ciudades sí son reales.
          </p>
        </div>

        {/* Las cards de los viajes — hover ilumina, clic fija */}
        <div className="space-y-2 lg:max-h-[520px] lg:overflow-y-auto lg:pr-1">
          {viajes.length === 0 ? (
            <p className="text-[12.5px] pt-2" style={{ color: 'var(--muted)' }}>
              Aquí van las tarjetas de cada viaje en curso, con sus días en ruta y sus fotos recibidas.
            </p>
          ) : viajes.map((v) => {
            const esActivo = v.id === activoId;
            return (
              <button key={v.id} type="button"
                onMouseEnter={() => setHover(v.id)} onMouseLeave={() => setHover(null)}
                onClick={() => setFijo((f) => (f === v.id ? null : v.id))}
                className="w-full text-left rounded-xl p-3 transition-colors hairline"
                style={{
                  background: 'var(--surface)',
                  borderColor: esActivo ? 'var(--marca)' : undefined,
                }}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[13px]">{v.folio}</span>
                  {v.escalado ? (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                      style={{ color: 'var(--bad)', background: 'var(--badbg)' }}>Escalado</span>
                  ) : (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                      style={{ color: 'var(--ok)', background: 'var(--okbg)' }}>En ruta</span>
                  )}
                  {v.dias !== null && (
                    <span className="ml-auto cifra-mono text-[11px] shrink-0" style={{ color: 'var(--muted)' }}>
                      {numero(v.dias)} {v.dias === 1 ? 'día' : 'días'}
                    </span>
                  )}
                </div>
                <div className="text-[12.5px] mt-1">{v.origenNombre} → {v.destinoNombre}</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>
                  {v.operadorNombre ?? 'Sin operador asignado'}
                  {' · '}≈ {numero(v.kmRecta)} km en línea recta
                  {v.fotos > 0 && <> · {numero(v.fotos)} {v.fotos === 1 ? 'foto' : 'fotos'} en proceso</>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
