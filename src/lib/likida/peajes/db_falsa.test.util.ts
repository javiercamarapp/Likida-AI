// ═══════════════════════════════════════════════════════════════════════════
// UNA BASE EN MEMORIA, SOLO PARA PRUEBAS: lo justo de supabase-js para ejercer
// el I/O de peajes (select/insert/update/delete/upsert, eq/in/gte/lte/is,
// order/range/limit, maybeSingle/single, count y rpc). No es Postgres: no
// aplica CHECK ni FK — eso lo prueba `supabase/tests/0375_*.sql` contra
// Postgres real. Aquí se verifica la LÓGICA de la app: qué lee, qué escribe y
// con qué filtro de tenant.
// ═══════════════════════════════════════════════════════════════════════════

export type Fila = Record<string, unknown>;
type Resp = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

export interface Llamada { tabla: string; op: string; filtros: Array<[string, string, unknown]>; payload?: unknown }

/**
 * Lo que una función fake de `rpc()` puede devolver: filas (éxito, como antes)
 * o un error DINÁMICO con `code` (p. ej. `54000`) — para simular una función de
 * Postgres que decide en el momento, según el estado de la tabla, si rechaza
 * (candado/tope atómico: 0693, 0849) en vez de un fallo fijo pre-registrado
 * con `fallar()`.
 */
export type RpcResultado = Fila[] | { error: { message: string; code?: string } };

export interface DbFalsa {
  tablas: Record<string, Fila[]>;
  llamadas: Llamada[];
  /** Hace fallar `tabla.op` (select/insert/update/delete/upsert/rpc:nombre) con ese mensaje. */
  fallar: (clave: string, mensaje: string, codigo?: string) => void;
  cliente: { from: (t: string) => unknown; rpc: (n: string, a?: unknown, o?: unknown) => unknown };
}

let secuencia = 0;

export function crearDbFalsa(
  inicial: Record<string, Fila[]> = {},
  rpcs: Record<string, (args: Record<string, unknown>) => RpcResultado> = {},
): DbFalsa {
  const tablas: Record<string, Fila[]> = Object.fromEntries(Object.entries(inicial).map(([k, v]) => [k, v.map((f) => ({ ...f }))]));
  const llamadas: Llamada[] = [];
  const fallos = new Map<string, string>();
  const codigos = new Map<string, string>();

  class Q implements PromiseLike<Resp> {
    private filtros: Array<[string, string, unknown]> = [];
    private op = 'select';
    private payload: unknown = undefined;
    private orden: Array<[string, boolean]> = [];
    private desde = 0;
    private hasta = Number.POSITIVE_INFINITY;
    private unico: 'single' | 'maybe' | null = null;
    private conteo = false;
    private head = false;
    private retorna = false;
    private opcionesUpsert: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    constructor(private tabla: string, private fuente?: () => RpcResultado, private clave?: string) {}

    select(_c?: string, o?: { count?: string; head?: boolean }) {
      if (this.op !== 'select') this.retorna = true;
      this.conteo = o?.count === 'exact';
      this.head = !!o?.head;
      return this;
    }
    insert(p: unknown) { this.op = 'insert'; this.payload = p; return this; }
    update(p: unknown) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    upsert(p: unknown, o?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.op = 'upsert'; this.payload = p; this.opcionesUpsert = o ?? {}; return this; }
    eq(c: string, v: unknown) { this.filtros.push([c, 'eq', v]); return this; }
    // El valor se guarda como `Set` (no como arreglo) para que `coincide()` compare cada fila en O(1) en vez
    // de recorrer `v` con `.includes()` por cada fila de la tabla: a escala (60 000 filas × cientos de
    // tandas de 100 ids en el UPDATE agrupado de `conciliarDesglose`) esa búsqueda lineal era el verdadero
    // costo medido de la prueba de rendimiento (`escala.test.ts`), no el cruce ni ninguna consulta real
    // contra Postgres — el `Set` se construye UNA vez por llamada, aquí, no por fila.
    in(c: string, v: unknown[]) { this.filtros.push([c, 'in', new Set(v)]); return this; }
    gte(c: string, v: unknown) { this.filtros.push([c, 'gte', v]); return this; }
    lte(c: string, v: unknown) { this.filtros.push([c, 'lte', v]); return this; }
    is(c: string, v: unknown) { this.filtros.push([c, 'is', v]); return this; }
    not(c: string, o: string, v: unknown) { this.filtros.push([c, o === 'is' ? 'nis' : o, v]); return this; }
    lt(c: string, v: unknown) { this.filtros.push([c, 'lt', v]); return this; }
    neq(c: string, v: unknown) { this.filtros.push([c, 'neq', v]); return this; }
    /** `.or('col.is.null,col.gte.X')`: solo las formas `is.null`, `gte`, `lte`, `eq` (lo que usa el código). */
    or(expr: string) { this.filtros.push([expr, 'or', null]); return this; }
    order(c: string, o?: { ascending?: boolean }) { this.orden.push([c, o?.ascending !== false]); return this; }
    range(d: number, h: number) { this.desde = d; this.hasta = h; return this; }
    limit(n: number) { this.desde = 0; this.hasta = n - 1; return this; }
    maybeSingle() { this.unico = 'maybe'; return this; }
    single() { this.unico = 'single'; return this; }

    private coincide(f: Fila): boolean {
      return this.filtros.every(([c, o, v]) => {
        if (o === 'or') {
          return c.split(',').some((alt) => {
            const [col, op, ...resto] = alt.split('.');
            const val = resto.join('.');
            const y = f[col!];
            if (op === 'is' && val === 'null') return y === null || y === undefined;
            if (y === null || y === undefined) return false;
            if (op === 'gte') return (y as string) >= val;
            if (op === 'lte') return (y as string) <= val;
            return op === 'eq' && String(y) === val;
          });
        }
        const x = f[c];
        if (o === 'eq') return x === v;
        if (o === 'in') return (v as Set<unknown>).has(x);
        if (o === 'is') return v === null ? x === null || x === undefined : x === v;
        if (o === 'neq') return x !== v;
        if (o === 'nis') return v === null ? x !== null && x !== undefined : x !== v;
        if (x === null || x === undefined) return false;
        if (o === 'gte') return (x as string | number) >= (v as string | number);
        if (o === 'lte') return (x as string | number) <= (v as string | number);
        if (o === 'lt') return (x as string | number) < (v as string | number);
        return true;
      });
    }

    private ejecutar(): Resp {
      const clave = this.clave ?? `${this.tabla}.${this.op}`;
      llamadas.push({ tabla: this.tabla, op: this.clave ? 'rpc' : this.op, filtros: this.filtros, payload: this.payload });
      const falla = fallos.get(clave) ?? fallos.get(`${this.tabla}.*`);
      if (falla) return { data: null, error: { message: falla, ...(codigos.get(clave) ? { code: codigos.get(clave) } : {}) } as { message: string } };

      if (this.fuente) {
        const resultado = this.fuente();
        if (!Array.isArray(resultado)) return { data: null, error: resultado.error };
        let filas = resultado.filter((f) => this.coincide(f));
        for (const [c, asc] of [...this.orden].reverse()) {
          filas = [...filas].sort((a, b) => (a[c]! < b[c]! ? -1 : a[c]! > b[c]! ? 1 : 0) * (asc ? 1 : -1));
        }
        const total = filas.length;
        return { data: filas.slice(this.desde, this.hasta + 1), error: null, count: this.conteo ? total : null };
      }

      const tabla = (tablas[this.tabla] ??= []);
      if (this.op === 'insert' || this.op === 'upsert') {
        const nuevos = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Fila[];
        const creados: Fila[] = [];
        // Índice por llave de conflicto (construido una vez por llamada): el `find` lineal por fila hacía el
        // upsert de 60 000 líneas O(n²) y medía a la base falsa, no al código.
        const llavesUp = (this.opcionesUpsert.onConflict ?? 'id').split(',').map((s) => s.trim());
        const claveDe = (f: Fila) => llavesUp.map((k) => JSON.stringify(f[k])).join('|');
        const indice = this.op === 'upsert' ? new Map<string, Fila>(tabla.map((t) => [claveDe(t), t] as [string, Fila])) : null;
        for (const n of nuevos) {
          // uuid con forma válida: las rutas /v1 validan el id como uuid, y un `id-3` jamás pasaría esa puerta.
          const fila: Fila = { id: `00000000-0000-4000-8000-${String(++secuencia).padStart(12, '0')}`, ...n };
          if (this.op === 'upsert') {
            const previa = indice!.get(claveDe(fila));
            // `ignoreDuplicates` (ON CONFLICT DO NOTHING): la fila previa NO se toca y no se devuelve.
            if (previa && this.opcionesUpsert.ignoreDuplicates) continue;
            if (previa) { Object.assign(previa, n); creados.push(previa); continue; }
          }
          tabla.push(fila);
          indice?.set(claveDe(fila), fila);
          creados.push(fila);
        }
        return this.devolver(creados);
      }
      const objetivo = tabla.filter((f) => this.coincide(f));
      if (this.op === 'update') {
        for (const f of objetivo) Object.assign(f, this.payload as Fila);
        return this.devolver(objetivo);
      }
      if (this.op === 'delete') {
        tablas[this.tabla] = tabla.filter((f) => !objetivo.includes(f));
        return this.devolver(objetivo);
      }
      let filas = objetivo;
      for (const [c, asc] of [...this.orden].reverse()) {
        filas = [...filas].sort((a, b) => (a[c]! < b[c]! ? -1 : a[c]! > b[c]! ? 1 : 0) * (asc ? 1 : -1));
      }
      const total = filas.length;
      if (this.head) return { data: null, error: null, count: total };
      return this.devolver(filas.slice(this.desde, this.hasta + 1), this.conteo ? total : null);
    }

    private devolver(filas: Fila[], count: number | null = null): Resp {
      if (this.op !== 'select' && !this.retorna && !this.unico) return { data: null, error: null };
      if (this.unico === 'single') {
        return filas.length === 1 ? { data: { ...filas[0] }, error: null } : { data: null, error: { message: `se esperaba una fila y hubo ${filas.length}` } };
      }
      if (this.unico === 'maybe') return { data: filas[0] ? { ...filas[0] } : null, error: null };
      return { data: filas.map((f) => ({ ...f })), error: null, count };
    }

    then<A = Resp, B = never>(ok?: ((v: Resp) => A | PromiseLike<A>) | null, no?: ((r: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
      return Promise.resolve().then(() => this.ejecutar()).then(ok, no);
    }
  }

  const cliente = {
    from: (t: string) => new Q(t),
    rpc: (n: string, args: unknown = {}) => {
      const f = rpcs[n];
      return new Q(`rpc:${n}`, () => (f ? f(args as Record<string, unknown>) : []), `rpc:${n}`);
    },
  };
  return { tablas, llamadas, fallar: (k, m, c) => { fallos.set(k, m); if (c) codigos.set(k, c); else codigos.delete(k); }, cliente };
}
