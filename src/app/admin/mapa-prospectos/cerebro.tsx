'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EL CEREBRO DE VENTAS (Fase D, orden del 17-ago) — el mundo virtual de la
// cartera: México entero respirando, cada prospecto una luz con el color de
// su etapa del embudo. Se navega país → estado (zoom animado) → calles
// (Leaflet). Se refresca solo cada 60 s: cuando un agente encuentra o
// enriquece un prospecto, su luz aparece sin recargar.
//
// Compromiso visual declarado: esta zona vive OSCURA en ambos temas — es un
// mundo, no un formulario — con todos sus colores pintados explícitos aquí.
// Toda animación respeta prefers-reduced-motion (regla de la casa).
// Los % son estimaciones deterministas; el pie enseña el criterio con las
// mismas palabras del módulo que las calcula (CRITERIO_SCORES).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { proyectar } from '../../dashboard/mapa/mexico-geo';
import { ESTADOS_GEO, VIEWBOX_ESTADOS, type EstadoGeo } from './mexico-estados-geo';
import {
  COLOR_EMBUDO, NOMBRE_GIRO, CRITERIO_SCORES, type DatosMapa, type ProspectoMapa,
} from '@/lib/admin/prospectos-mapa';
import { usePrefersReducedMotion } from '../ui/prefers-reduced-motion';
import { useCountUp } from '../ui/use-count-up';

const Calles = dynamic(() => import('./calles'), { ssr: false });

const FONDO = '#070d19';
const TINTA = '#e2e8f0';
const TENUE = '#7c8aa5';
const LINEA = '#1c2a42';

const ORDEN_EMBUDO = ['negociacion', 'demo', 'contactado', 'nuevo', 'cerrado', 'perdido'] as const;

function Kpi({ etiqueta, valor, animar }: { etiqueta: string; valor: number; animar: boolean }) {
  const mostrado = useCountUp(valor, animar);
  return (
    <div className="px-4 py-2.5 rounded-2xl backdrop-blur-sm" style={{ background: 'rgba(12,20,36,0.72)', border: `1px solid ${LINEA}` }}>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: TENUE }}>{etiqueta}</div>
      <div className="text-xl font-semibold tabular-nums" style={{ color: TINTA }}>{mostrado}</div>
    </div>
  );
}

/** Barra de % con su animación de llenado — usada por urgencia y cierre. */
function Barra({ etiqueta, pct, color }: { etiqueta: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]" style={{ color: TENUE }}>
      <span className="w-14 shrink-0">{etiqueta}</span>
      <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: LINEA }}>
        <span className="block h-full rounded-full cerebro-llenado" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="w-9 text-right tabular-nums font-medium" style={{ color: TINTA }}>{pct}%</span>
    </div>
  );
}

/** Revela sus hijos al entrar al viewport — el "scroll change" de la orden.
 *  Con reduced-motion no hay animación que revelar: se pinta visto desde el
 *  render (sin setState síncrono en el efecto — regla de hooks). */
function Reveal({ children, retraso = 0 }: { children: React.ReactNode; retraso?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visto, setVisto] = useState(false);
  const reducido = usePrefersReducedMotion();
  const mostrar = visto || reducido;
  useEffect(() => {
    if (reducido) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisto(true); obs.disconnect(); } }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [reducido]);
  return (
    <div ref={ref} style={{
      opacity: mostrar ? 1 : 0,
      transform: mostrar ? 'none' : 'translateY(22px)',
      transition: reducido ? 'none' : `opacity 650ms ease ${retraso}ms, transform 650ms cubic-bezier(.22,1,.36,1) ${retraso}ms`,
    }}>
      {children}
    </div>
  );
}

/** El primer toque, pre-armado — honesto, corto, editable en WhatsApp antes
 *  de mandar. Sin "nuestros clientes": no hay clientes todavía. */
export function mensajeWa(p: ProspectoMapa): string {
  const gancho = p.vacante
    ? `vi que buscan "${p.vacante}" — ese trabajo es exactamente el que automatizamos`
    : 'la liquidación de viajes de los operadores se sigue haciendo a mano en casi todas las flotas';
  return `Hola, soy Javier, de Likida. En ${p.empresa}, ${gancho}: el operador manda sus comprobantes por WhatsApp y la liquidación sale cuadrada, con lo fiscal separado. Estamos eligiendo a las primeras flotas. ¿Le interesan 15 minutos?`;
}

function TarjetaProspecto({ p, nuevo }: { p: ProspectoMapa; nuevo: boolean }) {
  const c = COLOR_EMBUDO[p.estado] ?? COLOR_EMBUDO.nuevo;
  return (
    <article className={`rounded-2xl p-3.5 space-y-2 ${nuevo ? 'cerebro-recien' : ''}`}
      style={{ background: 'rgba(15,24,44,0.85)', border: `1px solid ${LINEA}` }}>
      <div className="flex items-start gap-2">
        <span className="mt-1 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
        <div className="min-w-0">
          <h4 className="text-sm font-medium leading-snug truncate" style={{ color: TINTA }}>{p.empresa}</h4>
          <p className="text-[11px]" style={{ color: TENUE }}>
            {c.nombre} · {NOMBRE_GIRO[p.giro]}{p.ciudad ? ` · ${p.ciudad}` : ''}
          </p>
        </div>
      </div>
      {(p.contacto || p.telefono || p.correo) && (
        <div className="text-[12px] space-y-0.5" style={{ color: TINTA }}>
          {p.contacto && <p className="truncate">👤 {p.contacto}</p>}
          {p.telefono && <p>📞 <a className="hover:underline" href={`tel:${p.telefono}`}>{p.telefono}</a></p>}
          {p.correo && <p className="truncate">✉️ <a className="hover:underline" href={`mailto:${p.correo}`}>{p.correo}</a></p>}
        </div>
      )}
      {p.vacante && <p className="text-[11px] truncate" style={{ color: TENUE }}>Vacante: {p.vacante}</p>}
      <Barra etiqueta="Urgencia" pct={p.urgencia} color="#f59e0b" />
      <Barra etiqueta="Cierre" pct={p.cierre} color="#34d399" />
      {(p.telefono || p.lat !== null) && (
        <div className="flex gap-2 pt-1">
          {p.telefono && (
            <a href={`https://wa.me/52${p.telefono.replace(/^52/, '')}?text=${encodeURIComponent(mensajeWa(p))}`}
              target="_blank" rel="noreferrer"
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium"
              style={{ background: '#14532d', color: '#86efac' }}>
              WhatsApp →
            </a>
          )}
          {p.lat !== null && (
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`}
              target="_blank" rel="noreferrer"
              className="px-2.5 py-1 rounded-lg text-[11px]"
              style={{ background: '#1e293b', color: TINTA }}>
              Cómo llegar
            </a>
          )}
        </div>
      )}
    </article>
  );
}

export function Cerebro({ inicial, estadoInicial }: { inicial: DatosMapa; estadoInicial?: string }) {
  const reducido = usePrefersReducedMotion();
  const [datos, setDatos] = useState<DatosMapa>(inicial);
  const [seleccion, setSeleccion] = useState<EstadoGeo | null>(
    () => ESTADOS_GEO.find((e) => e.nombre === estadoInicial) ?? null,
  );
  const [hover, setHover] = useState<string | null>(null);
  const [calles, setCalles] = useState(false);
  const conocidos = useRef<Set<string>>(new Set(inicial.prospectos.map((p) => p.id)));
  const [recientes, setRecientes] = useState<Set<string>>(new Set());
  // Pantalla completa nativa: en el Odyssey 49 la zona ES el monitor entero.
  const zonaRef = useRef<HTMLElement>(null);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  useEffect(() => {
    const alCambiar = () => setPantallaCompleta(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', alCambiar);
    return () => document.removeEventListener('fullscreenchange', alCambiar);
  }, []);
  const alternarPantalla = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void zonaRef.current?.requestFullscreen();
  };

  // El latido: cada 60 s el mapa pregunta por la cartera y lo nuevo se
  // enciende con su animación de llegada.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await fetch('/api/admin/mapa-prospectos', { cache: 'no-store' });
        if (!r.ok) return; // el mapa vigente sigue; no se pinta un fallo como vacío
        const d = (await r.json()) as DatosMapa;
        if (d.fallo) return;
        const nuevos = new Set(d.prospectos.filter((p) => !conocidos.current.has(p.id)).map((p) => p.id));
        d.prospectos.forEach((p) => conocidos.current.add(p.id));
        setDatos(d);
        if (nuevos.size) setRecientes(nuevos);
      } catch { /* sin red: el mapa vigente sigue */ }
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const porEstado = useMemo(() => {
    const m = new Map<string, ProspectoMapa[]>();
    for (const p of datos.prospectos) {
      if (!p.entidad) continue;
      const lista = m.get(p.entidad) ?? [];
      lista.push(p);
      m.set(p.entidad, lista);
    }
    for (const lista of m.values()) lista.sort((a, b) => b.cierre - a.cierre || b.urgencia - a.urgencia);
    return m;
  }, [datos]);

  const sinPlaza = useMemo(() => datos.prospectos.filter((p) => !p.entidad).length, [datos]);
  const maxEstado = useMemo(() => Math.max(1, ...[...porEstado.values()].map((l) => l.length)), [porEstado]);
  const conTelefono = useMemo(() => datos.prospectos.filter((p) => p.telefono).length, [datos]);
  const conDecisor = useMemo(() => datos.prospectos.filter((p) => p.contacto).length, [datos]);
  const calientes = useMemo(() => datos.prospectos.filter((p) => p.urgencia >= 70).length, [datos]);

  // El zoom del país al estado: transform sobre el <g> con transición CSS.
  const zoom = useMemo(() => {
    if (!seleccion) return { transform: 'translate(0px, 0px) scale(1)' };
    const margen = 1.35;
    const s = Math.min(6.5, VIEWBOX_ESTADOS.w / (seleccion.bw * margen), VIEWBOX_ESTADOS.h / (seleccion.bh * margen));
    // El estado queda al centro-izquierda: el panel de tarjetas vive a la derecha.
    const cxDestino = VIEWBOX_ESTADOS.w * 0.36;
    const cyDestino = VIEWBOX_ESTADOS.h * 0.5;
    return { transform: `translate(${cxDestino - s * seleccion.cx}px, ${cyDestino - s * seleccion.cy}px) scale(${s})` };
  }, [seleccion]);

  const listaSeleccion = seleccion ? porEstado.get(seleccion.nombre) ?? [] : [];
  const pines = useMemo(
    () => datos.prospectos.filter((p) => p.lat !== null && p.lng !== null)
      .map((p) => ({ p, xy: proyectar(p.lat!, p.lng!) })),
    [datos],
  );

  return (
    <div className="space-y-10">
      {/* ── El mundo ─────────────────────────────────────────────────────── */}
      <section ref={zonaRef} className="relative rounded-3xl overflow-hidden cerebro-zona cerebro-ambiente"
        style={{ height: pantallaCompleta ? '100vh' : 'calc(100vh - 7.5rem)', minHeight: 540, background: `radial-gradient(120% 90% at 50% 8%, #0d1830 0%, ${FONDO} 55%, #04070f 100%)` }}>

        {/* KPIs flotantes */}
        <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-start gap-2 pointer-events-none">
          <div className="pointer-events-auto">
            <h1 className="text-lg font-semibold" style={{ color: TINTA }}>Cerebro de ventas</h1>
            <p className="text-[12px]" style={{ color: TENUE }}>
              {seleccion ? `${seleccion.nombre} — ${listaSeleccion.length} prospectos` : 'Toca un estado para entrar. Se actualiza solo: lo que los agentes encuentran, aparece.'}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2 pointer-events-auto">
            <Kpi etiqueta="Prospectos" valor={datos.prospectos.length} animar={!reducido} />
            <Kpi etiqueta="Con teléfono" valor={conTelefono} animar={!reducido} />
            <Kpi etiqueta="Con decisor" valor={conDecisor} animar={!reducido} />
            <Kpi etiqueta="Urgencia ≥70" valor={calientes} animar={!reducido} />
            <button onClick={alternarPantalla} title="Pantalla completa"
              className="px-3.5 py-2.5 rounded-2xl text-sm backdrop-blur-sm hover:brightness-125"
              style={{ background: 'rgba(12,20,36,0.72)', border: `1px solid ${LINEA}`, color: TINTA }}>
              {pantallaCompleta ? '⤡ Salir' : '⤢ Pantalla completa'}
            </button>
          </div>
        </div>

        {/* El ala izquierda — solo en pantallas anchas (el Odyssey la pide):
            el embudo y los más cerrables VIVEN junto al país, sin taparlo. */}
        <aside className="cerebro-ala absolute left-4 top-24 bottom-5 z-10 w-[300px] hidden flex-col gap-3 overflow-y-auto pr-1 pointer-events-auto">
          <div className="rounded-2xl p-4 backdrop-blur-sm" style={{ background: 'rgba(12,20,36,0.72)', border: `1px solid ${LINEA}` }}>
            <h3 className="text-[12px] font-semibold mb-2.5 uppercase tracking-wider" style={{ color: TENUE }}>El embudo</h3>
            <div className="space-y-2">
              {ORDEN_EMBUDO.map((e) => {
                const n = datos.prospectos.filter((p) => p.estado === e).length;
                return (
                  <div key={e} className="flex items-center gap-2 text-[12px]" style={{ color: TENUE }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLOR_EMBUDO[e].color, boxShadow: `0 0 5px ${COLOR_EMBUDO[e].color}` }} />
                    <span className="flex-1">{COLOR_EMBUDO[e].nombre}</span>
                    <span className="tabular-nums font-medium" style={{ color: TINTA }}>{n}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl p-4 backdrop-blur-sm flex-1 min-h-0 overflow-y-auto" style={{ background: 'rgba(12,20,36,0.72)', border: `1px solid ${LINEA}` }}>
            <h3 className="text-[12px] font-semibold mb-2.5 uppercase tracking-wider" style={{ color: TENUE }}>Más cerrables</h3>
            <div className="space-y-2.5">
              {[...datos.prospectos].sort((a, b) => b.cierre - a.cierre || b.urgencia - a.urgencia).slice(0, 7).map((p) => (
                <div key={p.id} className="text-[12px] leading-snug">
                  <p className="truncate font-medium" style={{ color: TINTA }}>{p.empresa}</p>
                  <p style={{ color: TENUE }}>
                    <span style={{ color: COLOR_EMBUDO[p.estado]?.color }}>●</span> {p.entidad ?? 'sin plaza'} · cierre {p.cierre}% · urgencia {p.urgencia}%
                  </p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* El país */}
        <svg viewBox={`0 0 ${VIEWBOX_ESTADOS.w} ${VIEWBOX_ESTADOS.h}`} className="absolute inset-0 w-full h-full" role="img" aria-label="Mapa de México con la cartera de prospectos">
          <g style={{ ...zoom, transformOrigin: '0 0', transition: reducido ? 'none' : 'transform 750ms cubic-bezier(.22,1,.36,1)' }}>
            {ESTADOS_GEO.map((e, i) => {
              const lista = porEstado.get(e.nombre) ?? [];
              const intensidad = lista.length / maxEstado;
              const activo = seleccion?.id === e.id;
              const apagado = seleccion !== null && !activo;
              return (
                <path key={e.id} d={e.path}
                  className={reducido ? undefined : 'cerebro-estado-entra'}
                  style={{
                    animationDelay: `${i * 22}ms`,
                    fill: activo
                      ? '#14263f'
                      : `color-mix(in srgb, #22d3ee ${Math.round(intensidad * 34)}%, #0e1a30)`,
                    stroke: hover === e.id || activo ? '#67e8f9' : '#223550',
                    strokeWidth: activo ? 0.7 : 0.5,
                    opacity: apagado ? 0.18 : 1,
                    cursor: 'pointer',
                    transition: 'fill 300ms, opacity 500ms, stroke 200ms',
                    filter: hover === e.id && !seleccion ? 'drop-shadow(0 0 6px rgba(103,232,249,0.55))' : undefined,
                  }}
                  onMouseEnter={() => setHover(e.id)}
                  onMouseLeave={() => setHover((h) => (h === e.id ? null : h))}
                  onClick={() => { setCalles(false); setSeleccion(activo ? null : e); }}
                />
              );
            })}
            {/* Las luces: cada prospecto con coordenadas reales */}
            {pines.map(({ p, xy }) => {
              const c = COLOR_EMBUDO[p.estado] ?? COLOR_EMBUDO.nuevo;
              const enSeleccion = !seleccion || p.entidad === seleccion.nombre;
              return (
                <circle key={p.id} cx={xy.x} cy={xy.y}
                  r={seleccion ? 1.1 : 2.2}
                  className={
                    recientes.has(p.id) ? 'cerebro-pin-nuevo'
                      : !reducido && p.urgencia >= 70 && enSeleccion ? 'cerebro-pin-pulso' : undefined
                  }
                  style={{
                    fill: c.color,
                    opacity: enSeleccion ? 0.95 : 0.12,
                    filter: `drop-shadow(0 0 3px ${c.color})`,
                    pointerEvents: 'none',
                    transition: 'opacity 500ms, r 750ms',
                  }}
                />
              );
            })}
          </g>
        </svg>

        {/* Tooltip del hover a nivel país */}
        {hover && !seleccion && (() => {
          const e = ESTADOS_GEO.find((x) => x.id === hover)!;
          const lista = porEstado.get(e.nombre) ?? [];
          return (
            <div className="absolute bottom-5 left-5 z-20 px-4 py-3 rounded-2xl backdrop-blur-sm"
              style={{ background: 'rgba(12,20,36,0.85)', border: `1px solid ${LINEA}`, color: TINTA }}>
              <div className="text-sm font-semibold">{e.nombre}</div>
              <div className="text-[12px]" style={{ color: TENUE }}>
                {lista.length} prospectos · {lista.filter((p) => p.telefono).length} con teléfono · {lista.filter((p) => p.urgencia >= 70).length} urgentes
              </div>
            </div>
          );
        })()}

        {/* Leyenda del embudo */}
        <div className="absolute bottom-5 right-5 z-20 flex flex-wrap gap-x-3 gap-y-1 px-4 py-2.5 rounded-2xl backdrop-blur-sm"
          style={{ background: 'rgba(12,20,36,0.8)', border: `1px solid ${LINEA}` }}>
          {ORDEN_EMBUDO.map((e) => (
            <span key={e} className="flex items-center gap-1.5 text-[11px]" style={{ color: TENUE }}>
              <span className="w-2 h-2 rounded-full" style={{ background: COLOR_EMBUDO[e].color, boxShadow: `0 0 5px ${COLOR_EMBUDO[e].color}` }} />
              {COLOR_EMBUDO[e].nombre}
            </span>
          ))}
        </div>

        {/* El panel del estado */}
        {seleccion && !calles && (
          <aside className="absolute top-0 right-0 bottom-0 z-20 w-full sm:w-[380px] flex flex-col cerebro-panel"
            style={{ background: 'linear-gradient(270deg, rgba(7,13,25,0.97) 75%, rgba(7,13,25,0))' }}>
            <div className="px-5 pt-16 pb-3 flex items-center gap-2">
              <h2 className="text-base font-semibold" style={{ color: TINTA }}>{seleccion.nombre}</h2>
              <span className="text-[12px]" style={{ color: TENUE }}>{listaSeleccion.length} prospectos</span>
              <div className="ml-auto flex gap-2">
                {listaSeleccion.some((p) => p.lat !== null) && (
                  <button onClick={() => setCalles(true)} className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
                    style={{ background: '#164e63', color: '#a5f3fc' }}>
                    Ver calles →
                  </button>
                )}
                <button onClick={() => setSeleccion(null)} className="px-3 py-1.5 rounded-lg text-[12px]"
                  style={{ background: '#1e293b', color: TINTA }}>
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-3">
              {listaSeleccion.length === 0 ? (
                <p className="text-sm" style={{ color: TENUE }}>
                  El censo todavía no encuentra a nadie aquí — cuando un agente lo haga, aparece solo.
                </p>
              ) : listaSeleccion.map((p) => (
                <TarjetaProspecto key={p.id} p={p} nuevo={recientes.has(p.id)} />
              ))}
            </div>
          </aside>
        )}

        {/* El nivel calles */}
        {seleccion && calles && (
          <Calles prospectos={listaSeleccion} titulo={seleccion.nombre} onCerrar={() => setCalles(false)} />
        )}
      </section>

      {/* ── Lo que se revela al hacer scroll ─────────────────────────────── */}
      <Reveal>
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl p-5" style={{ background: FONDO, border: `1px solid ${LINEA}` }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: TINTA }}>El embudo, en luces</h3>
            <div className="space-y-2.5">
              {ORDEN_EMBUDO.map((e) => {
                const n = datos.prospectos.filter((p) => p.estado === e).length;
                const pct = datos.prospectos.length ? Math.round((n / datos.prospectos.length) * 100) : 0;
                return (
                  <div key={e} className="flex items-center gap-3 text-[12px]" style={{ color: TENUE }}>
                    <span className="w-28 shrink-0">{COLOR_EMBUDO[e].nombre}</span>
                    <span className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: LINEA }}>
                      <span className="block h-full rounded-full cerebro-llenado" style={{ width: `${Math.max(pct, n ? 2 : 0)}%`, background: COLOR_EMBUDO[e].color }} />
                    </span>
                    <span className="w-10 text-right tabular-nums" style={{ color: TINTA }}>{n}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-3xl p-5" style={{ background: FONDO, border: `1px solid ${LINEA}` }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: TINTA }}>Dónde vive la cartera</h3>
            <div className="space-y-2">
              {[...porEstado.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([nombre, lista]) => (
                <div key={nombre} className="flex items-center gap-3 text-[12px]" style={{ color: TENUE }}>
                  <span className="w-28 shrink-0 truncate">{nombre}</span>
                  <span className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: LINEA }}>
                    <span className="block h-full rounded-full cerebro-llenado" style={{ width: `${Math.round((lista.length / maxEstado) * 100)}%`, background: '#22d3ee' }} />
                  </span>
                  <span className="w-10 text-right tabular-nums" style={{ color: TINTA }}>{lista.length}</span>
                </div>
              ))}
              <p className="text-[11px] pt-1" style={{ color: TENUE }}>
                {sinPlaza} sin plaza conocida — se dice, no se les inventa estado.
              </p>
            </div>
          </div>
        </section>
      </Reveal>

      <Reveal retraso={80}>
        <section className="rounded-3xl p-5" style={{ background: FONDO, border: `1px solid ${LINEA}` }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: TINTA }}>Los 12 más cerrables del país</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...datos.prospectos].sort((a, b) => b.cierre - a.cierre || b.urgencia - a.urgencia).slice(0, 12).map((p) => (
              <TarjetaProspecto key={p.id} p={p} nuevo={recientes.has(p.id)} />
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal retraso={120}>
        <footer className="text-[11px] leading-relaxed px-1 space-y-1" style={{ color: 'var(--muted)' }}>
          <p>{CRITERIO_SCORES.urgencia}</p>
          <p>{CRITERIO_SCORES.cierre}</p>
          <p suppressHydrationWarning>Puntos en el mapa: solo prospectos con dirección real (DENUE/INEGI). Actualizado {new Date(datos.generadoEn).toLocaleTimeString('es-MX')} · se refresca cada 60 s.</p>
        </footer>
      </Reveal>

      {/* Las animaciones del mundo (todas apagadas por prefers-reduced-motion
          vía la clase raíz — ver el media query de abajo). */}
      <style>{`
        .cerebro-estado-entra { opacity: 0; animation: cerebroEntra 600ms cubic-bezier(.22,1,.36,1) forwards; }
        @keyframes cerebroEntra { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
        .cerebro-pin-pulso { animation: cerebroPulso 2.6s ease-in-out infinite; }
        @keyframes cerebroPulso { 0%, 100% { opacity: 0.95; } 50% { opacity: 0.35; } }
        .cerebro-pin-nuevo { animation: cerebroLlega 1.1s cubic-bezier(.22,1,.36,1) 3; }
        @keyframes cerebroLlega { 0% { opacity: 0; } 35% { opacity: 1; } 65% { opacity: 0.25; } 100% { opacity: 0.95; } }
        .cerebro-recien { outline: 1px solid #22d3ee; box-shadow: 0 0 14px rgba(34,211,238,0.35); }
        .cerebro-panel { animation: cerebroPanel 420ms cubic-bezier(.22,1,.36,1); }
        @keyframes cerebroPanel { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
        .cerebro-llenado { transition: width 900ms cubic-bezier(.22,1,.36,1); }
        /* El resplandor ambiental: la zona respira, muy lento y muy tenue. */
        .cerebro-ambiente::before {
          content: ''; position: absolute; inset: -20%; pointer-events: none; z-index: 0;
          background: radial-gradient(45% 35% at 30% 30%, rgba(34,211,238,0.07), transparent 70%),
                      radial-gradient(40% 30% at 72% 62%, rgba(124,58,237,0.06), transparent 70%);
          animation: cerebroDeriva 26s ease-in-out infinite alternate;
        }
        @keyframes cerebroDeriva { from { transform: translate(0,0) } to { transform: translate(4%, 3%) } }
        /* El ala izquierda solo existe donde sobra pantalla (Odyssey 49 y
           similares): en laptop taparía el país. */
        @media (min-width: 1900px) { .cerebro-ala { display: flex; } }
        @media (prefers-reduced-motion: reduce) {
          .cerebro-ambiente::before { animation: none; }
          .cerebro-estado-entra, .cerebro-pin-pulso, .cerebro-pin-nuevo, .cerebro-panel { animation: none !important; opacity: 1; }
          .cerebro-llenado { transition: none; }
        }
      `}</style>
    </div>
  );
}
