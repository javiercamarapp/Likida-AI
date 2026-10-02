// ═══════════════════════════════════════════════════════════════════════════
// UNA BASE EN MEMORIA, SOLO PARA PRUEBAS E2E (copia extendida de peajes/db_falsa.test.util.ts: unicos 23505, gt, neq): lo justo de supabase-js para ejercer
// el I/O de peajes (select/insert/update/delete/upsert, eq/in/gte/lte/is,
// order/range/limit, maybeSingle/single, count y rpc). No es Postgres: no
// aplica CHECK ni FK — eso lo prueba `supabase/tests/0375_*.sql` contra
// Postgres real. Aquí se verifica la LÓGICA de la app: qué lee, qué escribe y
// con qué filtro de tenant.
// ═══════════════════════════════════════════════════════════════════════════

export type Fila = Record<string, unknown>;
type Resp = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

export interface Llamada { tabla: string; op: string; filtros: Array<[string, string, unknown]>; payload?: unknown }

export interface DbMemoria {
  tablas: Record<string, Fila[]>;
  llamadas: Llamada[];
  /** Hace fallar `tabla.op` (select/insert/update/delete/upsert/rpc:nombre) con ese mensaje. */
  fallar: (clave: string, mensaje: string, cuando?: (filtros: Array<[string, string, unknown]>) => boolean) => void;
  cliente: { from: (t: string) => unknown; rpc: (n: string, a?: unknown, o?: unknown) => unknown };
}

let secuencia = 0;

export function crearDbMemoria(
  inicial: Record<string, Fila[]> = {},
  rpcs: Record<string, (args: Record<string, unknown>) => Fila[] | boolean> = {},
  /** Restricciones únicas por tabla (lista de columnas): el INSERT que choca devuelve el error 23505 como Postgres. */
  unicos: Record<string, string[][]> = {},
  /** Valores por omisión de columnas por tabla (los DEFAULT de la migración). */
  defaults: Record<string, Fila> = {},
): DbMemoria {
  const tablas: Record<string, Fila[]> = Object.fromEntries(Object.entries(inicial).map(([k, v]) => [k, v.map((f) => ({ ...f }))]));
  const llamadas: Llamada[] = [];
  const fallos = new Map<string, { mensaje: string; cuando?: (filtros: Array<[string, string, unknown]>) => boolean }>();

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
    private opcionesUpsert: { onConflict?: string } = {};
    constructor(private tabla: string, private fuente?: () => Fila[] | boolean, private clave?: string) {}

    select(_c?: string, o?: { count?: string; head?: boolean }) {
      if (this.op !== 'select') this.retorna = true;
      this.conteo = o?.count === 'exact';
      this.head = !!o?.head;
      return this;
    }
    insert(p: unknown) { this.op = 'insert'; this.payload = p; return this; }
    update(p: unknown) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    upsert(p: unknown, o?: { onConflict?: string }) { this.op = 'upsert'; this.payload = p; this.opcionesUpsert = o ?? {}; return this; }
    eq(c: string, v: unknown) { this.filtros.push([c, 'eq', v]); return this; }
    in(c: string, v: unknown[]) { this.filtros.push([c, 'in', v]); return this; }
    gte(c: string, v: unknown) { this.filtros.push([c, 'gte', v]); return this; }
    lte(c: string, v: unknown) { this.filtros.push([c, 'lte', v]); return this; }
    is(c: string, v: unknown) { this.filtros.push([c, 'is', v]); return this; }
    not(c: string, o: string, v: unknown) { this.filtros.push([c, o === 'is' ? 'nis' : o, v]); return this; }
    lt(c: string, v: unknown) { this.filtros.push([c, 'lt', v]); return this; }
    gt(c: string, v: unknown) { this.filtros.push([c, 'gt', v]); return this; }
    neq(c: string, v: unknown) { this.filtros.push([c, 'neq', v]); return this; }
    order(c: string, o?: { ascending?: boolean }) { this.orden.push([c, o?.ascending !== false]); return this; }
    range(d: number, h: number) { this.desde = d; this.hasta = h; return this; }
    limit(n: number) { this.hasta = Math.min(this.hasta, this.desde + n - 1); return this; }
    maybeSingle() { this.unico = 'maybe'; return this; }
    single() { this.unico = 'single'; return this; }

    private coincide(f: Fila): boolean {
      return this.filtros.every(([c, o, v]) => {
        const x = f[c];
        if (o === 'eq') return x === v;
        if (o === 'in') return (v as unknown[]).includes(x);
        if (o === 'neq') return x !== v;
        if (o === 'is') return v === null ? x === null || x === undefined : x === v;
        if (o === 'nis') return v === null ? x !== null && x !== undefined : x !== v;
        if (x === null || x === undefined) return false;
        if (o === 'gte') return (x as string | number) >= (v as string | number);
        if (o === 'lte') return (x as string | number) <= (v as string | number);
        if (o === 'lt') return (x as string | number) < (v as string | number);
        if (o === 'gt') return (x as string | number) > (v as string | number);
        return true;
      });
    }

    private ejecutar(): Resp {
      const clave = this.clave ?? `${this.tabla}.${this.op}`;
      llamadas.push({ tabla: this.tabla, op: this.clave ? 'rpc' : this.op, filtros: this.filtros, payload: this.payload });
      const falla = fallos.get(clave) ?? fallos.get(`${this.tabla}.*`);
      if (falla && (!falla.cuando || falla.cuando(this.filtros))) return { data: null, error: { message: falla.mensaje } };

      if (this.fuente) {
        // Una RPC puede devolver un escalar (p. ej. `true` de finalizar_correo).
        const bruto = this.fuente() as unknown;
        if (!Array.isArray(bruto)) return { data: bruto, error: null };
        let filas = (bruto as Fila[]).filter((f) => this.coincide(f));
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
        for (const n of nuevos) {
          const fila: Fila = { id: `id-${++secuencia}`, created_at: new Date().toISOString(), ...(defaults[this.tabla] ?? {}), ...n };
          if (this.op === 'insert') {
            const choca = (unicos[this.tabla] ?? []).some((cols) => tabla.some((t) => cols.every((k) => JSON.stringify(t[k]) === JSON.stringify(fila[k]))));
            if (choca) return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
          }
          if (this.op === 'upsert') {
            const llaves = (this.opcionesUpsert.onConflict ?? 'id').split(',').map((s) => s.trim());
            const previa = tabla.find((t) => llaves.every((k) => t[k] === fila[k]));
            if (previa) { Object.assign(previa, n); creados.push(previa); continue; }
            // Un upsert que NO choca por su onConflict pero sí por OTRA restricción única falla como en Postgres.
            const choca = (unicos[this.tabla] ?? []).some((cols) => tabla.some((t) => cols.every((k) => JSON.stringify(t[k]) === JSON.stringify(fila[k]))));
            if (choca) return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
          }
          tabla.push(fila);
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
  return { tablas, llamadas, fallar: (k, m, cuando) => { fallos.set(k, { mensaje: m, cuando }); }, cliente };
}
