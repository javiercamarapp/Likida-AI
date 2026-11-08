'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { resolverFormato, type FormatoPreset } from './formato-preset';
import { useCountUp } from './use-count-up';
import { usePrefersReducedMotion } from './prefers-reduced-motion';
import { Cifra } from '../../ui-v2/graficas/cifra';
import { Tarjeta } from '../../ui-v2/componentes/tarjeta';
import { EstadoVacio as EstadoVacioV2 } from '../../ui-v2/componentes/estado-vacio';
import { EstadoError as EstadoErrorV2 } from '../../ui-v2/componentes/estado-error';
import './kit.css';

/**
 * Librería compartida de /admin y /dashboard — "construir UNA vez y reusar en todas las páginas".
 *
 * R8 (7-nov-2026): los EXPORTS conservan nombre y props, pero pintan con los componentes del sistema ui-v2: `Cifra` (KPI con
 * filete de 3 px de color de dato, conteo, delta y estados), `Tarjeta` (radio 12, padding 14), `EstadoVacio` y `EstadoError`.
 * Así las ~100 páginas heredan el aspecto nuevo sin reescribirlas una por una. Ningún componente de servidor pasa funciones
 * a estos componentes de cliente: los formatos cruzan como id (`FormatoPreset`) y los reintentos usan `router.refresh()`.
 */

// ── KpiTile ──────────────────────────────────────────────────────────────

export function KpiTile({
  icono, etiqueta, valor, formato = 'numero', tendencia, sparkline, vacio, destacar, nota,
}: {
  /** Elemento YA renderizado (`icono={<DollarSign width={15} .../>}`), no
   *  la referencia al componente — una referencia a función/componente no
   *  es serializable cruzando el límite Server→Client Component; un
   *  elemento (el resultado de `<Icono .../>`) sí lo es (mismo patrón que
   *  `asistente-expandible.tsx` ya usa para `main`/`asideTop`). */
  icono: React.ReactNode;
  etiqueta: string;
  /** `null` = NO MEDIBLE (auditoría 1): pinta "—" en el encabezado en vez de un
   *  0/0% con cara de medición. El pie lo explica con `vacio`. */
  valor: number | null;
  formato?: FormatoPreset;
  tendencia?: number | null;
  sparkline?: number[];
  /** Mensaje honesto ("sin historia suficiente") cuando no hay serie real
   *  que graficar — nunca se inventa un sparkline plano de relleno. */
  vacio?: string;
  /** Borde en --accent para LA cifra encabezado de una sección (p.ej. el
   *  litraje elegible del estímulo en /dashboard) — nunca dos destacadas en
   *  la misma grilla, o deja de leerse como jerarquía. */
  destacar?: boolean;
  /** Cita/base legal u otra nota fija de una línea (p.ej. "LIF 2026, Art.
   *  20-A") — a diferencia de `vacio`, no es un mensaje de "sin datos": se
   *  pinta SIEMPRE que se pasa, sin importar sparkline/vacio. Cada tile de
   *  /dashboard cita un artículo distinto; fusionarlas en una sola nota de
   *  sección se leería como que las tres comparten un mismo fundamento. */
  nota?: string;
}) {
  // El conteo vive aquí (hook existente): arranca en el valor REAL y solo anima cuando el valor cambia; Cifra recibe el texto ya formateado.
  const reducido = usePrefersReducedMotion();
  const mostrado = useCountUp(valor ?? 0, !reducido);
  const texto = valor === null ? null : resolverFormato(formato)(mostrado);
  const sinSerie = !(sparkline && sparkline.length > 1);
  return (
    <section className="rv-kpis kit-celda" aria-label={etiqueta} title={valor === null ? undefined : resolverFormato(formato)(valor)}>
      <Cifra
        etiqueta={etiqueta} valor={texto} icono={icono}
        serie={sparkline && sparkline.length > 1 ? sparkline : undefined}
        deltaPct={tendencia === undefined ? undefined : tendencia === null ? null : { pct: tendencia, bueno: tendencia >= 0 }}
        deltaNota="vs los 7 días previos"
        nota={nota ?? (sinSerie ? vacio : undefined)}
        estado={valor === null ? 'vacio' : undefined}
        mensaje={valor === null ? (vacio ?? 'Sin dato en este periodo') : undefined}
        tono={destacar ? 'warn' : undefined}
        matiz={destacar ? undefined : 1}
      />
    </section>
  );
}

/**
 * Blanco de toque de las flechas ‹ › de periodo (auditoría 28, FE-M5): un
 * SOLO literal para que `kpi-periodo.tsx` y `motor-fiscal-periodo.tsx` no
 * vuelvan a divergir (venían con la MISMA clase copiada en los dos
 * archivos, `w-4 h-4` = 16×16 CSS px, por debajo del mínimo 24×24 de WCAG
 * 2.5.8 — en una tablet el dedo cae en la flecha vecina). El ícono sigue
 * chico (12-13px, se centra solo con `items-center justify-center`); la
 * caja real crece a `w-6 h-6` (24px) y `-m-1` le resta 4px por lado al
 * espacio que reserva en el flujo, dejando el layout EXACTO de antes
 * (16px netos) para que las tarjetas de `MotorFiscalPeriodo` no crezcan de
 * alto — la fila padre las estira parejas a la más alta de las tres
 * ("Diésel elegible" incluida), así que un pixel de más aquí se contagia a
 * las otras dos. Usa `gap-3` (12px) entre las dos flechas, no menos: con el
 * margen negativo, un gap menor deja las dos cajas de 24px pisándose.
 */
export const BOTON_PERIODO =
  'w-6 h-6 -m-1 rounded flex items-center justify-center transition-colors disabled:opacity-30 hover:bg-[color-mix(in_srgb,var(--muted)_14%,transparent)] disabled:hover:bg-transparent';

// ── StatCard (12-ago-2026) ────────────────────────────

/** La stat card: chip de ícono neutro + etiqueta
 *  arriba, la CIFRA grande en tinta, y el delta como TEXTO verde/rojo bajo
 *  un hairline ("+12% vs periodo anterior"), no como pill.
 *  Reemplaza a `KpiDegradado` (7-ago) en todo el producto.
 *
 *  `delta.bueno` lo decide el LLAMADOR — gastar más no es buena noticia
 *  aunque el número suba. Sin dato comparable el llamador OMITE el delta:
 *  un "0.0%" inventado afirmaría "sin cambio", que no es lo mismo que "no
 *  se pudo comparar". La diferencia con `KpiTile` (que sigue viva en
 *  /admin): jerarquía cifra-primero y el slot `flechas` para los ‹ › de
 *  periodo de /dashboard. */
export function StatCard({
  icono, etiqueta, valor, formato = 'numero', delta, deltaNota = 'vs periodo anterior', flechas, nota,
  sinDato = 'sin dato en este periodo',
}: {
  icono: React.ReactNode;
  etiqueta: string;
  /** `null` = NO MEDIBLE (auditoría 1, CRÍTICO frontend): la tarjeta pinta "—"
   *  y lo dice, en vez de colapsar a `0` un valor que el backend dejó `null` a
   *  propósito (p. ej. costo por viaje con 0 viajes). Un $0.00 fabricado rompe
   *  la regla #1 del producto. `0` sigue siendo un cero REAL, medido. */
  valor: number | null;
  formato?: FormatoPreset;
  /** El pie cuando `valor` es `null`: por qué no hay cifra. */
  sinDato?: string;
  /** `{ pct, bueno }` — misma forma que tenía `KpiDegradado.tendencia`. */
  delta?: { pct: number; bueno: boolean } | null;
  deltaNota?: string;
  /** Los ‹ › de `KpiPeriodo` — viven aquí para que el layout no se duplique
   *  en cada llamador que necesite paginar el periodo. */
  flechas?: React.ReactNode;
  /** Nota fija de una línea (cita legal, aclaración del supuesto). */
  nota?: string;
}) {
  const reducido = usePrefersReducedMotion();
  const mostrado = useCountUp(valor ?? 0, !reducido);
  const texto = valor === null ? null : resolverFormato(formato)(mostrado);
  return (
    <section className="rv-kpis kit-celda" aria-label={etiqueta} title={valor === null ? undefined : resolverFormato(formato)(valor)}>
      <Cifra
        etiqueta={etiqueta} valor={texto} icono={icono} flechas={flechas}
        deltaPct={delta} deltaNota={deltaNota} nota={nota}
        estado={valor === null ? 'vacio' : undefined} mensaje={valor === null ? sinDato : undefined}
      />
    </section>
  );
}

// ── WidgetUso (ref. shadcn-dashboard "plan usage", 16-ago-2026) ──────────

/** La tarjeta de uso al pie del sidebar — el patrón "Basic Plan · 68/100"
 *  de la referencia, con la regla de la casa: SIEMPRE dato medido. El
 *  llamador que no pudo leer pasa `valor: null` y la tarjeta lo DICE —
 *  jamás un $0 o un 0% con cara de medición. En /admin mide el costo de IA
 *  del mes; en /dashboard, el presupuesto diario de análisis del tenant.
 *  El widget de PLAN real llega cuando exista suscripción real (DESIGN §3). */
export function WidgetUso({ etiqueta, valor, detalle, tope, href, hrefTexto = 'Ver' }: {
  /** Micro-rótulo mono uppercase: "COSTO DE IA · AGOSTO". */
  etiqueta: string;
  /** La cifra YA formateada por el llamador (lib/formato) — `null` = no se
   *  pudo leer, y se dice. */
  valor: string | null;
  detalle?: string;
  /** Barra de progreso usado/límite (misma unidad). Omitida, no hay barra. */
  tope?: { usado: number; limite: number } | null;
  href?: string;
  hrefTexto?: string;
}) {
  const pct = tope && tope.limite > 0 ? Math.min(100, Math.round((tope.usado / tope.limite) * 100)) : null;
  return (
    <div className="kit-uso">
      <div className="kit-uso__etq">{etiqueta}</div>
      {valor === null ? (
        <p className="kit-uso__nota">No se pudo leer ahora mismo.</p>
      ) : (
        <>
          {/* El sidebar mide ~200 px: recorte de ancho con la cifra completa en `title` (escala 50k). */}
          <div className="kit-uso__valor" title={valor}>{valor}</div>
          {pct !== null && (
            <div className="kit-uso__barra"><div style={{ width: `${pct}%` }} /></div>
          )}
          {detalle && <p className="kit-uso__nota">{detalle}</p>}
        </>
      )}
      {href && (
        <a href={href} className="kit-uso__ver">{hrefTexto} →</a>
      )}
    </div>
  );
}

// ── VerMas (botón fantasma, ref. shadcn-dashboard 16-ago-2026) ───────────

/** El "Ver estadísticas →" fantasma que vive BAJO un grupo de métricas y
 *  lleva a la pantalla (o ancla) donde se profundiza — el pariente chico del
 *  link del `BannerInsight`. Es `<a>` y no `Link` a propósito: la mitad de
 *  sus destinos son anclas (`#estadisticas`) en la misma página. */
export function VerMas({ href, children = 'Ver estadísticas' }: { href: string; children?: React.ReactNode }) {
  return (
    <a href={href} className="kit-vermas">
      {children} <ArrowRight width={12} height={12} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
    </a>
  );
}

// ── StatusPill / Semaphore ───────────────────────────────────────────────

export type Estado = 'ok' | 'warn' | 'bad' | 'neutral' | 'info';

const ESTILO_ESTADO: Record<Estado, { bg: string; fg: string; label: string }> = {
  ok: { bg: 'var(--okbg)', fg: 'var(--ok)', label: 'OK' },
  warn: { bg: 'var(--warnbg)', fg: 'var(--warn)', label: 'Atención' },
  bad: { bg: 'var(--badbg)', fg: 'var(--bad)', label: 'Error' },
  neutral: { bg: 'var(--canvas)', fg: 'var(--muted)', label: '—' },
  // Aditivo (v2): en v1 --info/--infobg no existen y caen a los neutros.
  info: { bg: 'var(--infobg, var(--canvas))', fg: 'var(--info, var(--muted))', label: 'Info' },
};

/** Nunca color solo — siempre trae texto (label o children), para no
 *  depender de percibir el matiz (regla del skill de dataviz). */
export function StatusPill({ estado, children }: { estado: Estado; children?: React.ReactNode }) {
  const e = ESTILO_ESTADO[estado];
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 shrink-0"
      style={{ background: e.bg, color: e.fg }}>
      {children ?? e.label}
    </span>
  );
}

export function Semaphore({ estado, etiqueta }: { estado: Estado; etiqueta?: string }) {
  const e = ESTILO_ESTADO[estado];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: e.fg }}>
      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: e.fg }} />
      {etiqueta}
    </span>
  );
}

// ── ChartCard ────────────────────────────────────────────────────────────

const ALTURA_TAMANO = { S: 120, M: 200, L: 280, XL: 380 } as const;

export function ChartCard({
  titulo, subtitulo, tamano = 'M', soft = false, accion, children,
}: {
  titulo: string;
  subtitulo?: string;
  tamano?: keyof typeof ALTURA_TAMANO;
  /** Variante "soft": fondo --canvas2 en vez de blanco puro, sin sombra —
   *  para piezas secundarias que no deben competir con la dominante. */
  soft?: boolean;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  void soft;
  return (
    <Tarjeta titulo={titulo} acciones={accion}>
      {subtitulo && <p className="kit-subtitulo">{subtitulo}</p>}
      <div style={{ minHeight: ALTURA_TAMANO[tamano] }}>{children}</div>
    </Tarjeta>
  );
}

// ── Estados: vacío / error / carga ───────────────────────────────────────

/** El mismo bloque "sin datos suficientes" que ya se repetía a mano en
 *  cada página — consolidado aquí (§H: "no gráficas/widgets ad-hoc por
 *  página"). Nunca rellena con datos de ejemplo. */
export function EstadoVacio({ icono, titulo = 'Sin datos por ahora', children, accion }: {
  icono?: React.ReactNode;
  /** Título corto (≤6 palabras, sin punto). Por omisión, el genérico. */
  titulo?: string;
  children: React.ReactNode;
  /** El siguiente paso, como enlace REAL. Un vacío que dice «no hay nada» sin
   *  decir cómo se llena es un callejón (auditoría de producto: «el alta rápida
   *  vive en Despacho» sin enlace). */
  accion?: { href: string; texto: string };
}) {
  // R9: vacío CONTENIDO (alto natural con tope de 220 px, no se estira a la altura del vecino) y con el icono que el llamador ya
  // pasaba y que antes se descartaba (`void icono`). El icono es un elemento ya renderizado, nunca un componente ni una función.
  return (
    <div className="rv-tarjeta kit-vacio" data-contenida>
      <div className="rv-tarjeta__cuerpo">
        {icono ? <span className="kit-vacio__icono" aria-hidden="true">{icono}</span> : null}
        <EstadoVacioV2 titulo={titulo} contenido
          accion={accion ? <Link href={accion.href} className="kit-vermas">{accion.texto}</Link> : undefined}>
          {children}
        </EstadoVacioV2>
      </div>
    </div>
  );
}

/**
 * `onReintentar` es OPCIONAL y con default interno (`router.refresh()`) a
 * propósito: así una página Server Component puede escribir
 * `<EstadoError mensaje="..." />` sin pasar ninguna función — pasar un
 * callback de un Server Component a este Client Component revienta en
 * build ("Event handlers cannot be passed to Client Component props").
 * Un caller que YA es cliente sí puede pasar su propio reintento si
 * "refrescar la página" no es lo que quiere.
 */
export function EstadoError({ mensaje, onReintentar }: { mensaje: string; onReintentar?: () => void }) {
  const router = useRouter();
  const reintentar = onReintentar ?? (() => router.refresh());
  return (
    <div className="rv-tarjeta kit-vacio">
      <div className="rv-tarjeta__cuerpo">
        <EstadoErrorV2 onReintentar={reintentar}>{mensaje}</EstadoErrorV2>
      </div>
    </div>
  );
}

/**
 * El banner de insight (patrón "Update" de shadcn,
 * 16-ago-2026): UNA noticia del periodo con cifra REAL y un link a donde
 * se profundiza. La regla que lo gobierna es la del producto entero: el
 * LLAMADOR solo lo monta cuando tiene un dato real que contar — este
 * componente no tiene estado vacío a propósito, porque un insight de
 * relleno ("$0 esta semana") es exactamente el ruido que no se pinta.
 * `deltaPct` viene de `pctCambio` y llega `null` sin comparable: el chip
 * se omite, nunca un "0%" con cara de medición.
 */
export function BannerInsight({ etiqueta, deltaPct, href, hrefTexto = 'Ver estadísticas', children }: {
  /** Micro-rótulo mono uppercase: "ESTA SEMANA", "ESTE MES". */
  etiqueta: string;
  /** % de cambio real vs el periodo anterior, o `null` si no hay comparable. */
  deltaPct: number | null;
  /** A dónde se profundiza (ancla o ruta). */
  href: string;
  hrefTexto?: string;
  /** La frase con la cifra ya formateada por el llamador (lib/formato). */
  children: React.ReactNode;
}) {
  return (
    <div className="kit-banner" data-banner="insight">
      <span className="kit-banner__punto" />
      <span className="kit-banner__etq">{etiqueta}</span>
      {/* Envuelve a una segunda línea; el monto (un <b>) no se parte (escala 50k). */}
      <span className="kit-banner__texto" data-banner-texto>{children}</span>
      {deltaPct !== null && (
        <span className="kit-banner__delta tabular" data-bueno={deltaPct >= 0 ? '1' : '0'}>
          {/* Sin toLocaleString: el formato vive SOLO en lib/formato. */}
          {deltaPct >= 0 ? '↑' : '↓'} {Math.abs(Math.round(deltaPct * 10) / 10)}% vs periodo anterior
        </span>
      )}
      <a href={href} className="kit-banner__ver">{hrefTexto} →</a>
    </div>
  );
}

/** Shimmer, no spinner (§E). `filas`/`alto` cubren tanto una lista de KPI
 *  (pocas filas cortas) como el cuerpo de una gráfica (una sola fila alta). */
export function EstadoCargando({ filas = 3, alto = 14 }: { filas?: number; alto?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="skeleton rounded-md" style={{ height: alto, width: i === filas - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}
