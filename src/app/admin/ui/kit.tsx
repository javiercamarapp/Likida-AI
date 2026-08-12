'use client';

import { useRouter } from 'next/navigation';
import { AlertTriangle, Info } from 'lucide-react';
import { Sparkline, Tendencia } from '../charts';
import { useCountUp } from './use-count-up';
import { usePrefersReducedMotion } from './prefers-reduced-motion';
import { resolverFormato, type FormatoPreset } from './formato-preset';

/**
 * Librería compartida de /admin (design system v2, complemento del
 * mockup aprobado) — "construir UNA vez y reusar en todas las páginas"
 * (§B). Todo monocromo: blanco/glass/negro + la rampa --g1..--g5, color
 * solo en los semáforos de salud (--ok/--warn/--bad) y nunca como
 * identidad de una serie de datos.
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
  valor: number;
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
  const reducido = usePrefersReducedMotion();
  const mostrado = useCountUp(valor, !reducido);
  const fmt = resolverFormato(formato);

  return (
    <div className="card p-3.5" style={destacar ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
          {icono}
        </div>
        <div className="min-w-0">
          <div className="text-xl font-semibold tracking-tight tabular leading-tight">{fmt(mostrado)}</div>
          {/* AUDITORÍA 10, MEDIO — `truncate` (una sola línea + "…") cortaba
              la palabra que carga el significado fiscal: "IVA acreditable
              document…" perdía justo "documentado". `line-clamp-2` deja
              envolver a una segunda línea antes de recortar — a los anchos
              medidos (~1100 px de contenido real, sidebar + rail
              descontados) dos líneas alcanzan para las etiquetas más largas
              del producto; solo un rótulo patológicamente largo llegaría a
              perder algo, y ahí sigue habiendo un tope. */}
          <div className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--muted)' }}>{etiqueta}</div>
        </div>
      </div>
      {vacio ? (
        <p className="text-xs mt-2" style={{ color: 'var(--faint)' }}>{vacio}</p>
      ) : sparkline && sparkline.length > 1 ? (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 min-w-0"><Sparkline valores={sparkline} alto={20} /></div>
          {tendencia !== undefined && <Tendencia valor={tendencia} />}
        </div>
      ) : null}
      {nota && <p className="text-xs mt-2" style={{ color: 'var(--faint)' }}>{nota}</p>}
    </div>
  );
}

// ── StatCard (referencia FlowAI, 12-ago-2026) ────────────────────────────

/** La stat card de la referencia FlowAI: chip de ícono neutro + etiqueta
 *  arriba, la CIFRA grande en tinta, y el delta como TEXTO verde/rojo bajo
 *  un hairline ("+12% vs periodo anterior") — así lo pinta la referencia,
 *  no como pill. Reemplaza a `KpiDegradado` (7-ago) en todo el producto.
 *
 *  `delta.bueno` lo decide el LLAMADOR — gastar más no es buena noticia
 *  aunque el número suba. Sin dato comparable el llamador OMITE el delta:
 *  un "0.0%" inventado afirmaría "sin cambio", que no es lo mismo que "no
 *  se pudo comparar". La diferencia con `KpiTile` (que sigue viva en
 *  /admin): jerarquía cifra-primero y el slot `flechas` para los ‹ › de
 *  periodo de /dashboard. */
export function StatCard({
  icono, etiqueta, valor, formato = 'numero', delta, deltaNota = 'vs periodo anterior', flechas, nota,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  valor: number;
  formato?: FormatoPreset;
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
  const mostrado = useCountUp(valor, !reducido);
  const fmt = resolverFormato(formato);
  return (
    // La anatomía EXACTA de la referencia: tarjeta blanca con una CAJA
    // INTERNA tenue (ícono + etiqueta + cifra) y el delta como línea de
    // texto DEBAJO de la caja, dentro de la tarjeta. El chip del ícono es
    // oscuro (--marca) con el glifo claro, como en la foto.
    <div className="card p-2.5 h-full flex flex-col min-w-0">
      <div className="rounded-xl px-3 pt-2.5 pb-3 min-w-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line2)' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
            {icono}
          </div>
          <div className="text-[13px] min-w-0 flex-1 line-clamp-2" style={{ color: 'var(--muted)' }}>{etiqueta}</div>
          {flechas}
        </div>
        <div className="font-display text-[28px] leading-tight font-semibold tabular mt-1">{fmt(mostrado)}</div>
      </div>
      {/* El espaciador alinea los pies en una fila de tarjetas parejas
          (`h-full`) aunque una etiqueta envuelva a dos líneas. */}
      <div className="grow" />
      {delta ? (
        <div className="px-1.5 pt-2 pb-0.5 text-xs flex items-baseline gap-1.5 min-w-0">
          <span className="font-medium tabular shrink-0" style={{ color: delta.bueno ? 'var(--ok)' : 'var(--bad)' }}>
            {delta.pct >= 0 ? '↑' : '↓'} {Math.abs(delta.pct)}%
          </span>
          <span className="truncate" style={{ color: 'var(--faint)' }}>{deltaNota}</span>
        </div>
      ) : nota ? (
        <p className="text-xs px-1.5 pt-2 pb-0.5" style={{ color: 'var(--faint)' }}>{nota}</p>
      ) : null}
    </div>
  );
}

// ── StatusPill / Semaphore ───────────────────────────────────────────────

export type Estado = 'ok' | 'warn' | 'bad' | 'neutral';

const ESTILO_ESTADO: Record<Estado, { bg: string; fg: string; label: string }> = {
  ok: { bg: 'var(--okbg)', fg: 'var(--ok)', label: 'OK' },
  warn: { bg: 'var(--warnbg)', fg: 'var(--warn)', label: 'Atención' },
  bad: { bg: 'var(--badbg)', fg: 'var(--bad)', label: 'Error' },
  neutral: { bg: 'var(--canvas)', fg: 'var(--muted)', label: '—' },
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
  return (
    <div className="rounded-2xl p-4"
      style={soft
        ? { background: 'var(--canvas2)', border: '1px solid var(--line2)' }
        : { background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          {/* Mismo criterio que `KpiTile.etiqueta`: "El gasto del periodo, por
              su suerte fiscal" se cortaba a media palabra con `truncate` —
              `line-clamp-2` lo deja envolver antes de recortar. */}
          <h3 className="text-xs font-semibold uppercase tracking-wide line-clamp-2" style={{ color: 'var(--muted)' }}>{titulo}</h3>
          {subtitulo && <p className="text-xs mt-0.5" style={{ color: 'var(--faint)' }}>{subtitulo}</p>}
        </div>
        {accion}
      </div>
      <div style={{ minHeight: ALTURA_TAMANO[tamano] }}>{children}</div>
    </div>
  );
}

// ── Estados: vacío / error / carga ───────────────────────────────────────

/** El mismo bloque "sin datos suficientes" que ya se repetía a mano en
 *  cada página — consolidado aquí (§H: "no gráficas/widgets ad-hoc por
 *  página"). Nunca rellena con datos de ejemplo. */
export function EstadoVacio({ icono, children }: { icono?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
          {icono ?? <Info width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
        </div>
        <p className="text-sm pt-1">{children}</p>
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
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--badbg)' }}>
          <AlertTriangle width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />
        </div>
        <div className="flex-1 pt-0.5">
          <p className="text-sm">{mensaje}</p>
          <button type="button" onClick={reintentar}
            className="mt-2 text-xs font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
            Reintentar
          </button>
        </div>
      </div>
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
