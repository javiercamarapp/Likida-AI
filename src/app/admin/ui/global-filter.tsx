import Link from 'next/link';

const OPCIONES = [
  { valor: '7', etiqueta: '7d' },
  { valor: '30', etiqueta: '30d' },
  { valor: 'todo', etiqueta: 'Todo' },
] as const;

export type Rango = '7' | '30' | 'todo';

export interface RangoResuelto {
  /** El rango que la página tiene que usar AHORA. */
  rango: Rango;
  /** Cuál opción se asume cuando no hay `?rango=` en la URL. */
  pordefecto: Rango;
  /** Días de la ventana. Con 'todo' vale 7 y no se usa para cortar. */
  ventanaDias: number;
  /** La ventana para las consultas: `undefined` con 'todo' = sin corte. */
  ventana: number | undefined;
}

/**
 * LEE EL RANGO Y DECIDE EL DEFAULT EN LA MISMA LLAMADA — y por eso vive pegada
 * al componente que lo pinta, no en la página.
 *
 * ESTE BUG SE PAGÓ DOS VECES. Antes, cada página parseaba `?rango=` por su
 * cuenta y le pasaba `pordefecto` al filtro a mano, así que los dos podían
 * decir cosas distintas — y cuando lo decían, el síntoma era que UNA de las
 * tres opciones dejaba de responder. El botón cuyo valor es el default se
 * enlaza SIN el parámetro (para que la URL quede limpia); si la página asume
 * otro default, ese clic la manda a la URL pelona, la página la lee como el
 * suyo, y el pill salta de vuelta. La segunda vez le tocó a "30d" en
 * /dashboard: la gráfica de liquidaciones cerradas se quedaba en 7 días.
 *
 * No se puede desincronizar lo que sale de una sola llamada: la página pasa el
 * objeto entero al filtro en vez de dos valores sueltos que hay que acordarse
 * de mantener iguales.
 */
export function resolverRango(crudo: string | undefined, pordefecto: Rango): RangoResuelto {
  const rango: Rango = crudo === '7' || crudo === '30' || crudo === 'todo' ? crudo : pordefecto;
  // Con 'todo' no hay ventana, pero `ventanaDias` sigue siendo un número que
  // alguna consulta secundaria recibe. Cae al default de la página en vez de a
  // un 7 fijo: así ninguna de las tres pantallas cambia lo que ya pedía.
  const efectivo = rango === 'todo' ? pordefecto : rango;
  const ventanaDias = efectivo === '30' ? 30 : 7;
  return { rango, pordefecto, ventanaDias, ventana: rango === 'todo' ? undefined : ventanaDias };
}

/**
 * A dónde apunta cada pill. Pura y exportada para que la prueba pueda hacer el
 * VIAJE REDONDO —construir la URL de un botón y volver a leerla con
 * `resolverRango`— que es la única forma de comprobar que los tres clics
 * llegan a donde dicen. Mirar la URL o mirar el parser por separado no lo
 * prueba: el bug vivía justo en el salto entre los dos.
 *
 * La opción que ES el default se enlaza SIN `?rango=`, para que la URL de la
 * pantalla que se abre por omisión quede limpia y compartible.
 */
export function urlDeRango(
  base: string,
  rango: Rango,
  pordefecto: Rango,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams(extra);
  if (rango !== pordefecto) params.set('rango', rango);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

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
 * `r` — el resultado de `resolverRango()`, no dos valores sueltos. Trae el
 * rango activo Y el default de la página en el mismo objeto, precisamente
 * porque cuando eran dos props independientes se desincronizaron dos veces y
 * el síntoma fue un botón que no responde (ver `resolverRango`). Un filtro que
 * ignora un clic es peor que no tenerlo.
 */
export function GlobalFilter({
  base, r, extra,
}: { base: string; r: RangoResuelto; extra?: Record<string, string> }) {
  const { rango: activo, pordefecto } = r;
  const construir = (rango: Rango) => urlDeRango(base, rango, pordefecto, extra);
  return (
    <div className="inline-flex items-center gap-1 p-0.5 rounded-full shrink-0" style={{ background: 'var(--canvas)' }}>
      {OPCIONES.map((o) => (
        <Link key={o.valor} href={construir(o.valor)}
          className="text-xs font-medium px-2.5 py-1 rounded-full transition-colors"
          style={activo === o.valor ? { background: 'var(--marca)', color: 'white' } : { color: 'var(--muted)' }}>
          {o.etiqueta}
        </Link>
      ))}
    </div>
  );
}
