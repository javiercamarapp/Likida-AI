import Link from 'next/link';

const OPCIONES = [
  { valor: '7', etiqueta: '7d' },
  { valor: '30', etiqueta: '30d' },
  { valor: 'todo', etiqueta: 'Todo' },
] as const;

/**
 * Filtro de rango de fechas (§3/§C del complemento de diseño) — pill
 * activo negro, mismo lenguaje que el resto de /admin. Server Component
 * puro (Links con query string, sin JS de cliente): la página que lo usa
 * lee `searchParams.rango` y decide qué consulta correr — nunca un filtro
 * decorativo que no cambia el dato real de abajo.
 *
 * `extra` — query params que YA vivían en la URL y no son `rango`
 * (`?tenant=`/`?vista=demo` de /dashboard, cuando un superadmin está viendo
 * una flota real) — sin esto, tocar 7d/30d/Todo perdía de cuál flota se
 * estaba hablando, el mismo bug de `requireSessionTenant` que dropea query
 * params al redirigir.
 */
export function GlobalFilter({ base, activo, extra }: { base: string; activo: string; extra?: Record<string, string> }) {
  const construir = (rango: string) => {
    const params = new URLSearchParams(extra);
    if (rango !== '7') params.set('rango', rango);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  };
  return (
    <div className="inline-flex items-center gap-1 p-0.5 rounded-full shrink-0" style={{ background: 'var(--canvas)' }}>
      {OPCIONES.map((o) => (
        <Link key={o.valor} href={construir(o.valor)}
          className="text-xs font-medium px-2.5 py-1 rounded-full transition-colors"
          style={activo === o.valor ? { background: 'var(--ink)', color: 'white' } : { color: 'var(--muted)' }}>
          {o.etiqueta}
        </Link>
      ))}
    </div>
  );
}
