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
          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{etiqueta}</div>
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
          <h3 className="text-xs font-semibold uppercase tracking-wide truncate" style={{ color: 'var(--muted)' }}>{titulo}</h3>
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
