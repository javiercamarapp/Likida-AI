'use client';

import { nivelDePosicion, ROTULO_FRESCURA, type NivelFrescura } from '@/lib/likida/gps_salud';
import { useState } from 'react';
import { numero } from '@/lib/formato';
import { Boton, Disclosure, EstadoVacio, SegmentedControl, StatusChip, TablaBase, Tarjeta } from '@/app/ui-v2/componentes';
import { KindBadge } from '@/app/ui-v2/graficas';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';
import '../estados.css';
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
/** Cuántos viajes dibujados hay por lugar (medido, no estimado); los 8 con más concentración. */
function rankingDe(viajes: ViajeEnMapa[], eje: 'destino' | 'origen'): Array<{ nombre: string; cuenta: number }> {
  const cuentas = new Map<string, number>();
  for (const v of viajes) {
    const n = eje === 'destino' ? v.destinoNombre : v.origenNombre;
    cuentas.set(n, (cuentas.get(n) ?? 0) + 1);
  }
  return [...cuentas.entries()].map(([nombre, cuenta]) => ({ nombre, cuenta }))
    .sort((a, b) => b.cuenta - a.cuenta || a.nombre.localeCompare(b.nombre)).slice(0, 8);
}

export function MapaVivo({ viajes, pines = [], sinUbicar = 0 }: {
  viajes: ViajeEnMapa[];
  /** Viajes en curso que NO se pudieron dibujar (origen o destino fuera del catálogo): el rótulo del vacío tiene que decirlo, no afirmar «sin viajes». */
  sinUbicar?: number;
  /** Posiciones medidas por unidad. Vacío = la flota no tiene GPS todavía. */
  pines?: PinUnidad[];
}) {
  const [fijo, setFijo] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const { t } = useT('operacion', operacionEs);
  // Zoom del lienzo (1 a 3): recorta el viewBox alrededor del viaje activo (o del centro). Solo cambia el encuadre, nunca los datos.
  const [zoom, setZoom] = useState(1);
  // Ranking del panel (Rovaq: «mayor concentración · elige otro»): cuenta MEDIDA de los viajes dibujados por destino u origen.
  const [eje, setEje] = useState<'destino' | 'origen'>('destino');
  const [lugar, setLugar] = useState<string | null>(null);
  const ranking = rankingDe(viajes, eje);
  const visibles = lugar ? viajes.filter((v) => (eje === 'destino' ? v.destinoNombre : v.origenNombre) === lugar) : viajes;
  const activoId = hover ?? fijo ?? visibles[0]?.id ?? viajes[0]?.id ?? null;
  const activo = viajes.find((v) => v.id === activoId) ?? null;

  const ancho = VIEWBOX.w / zoom, alto = VIEWBOX.h / zoom;
  const cx = activo ? (activo.ox + activo.dx) / 2 : VIEWBOX.w / 2;
  const cy = activo ? (activo.oy + activo.dy) / 2 : VIEWBOX.h / 2;
  const vx = Math.min(Math.max(cx - ancho / 2, 0), VIEWBOX.w - ancho);
  const vy = Math.min(Math.max(cy - alto / 2, 0), VIEWBOX.h - alto);

  return (
    <Tarjeta titulo={t('mapa.card.titulo')} info="mapa.en_el_mapa"
      acciones={(
        <span className="rv-mp__cab">
          {viajes.length > 0 ? (
            <SegmentedControl<'destino' | 'origen'> etiqueta={t('mapa.panel.eje')} tamano="sm" valor={eje}
              onChange={(v) => { setEje(v); setLugar(null); setFijo(null); }}
              opciones={[{ valor: 'destino', etiqueta: t('mapa.panel.por_destino') }, { valor: 'origen', etiqueta: t('mapa.panel.por_origen') }]} />
          ) : null}
          <KindBadge tipo="observado" />
        </span>
      )}>
      <div className="rv-mp__rejilla">
        <div className="rv-mp__lienzo">
          <div className="rv-mp__zoom" role="group" aria-label={t('mapa.zoom')}>
            <button type="button" className="rv-mp__zbtn" onClick={() => setZoom((z) => Math.min(3, z + 0.5))} disabled={zoom >= 3} aria-label={t('mapa.zoom.mas')}>+</button>
            <button type="button" className="rv-mp__zbtn" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label={t('mapa.zoom.menos')}>−</button>
            <button type="button" className="rv-mp__zbtn" onClick={() => setZoom(1)} disabled={zoom === 1} aria-label={t('mapa.zoom.reset')}>⤢</button>
          </div>
          <svg viewBox={`${vx.toFixed(1)} ${vy.toFixed(1)} ${ancho.toFixed(1)} ${alto.toFixed(1)}`} className="rv-mp__svg" role="img"
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
              <p>{sinUbicar > 0
                ? t('mapa.vacio.sin_ubicar', { n: numero(sinUbicar) })
                : 'Sin viajes en curso ahora mismo — el próximo que despaches se dibuja aquí.'}</p>
            </div>
          )}

          {/* Leyenda de clases bajo el mapa (Rovaq): qué es cada marca. */}
          <ul className="rv-mp__leyenda" aria-label={t('mapa.leyenda')}>
            <li><svg width="22" height="8" aria-hidden="true"><path d="M1 6 Q11 -2 21 6" fill="none" stroke="var(--ink)" strokeWidth="1.6" /></svg>{t('mapa.leyenda.arco')}</li>
            <li><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.4" fill="none" stroke="var(--ink)" strokeWidth="1.4" /></svg>{t('mapa.leyenda.origen')}</li>
            <li><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.4" fill="var(--ink)" /></svg>{t('mapa.leyenda.destino')}</li>
            <li><svg width="10" height="10" aria-hidden="true"><rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" fill="var(--ok)" /></svg>{t('mapa.leyenda.envivo')}</li>
            <li><svg width="10" height="10" aria-hidden="true"><rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" fill="var(--warn)" /></svg>{t('mapa.leyenda.atrasada')}</li>
            <li><svg width="10" height="10" aria-hidden="true"><rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" fill="var(--faint)" /></svg>{t('mapa.leyenda.obsoleta')}</li>
          </ul>
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
        <aside className="rv-mp__panel" aria-label={t('mapa.panel.titulo')}>
          {ranking.length > 0 ? (
            <section className="rv-mp__rank-bloque">
              <p className="rv-mp__eyebrow">{t('mapa.panel.concentracion')}</p>
              <ol className="rv-mp__rank">
                {ranking.map((r, i) => (
                  <li key={r.nombre}>
                    <button type="button" className="rv-mp__rank-fila" data-activo={r.nombre === lugar || undefined} aria-pressed={r.nombre === lugar}
                      onClick={() => { setLugar((l) => (l === r.nombre ? null : r.nombre)); setFijo(null); }}>
                      <span className="rv-mp__rank-n">{i + 1}</span>
                      <span className="rv-mp__rank-nombre">{r.nombre}</span>
                      <span className="rv-mp__rank-cuenta">{numero(r.cuenta)}</span>
                      <svg className="rv-mp__rank-barra" aria-hidden="true" height="4" width="100%"><rect width="100%" height="4" rx="2" className="rv-mp__rank-pista" /><rect width={`${Math.max(6, Math.round((r.cuenta / ranking[0].cuenta) * 100))}%`} height="4" rx="2" className="rv-mp__rank-valor" /></svg>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {ranking.length > 0 ? <p className="rv-mp__eyebrow">{lugar ? t('mapa.panel.viajes_en', { lugar }) : t('mapa.panel.viajes')}</p> : null}
          <div className="rv-mp__cards">
          {viajes.length === 0 ? (
            sinUbicar > 0
              ? <EstadoVacio titulo={t('mapa.panel.sin_ubicar', { n: numero(sinUbicar) })}>{t('mapa.panel.sin_ubicar.nota')}</EstadoVacio>
              : <EstadoVacio titulo={t('mapa.panel.vacio')}>{t('mapa.panel.vacio.nota')}</EstadoVacio>
          ) : visibles.map((v) => {
            const esActivo = v.id === activoId;
            return (
              <Boton key={v.id} variante="ghost"
                onMouseEnter={() => setHover(v.id)} onMouseLeave={() => setHover(null)}
                onClick={() => setFijo((f) => (f === v.id ? null : v.id))}
                className="rv-mp__card !flex !h-auto !w-full !flex-col !items-stretch !justify-start !whitespace-normal !text-left" data-activo={esActivo || undefined} aria-pressed={esActivo}>
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
              </Boton>
            );
          })}
        </div>
          <p className="rv-mp__nota">{t('mapa.panel.nota')}</p>
        </aside>
      </div>
      {viajes.length > 0 ? (
        <Disclosure variante="linea" titulo={t('mapa.tabla.eq')}>
          <TablaBase<ViajeEnMapa> etiqueta={t('mapa.tabla.eq')} densa altoMaximo={false} tarjetaMovil filas={viajes} idFila={(v) => v.id}
            columnas={[
              { id: 'folio', titulo: t('mapa.tabla.folio'), principal: true, celda: (v) => v.folio },
              { id: 'ruta', titulo: t('mapa.tabla.ruta'), celda: (v) => `${v.origenNombre} → ${v.destinoNombre}` },
              { id: 'operador', titulo: t('mapa.tabla.operador'), celda: (v) => v.operadorNombre ?? '—' },
              { id: 'dias', titulo: t('mapa.tabla.dias'), celda: (v) => (v.dias === null ? '—' : numero(v.dias)) },
              { id: 'km', titulo: t('mapa.tabla.km'), celda: (v) => numero(v.kmRecta) },
              { id: 'estado', titulo: t('mapa.tabla.estado'), celda: (v) => (v.escalado ? <StatusChip tono="bad">Escalado</StatusChip> : <StatusChip tono="ok">En ruta</StatusChip>) },
            ]} />
        </Disclosure>
      ) : null}
    </Tarjeta>
  );
}
