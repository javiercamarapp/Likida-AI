import Link from 'next/link';
import {
  ROTULO_SEVERIDAD,
  ROTULO_TIPO,
  type Insight,
  type Severidad,
  type TipoInsight,
} from '@/lib/likida/insights/tipos';

// T-INS-03 — Tarjeta «Qué pasó / Qué significa / Qué hacer».
// Presentacional y sin estado: la decisión ya la tomó la regla determinista (T-INS-02).
// El tipo y la severidad se dicen con PALABRAS, no solo con color.

/** Tinta y fondo por tipo: tokens ya definidos (contraste medido en tarjeta-insight.test.tsx). */
export const COLOR_TIPO: Record<TipoInsight, { tinta: string; fondo: string }> = {
  dato: { tinta: 'var(--ok)', fondo: 'var(--okbg)' },
  candidato: { tinta: 'var(--warn)', fondo: 'var(--warnbg)' },
  ejemplo: { tinta: 'var(--muted)', fondo: 'var(--canvas)' },
  simulado: { tinta: 'var(--bad)', fondo: 'var(--badbg)' },
};

export const COLOR_SEVERIDAD: Record<Severidad, { tinta: string; fondo: string }> = {
  info: { tinta: 'var(--muted)', fondo: 'var(--canvas)' },
  atencion: { tinta: 'var(--warn)', fondo: 'var(--warnbg)' },
  urgente: { tinta: 'var(--bad)', fondo: 'var(--badbg)' },
};

function Chip({ texto, tinta, fondo, etiqueta }: { texto: string; tinta: string; fondo: string; etiqueta: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: tinta, background: fondo, border: '1px solid var(--line2)' }}
      data-chip={etiqueta}
    >
      {texto}
    </span>
  );
}

function Linea({ rotulo, texto }: { rotulo: string; texto: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {rotulo}
      </dt>
      <dd className="text-sm" style={{ color: 'var(--ink)' }}>
        {texto}
      </dd>
    </div>
  );
}

/** «Fuente: <tabla/archivo/cálculo> · <periodo> · n=<N>» — todo número trae su fuente. */
export function textoFuente(f: Insight['fuente']): string {
  const origen = [f.tabla, f.archivo, f.calculo].filter((x): x is string => Boolean(x)).join(' + ');
  return `Fuente: ${origen} · ${f.periodo} · n=${f.n}`;
}

export function TarjetaInsight({ insight }: { insight: Insight }) {
  const tipo = COLOR_TIPO[insight.tipo];
  const sev = COLOR_SEVERIDAD[insight.severidad];
  const rotuloExtra = insight.tipo === 'ejemplo' || insight.tipo === 'simulado' ? insight.rotulo : null;
  const titulo = `insight-${insight.id}-titulo`;

  return (
    <article className="card p-4" role="article" aria-labelledby={titulo} data-insight={insight.id}>
      <header className="flex flex-wrap items-center gap-2 mb-2">
        <h3 id={titulo} className="sr-only">
          {insight.quePaso}
        </h3>
        <Chip texto={ROTULO_TIPO[insight.tipo]} tinta={tipo.tinta} fondo={tipo.fondo} etiqueta="tipo" />
        <Chip texto={ROTULO_SEVERIDAD[insight.severidad]} tinta={sev.tinta} fondo={sev.fondo} etiqueta="severidad" />
        {rotuloExtra && (
          <span className="text-[11px] font-medium" style={{ color: 'var(--ink)' }} data-rotulo>
            {rotuloExtra}
          </span>
        )}
      </header>
      <dl className="space-y-2">
        <Linea rotulo="Qué pasó" texto={insight.quePaso} />
        <Linea rotulo="Qué significa" texto={insight.queSignifica} />
        <Linea rotulo="Qué hacer" texto={insight.queHacer} />
      </dl>
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px]" style={{ color: 'var(--muted)' }} data-fuente>
          {textoFuente(insight.fuente)}
        </p>
        {insight.accion && (
          <Link
            href={insight.accion.ruta}
            className="text-xs font-medium underline"
            style={{ color: 'var(--ink)' }}
          >
            {insight.accion.rotulo}
          </Link>
        )}
      </footer>
    </article>
  );
}
