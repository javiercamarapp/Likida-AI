'use client';

import { nivelDePosicion, ROTULO_FRESCURA, type NivelFrescura } from '@/lib/likida/gps_salud';
import { useEffect, useState } from 'react';
import { numero } from '@/lib/formato';
import { Disclosure, EstadoVacio, SegmentedControl, StatusChip, TablaBase, Tarjeta } from '@/app/ui-v2/componentes';
import { KindBadge } from '@/app/ui-v2/graficas';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';
import { dashboard_a as dashboard_aEs } from '@/lib/i18n/es/dashboard_a';
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

/** Agrupa por rejilla las posiciones medidas: con ~140 unidades juntas entre Guadalajara y Monterrey las etiquetas se montaban. `celda` va en unidades del
 *  viewBox y se achica con el zoom, así que al acercar los grupos se separan. El grupo solo cuenta y promedia posiciones MEDIDAS; no inventa ninguna. */
export interface GrupoPines { clave: string; x: number; y: number; pines: PinUnidad[]; nivel: NivelFrescura }
const GRAVEDAD: Record<NivelFrescura, number> = { en_vivo: 0, atrasada: 1, obsoleta: 2 };
export function agruparPines(pines: PinUnidad[], celda: number): GrupoPines[] {
  const celdas = new Map<string, PinUnidad[]>();
  for (const p of pines) {
    const k = `${Math.floor(p.x / celda)}:${Math.floor(p.y / celda)}`;
    const l = celdas.get(k);
    if (l) l.push(p); else celdas.set(k, [p]);
  }
  return [...celdas.entries()].map(([clave, ps]) => {
    let nivel: NivelFrescura = 'en_vivo';
    for (const p of ps) { const n = nivelDePosicion(p.minutos); if (GRAVEDAD[n] > GRAVEDAD[nivel]) nivel = n; }
    return { clave, x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length, pines: ps, nivel };
  });
}

export function MapaVivo({ viajes, pines = [], sinUbicar = 0, sinSeguimiento = 0, nota }: {
  viajes: ViajeEnMapa[];
  /** Viajes en curso que NO se pudieron dibujar (origen o destino fuera del catálogo): el rótulo del vacío tiene que decirlo, no afirmar «sin viajes». */
  sinUbicar?: number;
  /** Posiciones medidas por unidad. Vacío = la flota no tiene GPS todavía. */
  pines?: PinUnidad[];
  /** Viajes en curso que existen en la base pero el tablero del conductor aún no sigue (En vivo): el vacío dice «sin seguimiento», no «sin viajes». */
  sinSeguimiento?: number;
  /** Nota de método o procedencia: va DENTRO de la tarjeta, bajo el mapa (Rovaq), no suelta sobre el lienzo. */
  nota?: import('react').ReactNode;
}) {
  const [fijo, setFijo] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pinFijo, setPinFijo] = useState<string | null>(null);
  const [pinHover, setPinHover] = useState<string | null>(null);
  const { t } = useT('operacion', operacionEs);
  const { t: ta } = useT('dashboard_a', dashboard_aEs);
  // Zoom del lienzo (1 a 3): recorta el viewBox alrededor del viaje activo (o del centro). Solo cambia el encuadre, nunca los datos.
  const [zoom, setZoom] = useState(1);
  // Ranking del panel (Rovaq: «mayor concentración · elige otro»): cuenta MEDIDA de los viajes dibujados por destino u origen.
  const [eje, setEje] = useState<'destino' | 'origen'>('destino');
  const [lugar, setLugar] = useState<string | null>(null);
  const ranking = rankingDe(viajes, eje);
  const visibles = lugar ? viajes.filter((v) => (eje === 'destino' ? v.destinoNombre : v.origenNombre) === lugar) : viajes;
  const activoId = hover ?? fijo ?? visibles[0]?.id ?? viajes[0]?.id ?? null;
  const activo = viajes.find((v) => v.id === activoId) ?? null;

  // Al elegir un viaje en el mapa, su fila se trae a la vista en la lista (la lista a mapa ya funciona por hover/clic).
  useEffect(() => {
    if (!fijo) return;
    const el = document.getElementById(`rv-mp-v-${fijo}`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [fijo]);
  const grupos = agruparPines(pines, 16 / zoom);
  const enVisibles = new Set(visibles.map((v) => v.id));
  const escalados = viajes.filter((v) => v.escalado && v.id !== activoId);
  // Etiquetas de ciudades: las del ranking (medidas), con las coordenadas del primer viaje que las usa.
  const ciudades = ranking.slice(0, 6).flatMap((r) => {
    const v = viajes.find((x) => (eje === 'destino' ? x.destinoNombre : x.origenNombre) === r.nombre);
    if (!v || r.nombre === activo?.origenNombre || r.nombre === activo?.destinoNombre) return [];
    return [{ nombre: r.nombre, x: eje === 'destino' ? v.dx : v.ox, y: eje === 'destino' ? v.dy : v.oy }];
  });
  const ancho = VIEWBOX.w / zoom, alto = VIEWBOX.h / zoom;
  const cx = activo ? (activo.ox + activo.dx) / 2 : VIEWBOX.w / 2;
  const cy = activo ? (activo.oy + activo.dy) / 2 : VIEWBOX.h / 2;
  const vx = Math.min(Math.max(cx - ancho / 2, 0), VIEWBOX.w - ancho);
  const vy = Math.min(Math.max(cy - alto / 2, 0), VIEWBOX.h - alto);

  const vacioPanel = sinUbicar > 0
    ? <EstadoVacio contenido titulo={t('mapa.panel.sin_ubicar', { n: numero(sinUbicar) })}>{t('mapa.panel.sin_ubicar.nota')}</EstadoVacio>
    : sinSeguimiento > 0
      ? <EstadoVacio contenido titulo={t('mapa.panel.sin_seguimiento', { n: numero(sinSeguimiento) })}>{t('mapa.panel.sin_seguimiento.nota')}</EstadoVacio>
      : <EstadoVacio contenido titulo={t('mapa.panel.vacio')}>{t('mapa.panel.vacio.nota')}</EstadoVacio>;

  // Ronda 8 (Rovaq 09: el estado sin dato se dibuja compacto): sin un solo viaje dibujable ni una posición medida NO se pinta un mapa de 470 px vacío con un panel
  // de 160 px al lado; la tarjeta dice lo que falta, en una sola caja, y conserva su nota de método.
  if (viajes.length === 0 && pines.length === 0) {
    return (
      <Tarjeta titulo={t('mapa.card.titulo')} info="mapa.en_el_mapa" className="rv-mp__tarjeta" acciones={<KindBadge tipo="observado" />}>
        {vacioPanel}
        {nota ? <p className="rv-mp__nota rv-mp__nota--pie">{nota}</p> : null}
      </Tarjeta>
    );
  }

  return (
    <Tarjeta titulo={t('mapa.card.titulo')} info="mapa.en_el_mapa" className="rv-mp__tarjeta"
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
            aria-label={ta('mv.aria')}>
            {/* La tierra: trazo tenue + la matriz de puntos */}
            <path d={TRAZO_MEXICO} fillRule="evenodd" fill="var(--g1)" stroke="var(--line2)" strokeWidth={0.7} />
            {PUNTOS_MEXICO.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={1.25} fill="var(--g3)" opacity={0.5} />
            ))}

            {/* Los arcos de fondo (todos los viajes menos el activo): se dibujan al entrar y se reanima al cambiar de eje; los que no son del lugar elegido se atenúan. */}
            {viajes.map((v, i) => {
              if (v.id === activoId) return null;
              const d = arcoDe(v);
              return (
                <g key={`${eje}:${v.id}`} className="rv-mp__arco" data-r={i % 6} data-fuera={enVisibles.has(v.id) ? undefined : true} data-escalado={v.escalado || undefined}
                  onMouseEnter={() => setHover(v.id)} onMouseLeave={() => setHover(null)} onClick={() => setFijo(v.id)}>
                  {d && <path d={d} fill="none" strokeWidth={1.1} pathLength={1} className="rv-mp__trazo" />}
                  {/* Zona de clic generosa e invisible */}
                  {d && <path d={d} fill="none" stroke="transparent" strokeWidth={12} />}
                  <circle cx={v.ox} cy={v.oy} r={1.8} className="rv-mp__extremo" />
                  <circle cx={v.dx} cy={v.dy} r={1.8} className="rv-mp__extremo" />
                </g>
              );
            })}

            {/* Escalados: pulso suave en el destino; su folio se rotula solo si son pocos o hay zoom (si no, se montan). */}
            {escalados.map((v) => (
              <g key={`esc:${v.id}`} className="rv-mp__esc" onMouseEnter={() => setHover(v.id)} onMouseLeave={() => setHover(null)} onClick={() => setFijo(v.id)}>
                <circle cx={v.dx} cy={v.dy} r={3} className="rv-mp__esc-punto" />
                <circle cx={v.dx} cy={v.dy} r={3} className="rv-mp__esc-pulso" />
                {(escalados.length <= 6 || zoom >= 2) && <text x={v.dx} y={v.dy - 6} textAnchor="middle" className="rv-mp__txt rv-mp__txt--esc">{v.folio}</text>}
              </g>
            ))}

            {/* Ciudades del ranking */}
            {ciudades.map((c) => (
              <g key={`ciu:${c.nombre}`}>
                <circle cx={c.x} cy={c.y} r={2} className="rv-mp__ciudad-punto" />
                <text x={c.x} y={c.y - 5} textAnchor="middle" className="rv-mp__txt rv-mp__txt--ciudad">{c.nombre}</text>
              </g>
            ))}

            {/* El viaje activo, encima de todo */}
            {activo && (() => {
              const d = arcoDe(activo);
              return (
                <g key={`activo:${activo.id}`}>
                  {d && <path d={d} fill="none" stroke="var(--ink)" strokeWidth={2} className="rv-mp__activo" />}
                  <circle cx={activo.ox} cy={activo.oy} r={3} fill="none" stroke="var(--ink)" strokeWidth={1.5} />
                  <circle cx={activo.dx} cy={activo.dy} r={3.2} fill="var(--ink)" />
                  <circle cx={activo.dx} cy={activo.dy} r={3.2} fill="var(--ink)" className="rv-mp__pulso" />
                  <text x={activo.ox} y={activo.oy - 7} textAnchor="middle" className="rv-mp__txt rv-mp__txt--activo">{activo.origenNombre}</text>
                  <text x={activo.dx} y={activo.dy - 7} textAnchor="middle" className="rv-mp__txt rv-mp__txt--activo">{activo.destinoNombre}</text>
                </g>
              );
            })()}

            {/* Las posiciones MEDIDAS, encima de todo: rombo (no círculo, que es el vocabulario de los extremos del arco) con el color de su frescura.
                Cercanas entre sí se agrupan con su contador; el rótulo solo sale en la elegida o bajo el cursor. */}
            {grupos.map((g) => {
              if (g.pines.length > 1) {
                return (
                  <g key={`g:${g.clave}`} className="rv-mp__grupo" data-nivel={g.nivel} onClick={() => setZoom((z) => Math.min(3, z + 1))}>
                    <title>{ta('mv.grupo', { n: numero(g.pines.length) })}</title>
                    <circle cx={g.x} cy={g.y} r={5 + Math.min(4, Math.log2(g.pines.length))} className="rv-mp__grupo-disco" />
                    <text x={g.x} y={g.y} textAnchor="middle" dominantBaseline="central" className="rv-mp__txt rv-mp__txt--grupo">{numero(g.pines.length)}</text>
                  </g>
                );
              }
              const p = g.pines[0];
              const nivel: NivelFrescura = nivelDePosicion(p.minutos);
              const fresco = nivel === 'en_vivo';
              const rotulo = pinFijo === p.unidadId || pinHover === p.unidadId;
              return (
                <g key={p.unidadId} className="rv-mp__pin" data-nivel={nivel} onMouseEnter={() => setPinHover(p.unidadId)} onMouseLeave={() => setPinHover(null)}
                  onClick={() => setPinFijo((f) => (f === p.unidadId ? null : p.unidadId))}>
                  <rect x={p.x - 3.2} y={p.y - 3.2} width={6.4} height={6.4} transform={`rotate(45 ${p.x} ${p.y})`} className="rv-mp__rombo">
                    <title>
                      {ta(fresco ? 'mv.pin.fresco' : 'mv.pin.viejo', { etiqueta: p.etiqueta, frescura: ROTULO_FRESCURA[nivel], fuente: p.respaldoWa ? ta('mv.pin.respaldo') : p.proveedor })}
                    </title>
                  </rect>
                  {rotulo && <text x={p.x} y={p.y + 11} textAnchor="middle" className="rv-mp__txt rv-mp__txt--pin">{p.etiqueta}</text>}
                </g>
              );
            })}
          </svg>

          {/* El vacío («sin viajes», «sin ubicar», «sin seguimiento») se dice UNA sola vez, en el panel lateral: antes salía también sobre el mapa. */}

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
            {pines.length > 0
              ? ta(pines.length === 1 ? 'mv.nota.pines.uno' : 'mv.nota.pines.otros', { n: numero(pines.length) })
              : ta('mv.nota.sinPines')}
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
            vacioPanel
          ) : visibles.map((v) => {
            const esActivo = v.id === activoId;
            const operador = v.operadorNombre ?? ta('mv.sinOperador');
            const pie = `${operador} · ${ta('mv.km', { km: numero(v.kmRecta) })}${v.fotos > 0 ? ` · ${ta(v.fotos === 1 ? 'mv.fotos.uno' : 'mv.fotos.otros', { n: numero(v.fotos) })}` : ''}`;
            const ruta = `${v.origenNombre} → ${v.destinoNombre}`;
            return (
              <button key={v.id} id={`rv-mp-v-${v.id}`} type="button"
                onMouseEnter={() => setHover(v.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(v.id)} onBlur={() => setHover(null)}
                onClick={() => setFijo((f) => (f === v.id ? null : v.id))}
                className="rv-mp__card" data-activo={esActivo || undefined} data-escalado={v.escalado || undefined} aria-pressed={esActivo}>
                <span className="rv-mp__card-cab">
                  <strong className="rv-mp__card-folio" title={v.folio}>{v.folio}</strong>
                  {v.escalado ? <StatusChip tono="bad">{ta('mv.escalado')}</StatusChip> : <StatusChip tono="ok">{ta('mv.enRuta')}</StatusChip>}
                  {v.dias !== null && (
                    <span className="rv-mp__card-dias">{ta(v.dias === 1 ? 'mv.dias.uno' : 'mv.dias.otros', { n: numero(v.dias) })}</span>
                  )}
                </span>
                <span className="rv-mp__card-ruta" title={ruta}>{ruta}</span>
                <span className="rv-mp__card-pie" title={pie}>{pie}</span>
              </button>
            );
          })}
        </div>
          <p className="rv-mp__nota">{t('mapa.panel.nota')}</p>
        </aside>
      </div>
      {nota ? <p className="rv-mp__nota rv-mp__nota--pie">{nota}</p> : null}
      {viajes.length > 0 ? (
        <Disclosure variante="linea" titulo={t('mapa.tabla.eq')}>
          <TablaBase<ViajeEnMapa> etiqueta={t('mapa.tabla.eq')} densa altoMaximo={false} tarjetaMovil filas={viajes} idFila={(v) => v.id}
            columnas={[
              { id: 'folio', titulo: t('mapa.tabla.folio'), principal: true, celda: (v) => v.folio },
              { id: 'ruta', titulo: t('mapa.tabla.ruta'), celda: (v) => `${v.origenNombre} → ${v.destinoNombre}` },
              { id: 'operador', titulo: t('mapa.tabla.operador'), celda: (v) => v.operadorNombre ?? '—' },
              { id: 'dias', titulo: t('mapa.tabla.dias'), celda: (v) => (v.dias === null ? '—' : numero(v.dias)) },
              { id: 'km', titulo: t('mapa.tabla.km'), celda: (v) => numero(v.kmRecta) },
              { id: 'estado', titulo: t('mapa.tabla.estado'), celda: (v) => (v.escalado ? <StatusChip tono="bad">{ta('mv.escalado')}</StatusChip> : <StatusChip tono="ok">{ta('mv.enRuta')}</StatusChip>) },
            ]} />
        </Disclosure>
      ) : null}
    </Tarjeta>
  );
}
