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
  /** Columnas que «no existen» por tabla (base sin migrar): pedirlas en un select da 42703. */
  columnasAusentes = new Map<string, Set<string>>();
  /** Cada consulta que llegó, para afirmar que todas anclan el tenant. */
  consultas: Array<{ tabla: string; op: string; filtros: Array<[string, unknown]> }> = [];
  private n = 0;
  /** Un uuid determinista (la forma que validan las acciones del panel), no un texto libre. El prefijo ya no entra al id. */
  id(_prefijo = 'id'): string { return `00000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`; }

  poner(tabla: string, fila: Fila): Fila {
    const f = { id: this.id(tabla), ...fila };
    (this.tablas[tabla] ??= []).push(f);
    return f;
  }

  /** Las funciones RPC que «no existen» (base sin la 0656/0657). */
  rpcAusentes = new Set<string>();
  /** Cada RPC que llegó, para afirmar que todas anclan el tenant. */
  rpcLlamadas: Array<{ nombre: string; args: Record<string, unknown> }> = [];

  from(tabla: string): Builder { return new Builder(this, tabla); }
  admin() { return { from: (t: string) => this.from(t), rpc: (n: string, a: Record<string, unknown>) => this.rpc(n, a) }; }

  /**
   * Las dos funciones de edición (0656/0657) ESPEJADAS en memoria: misma entrada, mismos estados de salida. Es una copia a
   * propósito (la prueba de que la base hace esto es supabase/tests/0656_convenio_guardar.sql contra Postgres real); sirve para
   * que el panel, las acciones y el ciclo del cron se ejerciten juntos sin una base.
   */
  rpc(nombre: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> {
    this.rpcLlamadas.push({ nombre, args: a });
    if (this.rpcAusentes.has(nombre)) {
      return Promise.resolve({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nombre} in the schema cache` } });
    }
    return Promise.resolve({ data: nombre === 'guardar_convenio' ? this.guardarConvenio(a) : nombre === 'refrescar_viajes_de_convenio' ? this.refrescarViajes(a) : null, error: null });
  }

  private guardarConvenio(a: Record<string, unknown>): Fila {
    const t = a.p_tenant;
    const instrucciones = a.p_instrucciones as Array<Record<string, unknown>> | null;
    const convenios = this.tablas.cliente_convenio;
    // Validaciones de la base (CHECK y FK) ANTES de escribir: todo o nada, como la transacción.
    const desde = a.p_desde as string | null; const hasta = a.p_hasta as string | null;
    if (desde && hasta && hasta < desde) return { estado: 'invalida' };
    const dominio = { categoria: ['puerta', 'reportarse', 'peculiaridad', 'documentos', 'horario', 'seguridad', 'otro'], momento: ['despacho', 'acercamiento', 'ambos'], lugar: ['origen', 'destino', 'ambos'] };
    for (const i of instrucciones ?? []) {
      const texto = String(i.texto ?? '');
      if (!dominio.categoria.includes(String(i.categoria)) || !dominio.momento.includes(String(i.momento ?? 'ambos')) || !dominio.lugar.includes(String(i.lugar ?? 'ambos'))
        || texto.length < 1 || texto.length > 400 || Number(i.orden ?? 0) < 0 || Number(i.orden ?? 0) > 999) return { estado: 'invalida' };
    }
    for (const sitio of [a.p_origen_sitio, a.p_destino_sitio]) {
      if (sitio && !this.tablas.geocerca.some((g) => g.id === sitio && g.tenant_id === t)) return { estado: 'referencia_invalida' };
    }
    let convenio: Fila | undefined; let creado = false;
    if (a.p_convenio === null || a.p_convenio === undefined) {
      if (!a.p_cliente || !this.tablas.cliente.some((c) => c.id === a.p_cliente && c.tenant_id === t)) return { estado: 'referencia_invalida' };
      if (convenios.some((c) => c.tenant_id === t && c.cliente_id === a.p_cliente && c.nombre === a.p_nombre)) return { estado: 'duplicado' };
      convenio = this.poner('cliente_convenio', { tenant_id: t, cliente_id: a.p_cliente, activo: true, version: 1 });
      creado = true;
    } else {
      convenio = convenios.find((c) => c.id === a.p_convenio && c.tenant_id === t);
      if (!convenio) return { estado: 'no_existe' };
      if (a.p_version !== convenio.version) return { estado: 'conflicto', version: convenio.version };
      if (convenios.some((c) => c !== convenio && c.tenant_id === t && c.cliente_id === convenio!.cliente_id && c.nombre === a.p_nombre)) return { estado: 'duplicado' };
    }
    Object.assign(convenio, {
      nombre: a.p_nombre, origen: a.p_origen, destino: a.p_destino, origen_sitio_id: a.p_origen_sitio, destino_sitio_id: a.p_destino_sitio,
      vigente_desde: desde, vigente_hasta: hasta, notas: a.p_notas, actualizado_en: new Date().toISOString(),
      version: creado ? 1 : Number(convenio.version) + 1,
    });
    if (instrucciones !== null && instrucciones !== undefined) {
      const conservar: Fila[] = [];
      for (const i of instrucciones) {
        const previa = this.tablas.convenio_instruccion.find((x) => x.convenio_id === convenio!.id && x.categoria === i.categoria && x.texto === i.texto);
        const datos = { momento: i.momento ?? 'ambos', lugar: i.lugar ?? 'ambos', orden: Number(i.orden ?? 0), activa: true };
        if (previa) { Object.assign(previa, datos); conservar.push(previa); }
        else conservar.push(this.poner('convenio_instruccion', { tenant_id: t, convenio_id: convenio.id, categoria: i.categoria, texto: i.texto, ...datos }));
      }
      this.tablas.convenio_instruccion = this.tablas.convenio_instruccion.filter((x) => x.convenio_id !== convenio!.id || conservar.includes(x));
    }
    return { estado: 'ok', id: convenio.id, version: convenio.version, creado };
  }

  private refrescarViajes(a: Record<string, unknown>): Fila[] {
    const t = a.p_tenant;
    if (!this.tablas.cliente_convenio.some((c) => c.id === a.p_convenio && c.tenant_id === t)) return [];
    const foto = this.tablas.convenio_instruccion
      .filter((i) => i.convenio_id === a.p_convenio && i.tenant_id === t && i.activa !== false)
      .sort((x, y) => Number(x.orden) - Number(y.orden))
      .map((i) => ({ categoria: i.categoria, texto: i.texto, momento: i.momento, lugar: i.lugar, orden: i.orden }));
    const salida: Fila[] = [];
    for (const vc of this.tablas.viaje_convenio) {
      if (vc.tenant_id !== t || vc.convenio_id !== a.p_convenio) continue;
      const viaje = this.tablas.viaje.find((v) => v.id === vc.viaje_id && v.tenant_id === t);
      if (!viaje || viaje.estatus === 'liquidado' || JSON.stringify(vc.instrucciones) === JSON.stringify(foto)) continue;
      const habia = !!vc.despacho_enviado_en;
      vc.instrucciones = foto;
      if (a.p_reenviar === true && habia) { vc.despacho_reclamado_en = null; vc.despacho_enviado_en = null; vc.despacho_canal = null; }
      salida.push({ viaje_id: vc.viaje_id, reenviar: a.p_reenviar === true && habia });
    }
    return salida;
  }
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
  private columnas: string | null = null;

  constructor(private m: Mundo, private tabla: string) {}

  select(cols?: string, _op?: unknown) { this.columnas = cols ?? null; if (this.op === 'select') this.pedirFilas = true; else this.pedirFilas = true; return this; }
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
    const ausentes = m.columnasAusentes.get(tabla);
    if (this.op === 'select' && ausentes && this.columnas) {
      const pedida = [...ausentes].find((c) => this.columnas!.split(',').map((x) => x.trim()).includes(c));
      if (pedida) return { data: null, error: { code: '42703', message: `column ${tabla}.${pedida} does not exist` } };
    }
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
        if (dup) { Object.assign(dup, nueva); if (tabla === 'cliente_convenio') dup.version = Number(dup.version ?? 1) + 1; salida.push(dup); }
        else { const f: Fila = { id: m.id(tabla), ...(tabla === 'viaje_convenio' ? { ligado_en: new Date().toISOString() } : {}), ...(tabla === 'cliente_convenio' ? { version: 1 } : {}), ...nueva }; filas.push(f); salida.push(f); }
      }
    } else if (this.op === 'update') {
      for (const f of filas.filter(coincide)) { Object.assign(f, this.payload as Fila); if (tabla === 'cliente_convenio') f.version = Number(f.version ?? 1) + 1; salida.push(f); }
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
