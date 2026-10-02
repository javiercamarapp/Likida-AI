// ═══════════════════════════════════════════════════════════════════════════
// UNA BASE EN MEMORIA PARA PROBAR LOS CONVENIOS DE PUNTA A PUNTA.
//
// No es un mock ciego: implementa lo que `repo.ts` usa de PostgREST (select/insert/upsert/update/delete, eq/in/is/or,
// order/range, single/maybeSingle) y las dos garantías que importan de las restricciones de la 0580: la llave única
// (flota, cliente, nombre) / (convenio, categoría, texto) y la PK de `viaje_convenio`. Lo que solo Postgres garantiza
// (FK compuestas, RLS) lo prueba `supabase/tests/0580_convenios.sql` en ci-postgres.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;

const UNICAS: Record<string, string[][]> = {
  cliente_convenio: [['tenant_id', 'cliente_id', 'nombre']],
  convenio_instruccion: [['convenio_id', 'categoria', 'texto']],
  convenio_comercial: [['convenio_id']],
  viaje_convenio: [['viaje_id']],
};
const PK_NOMBRE: Record<string, string> = { viaje_convenio: 'viaje_convenio_pkey', cliente_convenio: 'cliente_convenio_unico', convenio_instruccion: 'convenio_instruccion_unica' };

export class Mundo {
  tablas: Record<string, Fila[]> = {
    cliente: [], geocerca: [], posicion: [], cliente_convenio: [], convenio_instruccion: [], convenio_comercial: [], viaje_convenio: [], viaje: [], viaje_hito: [], operador: [],
  };
  /** Las tablas que «no existen» (base sin migrar). */
  ausentes = new Set<string>();
  /** Cada consulta que llegó, para afirmar que todas anclan el tenant. */
  consultas: Array<{ tabla: string; op: string; filtros: Array<[string, unknown]> }> = [];
  private n = 0;
  id(prefijo = 'id'): string { return `${prefijo}-${++this.n}`; }

  poner(tabla: string, fila: Fila): Fila {
    const f = { id: this.id(tabla), ...fila };
    (this.tablas[tabla] ??= []).push(f);
    return f;
  }

  from(tabla: string): Builder { return new Builder(this, tabla); }
  admin() { return { from: (t: string) => this.from(t) }; }
}

class Builder implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Fila | Fila[] | null = null;
  private conflicto: string[] | null = null;
  private filtros: Array<(f: Fila) => boolean> = [];
  private pistas: Array<[string, unknown]> = [];
  private orden: Array<string> = [];
  private rango: [number, number] | null = null;
  private pedirFilas = false;
  private uno: 'single' | 'maybe' | null = null;
  private tope: number | null = null;

  constructor(private m: Mundo, private tabla: string) {}

  select(_cols?: string, _op?: unknown) { if (this.op === 'select') this.pedirFilas = true; else this.pedirFilas = true; return this; }
  insert(p: Fila | Fila[]) { this.op = 'insert'; this.payload = p; return this; }
  upsert(p: Fila | Fila[], o?: { onConflict?: string }) { this.op = 'upsert'; this.payload = p; this.conflicto = o?.onConflict ? o.onConflict.split(',') : null; return this; }
  update(p: Fila) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: unknown) { this.pistas.push([c, v]); this.filtros.push((f) => f[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.pistas.push([c, vs]); this.filtros.push((f) => vs.includes(f[c])); return this; }
  is(c: string, v: null) { this.pistas.push([c, v]); this.filtros.push((f) => (f[c] ?? null) === v); return this; }
  gte(c: string, v: unknown) { this.pistas.push([c, v]); this.filtros.push((f) => String(f[c] ?? '') >= String(v)); return this; }
  lte(c: string, v: unknown) { this.pistas.push([c, v]); this.filtros.push((f) => String(f[c] ?? '') <= String(v)); return this; }
  not(c: string, op: string, v: unknown) { this.pistas.push([c, v]); this.filtros.push((f) => (op === 'is' && v === null ? (f[c] ?? null) !== null : false)); return this; }
  or(expr: string) {
    const partes = expr.split(',').map((p) => {
      const [col, op, ...resto] = p.split('.');
      const val = resto.join('.');
      return (f: Fila): boolean => (op === 'is' ? (f[col] ?? null) === null : op === 'lt' ? (f[col] ?? null) !== null && String(f[col]) < val : false);
    });
    this.filtros.push((f) => partes.some((p) => p(f)));
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) { this.orden.push(o?.ascending === false ? `-${c}` : c); return this; }
  range(d: number, h: number) { this.rango = [d, h]; return this; }
  limit(n: number) { this.tope = n; return this; }
  maybeSingle() { this.uno = 'maybe'; return this; }
  single() { this.uno = 'single'; return this; }
  abortSignal() { return this; }

  private ejecutar(): { data: unknown; error: unknown } {
    const { tabla, m } = this;
    m.consultas.push({ tabla, op: this.op, filtros: this.pistas });
    if (m.ausentes.has(tabla)) return { data: null, error: { code: '42P01', message: `relation "public.${tabla}" does not exist` } };
    const filas = m.tablas[tabla] ?? (m.tablas[tabla] = []);
    const coincide = (f: Fila) => this.filtros.every((p) => p(f));
    let salida: Fila[] = [];

    if (this.op === 'select') salida = filas.filter(coincide);
    else if (this.op === 'insert' || this.op === 'upsert') {
      for (const nueva of Array.isArray(this.payload) ? this.payload : [this.payload as Fila]) {
        const claves = this.conflicto ? [this.conflicto] : (UNICAS[tabla] ?? []);
        const dup = filas.find((f) => claves.some((k) => k.every((c) => f[c] === nueva[c])));
        if (dup && this.op === 'insert') {
          return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${PK_NOMBRE[tabla] ?? tabla}"` } };
        }
        if (dup) { Object.assign(dup, nueva); salida.push(dup); }
        else { const f: Fila = { id: m.id(tabla), ...(tabla === 'viaje_convenio' ? { ligado_en: new Date().toISOString() } : {}), ...nueva }; filas.push(f); salida.push(f); }
      }
    } else if (this.op === 'update') {
      for (const f of filas.filter(coincide)) { Object.assign(f, this.payload as Fila); salida.push(f); }
    } else {
      const quitar = filas.filter(coincide);
      m.tablas[tabla] = filas.filter((f) => !quitar.includes(f));
      salida = quitar;
    }

    for (const c0 of [...this.orden].reverse()) {
      const desc = c0.startsWith('-');
      const c = desc ? c0.slice(1) : c0;
      salida = salida.slice().sort((a, b) => (desc ? -1 : 1) * String(a[c] ?? '').localeCompare(String(b[c] ?? ''), undefined, { numeric: true }));
    }
    if (this.rango) salida = salida.slice(this.rango[0], this.rango[1] + 1);
    if (this.tope !== null) salida = salida.slice(0, this.tope);
    if (tabla === 'viaje') {
      salida = salida.map((f) => ({ ...f, operador: m.tablas.operador.find((o) => o.id === f.operador_id) ?? null }));
    }
    if (this.uno) return { data: salida[0] ?? null, error: null };
    return { data: this.pedirFilas || this.op === 'select' ? salida.map((f) => ({ ...f })) : null, error: null };
  }

  then<A, B>(ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.ejecutar()).then(ok, no);
  }
}
