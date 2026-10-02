// ═══════════════════════════════════════════════════════════════════════════
// UNA BASE EN MEMORIA PARA PROBAR LAS CARRERAS (W2 «producto»).
//
// Los dobles de supabase-js que encadenan `vi.fn()` prueban «qué métodos se
// llamaron», no «qué pasó con las filas». Para lo que depende de la ATOMICIDAD
// de un UPDATE condicionado —el reclamo de una invitación, dos submits del mismo
// archivo— hace falta un doble que aplique los filtros de verdad. Este lo hace,
// con el subconjunto de PostgREST que usa el panel: `select/update/insert/
// delete`, `eq/neq/is/not/in/lt/or/order/limit/range`, `count`/`head`,
// `maybeSingle`/`single` y `rpc` programado.
//
// Cada método de la cadena termina en un `then` que ejecuta la operación EN UN
// SOLO TURNO del event loop: dos `await` concurrentes sobre el mismo UPDATE se
// serializan igual que en Postgres (el segundo ve lo que dejó el primero).
// ═══════════════════════════════════════════════════════════════════════════

export type Fila = Record<string, unknown>;
type Predicado = (f: Fila) => boolean;
type ErrorDb = { message: string; code?: string };

/** `a.is.null`, `a.eq.x`, `a.lt.x` y `and(...)` separados por coma — la forma
 *  que arma `.or()` en el panel. No es un parser PostgREST completo. */
export function predicadoDeOr(expresion: string): Predicado {
  const partes: string[] = [];
  let prof = 0; let actual = '';
  for (const c of expresion) {
    if (c === '(') prof++;
    if (c === ')') prof--;
    if (c === ',' && prof === 0) { partes.push(actual); actual = ''; } else actual += c;
  }
  if (actual) partes.push(actual);
  const unaCondicion = (t: string): Predicado => {
    const y = /^and\((.*)\)$/.exec(t);
    if (y) { const hijos = predicadoDeAnd(y[1]); return (f) => hijos.every((h) => h(f)); }
    const m = /^([a-z_0-9]+)\.(is|eq|neq|lt|lte|gt|gte)\.(.*)$/.exec(t);
    if (!m) throw new Error(`fixture: condición no soportada «${t}»`);
    return comparar(m[1], m[2], m[3]);
  };
  const hijos = partes.map(unaCondicion);
  return (f) => hijos.some((h) => h(f));
}

function predicadoDeAnd(expresion: string): Predicado[] {
  const partes: string[] = [];
  let prof = 0; let actual = '';
  for (const c of expresion) {
    if (c === '(') prof++;
    if (c === ')') prof--;
    if (c === ',' && prof === 0) { partes.push(actual); actual = ''; } else actual += c;
  }
  if (actual) partes.push(actual);
  return partes.map((t) => {
    const m = /^([a-z_0-9]+)\.(is|eq|neq|lt|lte|gt|gte)\.(.*)$/.exec(t);
    if (!m) throw new Error(`fixture: condición no soportada «${t}»`);
    return comparar(m[1], m[2], m[3]);
  });
}

function comparar(col: string, op: string, crudo: string): Predicado {
  return (f) => {
    const v = f[col];
    if (op === 'is') return crudo === 'null' ? v === null || v === undefined : String(v) === crudo;
    const a = v === null || v === undefined ? null : String(v);
    if (a === null) return false;
    if (op === 'eq') return a === crudo;
    if (op === 'neq') return a !== crudo;
    if (op === 'lt') return a < crudo;
    if (op === 'lte') return a <= crudo;
    if (op === 'gt') return a > crudo;
    return a >= crudo;
  };
}

/** Igualdad para UNIQUE: un jsonb (objeto) se compara por contenido, no por referencia. */
function igualUnico(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && JSON.stringify(a) === JSON.stringify(b);
}

function comparaOrden(a: unknown, b: unknown, ok: (d: number) => boolean): boolean {
  if (a === null || a === undefined) return false;
  const na = typeof a === 'number' ? a : Number.NaN;
  const nb = typeof b === 'number' ? b : Number.NaN;
  const numA = Number.isFinite(na) ? na : (typeof a === 'string' && /^-?\d+(\.\d+)?$/.test(a) ? Number(a) : Number.NaN);
  const numB = Number.isFinite(nb) ? nb : (typeof b === 'string' && /^-?\d+(\.\d+)?$/.test(b) ? Number(b) : Number.NaN);
  if (Number.isFinite(numA) && Number.isFinite(numB)) return ok(numA - numB);
  const sa = String(a); const sb = String(b);
  return ok(sa < sb ? -1 : sa > sb ? 1 : 0);
}

export interface BaseEnMemoria {
  /** Sustituye a `supabaseAdmin()`. */
  cliente: { from: (t: string) => unknown; rpc: (n: string, a?: unknown) => unknown };
  tabla: (t: string) => Fila[];
  /** La próxima operación `op` sobre `tabla` devuelve este error (una sola vez);
   *  con `saltar = n` deja pasar las primeras n y falla la siguiente. */
  fallarProxima: (tabla: string, op: 'select' | 'update' | 'insert' | 'delete', error: ErrorDb, saltar?: number) => void;
  /** Programa la respuesta de una RPC. */
  rpcRespuesta: (nombre: string, f: (args: unknown) => { data: unknown; error: ErrorDb | null }) => void;
  /** Todas las operaciones ejecutadas, en orden (para afirmar «no se llamó a…»). */
  bitacora: Array<{ tabla: string; op: string; payload?: Fila | Fila[] }>;
}

/** Una restricción UNIQUE que el doble hace cumplir al insertar, con el nombre del
 *  índice real (el código de producción reconoce el 23505 por ese nombre). */
export interface RestriccionUnica { tabla: string; nombre: string; columnas: string[] }

/** Los DEFAULT de las columnas que la base rellena sola al insertar (p. ej.
 *  `activo` = true): sin ellos una fila recién creada no se parece a una real. */
export type ValoresPorOmision = Record<string, Fila>;

let secuencia = 0;
/** Un uuid con forma válida (v4) y determinista: los ids reales lo son, y el código
 *  de producción rechaza lo que no lo parece. */
function uuidSecuencial(): string {
  secuencia += 1;
  return `00000000-0000-4000-8000-${String(secuencia).padStart(12, '0')}`;
}

export function crearBaseEnMemoria(
  inicial: Record<string, Fila[]> = {},
  restricciones: RestriccionUnica[] = [],
  porOmision: ValoresPorOmision = {},
): BaseEnMemoria {
  const tablas = new Map<string, Fila[]>(Object.entries(inicial).map(([k, v]) => [k, v.map((f) => ({ ...f }))]));
  const fallos: Array<{ tabla: string; op: string; error: ErrorDb; saltar: number }> = [];
  const rpcs = new Map<string, (a: unknown) => { data: unknown; error: ErrorDb | null }>();
  const bitacora: BaseEnMemoria['bitacora'] = [];
  const filasDe = (t: string): Fila[] => { if (!tablas.has(t)) tablas.set(t, []); return tablas.get(t)!; };

  class Consulta implements PromiseLike<{ data: unknown; error: ErrorDb | null; count?: number | null }> {
    private op: 'select' | 'update' | 'insert' | 'delete' = 'select';
    private filtros: Predicado[] = [];
    private payload: Fila | Fila[] | null = null;
    private opcionesInsert: { onConflict?: string; ignoreDuplicates?: boolean } | null = null;
    private retornar = false;
    private columnas = '*';
    private conteo = false;
    private soloConteo = false;
    private ordenes: Array<{ col: string; asc: boolean }> = [];
    private limite: number | null = null;
    private rango: [number, number] | null = null;
    private uno: 'maybe' | 'single' | null = null;
    constructor(private readonly t: string) {}

    select(cols = '*', opts?: { count?: string; head?: boolean }) {
      if (this.op === 'select') { this.columnas = cols; } else { this.retornar = true; this.columnas = cols; }
      if (opts?.count) this.conteo = true;
      if (opts?.head) this.soloConteo = true;
      return this;
    }
    insert(f: Fila | Fila[]) { this.op = 'insert'; this.payload = f; return this; }
    upsert(f: Fila | Fila[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.op = 'insert'; this.payload = f; this.opcionesInsert = o ?? {}; return this; }
    update(f: Fila) { this.op = 'update'; this.payload = f; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c: string, v: unknown) { this.filtros.push((f) => f[c] === v); return this; }
    neq(c: string, v: unknown) { this.filtros.push((f) => f[c] !== v); return this; }
    is(c: string, v: unknown) { this.filtros.push((f) => (v === null ? f[c] === null || f[c] === undefined : f[c] === v)); return this; }
    not(c: string, op: string, v: unknown) {
      if (op !== 'is') throw new Error(`fixture: not(${op}) no soportado`);
      this.filtros.push((f) => !(v === null ? f[c] === null || f[c] === undefined : f[c] === v));
      return this;
    }
    in(c: string, vs: unknown[]) { this.filtros.push((f) => vs.includes(f[c])); return this; }
    lt(c: string, v: unknown) { this.filtros.push((f) => f[c] !== null && f[c] !== undefined && String(f[c]) < String(v)); return this; }
    // gt/gte/lte (loop punta a punta, ola 3): comparan NUMÉRICAMENTE cuando los dos
    // lados son números (un monto «500» no es mayor que «3000» como texto) y como
    // texto en el resto (las fechas ISO ordenan igual).
    gt(c: string, v: unknown) { this.filtros.push((f) => comparaOrden(f[c], v, (d) => d > 0)); return this; }
    gte(c: string, v: unknown) { this.filtros.push((f) => comparaOrden(f[c], v, (d) => d >= 0)); return this; }
    lte(c: string, v: unknown) { this.filtros.push((f) => comparaOrden(f[c], v, (d) => d <= 0)); return this; }
    or(expr: string) { this.filtros.push(predicadoDeOr(expr)); return this; }
    order(c: string, o?: { ascending?: boolean }) { this.ordenes.push({ col: c, asc: o?.ascending !== false }); return this; }
    limit(n: number) { this.limite = n; return this; }
    range(d: number, h: number) { this.rango = [d, h]; return this; }
    maybeSingle() { this.uno = 'maybe'; return this; }
    single() { this.uno = 'single'; return this; }

    private ejecutar(): { data: unknown; error: ErrorDb | null; count?: number | null } {
      bitacora.push({ tabla: this.t, op: this.op, payload: this.payload ?? undefined });
      const i = fallos.findIndex((x) => x.tabla === this.t && x.op === this.op);
      if (i >= 0) {
        if (fallos[i].saltar > 0) fallos[i].saltar--;
        else { const [{ error }] = fallos.splice(i, 1); return { data: null, error }; }
      }
      const filas = filasDe(this.t);
      const cumple = (f: Fila) => this.filtros.every((p) => p(f));
      const proyectar = (f: Fila): Fila => {
        if (this.columnas === '*' || this.columnas === '') return { ...f };
        const sal: Fila = {};
        for (const c of this.columnas.split(',').map((x) => x.trim()).filter(Boolean)) sal[c] = f[c];
        return sal;
      };
      const entregar = (rs: Fila[], count?: number) => {
        if (this.uno) {
          if (rs.length > 1 && this.uno === 'single') return { data: null, error: { message: 'multiple rows' } as ErrorDb };
          return { data: rs[0] ?? null, error: this.uno === 'single' && rs.length === 0 ? ({ message: 'no rows' } as ErrorDb) : null };
        }
        return { data: rs, error: null, ...(count !== undefined ? { count } : {}) };
      };

      if (this.op === 'insert') {
        const lote = Array.isArray(this.payload) ? this.payload : [this.payload as Fila];
        // Un insert es ATÓMICO (como en Postgres): si una fila choca contra un
        // UNIQUE, ninguna del lote entra.
        if (!this.opcionesInsert?.ignoreDuplicates) {
          const vistas: Fila[] = [...filas];
          for (const f of lote) {
            for (const r of restricciones.filter((x) => x.tabla === this.t)) {
              if (vistas.some((x) => r.columnas.every((k) => igualUnico(x[k], f[k])))) {
                return { data: null, error: { message: `duplicate key value violates unique constraint "${r.nombre}"`, code: '23505' } };
              }
            }
            vistas.push(f);
          }
        }
        const nuevos: Fila[] = [];
        for (const f of lote) {
          if (this.opcionesInsert?.onConflict && this.opcionesInsert.ignoreDuplicates) {
            const llaves = this.opcionesInsert.onConflict.split(',');
            if (filas.some((x) => llaves.every((k) => x[k] === f[k]))) continue;
          }
          const fila = { id: f.id ?? uuidSecuencial(), ...(porOmision[this.t] ?? {}), ...f };
          filas.push(fila);
          nuevos.push(fila);
        }
        return this.retornar ? entregar(nuevos.map(proyectar)) : { data: null, error: null };
      }
      if (this.op === 'update') {
        const tocadas = filas.filter(cumple);
        for (const f of tocadas) Object.assign(f, this.payload);
        return this.retornar ? entregar(tocadas.map(proyectar)) : { data: null, error: null };
      }
      if (this.op === 'delete') {
        const borradas = filas.filter(cumple);
        for (const f of borradas) filas.splice(filas.indexOf(f), 1);
        return this.retornar ? entregar(borradas.map(proyectar)) : { data: null, error: null };
      }
      let rs = filas.filter(cumple);
      for (const o of [...this.ordenes].reverse()) {
        rs = [...rs].sort((a, b) => {
          const x = a[o.col]; const y = b[o.col];
          if (x === y) return 0;
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          return (String(x) < String(y) ? -1 : 1) * (o.asc ? 1 : -1);
        });
      }
      const total = rs.length;
      if (this.rango) rs = rs.slice(this.rango[0], this.rango[1] + 1);
      if (this.limite !== null) rs = rs.slice(0, this.limite);
      if (this.soloConteo) return { data: null, error: null, count: total };
      return entregar(rs.map(proyectar), this.conteo ? total : undefined);
    }

    then<R1 = unknown, R2 = never>(
      ok?: ((v: { data: unknown; error: ErrorDb | null; count?: number | null }) => R1 | PromiseLike<R1>) | null,
      ko?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
    ): Promise<R1 | R2> {
      return Promise.resolve().then(() => this.ejecutar()).then(ok ?? undefined, ko ?? undefined) as Promise<R1 | R2>;
    }
  }

  return {
    cliente: {
      from: (t: string) => new Consulta(t),
      rpc: (nombre: string, args?: unknown) => {
        const f = rpcs.get(nombre);
        bitacora.push({ tabla: `rpc:${nombre}`, op: 'rpc' });
        return Promise.resolve(f ? f(args) : { data: null, error: { message: `rpc ${nombre} sin programar` } });
      },
    },
    tabla: filasDe,
    fallarProxima: (tabla, op, error, saltar = 0) => { fallos.push({ tabla, op, error, saltar }); },
    rpcRespuesta: (nombre, f) => { rpcs.set(nombre, f); },
    bitacora,
  };
}
