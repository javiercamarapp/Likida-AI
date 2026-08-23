'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EL CEREBRO DE VENTAS (Fase D, orden del 17-ago) — el mundo virtual de la
// cartera: México entero respirando, cada prospecto una luz con el color de
// su etapa del embudo. Se navega país → estado (zoom animado) → calles
// (Leaflet). Se refresca solo cada 60 s: cuando un agente encuentra o
// enriquece un prospecto, su luz aparece sin recargar (cada 5 min — con
// 30k filas el latido de 1 min pesaba de más).
//
// Visual (orden 17-ago, 2ª dirección): el Cerebro viste los TOKENS del
// software — blanco/gris/negro por tema (claro y oscuro), como el resto de
// /admin. Los únicos colores firmes son los SEMÁNTICOS: el embudo en los
// pines y las barras de urgencia/cierre. La cámara es LIBRE (rueda = zoom
// al cursor, arrastre = paneo, clic = vuelo al estado) — de un estado a
// otro sin pasar por el país.
// Toda animación respeta prefers-reduced-motion (regla de la casa).
// Los % son estimaciones deterministas; el pie enseña el criterio con las
// mismas palabras del módulo que las calcula (CRITERIO_SCORES).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { proyectar } from '../../dashboard/mapa/mexico-geo';
import { ESTADOS_GEO, VIEWBOX_ESTADOS, type EstadoGeo } from './mexico-estados-geo';
import {
  COLOR_EMBUDO, NOMBRE_GIRO, CRITERIO_SCORES, TAMANOS, type DatosMapa, type Giro, type ProspectoMapa, type Tamano,
} from '@/lib/admin/prospectos-mapa';
import { fechaHoraMx, numero, hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { usePrefersReducedMotion } from '../ui/prefers-reduced-motion';
import { useCountUp } from '../ui/use-count-up';
import { hrefWa, hrefCorreo } from './mensajes';

const Calles = dynamic(() => import('./calles'), { ssr: false });

const TINTA = 'var(--ink)';
const TENUE = 'var(--muted)';
const LINEA = 'var(--line)';
const SUPERFICIE = 'var(--surface)';

const ORDEN_EMBUDO = ['negociacion', 'demo', 'contactado', 'nuevo', 'cerrado', 'perdido'] as const;
const GIROS: Giro[] = ['transportista', 'embotelladora', 'abarrotes_mayoreo', 'flota_propia', 'logistica', 'otro'];
const FUENTES = [
  { clave: 'censo', nombre: 'Censo (vacantes)' },
  { clave: 'denue', nombre: 'Universo DENUE' },
  { clave: 'canacar', nombre: 'Directorio CANACAR' },
  { clave: 'bolsa', nombre: 'Bolsas (histórico)' },
  { clave: 'aaag', nombre: 'Padrón AAAG' },
  { clave: 'scribd-tampico', nombre: 'Directorio Tampico' },
  { clave: 'manual', nombre: 'Cuentas a mano' },
] as const;

/** Con más de este número de luces a nivel país, el DOM se arrastra: se
 *  enseñan las N más calientes y el pie lo DICE (nunca se recorta callado). */
const TOPE_LUCES_PAIS = 2200;

interface Filtros {
  giros: Set<Giro> | null;      // null = todas
  etapas: Set<string> | null;
  fuentes: Set<string> | null;
  minUrgencia: 0 | 50 | 70;
  soloTel: boolean;
  soloDecisor: boolean;
  orden: 'cierre' | 'urgencia' | 'recientes' | 'completos' | 'similitud' | 'necesidad';
  tamanos: Set<Tamano | 'n/d'> | null;   // null = todos
  minCompletitud: 0 | 50 | 75;
  /** 0140, GENERADAS — ver CRITERIO_SCORES.similitud/.necesidad. */
  minSimilitud: 0 | 40 | 65 | 85;
  minNecesidad: 0 | 40 | 65 | 85;
  /** "Sin contactar en N días" (0130): 0 = apagado; N = sin toque registrado
   *  en los últimos N días (o nunca tocado). */
  sinToqueDias: 0 | 7 | 14 | 30;
  soloMensajeIA: boolean;
  soloVacante: boolean;
  /** "Todos a 50 km de Nuevo Laredo" (backlog 17-ago): centro elegido de la
   *  lista de plazas + radio. 0 = apagado. Con radio activo solo pasan los
   *  prospectos CON coordenadas — al resto no se le adivina distancia. */
  centro: { lat: number; lng: number; nombre: string } | null;
  radioKm: number;
}
const SIN_FILTROS: Filtros = {
  giros: null, etapas: null, fuentes: null, minUrgencia: 0,
  soloTel: false, soloDecisor: false, orden: 'cierre',
  tamanos: null, minCompletitud: 0, soloMensajeIA: false, soloVacante: false,
  sinToqueDias: 0, minSimilitud: 0, minNecesidad: 0,
  centro: null, radioKm: 0,
};
const TAMANOS_UI: Array<Tamano | 'n/d'> = [...TAMANOS, 'n/d'];

/** Distancia esférica en km — suficiente para un radio comercial. */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** El CSV de la vista actual — columnas fijas, comillas escapadas, BOM para
 *  que Excel en español lo abra con acentos bien. */
function csvDe(lista: ProspectoMapa[]): string {
  const cab = ['empresa', 'giro', 'etapa', 'urgencia_pct', 'cierre_pct', 'similitud_icp_pct', 'necesidad_pct', 'num_unidades', 'contacto', 'telefono', 'correo', 'ciudad', 'entidad', 'vacante', 'fuente', 'lat', 'lng', 'notas'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const filas = lista.map((p) => [
    p.empresa, NOMBRE_GIRO[p.giro], COLOR_EMBUDO[p.estado]?.nombre ?? p.estado, p.urgencia, p.cierre,
    p.similitudIcpPct, p.necesidadPct, p.numUnidades,
    p.contacto, p.telefono, p.correo, p.ciudad, p.entidad, p.vacante, p.fuente, p.lat, p.lng, p.notas,
  ].map(esc).join(','));
  return '\ufeff' + [cab.join(','), ...filas].join('\n');
}

// ADITIVO (orden del 17-ago): default NADA seleccionado (null = sin filtro,
// se ve todo y los chips van apagados); un clic AGREGA el chip (se pinta),
// otro clic lo quita; el conjunto vacío vuelve a null. Antes null pintaba
// TODOS los chips como activos — la pared de chips marcados del popup.
function alternarEnSet<T>(actual: Set<T> | null, valor: T): Set<T> | null {
  const s = new Set(actual ?? []);
  if (s.has(valor)) s.delete(valor); else s.add(valor);
  return s.size === 0 ? null : s;
}

function Chip({ activo, color, onClick, children }: {
  activo: boolean; color?: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] transition-all ${activo ? 'font-medium' : ''}`}
      style={{
        // Activo SIN color de embudo: tinta SUAVE, no relleno negro — con
        // media docena de chips activos el popup se volvía una pared negra
        // (orden del 17-ago). El borde en tinta ya dice "seleccionado".
        background: activo ? (color ? `color-mix(in srgb, ${color} 18%, var(--surface))` : 'color-mix(in srgb, var(--ink) 7%, var(--surface))') : 'transparent',
        border: `1px solid ${activo ? (color ?? 'var(--ink)') : LINEA}`,
        color: activo ? 'var(--ink)' : TENUE,
      }}>
      {children}
    </button>
  );
}

/** Stat inline de la barra premium: etiqueta chica + número tabular, sin
 *  cajón propio — la barra los junta con divisores de pelo (orden 17-ago:
 *  "minimalista premium elegante"). */
function Kpi({ etiqueta, valor, animar, divisor }: { etiqueta: string; valor: number; animar: boolean; divisor?: boolean }) {
  const mostrado = useCountUp(valor, animar);
  return (
    <div className="px-3.5 py-1.5 flex items-baseline gap-2 whitespace-nowrap"
      style={divisor ? { borderLeft: `1px solid ${LINEA}` } : undefined}>
      <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: TENUE }}>{etiqueta}</span>
      <span className="text-[15px] font-semibold tabular-nums" style={{ color: TINTA }}>{numero(mostrado)}</span>
    </div>
  );
}

const SOMBRA_FLOTANTE = '0 10px 30px color-mix(in srgb, var(--ink) 10%, transparent)';
const BOTON_BARRA = 'px-3 py-1.5 rounded-full text-[12px] font-medium backdrop-blur-sm transition-colors';

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

function TarjetaProspecto({ p, nuevo, afinando, onAfinar, onToque, plana }: {
  p: ProspectoMapa; nuevo: boolean; afinando?: boolean; onAfinar?: (id: string) => void;
  onToque?: (id: string, canal: 'whatsapp' | 'correo') => void;
  /** true = tarjeta de sección (plana, sin blur ni sombra — abajo del mapa
   *  no hay país sobre el que flotar). */
  plana?: boolean;
}) {
  const c = COLOR_EMBUDO[p.estado] ?? COLOR_EMBUDO.nuevo;
  return (
    <article className={`rounded-2xl p-3.5 space-y-2 ${plana ? '' : 'backdrop-blur-md'} ${nuevo ? 'cerebro-recien' : ''}`}
      style={plana
        ? { background: 'var(--canvas)', border: `1px solid ${LINEA}` }
        : { background: 'color-mix(in srgb, var(--surface) 90%, transparent)', border: `1px solid ${LINEA}`, boxShadow: '0 10px 30px color-mix(in srgb, var(--ink) 10%, transparent)' }}>
      <div className="flex items-start gap-2">
        <span className="mt-1 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
        <div className="min-w-0">
          <Link href={`/admin/mapa-prospectos/${p.id}`}
            className="text-sm font-medium leading-snug truncate block hover:underline" style={{ color: TINTA }}>
            {p.empresa}
          </Link>
          <p className="text-[11px]" style={{ color: TENUE }}>
            {c.nombre} · {NOMBRE_GIRO[p.giro]}
            {p.numUnidades !== null ? ` · ${numero(p.numUnidades)} unidades` : p.tamano ? ` · ${p.tamano} pers.` : ''}
            {p.ciudad ? ` · ${p.ciudad}` : ''} · datos {p.completitud}%
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
      {p.notas && <p className="text-[11px] line-clamp-2" style={{ color: TENUE }} title={p.notas}>{p.notas}</p>}
      <Barra etiqueta="Urgencia" pct={p.urgencia} color="#f59e0b" />
      <Barra etiqueta="Cierre" pct={p.cierre} color="#34d399" />
      <Barra etiqueta="ICP" pct={p.similitudIcpPct} color="#8b5cf6" />
      <Barra etiqueta="Necesid." pct={p.necesidadPct} color="#ef4444" />
      {p.mensajesGeneradosEn && (
        <p className="text-[10px]" style={{ color: 'var(--marca)' }}>✨ mensaje del agente experto listo</p>
      )}
      {p.ultimoToque && (
        <p className="text-[10px]" style={{ color: TENUE }}>Último toque: {fechaHoraMx(p.ultimoToque)}</p>
      )}
      {(p.telefono || p.correo || p.lat !== null) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {p.telefono && (
            <a href={hrefWa(p)!} target="_blank" rel="noreferrer"
              onClick={() => onToque?.(p.id, 'whatsapp')}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium"
              style={{ border: '1px solid #16a34a55', color: '#15803d', background: 'color-mix(in srgb, #16a34a 8%, var(--surface))' }}>
              WhatsApp →
            </a>
          )}
          {p.correo && (
            <a href={hrefCorreo(p)!}
              onClick={() => onToque?.(p.id, 'correo')}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium"
              style={{ border: '1px solid #2563eb55', color: '#1d4ed8', background: 'color-mix(in srgb, #2563eb 8%, var(--surface))' }}>
              Correo →
            </a>
          )}
          {p.lat !== null && (
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`}
              target="_blank" rel="noreferrer"
              className="px-2.5 py-1 rounded-lg text-[11px]"
              style={{ background: 'var(--canvas)', color: TINTA, border: `1px solid ${LINEA}` }}>
              Cómo llegar
            </a>
          )}
          {onAfinar && (p.telefono || p.correo) && (
            <button onClick={() => onAfinar(p.id)} disabled={afinando}
              title="El agente experto redacta el primer toque con toda la info de este prospecto"
              className="px-2.5 py-1 rounded-lg text-[11px]"
              style={{ border: '1px solid #7c3aed55', color: '#6d28d9', background: 'color-mix(in srgb, #7c3aed 8%, var(--surface))', opacity: afinando ? 0.6 : 1 }}>
              {afinando ? 'redactando…' : p.mensajesGeneradosEn ? '↻ IA' : '✨ Mensaje IA'}
            </button>
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

  // ── Filtros y orden (orden del 17-ago: "filtro y orden, muy chingón") ────
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  // El popup se cierra al hacer clic FUERA (orden 17-ago: "sino no se
  // quita") — pointerdown en captura, ignorando el propio botón de Filtros.
  const popupRef = useRef<HTMLDivElement>(null);
  const botonFiltrosRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!filtrosAbiertos) return;
    const fuera = (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (popupRef.current?.contains(t) || botonFiltrosRef.current?.contains(t)) return;
      setFiltrosAbiertos(false);
    };
    document.addEventListener('pointerdown', fuera, true);
    return () => document.removeEventListener('pointerdown', fuera, true);
  }, [filtrosAbiertos]);
  const filtrosActivos =
    (filtros.giros ? 1 : 0) + (filtros.etapas ? 1 : 0) + (filtros.fuentes ? 1 : 0) +
    (filtros.minUrgencia ? 1 : 0) + (filtros.soloTel ? 1 : 0) + (filtros.soloDecisor ? 1 : 0) +
    (filtros.tamanos ? 1 : 0) + (filtros.minCompletitud ? 1 : 0) +
    (filtros.soloMensajeIA ? 1 : 0) + (filtros.soloVacante ? 1 : 0) +
    (filtros.sinToqueDias ? 1 : 0) +
    (filtros.minSimilitud ? 1 : 0) + (filtros.minNecesidad ? 1 : 0) +
    (filtros.centro && filtros.radioKm ? 1 : 0);
  const filtrados = useMemo(() => datos.prospectos.filter((p) =>
    (!filtros.giros || filtros.giros.has(p.giro))
    && (!filtros.etapas || filtros.etapas.has(p.estado))
    && (!filtros.fuentes || filtros.fuentes.has(p.fuente))
    && p.urgencia >= filtros.minUrgencia
    && (!filtros.soloTel || p.telefono !== null)
    && (!filtros.soloDecisor || p.contacto !== null)
    && (!filtros.tamanos || filtros.tamanos.has(p.tamano ?? 'n/d'))
    && p.completitud >= filtros.minCompletitud
    && p.similitudIcpPct >= filtros.minSimilitud
    && p.necesidadPct >= filtros.minNecesidad
    && (!filtros.soloMensajeIA || p.mensajesGeneradosEn !== null)
    && (!filtros.soloVacante || p.vacante !== null)
    && (filtros.sinToqueDias === 0 || !p.ultimoToque
      || (ahoraMs() - new Date(p.ultimoToque).getTime()) >= filtros.sinToqueDias * 86_400_000)
    && (!filtros.centro || filtros.radioKm === 0
      || (p.lat !== null && haversineKm(filtros.centro, { lat: p.lat, lng: p.lng! }) <= filtros.radioKm)),
  ), [datos, filtros]);
  // Las plazas con coordenadas (centro del radio): promedio por ciudad.
  const plazas = useMemo(() => {
    const acc = new Map<string, { lat: number; lng: number; n: number }>();
    for (const p of datos.prospectos) {
      if (p.lat === null || !p.ciudad) continue;
      const k = p.entidad ? `${p.ciudad}, ${p.entidad}` : p.ciudad;
      const a = acc.get(k) ?? { lat: 0, lng: 0, n: 0 };
      acc.set(k, { lat: a.lat + p.lat, lng: a.lng + p.lng!, n: a.n + 1 });
    }
    return [...acc.entries()]
      .map(([nombre, a]) => ({ nombre, lat: a.lat / a.n, lng: a.lng / a.n, n: a.n }))
      .sort((x, y) => y.n - x.n)
      .slice(0, 250);
  }, [datos]);
  const ordenar = useMemo(() => (lista: ProspectoMapa[]) => [...lista].sort((a, b) =>
    filtros.orden === 'urgencia' ? (b.urgencia - a.urgencia || b.cierre - a.cierre)
      : filtros.orden === 'recientes' ? 0 // ya vienen por created_at desc del servidor
        : filtros.orden === 'completos' ? (b.completitud - a.completitud || b.cierre - a.cierre)
          : filtros.orden === 'similitud' ? (b.similitudIcpPct - a.similitudIcpPct || b.necesidadPct - a.necesidadPct)
            : filtros.orden === 'necesidad' ? (b.necesidadPct - a.necesidadPct || b.similitudIcpPct - a.similitudIcpPct)
              : (b.cierre - a.cierre || b.urgencia - a.urgencia),
  ), [filtros.orden]);
  const exportarCsv = () => {
    const blob = new Blob([csvDe(ordenar(filtrados))], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // El día de México: descargado a las 19:00 el archivo se llamaba con la
    // fecha de mañana, y el orden por nombre de dos exports seguidos mentía.
    a.download = `cerebro-prospectos-${hoyMx()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── El toque se registra solo (0130): al abrir WhatsApp/correo, fila al
  // historial — fuego y olvido, el link abre igual aunque la red falle. ────
  const tocar = (id: string, canal: 'whatsapp' | 'correo') => {
    void fetch('/api/admin/mapa-prospectos/toque', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, canal }),
    }).catch(() => undefined);
    setDatos((d) => ({
      ...d,
      prospectos: d.prospectos.map((p) => (p.id === id ? { ...p, ultimoToque: new Date().toISOString() } : p)),
    }));
  };

  // ── El agente experto en vivo: afinar el mensaje de UNA tarjeta ──────────
  const [afinando, setAfinando] = useState<string | null>(null);
  const afinar = async (id: string) => {
    setAfinando(id);
    try {
      const r = await fetch('/api/admin/mapa-prospectos/mensaje', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) return; // el botón sigue con la plantilla; el error ya quedó en el log del servidor
      const m = (await r.json()) as Pick<ProspectoMapa, 'mensajeWaIa' | 'correoAsuntoIa' | 'correoCuerpoIa' | 'mensajesGeneradosEn'>;
      setDatos((d) => ({
        ...d,
        prospectos: d.prospectos.map((p) => (p.id === id ? { ...p, ...m } : p)),
      }));
    } finally {
      setAfinando(null);
    }
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
    }, 300_000);
    return () => clearInterval(t);
  }, []);

  const porEstado = useMemo(() => {
    const m = new Map<string, ProspectoMapa[]>();
    for (const p of filtrados) {
      if (!p.entidad) continue;
      const lista = m.get(p.entidad) ?? [];
      lista.push(p);
      m.set(p.entidad, lista);
    }
    for (const [k, lista] of m) m.set(k, ordenar(lista));
    return m;
  }, [filtrados, ordenar]);

  const sinPlaza = useMemo(() => filtrados.filter((p) => !p.entidad).length, [filtrados]);
  const maxEstado = useMemo(() => Math.max(1, ...[...porEstado.values()].map((l) => l.length)), [porEstado]);
  const conTelefono = useMemo(() => filtrados.filter((p) => p.telefono).length, [filtrados]);
  const conDecisor = useMemo(() => filtrados.filter((p) => p.contacto).length, [filtrados]);
  const calientes = useMemo(() => filtrados.filter((p) => p.urgencia >= 70).length, [filtrados]);

  // ── LA CÁMARA LIBRE (orden 17-ago: "completamente fluido") ───────────────
  // La cámara vive en un ref y se aplica DIRECTO al <g> (sin re-render por
  // frame): la rueda acerca hacia el cursor, el arrastre panea, el clic en
  // un estado VUELA hacia él con transición — y de ahí puedes rodar o
  // arrastrarte a otro estado sin regresar al país. `camK` es la copia en
  // estado de React (para el grosor de trazos y el radio de las luces) y se
  // sincroniza al SOLTAR el gesto, no a 60fps.
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const cam = useRef({ x: 0, y: 0, k: 1 });
  const [camK, setCamK] = useState(1);
  const arrastro = useRef(false);
  const arrastrando = useRef<{ cx: number; cy: number; acumulado: number } | null>(null);
  const sincro = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aplicarCam = (transicion: boolean) => {
    const g = gRef.current;
    if (!g) return;
    g.style.transition = transicion && !reducido ? 'transform 750ms cubic-bezier(.22,1,.36,1)' : 'none';
    g.style.transform = `translate(${cam.current.x}px, ${cam.current.y}px) scale(${cam.current.k})`;
  };

  /** Coordenadas de pantalla → unidades del viewBox (preserveAspectRatio meet). */
  const factorViewBox = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { f: 1, ox: 0, oy: 0, left: 0, top: 0 };
    const f = Math.min(r.width / VIEWBOX_ESTADOS.w, r.height / VIEWBOX_ESTADOS.h);
    return { f, ox: (r.width - VIEWBOX_ESTADOS.w * f) / 2, oy: (r.height - VIEWBOX_ESTADOS.h * f) / 2, left: r.left, top: r.top };
  };

  const volarA = (e: EstadoGeo | null) => {
    if (!e) {
      cam.current = { x: 0, y: 0, k: 1 };
    } else {
      const margen = 1.35;
      const k = Math.min(9, VIEWBOX_ESTADOS.w / (e.bw * margen), VIEWBOX_ESTADOS.h / (e.bh * margen));
      // El estado aterriza al centro-izquierda: el panel vive a la derecha.
      cam.current = {
        x: VIEWBOX_ESTADOS.w * 0.36 - k * e.cx,
        y: VIEWBOX_ESTADOS.h * 0.5 - k * e.cy,
        k,
      };
    }
    aplicarCam(true);
    setCamK(cam.current.k);
  };

  const alRodar = (ev: WheelEvent) => {
    ev.preventDefault();
    const { f, ox, oy, left, top } = factorViewBox();
    const px = (ev.clientX - left - ox) / f;
    const py = (ev.clientY - top - oy) / f;
    const { x, y, k } = cam.current;
    const k2 = Math.min(16, Math.max(1, k * Math.exp(-ev.deltaY * 0.0016)));
    if (k2 === k) return;
    cam.current = { x: px - ((px - x) * k2) / k, y: py - ((py - y) * k2) / k, k: k2 };
    if (k2 === 1) cam.current = { x: 0, y: 0, k: 1 }; // al fondo, el país completo
    aplicarCam(false);
    if (sincro.current) clearTimeout(sincro.current);
    sincro.current = setTimeout(() => setCamK(cam.current.k), 120);
  };

  // La rueda necesita listener NO pasivo (preventDefault) — React no lo da.
  // Y si la página llegó con un estado inicial (deep-link), la cámara vuela
  // hacia él al montar — la cámara imperativa no lo haría sola.
  useEffect(() => {
    if (seleccion) volarA(seleccion);
    else aplicarCam(false);
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', alRodar, { passive: false });
    return () => svg.removeEventListener('wheel', alRodar);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alRodar solo lee refs
  }, []);

  const alBajarPuntero = (ev: React.PointerEvent<SVGSVGElement>) => {
    arrastro.current = false;
    arrastrando.current = { cx: ev.clientX, cy: ev.clientY, acumulado: 0 };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  };
  const alMoverPuntero = (ev: React.PointerEvent<SVGSVGElement>) => {
    const a = arrastrando.current;
    if (!a) return;
    const { f } = factorViewBox();
    const dx = ev.clientX - a.cx;
    const dy = ev.clientY - a.cy;
    a.acumulado += Math.abs(dx) + Math.abs(dy);
    a.cx = ev.clientX;
    a.cy = ev.clientY;
    if (a.acumulado > 4) arrastro.current = true;
    cam.current = { ...cam.current, x: cam.current.x + dx / f, y: cam.current.y + dy / f };
    aplicarCam(false);
  };
  const alSoltarPuntero = () => {
    if (arrastrando.current) setCamK(cam.current.k);
    arrastrando.current = null;
  };

  const listaSeleccion = seleccion ? porEstado.get(seleccion.nombre) ?? [] : [];
  const conCoords = useMemo(() => filtrados.filter((p) => p.lat !== null && p.lng !== null), [filtrados]);
  const TOPE_LUCES_ESTADO = 1500;
  const lucesRecortadas = seleccion === null
    ? conCoords.length > TOPE_LUCES_PAIS
    : conCoords.filter((p) => p.entidad === seleccion.nombre).length > TOPE_LUCES_ESTADO;
  const pines = useMemo(() => {
    // Con estado elegido solo se pintan SUS luces (las 30k del país detrás
    // eran el jank); a nivel país, las más calientes hasta el tope.
    const universo = seleccion ? conCoords.filter((p) => p.entidad === seleccion.nombre) : conCoords;
    const tope = seleccion ? TOPE_LUCES_ESTADO : TOPE_LUCES_PAIS;
    const base = universo.length > tope
      ? [...universo].sort((a, b) => (b.urgencia + b.cierre) - (a.urgencia + a.cierre)).slice(0, tope)
      : universo;
    return base.map((p) => ({ p, xy: proyectar(p.lat!, p.lng!) }));
  }, [conCoords, seleccion]);

  return (
    <div className="space-y-10">
      {/* ── El mundo ─────────────────────────────────────────────────────── */}
      <section ref={zonaRef} className="relative rounded-3xl overflow-hidden cerebro-zona"
        style={{ height: pantallaCompleta ? '100vh' : 'calc(100vh - 7.5rem)', minHeight: 540, background: 'var(--canvas)', border: '1px solid var(--line)' }}>

        {/* KPIs flotantes */}
        <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-start gap-2 pointer-events-none">
          <div className="pointer-events-auto">
            <h1 className="text-lg font-semibold" style={{ color: TINTA }}>Cerebro de ventas</h1>
            <p className="text-[12px]" style={{ color: TENUE }}>
              {seleccion ? `${seleccion.nombre} — ${listaSeleccion.length} prospectos` : 'Rueda para acercar, arrastra para moverte, toca un estado para volar a él. Se actualiza solo.'}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 pointer-events-auto">
            <div className="flex items-center rounded-full backdrop-blur-sm overflow-hidden"
              style={{ background: SUPERFICIE, border: `1px solid ${LINEA}`, boxShadow: SOMBRA_FLOTANTE }}>
              <Kpi etiqueta="Prospectos" valor={filtrados.length} animar={!reducido} />
              <Kpi etiqueta="Teléfono" valor={conTelefono} animar={!reducido} divisor />
              <Kpi etiqueta="Decisor" valor={conDecisor} animar={!reducido} divisor />
              <Kpi etiqueta="Urgentes" valor={calientes} animar={!reducido} divisor />
            </div>
            {(camK > 1.02 || seleccion) && (
              <button onClick={() => { setSeleccion(null); setCalles(false); volarA(null); }}
                className={`${BOTON_BARRA} hover:bg-[var(--canvas)]`} title="Volver al país"
                style={{ background: SUPERFICIE, border: `1px solid ${LINEA}`, color: TINTA, boxShadow: SOMBRA_FLOTANTE }}>
                ⌂
              </button>
            )}
            {/* Los dos atajos más pedidos (orden 20-ago): un clic, sin abrir
                el popup de Filtros. Mismo estado que sus chips de adentro —
                se puede apagar desde cualquiera de los dos lados. */}
            <button onClick={() => setFiltros((f) => ({ ...f, soloDecisor: !f.soloDecisor }))}
              className={BOTON_BARRA}
              style={{
                background: filtros.soloDecisor ? '#16a34a' : SUPERFICIE,
                border: `1px solid ${filtros.soloDecisor ? '#16a34a' : LINEA}`,
                color: filtros.soloDecisor ? '#fff' : TINTA, boxShadow: SOMBRA_FLOTANTE,
              }}>
              ✓ Con decisor
            </button>
            <button onClick={() => setFiltros((f) => ({ ...f, minUrgencia: f.minUrgencia === 70 ? 0 : 70 }))}
              className={BOTON_BARRA}
              style={{
                background: filtros.minUrgencia === 70 ? '#ea580c' : SUPERFICIE,
                border: `1px solid ${filtros.minUrgencia === 70 ? '#ea580c' : LINEA}`,
                color: filtros.minUrgencia === 70 ? '#fff' : TINTA, boxShadow: SOMBRA_FLOTANTE,
              }}>
              🔥 Urgentes
            </button>
            <button ref={botonFiltrosRef} onClick={() => setFiltrosAbiertos((v) => !v)}
              className={`${BOTON_BARRA} ${filtrosActivos ? '' : 'hover:bg-[var(--canvas)]'}`}
              style={{ background: filtrosActivos ? 'var(--ink)' : SUPERFICIE, border: `1px solid ${filtrosActivos ? 'var(--ink)' : LINEA}`, color: filtrosActivos ? 'var(--canvas)' : TINTA, boxShadow: SOMBRA_FLOTANTE }}>
              Filtros{filtrosActivos ? ` · ${filtrosActivos}` : ''}
            </button>
            <button onClick={alternarPantalla} title="Pantalla completa"
              className={`${BOTON_BARRA} hover:bg-[var(--canvas)]`}
              style={{ background: SUPERFICIE, border: `1px solid ${LINEA}`, color: TINTA, boxShadow: SOMBRA_FLOTANTE }}>
              {pantallaCompleta ? '⤡' : '⤢'}
            </button>
          </div>
        </div>

        {/* ── La barra de filtros y orden ─────────────────────────────────── */}
        {filtrosAbiertos && (
          <div ref={popupRef} className="absolute top-20 right-4 z-40 w-[min(94vw,560px)] rounded-2xl p-4 space-y-3 cerebro-panel overflow-y-auto"
            style={{ maxHeight: 'calc(100% - 6.5rem)', background: SUPERFICIE, border: `1px solid ${LINEA}`, boxShadow: '0 16px 40px color-mix(in srgb, var(--ink) 14%, transparent)' }}>
            <div>
              <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }}>Categoría</p>
              <div className="flex flex-wrap gap-1.5">
                {GIROS.map((g) => (
                  <Chip key={g} activo={filtros.giros?.has(g) ?? false}
                    onClick={() => setFiltros((f) => ({ ...f, giros: alternarEnSet(f.giros, g) }))}>
                    {NOMBRE_GIRO[g]} · {datos.prospectos.filter((p) => p.giro === g).length}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }}>Etapa del embudo</p>
              <div className="flex flex-wrap gap-1.5">
                {ORDEN_EMBUDO.map((e) => (
                  <Chip key={e} color={COLOR_EMBUDO[e].color} activo={filtros.etapas?.has(e) ?? false}
                    onClick={() => setFiltros((f) => ({ ...f, etapas: alternarEnSet(f.etapas, e) }))}>
                    {COLOR_EMBUDO[e].nombre}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }}>Tamaño (personal DENUE)</p>
              <div className="flex flex-wrap gap-1.5">
                {TAMANOS_UI.map((t) => (
                  <Chip key={t} activo={filtros.tamanos?.has(t) ?? false}
                    onClick={() => setFiltros((f) => ({ ...f, tamanos: alternarEnSet(f.tamanos, t) }))}>
                    {t === 'n/d' ? 'Sin dato' : t}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              <div>
                <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }}>Fuente</p>
                <div className="flex flex-wrap gap-1.5">
                  {FUENTES.map((f) => (
                    <Chip key={f.clave} activo={filtros.fuentes?.has(f.clave) ?? false}
                      onClick={() => setFiltros((v) => ({ ...v, fuentes: alternarEnSet(v.fuentes, f.clave) }))}>
                      {f.nombre}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }}>Urgencia mínima</p>
                <div className="flex gap-1.5">
                  {([0, 50, 70] as const).map((u) => (
                    <Chip key={u} activo={u !== 0 && filtros.minUrgencia === u}
                      onClick={() => setFiltros((f) => ({ ...f, minUrgencia: f.minUrgencia === u ? 0 : u }))}>
                      {u === 0 ? 'Todas' : `≥${u}%`}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }} title={CRITERIO_SCORES.similitud}>
                  Similitud ICP mínima (0140)
                </p>
                <div className="flex gap-1.5">
                  {([0, 40, 65, 85] as const).map((u) => (
                    <Chip key={u} activo={u !== 0 && filtros.minSimilitud === u}
                      onClick={() => setFiltros((f) => ({ ...f, minSimilitud: f.minSimilitud === u ? 0 : u }))}>
                      {u === 0 ? 'Todas' : `≥${u}%`}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }} title={CRITERIO_SCORES.necesidad}>
                  Necesidad mínima (0140)
                </p>
                <div className="flex gap-1.5">
                  {([0, 40, 65, 85] as const).map((u) => (
                    <Chip key={u} activo={u !== 0 && filtros.minNecesidad === u}
                      onClick={() => setFiltros((f) => ({ ...f, minNecesidad: f.minNecesidad === u ? 0 : u }))}>
                      {u === 0 ? 'Todas' : `≥${u}%`}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-3 items-end">
              <div>
                <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }}>Alcanzables</p>
                <div className="flex gap-1.5">
                  <Chip activo={filtros.soloTel} onClick={() => setFiltros((f) => ({ ...f, soloTel: !f.soloTel }))}>Con teléfono</Chip>
                  <Chip activo={filtros.soloDecisor} onClick={() => setFiltros((f) => ({ ...f, soloDecisor: !f.soloDecisor }))}>Con decisor</Chip>
                  <Chip activo={filtros.soloMensajeIA} onClick={() => setFiltros((f) => ({ ...f, soloMensajeIA: !f.soloMensajeIA }))}>✨ Mensaje listo</Chip>
                  <Chip activo={filtros.soloVacante} onClick={() => setFiltros((f) => ({ ...f, soloVacante: !f.soloVacante }))}>Con vacante</Chip>
                </div>
              </div>
              <div>
                <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }}>Datos completos</p>
                <div className="flex gap-1.5">
                  {([0, 50, 75] as const).map((c) => (
                    <Chip key={c} activo={c !== 0 && filtros.minCompletitud === c}
                      onClick={() => setFiltros((f) => ({ ...f, minCompletitud: f.minCompletitud === c ? 0 : c }))}>
                      {c === 0 ? 'Todos' : `≥${c}%`}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }}>Sin toque en</p>
                <div className="flex gap-1.5">
                  {([0, 7, 14, 30] as const).map((d) => (
                    <Chip key={d} activo={d !== 0 && filtros.sinToqueDias === d}
                      onClick={() => setFiltros((f) => ({ ...f, sinToqueDias: f.sinToqueDias === d ? 0 : d }))}>
                      {d === 0 ? 'Todos' : `≥${d} días`}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }}>Ordenar por</p>
                <div className="flex gap-1.5">
                  {([['cierre', '% cierre'], ['urgencia', '% urgencia'], ['similitud', '% similitud ICP'], ['necesidad', '% necesidad'], ['completos', 'Datos'], ['recientes', 'Recientes']] as const).map(([k, n]) => (
                    <Chip key={k} activo={filtros.orden === k} onClick={() => setFiltros((f) => ({ ...f, orden: k }))}>{n}</Chip>
                  ))}
                </div>
              </div>
              <button onClick={() => setFiltros(SIN_FILTROS)}
                className="ml-auto px-3 py-1.5 rounded-lg text-[11px]" style={{ background: 'var(--canvas)', color: TINTA, border: `1px solid ${LINEA}` }}>
                Limpiar todo
              </button>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-3 items-end">
              <div className="min-w-[220px]">
                <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }}>Cerca de (plaza)</p>
                <input list="cerebro-plazas" placeholder="Escribe una ciudad…"
                  defaultValue={filtros.centro?.nombre ?? ''}
                  onChange={(e) => {
                    const plaza = plazas.find((x) => x.nombre === e.target.value);
                    setFiltros((f) => ({
                      ...f,
                      centro: plaza ? { lat: plaza.lat, lng: plaza.lng, nombre: plaza.nombre } : null,
                      radioKm: plaza ? (f.radioKm || 50) : 0,
                    }));
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none"
                  style={{ background: 'var(--canvas)', border: `1px solid ${LINEA}`, color: TINTA }} />
                <datalist id="cerebro-plazas">
                  {plazas.map((x) => <option key={x.nombre} value={x.nombre} />)}
                </datalist>
              </div>
              <div>
                <p className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: TENUE }}>Radio</p>
                <div className="flex gap-1.5">
                  {[25, 50, 100, 200].map((km) => (
                    <Chip key={km} activo={filtros.radioKm === km && filtros.centro !== null}
                      onClick={() => setFiltros((f) => ({ ...f, radioKm: f.radioKm === km ? 0 : km }))}>
                      {km} km
                    </Chip>
                  ))}
                </div>
              </div>
              <button onClick={exportarCsv}
                className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-medium"
                style={{ background: 'var(--ink)', color: 'var(--canvas)' }}>
                ⬇ Exportar CSV ({numero(filtrados.length)})
              </button>
            </div>
            <p className="text-[11px]" style={{ color: TENUE }}>
              {numero(filtrados.length)} de {numero(datos.prospectos.length)} prospectos pasan el filtro.
            </p>
          </div>
        )}

        {/* El ala izquierda — solo en pantallas anchas (el Odyssey la pide):
            el embudo y los más cerrables VIVEN junto al país, sin taparlo. */}
        <aside className="cerebro-ala absolute left-4 top-24 bottom-5 z-10 w-[300px] hidden flex-col gap-3 overflow-y-auto pr-1 pointer-events-auto">
          <div className="rounded-2xl p-4 backdrop-blur-sm" style={{ background: SUPERFICIE, border: `1px solid ${LINEA}` }}>
            <h3 className="text-[12px] font-semibold mb-2.5 uppercase tracking-wider" style={{ color: TENUE }}>El embudo</h3>
            <div className="space-y-2">
              {ORDEN_EMBUDO.map((e) => {
                const n = filtrados.filter((p) => p.estado === e).length;
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
          <div className="rounded-2xl p-4 backdrop-blur-sm flex-1 min-h-0 overflow-y-auto" style={{ background: SUPERFICIE, border: `1px solid ${LINEA}` }}>
            <h3 className="text-[12px] font-semibold mb-2.5 uppercase tracking-wider" style={{ color: TENUE }}>Más cerrables</h3>
            <div className="space-y-2.5">
              {ordenar(filtrados).slice(0, 7).map((p) => (
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

        {/* El país — cámara libre: rueda, arrastre y vuelo */}
        <svg ref={svgRef} viewBox={`0 0 ${VIEWBOX_ESTADOS.w} ${VIEWBOX_ESTADOS.h}`}
          className="absolute inset-0 w-full h-full"
          style={{ cursor: 'grab', touchAction: 'none' }}
          onPointerDown={alBajarPuntero} onPointerMove={alMoverPuntero}
          onPointerUp={alSoltarPuntero} onPointerCancel={alSoltarPuntero}
          role="img" aria-label="Mapa de México con la cartera de prospectos">
          {/* El mar: clic fuera de un estado = volver al país (si no fue arrastre). */}
          <rect x={0} y={0} width={VIEWBOX_ESTADOS.w} height={VIEWBOX_ESTADOS.h} fill="transparent"
            onClick={() => { if (arrastro.current) return; setCalles(false); setSeleccion(null); volarA(null); }} />
          <g ref={gRef} style={{ transformOrigin: '0 0', willChange: 'transform' }}>
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
                      ? 'color-mix(in srgb, var(--ink) 5%, var(--surface))'
                      : `color-mix(in srgb, var(--ink) ${8 + Math.round(intensidad * 24)}%, var(--surface))`,
                    stroke: hover === e.id || activo ? 'var(--ink)' : 'var(--line)',
                    strokeWidth: Math.max(0.12, (activo ? 0.8 : 0.55) / camK),
                    opacity: apagado ? 0.18 : 1,
                    cursor: 'pointer',
                    transition: 'fill 300ms, opacity 500ms, stroke 200ms',
                    filter: hover === e.id && !seleccion ? 'drop-shadow(0 1px 4px color-mix(in srgb, var(--ink) 30%, transparent))' : undefined,
                  }}
                  onMouseEnter={() => setHover(e.id)}
                  onMouseLeave={() => setHover((h) => (h === e.id ? null : h))}
                  onClick={() => {
                    if (arrastro.current) return; // fue paneo, no clic
                    setCalles(false);
                    setFiltrosAbiertos(false);
                    const destino = activo ? null : e;
                    setSeleccion(destino);
                    volarA(destino);
                  }}
                />
              );
            })}
            {/* Las luces: cada prospecto con coordenadas reales */}
            {pines.map(({ p, xy }) => {
              const c = COLOR_EMBUDO[p.estado] ?? COLOR_EMBUDO.nuevo;
              const enSeleccion = true;
              return (
                <circle key={p.id} cx={xy.x} cy={xy.y}
                  r={Math.max(0.5, Math.min(2.4, 2.4 / camK))}
                  className={
                    recientes.has(p.id) ? 'cerebro-pin-nuevo'
                      : !reducido && p.urgencia >= 70 && enSeleccion ? 'cerebro-pin-pulso' : undefined
                  }
                  style={{
                    fill: c.color,
                    opacity: enSeleccion ? 0.95 : 0.12,
                    stroke: 'var(--surface)',
                    strokeWidth: Math.max(0.1, 0.4 / camK),
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
            <div className="absolute bottom-16 left-5 z-20 px-4 py-3 rounded-2xl backdrop-blur-sm"
              style={{ background: SUPERFICIE, border: `1px solid ${LINEA}`, color: TINTA }}>
              <div className="text-sm font-semibold">{e.nombre}</div>
              <div className="text-[12px]" style={{ color: TENUE }}>
                {lista.length} prospectos · {lista.filter((p) => p.telefono).length} con teléfono · {lista.filter((p) => p.urgencia >= 70).length} urgentes
              </div>
            </div>
          );
        })()}

        {lucesRecortadas && (
          <p className="absolute bottom-5 right-4 z-10 text-[11px] px-3 py-1.5 rounded-full backdrop-blur-sm"
            style={{ background: SUPERFICIE, border: `1px solid ${LINEA}`, color: TENUE }}>
            Luces: las más calientes ({numero(pines.length)} de {numero(seleccion ? conCoords.filter((p) => p.entidad === seleccion.nombre).length : conCoords.length)}) — afina el filtro para verlas todas.
          </p>
        )}
        {/* Leyenda del embudo */}
        <div className="absolute bottom-5 left-5 z-10 flex flex-wrap gap-x-3 gap-y-1 px-4 py-2 rounded-full backdrop-blur-sm"
          style={{ background: SUPERFICIE, border: `1px solid ${LINEA}` }}>
          {ORDEN_EMBUDO.map((e) => (
            <span key={e} className="flex items-center gap-1.5 text-[11px]" style={{ color: TENUE }}>
              <span className="w-2 h-2 rounded-full" style={{ background: COLOR_EMBUDO[e].color, boxShadow: `0 0 5px ${COLOR_EMBUDO[e].color}` }} />
              {COLOR_EMBUDO[e].nombre}
            </span>
          ))}
        </div>

        {/* Los leads del estado: tarjetas FLOTANDO al lateral del país —
            sin recuadro contenedor (orden 17-ago). El país respira entre
            ellas; solo la columna hace scroll. */}
        {seleccion && !calles && (
          <div className="absolute top-[4.4rem] right-4 bottom-4 z-20 w-[min(92vw,330px)] flex flex-col gap-2.5 cerebro-panel pointer-events-none">
            <div className="pointer-events-auto self-end flex items-center gap-2.5 px-3.5 py-1.5 rounded-full backdrop-blur-sm"
              style={{ background: SUPERFICIE, border: `1px solid ${LINEA}`, boxShadow: SOMBRA_FLOTANTE }}>
              <span className="text-[13px] font-semibold" style={{ color: TINTA }}>{seleccion.nombre}</span>
              <span className="text-[11px] tabular-nums" style={{ color: TENUE }}>{numero(listaSeleccion.length)}</span>
              {listaSeleccion.some((p) => p.lat !== null) && (
                <button onClick={() => setCalles(true)} className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                  style={{ background: 'var(--ink)', color: 'var(--canvas)' }}>
                  Calles →
                </button>
              )}
              <button onClick={() => { setSeleccion(null); volarA(null); }} title="Cerrar"
                className="text-[13px] leading-none px-1" style={{ color: TENUE }}>
                ✕
              </button>
            </div>
            <div className="pointer-events-auto flex-1 overflow-y-auto space-y-2.5 pr-0.5 cerebro-scroll">
              {listaSeleccion.length === 0 ? (
                <p className="text-[12px] px-3.5 py-2.5 rounded-2xl backdrop-blur-sm"
                  style={{ background: SUPERFICIE, border: `1px solid ${LINEA}`, color: TENUE, boxShadow: SOMBRA_FLOTANTE }}>
                  El censo todavía no encuentra a nadie aquí — cuando un agente lo haga, aparece solo.
                </p>
              ) : (
                <>
                  {listaSeleccion.slice(0, 60).map((p) => (
                    <TarjetaProspecto key={p.id} p={p} nuevo={recientes.has(p.id)} afinando={afinando === p.id} onAfinar={afinar} onToque={tocar} />
                  ))}
                  {listaSeleccion.length > 60 && (
                    <p className="text-[11px] px-3.5 py-2 rounded-2xl backdrop-blur-sm"
                      style={{ background: SUPERFICIE, border: `1px solid ${LINEA}`, color: TENUE, boxShadow: SOMBRA_FLOTANTE }}>
                      Se enseñan las 60 mejores de {numero(listaSeleccion.length)} — afina el filtro o ⬇ exporta el CSV completo.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* El nivel calles */}
        {seleccion && calles && (
          <Calles prospectos={listaSeleccion} titulo={seleccion.nombre} onCerrar={() => setCalles(false)} />
        )}
      </section>

      {/* ── Lo que se revela al hacer scroll ─────────────────────────────── */}
      <Reveal>
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl p-4" style={{ background: SUPERFICIE, border: `1px solid ${LINEA}` }}>
            <h3 className="etiqueta-mono text-[10px] font-medium uppercase mb-3" style={{ color: TENUE }}>El embudo, en luces</h3>
            <div className="space-y-2.5">
              {ORDEN_EMBUDO.map((e) => {
                const n = filtrados.filter((p) => p.estado === e).length;
                const pct = filtrados.length ? Math.round((n / filtrados.length) * 100) : 0;
                return (
                  <div key={e} className="flex items-center gap-3 text-[12px]" style={{ color: TENUE }}>
                    <span className="w-28 shrink-0">{COLOR_EMBUDO[e].nombre}</span>
                    <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: LINEA }}>
                      <span className="block h-full rounded-full cerebro-llenado" style={{ width: `${Math.max(pct, n ? 2 : 0)}%`, background: COLOR_EMBUDO[e].color }} />
                    </span>
                    <span className="w-10 text-right tabular-nums" style={{ color: TINTA }}>{n}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl p-4" style={{ background: SUPERFICIE, border: `1px solid ${LINEA}` }}>
            <h3 className="etiqueta-mono text-[10px] font-medium uppercase mb-3" style={{ color: TENUE }}>Dónde vive la cartera</h3>
            <div className="space-y-2">
              {[...porEstado.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([nombre, lista]) => (
                <div key={nombre} className="flex items-center gap-3 text-[12px]" style={{ color: TENUE }}>
                  <span className="w-28 shrink-0 truncate">{nombre}</span>
                  <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: LINEA }}>
                    <span className="block h-full rounded-full cerebro-llenado" style={{ width: `${Math.round((lista.length / maxEstado) * 100)}%`, background: 'color-mix(in srgb, var(--ink) 55%, transparent)' }} />
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
        <section className="rounded-2xl p-4" style={{ background: SUPERFICIE, border: `1px solid ${LINEA}` }}>
          <h3 className="etiqueta-mono text-[10px] font-medium uppercase mb-3" style={{ color: TENUE }}>Los 12 más cerrables del país</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ordenar(filtrados).slice(0, 12).map((p) => (
              <TarjetaProspecto key={p.id} p={p} plana nuevo={recientes.has(p.id)} afinando={afinando === p.id} onAfinar={afinar} onToque={tocar} />
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal retraso={120}>
        <footer className="text-[11px] leading-relaxed px-1 space-y-1" style={{ color: 'var(--muted)' }}>
          <p>{CRITERIO_SCORES.urgencia}</p>
          <p>{CRITERIO_SCORES.cierre}</p>
          <p>{CRITERIO_SCORES.datos}</p>
          <p>{CRITERIO_SCORES.similitud}</p>
          <p>{CRITERIO_SCORES.necesidad}</p>
          <p suppressHydrationWarning>Puntos en el mapa: solo prospectos con dirección real (DENUE/INEGI). Actualizado {fechaHoraMx(datos.generadoEn)} · se refresca cada 5 min.</p>
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
        .cerebro-recien { outline: 1px solid var(--marca); box-shadow: 0 0 10px color-mix(in srgb, var(--marca) 30%, transparent); }
        .cerebro-panel { animation: cerebroPanel 420ms cubic-bezier(.22,1,.36,1); }
        @keyframes cerebroPanel { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
        .cerebro-llenado { transition: width 900ms cubic-bezier(.22,1,.36,1); }
        .cerebro-scroll::-webkit-scrollbar { width: 5px; }
        .cerebro-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--ink) 16%, transparent); border-radius: 99px; }
        .cerebro-scroll::-webkit-scrollbar-track { background: transparent; }
        /* El ala izquierda solo existe donde sobra pantalla (Odyssey 49 y
           similares): en laptop taparía el país. */
        @media (min-width: 1900px) { .cerebro-ala { display: flex; } }
        @media (prefers-reduced-motion: reduce) {
                    .cerebro-estado-entra, .cerebro-pin-pulso, .cerebro-pin-nuevo, .cerebro-panel { animation: none !important; opacity: 1; }
          .cerebro-llenado { transition: none; }
        }
      `}</style>
    </div>
  );
}
