import Link from 'next/link';
import { type ClavePeriodo, type Periodo, PERIODO_POR_DEFECTO } from '@/lib/likida/fiscal';
import { fechaMx } from '@/lib/formato';

/**
 * El selector de periodo del panel fiscal — mismo lenguaje visual que
 * `GlobalFilter` de /admin (pill negro para el activo), pero con las opciones
 * que un contador usa: el mes que va a declarar, el que acaba de cerrar, el
 * ejercicio, y el histórico.
 *
 * Server Component puro (Links con query string, sin JS de cliente): la página
 * lee `?p=` y CORRE OTRA CONSULTA. Nunca un filtro decorativo — si el pill se
 * mueve y las cifras de abajo no, el control enseña a desconfiar del control.
 *
 * La opción que ES el default se enlaza SIN `?p=`, igual que `urlDeRango`, para
 * que la URL de la pantalla que se abre por omisión quede limpia y compartible.
 * Esa simetría no es cosmética: cuando el botón del default apunta a la URL
 * pelona y la página asume OTRO default, el clic rebota y el pill salta de
 * vuelta — el bug que `resolverRango` ya pagó dos veces.
 */
const OPCIONES: Array<{ valor: ClavePeriodo; etiqueta: string }> = [
  { valor: 'mes', etiqueta: 'Este mes' },
  { valor: 'mes_anterior', etiqueta: 'Mes anterior' },
  { valor: 'ejercicio', etiqueta: 'Ejercicio' },
  { valor: 'todo', etiqueta: 'Todo' },
];

/** Construye la URL de un pill conservando `?tenant=`/`?vista=`/`?rol=`. */
export function urlDePeriodo(base: string, p: ClavePeriodo, extra?: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  if (p !== PERIODO_POR_DEFECTO) params.set('p', p);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function SelectorPeriodo({
  base, activo, extra,
}: { base: string; activo: ClavePeriodo; extra?: Record<string, string> }) {
  return (
    <div className="inline-flex items-center gap-1 p-0.5 rounded-full shrink-0" style={{ background: 'var(--canvas)' }}>
      {OPCIONES.map((o) => (
        <Link key={o.valor} href={urlDePeriodo(base, o.valor, extra)}
          className="text-xs font-medium px-2.5 py-1 rounded-full transition-colors"
          style={activo === o.valor ? { background: 'var(--marca)', color: 'white' } : { color: 'var(--muted)' }}>
          {o.etiqueta}
        </Link>
      ))}
    </div>
  );
}

/**
 * El encabezado que llevan las seis pantallas del panel: título, subtítulo y
 * el selector, con el rango REAL escrito debajo.
 *
 * El rango se imprime siempre, con sus fechas, y no solo el nombre del
 * periodo. "Ejercicio 2026" es una etiqueta; "01 ene 2026 – 31 dic 2026" es
 * lo que el contador puede cruzar contra su papel de trabajo sin preguntarle
 * a nadie qué incluye.
 *
 * AUDITORÍA 10, BAJO (frontend) — el rango se imprimía en ISO crudo
 * ("2026-01-01 – 2026-12-31"): el único formato de fecha del producto que NO
 * pasaba por `fechaMx()`, la única representación fiscal que CLAUDE.md exige
 * ("El formato de cifras vive solo en `lib/formato.ts`"). Un contador que lee
 * ISO en una pantalla y "01 ene 2026" en las otras 30 lee dos productos.
 */
export function EncabezadoFiscal({
  icono, titulo, subtitulo, base, periodo, extra,
}: {
  icono: React.ReactNode;
  titulo: string;
  subtitulo: string;
  base: string;
  periodo: Periodo;
  extra?: Record<string, string>;
}) {
  return (
    <header className="glass-panel flex flex-wrap items-center gap-3 px-5 py-4">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {icono}
        <div className="min-w-0">
          <span className="text-sm font-medium block">{titulo}</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>{subtitulo}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <SelectorPeriodo base={base} activo={periodo.clave} extra={extra} />
        <span className="text-xs tabular" style={{ color: 'var(--faint)' }}>
          {periodo.desde ? `${fechaMx(periodo.desde)} – ${fechaMx(periodo.hasta)}` : 'Sin corte de fechas'}
        </span>
      </div>
    </header>
  );
}
