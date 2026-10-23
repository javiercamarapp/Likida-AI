// Base falsa EN MEMORIA para las pruebas de selección de candidatos (A37-S28): a diferencia de los mocks de
// cola de respuestas, aquí `eq`/`in`/`is`/`not`/`gte`/`or`(keyset)/`order`/`limit` FILTRAN y ORDENAN de verdad,
// de modo que una ventana que no avanza se nota (una cola de respuestas fijas la disimula).
export type Fila = Record<string, unknown>;
export type Tablas = Record<string, Fila[]>;

export function crearDbFalsa(tablas: Tablas, consultas?: string[]) {
  function from(tabla: string) {
    let filas = [...(tablas[tabla] ?? [])];
    const orden: Array<{ col: string; asc: boolean }> = [];
    let tope: number | null = null;
    const b: Record<string, unknown> = {};
    const filtrar = (f: (r: Fila) => boolean) => { filas = filas.filter(f); return b; };
    Object.assign(b, {
      select: () => b,
      eq: (c: string, v: unknown) => filtrar((r) => r[c] === v),
      neq: (c: string, v: unknown) => filtrar((r) => r[c] !== v),
      in: (c: string, vs: unknown[]) => filtrar((r) => vs.includes(r[c])),
      is: (c: string, v: unknown) => filtrar((r) => (r[c] ?? null) === v),
      not: (c: string, op: string, v: unknown) => (op === 'is' && v === null ? filtrar((r) => (r[c] ?? null) !== null) : b),
      gte: (c: string, v: unknown) => filtrar((r) => String(r[c]) >= String(v)),
      gt: (c: string, v: unknown) => filtrar((r) => String(r[c]) > String(v)),
      lt: (c: string, v: unknown) => filtrar((r) => String(r[c]) < String(v)),
      // Solo entiende el keyset del repo: `col.gt.X,and(col.eq.X,id.gt.Y)`.
      // Cualquier otro `or` (p. ej. la compuerta ICP) se interpreta con `orIcp`.
      or: (expr: string) => {
        const k = expr.match(/^\(?([a-z_]+)\.gt\.([^,]+),and\(\1\.eq\.\2,id\.gt\.([^)]+)\)\)?$/);
        if (k) return filtrar((r) => String(r[k[1]]) > k[2] || (String(r[k[1]]) === k[2] && String(r.id) > k[3]));
        if (expr.includes('similitud_icp_pct')) {
          return filtrar((r) => {
            const s = String(r.scian ?? '');
            return s.startsWith('48') || s.startsWith('49')
              || ['canacar', 'aaag', 'manual', 'landing'].includes(String(r.fuente))
              || (typeof r.similitud_icp_pct === 'number' && r.similitud_icp_pct >= 60);
          });
        }
        throw new Error(`db_falsa: or() no soportado: ${expr}`);
      },
      order: (c: string, o?: { ascending?: boolean }) => { orden.push({ col: c, asc: o?.ascending !== false }); return b; },
      limit: (n: number) => { tope = n; return b; },
      then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => {
        consultas?.push(tabla);
        let out = filas;
        if (orden.length) {
          out = [...out].sort((x, y) => {
            for (const { col, asc } of orden) {
              const a = String(x[col] ?? ''), c = String(y[col] ?? '');
              if (a !== c) return (a < c ? -1 : 1) * (asc ? 1 : -1);
            }
            return 0;
          });
        }
        if (tope !== null) out = out.slice(0, tope);
        return Promise.resolve({ data: out, error: null }).then(res, rej);
      },
    });
    return b;
  }
  return { from };
}
