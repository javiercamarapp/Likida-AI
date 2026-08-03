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
 *
 * `pordefecto` — cuál opción es la que la página asume cuando NO hay
 * `?rango=` en la URL; es la única que se enlaza sin el parámetro. Era '7'
 * fijo, y en cuanto /dashboard cambió su default a 30 días eso se volvió un
 * bug silencioso: el botón "7d" apuntaba a la URL sin parámetro, la página
 * la leía como 30, y el pill activo saltaba de vuelta a 30d. Un filtro que
 * ignora un clic es peor que no tenerlo.
 */
export function GlobalFilter({
  base, activo, extra, pordefecto = '7',
}: { base: string; activo: string; extra?: Record<string, string>; pordefecto?: string }) {
  const construir = (rango: string) => {
    const params = new URLSearchParams(extra);
    if (rango !== pordefecto) params.set('rango', rango);
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
