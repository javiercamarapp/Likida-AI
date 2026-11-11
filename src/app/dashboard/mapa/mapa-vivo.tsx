'use client';

import { nivelDePosicion, ROTULO_FRESCURA, type NivelFrescura } from '@/lib/likida/gps_salud';
import { useState } from 'react';
import { numero } from '@/lib/formato';
import { StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { VIEWBOX, TRAZO_MEXICO, PUNTOS_MEXICO } from './mexico-geo';
import './mapa.css';

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

/**
 * Una POSICIÓN MEDIDA de una unidad, ya proyectada al viewBox (auditoría 20).
 *
 * No es un `ViajeEnMapa` ni se dibuja como uno: aquélla es una línea entre dos
 * ciudades de catálogo (ilustrativa) y ésta es una coordenada que un GPS
 * reportó a una hora. Mezclarlas en el mismo tipo sería el primer paso para
 * mezclarlas en el mismo rótulo.
 */
export interface PinUnidad {
  unidadId: string;
  /** Número económico, o placas si no hay. Es como la flota la nombra. */
  etiqueta: string;
  placas: string | null;
  /** `unidad.estado` crudo (disponible|en_ruta|taller|baja). */
  estadoUnidad: string;
  x: number; y: number;
  /** Las coordenadas CRUDAS, además de la proyección: la tabla las enseña
   *  para que la posición se pueda verificar fuera de Likida (pegarlas en
   *  cualquier mapa). Un pin que solo existe como pixel no es verificable. */
  lat: number; lng: number;
  /** ISO de `medida_en` — la hora del GPS, no la de la inserción. */
  medidaEn: string;
  /** Minutos de antigüedad, calculados EN EL SERVIDOR (ver page.tsx). */
  minutos: number;
  velocidadKmh: number | null;
  proveedor: string;
  /** `true` = el pin es el del chofer por WhatsApp y esta unidad SÍ tiene un
   *  dispositivo GPS ligado: el GPS no reportó y el pin es el respaldo. */
  respaldoWa?: boolean;
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
 * píxeles, en mapa) y los viajes en curso como arcos; el trayecto del viaje
 * activo fluye y su destino pulsa. Hover o clic en una card lo cambia.
 * (El punto que recorría el arco se quitó en la Fase 8: dependía de un `style=`
 * por viaje y solo ilustraba «va en camino».)
 *
 * HONESTIDAD DEL DIBUJO — y son DOS cosas distintas sobre el mismo lienzo:
 *
 *   · el ARCO es trayecto ilustrativo en línea curva entre ciudades, y su
 *     animación es decorativa (ilustra "va en camino"), no una posición:
 *     por eso no lleva marcas de tiempo ni % de avance;
 *   · el PIN CUADRADO es una posición MEDIDA (auditoría 20): coordenada real
 *     que reportó el GPS de la unidad o el chofer por WhatsApp, con su hora
 *     en la tabla de abajo. Se dibuja con otra forma y otro color a propósito
 *     — si se pareciera al arco, el dato y el dibujo se leerían igual.
 *
 * `prefers-reduced-motion` apaga todas las animaciones vía CSS.
 */
export function MapaVivo({ viajes, pines = [] }: {
  viajes: ViajeEnMapa[];
  /** Posiciones medidas por unidad. Vacío = la flota no tiene GPS todavía. */
  pines?: PinUnidad[];
}) {
  const [fijo, setFijo] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const activoId = hover ?? fijo ?? viajes[0]?.id ?? null;
  const activo = viajes.find((v) => v.id === activoId) ?? null;

  return (
    <Tarjeta titulo="Viajes en curso sobre México" info="mapa.en_el_mapa">
      <div className="rv-mp__rejilla">
        <div className="rv-mp__lienzo">
          <svg viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`} className="rv-mp__svg" role="img"
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
                <g key={v.id} className="rv-mp__arco" onMouseEnter={() => setHover(v.id)}
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
                  {d && <path d={d} fill="none" stroke="var(--ink)" strokeWidth={2} className="rv-mp__activo" />}
                  <circle cx={activo.ox} cy={activo.oy} r={3} fill="none" stroke="var(--ink)" strokeWidth={1.5} />
                  <circle cx={activo.dx} cy={activo.dy} r={3.2} fill="var(--ink)" />
                  <circle cx={activo.dx} cy={activo.dy} r={3.2} fill="var(--ink)" className="rv-mp__pulso" />
                  <text x={activo.ox} y={activo.oy - 7} textAnchor="middle" fontSize={12} fontWeight={600}
                    fill="var(--ink)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">
                    {activo.origenNombre}
                  </text>
                  <text x={activo.dx} y={activo.dy - 7} textAnchor="middle" fontSize={12} fontWeight={600}
                    fill="var(--ink)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">
                    {activo.destinoNombre}
                  </text>
                </g>
              );
            })()}

            {/* Los PINES medidos, encima de todo: cuadrado girado 45° (no un círculo, que es el vocabulario de los extremos del arco)
                y en --ok si reportó hace poco, --faint si lleva horas callado. */}
            {pines.map((p) => {
              const nivel: NivelFrescura = nivelDePosicion(p.minutos);
              const fresco = nivel === 'en_vivo';
              const relleno = nivel === 'en_vivo' ? 'var(--ok)' : nivel === 'atrasada' ? 'var(--warn)' : 'var(--faint)';
              return (
                <g key={p.unidadId}>
                  <rect x={p.x - 3.2} y={p.y - 3.2} width={6.4} height={6.4}
                    transform={`rotate(45 ${p.x} ${p.y})`}
                    fill={relleno}
                    stroke="var(--surface)" strokeWidth={1.2}>
                    <title>
                      {`${p.etiqueta} — ${ROTULO_FRESCURA[nivel]}${fresco ? '' : ': última posición conocida, no dónde está ahora'} (${p.respaldoWa ? 'pin del chofer, respaldo del GPS' : p.proveedor})`}
                    </title>
                  </rect>
                  <text x={p.x} y={p.y + 11} textAnchor="middle" fontSize={11} fontWeight={600}
                    fill="var(--ink)" stroke="var(--surface)" strokeWidth={2.4} paintOrder="stroke"
                    opacity={nivel === 'obsoleta' ? 0.6 : 1}>
                    {p.etiqueta}
                  </text>
                </g>
              );
            })}
          </svg>

          {viajes.length === 0 && pines.length === 0 && (
            <div className="rv-mp__vacio">
              <p>Sin viajes en curso ahora mismo — el próximo que despaches se dibuja aquí.</p>
            </div>
          )}

          {/* AUDITORÍA 20 (H5): esta leyenda decía «Likida no rastrea GPS» y dejó de ser verdad — `posicion` tiene escritores y los
              pines de arriba salen de ahí. Lo ilustrativo sigue siendo el ARCO, y eso es lo que la leyenda tiene que decir ahora. */}
          <p className="rv-mp__nota">
            El ARCO es el trayecto ilustrativo entre origen y destino, no la ruta que hizo el
            camión. {pines.length > 0
              ? `Los ${numero(pines.length)} ${pines.length === 1 ? 'rombo es una posición MEDIDA' : 'rombos son posiciones MEDIDAS'} — con su hora y su origen en la lista de abajo.`
              : 'Cuando una unidad reporte posición (conector GPS o pin del chofer por WhatsApp) aparece aquí como un rombo.'}
          </p>
        </div>

        {/* Las cards de los viajes — hover ilumina, clic fija */}
        <div className="rv-mp__cards">
          {viajes.length === 0 ? (
            <p className="rv-mp__nota">Aquí van las tarjetas de cada viaje en curso, con sus días en ruta y sus fotos recibidas.</p>
          ) : viajes.map((v) => {
            const esActivo = v.id === activoId;
            return (
              <button key={v.id} type="button"
                onMouseEnter={() => setHover(v.id)} onMouseLeave={() => setHover(null)}
                onClick={() => setFijo((f) => (f === v.id ? null : v.id))}
                className="rv-mp__card" data-activo={esActivo || undefined} aria-pressed={esActivo}>
                <div className="rv-mp__card-cab">
                  <strong>{v.folio}</strong>
                  {v.escalado ? <StatusChip tono="bad">Escalado</StatusChip> : <StatusChip tono="ok">En ruta</StatusChip>}
                  {v.dias !== null && (
                    <span className="rv-mp__card-dias">{numero(v.dias)} {v.dias === 1 ? 'día' : 'días'}</span>
                  )}
                </div>
                <div className="rv-mp__card-ruta">{v.origenNombre} → {v.destinoNombre}</div>
                <div className="rv-mp__card-pie">
                  {v.operadorNombre ?? 'Sin operador asignado'}
                  {' · '}≈ {numero(v.kmRecta)} km en línea recta
                  {v.fotos > 0 && <> · {numero(v.fotos)} {v.fotos === 1 ? 'foto' : 'fotos'} en proceso</>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Tarjeta>
  );
}
