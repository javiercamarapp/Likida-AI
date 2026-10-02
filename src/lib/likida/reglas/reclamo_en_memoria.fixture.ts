// ═══════════════════════════════════════════════════════════════════════════
// LAS TRES RPC DEL RECLAMO (0660) EN MEMORIA, para los e2e que corren el vigilante entero contra un doble de la base.
//
// Replica la semántica que `supabase/tests/0660_reglas_reclamo.sql` demuestra contra Postgres real: insertar la llave es
// reclamarla (`enviando` + token + arriendo), un arriendo vencido se retoma, confirmar/liberar solo obedecen al token vigente.
// Opera sobre las MISMAS filas de `regla_disparo` que ve el resto del e2e, así lo que el vigilante sella se ve en la tabla.
// ═══════════════════════════════════════════════════════════════════════════
type Fila = Record<string, unknown>;

const llave = (f: Fila) => `${f.tenant_id}|${f.regla_id}|${f.objeto}|${f.objeto_id}|${f.clave ?? ''}`;

export function reclamoEnMemoria(filas: () => Fila[]) {
  let seq = 0;
  return {
    /** `reclamar_disparos_regla` → filas `{o_token, o_objeto, o_objeto_id, o_clave}` de las llaves que ESTA llamada ganó. */
    reclamar(args: unknown): Fila[] {
      const a = args as { p_tenant: string; p_regla: string; p_items: Array<Record<string, string>>; p_lease_segundos?: number; p_ahora?: string };
      const ahora = a.p_ahora ? new Date(a.p_ahora).getTime() : Date.now();
      const token = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      const expira = new Date(ahora + (a.p_lease_segundos ?? 300) * 1000).toISOString();
      const tabla = filas();
      const ganadas: Fila[] = [];
      const vistas = new Set<string>();
      for (const i of a.p_items) {
        const nueva: Fila = {
          tenant_id: a.p_tenant, regla_id: a.p_regla, objeto: i.objeto, objeto_id: i.objeto_id, clave: i.clave ?? '',
          evidencia: String(i.evidencia ?? '').slice(0, 1_000),
        };
        if (vistas.has(llave(nueva))) continue;
        vistas.add(llave(nueva));
        const previa = tabla.find((t) => llave(t) === llave(nueva));
        if (previa) {
          const vencida = previa.estado === 'enviando' && new Date(String(previa.reclamo_expira_en)).getTime() <= ahora;
          if (!vencida) continue;
          Object.assign(previa, { estado: 'enviando', reclamo_token: token, reclamo_expira_en: expira, evidencia: nueva.evidencia });
        } else {
          tabla.push({ ...nueva, estado: 'enviando', reclamo_token: token, reclamo_expira_en: expira, disparado_en: new Date(ahora).toISOString() });
        }
        ganadas.push({ o_token: token, o_objeto: i.objeto, o_objeto_id: i.objeto_id, o_clave: i.clave ?? '' });
      }
      return ganadas;
    },
    /** `confirmar_disparos_regla` → cuántas llaves pasaron a `enviado`. */
    confirmar(args: unknown): number {
      const a = args as { p_tenant: string; p_regla: string; p_token: string; p_ahora?: string };
      let n = 0;
      for (const t of filas()) {
        if (t.tenant_id === a.p_tenant && t.regla_id === a.p_regla && t.estado === 'enviando' && t.reclamo_token === a.p_token) {
          Object.assign(t, { estado: 'enviado', reclamo_token: null, reclamo_expira_en: null, disparado_en: a.p_ahora ?? t.disparado_en });
          n++;
        }
      }
      return n;
    },
    /** `liberar_disparos_regla` → cuántas llaves se borraron. */
    liberar(args: unknown): number {
      const a = args as { p_tenant: string; p_regla: string; p_token: string };
      const tabla = filas();
      let n = 0;
      for (let i = tabla.length - 1; i >= 0; i--) {
        const t = tabla[i];
        if (t.tenant_id === a.p_tenant && t.regla_id === a.p_regla && t.estado === 'enviando' && t.reclamo_token === a.p_token) { tabla.splice(i, 1); n++; }
      }
      return n;
    },
  };
}
