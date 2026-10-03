import type { ControlEmision, DepsControl, FasePortal, RepoControl } from './control_emision';

// Doble en memoria de los puertos del control de emisión. Replica las reglas de las RPC de la 0542
// (lote vivo único por portal, consumo único, cupo atómico, fase supervisada por omisión).

export interface LoteMem { id: string; tenantId: string; comercio: string; gastoIds: string[]; monto: number; estado: 'propuesto' | 'confirmado' | 'rechazado' | 'ejecutado' | 'expirado' }

export function crearMemoriaControl(opciones: { verificados?: string[]; obsoletos?: string[]; hoy?: string } = {}) {
  const controles = new Map<string, ControlEmision>();
  const fases = new Map<string, { fase: FasePortal; emisionesConfirmadas: number }>();
  const lotes: LoteMem[] = [];
  const cupos = new Map<string, { tickets: number; monto: number }>();
  const bitacora: Array<{ tenantId: string; accion: string; entidadId: string; detalle: Record<string, unknown> }> = [];
  const falla = { control: false, fase: false, cupo: false, consumir: false };
  let n = 0;
  const hoy = opciones.hoy ?? '2026-10-02';

  const repo: RepoControl = {
    async control(t) { if (falla.control) return null; return controles.get(t) ?? 'sin_fila'; },
    async fase(t, c) { if (falla.fase) return null; return fases.get(`${t}|${c}`) ?? 'sin_fila'; },
    async cupoDelDia(t, d) { if (falla.cupo) return null; return { ...(cupos.get(`${t}|${d}`) ?? { tickets: 0, monto: 0 }) }; },
    async reservarCupo(t, d, tk, m, maxT, maxM) {
      const k = `${t}|${d}`; const c = cupos.get(k) ?? { tickets: 0, monto: 0 };
      if (tk < 1 || c.tickets + tk > maxT || c.monto + m > maxM) return false;
      cupos.set(k, { tickets: c.tickets + tk, monto: c.monto + m }); return true;
    },
    async liberarCupo(t, d, tk, m) { const k = `${t}|${d}`; const c = cupos.get(k); if (c) cupos.set(k, { tickets: Math.max(c.tickets - tk, 0), monto: Math.max(c.monto - m, 0) }); },
    async consumirLoteConfirmado(t, c, ids) {
      if (falla.consumir) return null;
      const l = lotes.find((x) => x.tenantId === t && x.comercio === c && x.estado === 'confirmado');
      if (!l) return [];
      const v = l.gastoIds.filter((g) => ids.includes(g));
      if (v.length === 0) return v;
      l.estado = 'ejecutado'; return v;
    },
    async proponerLote(t, c, ids, monto) {
      const vivo = lotes.find((x) => x.tenantId === t && x.comercio === c && (x.estado === 'propuesto' || x.estado === 'confirmado'));
      if (vivo?.estado === 'confirmado') return { ok: true, estado: 'confirmado' };
      if (vivo) { vivo.gastoIds = [...new Set([...vivo.gastoIds, ...ids])]; vivo.monto += monto; return { ok: true, estado: 'propuesto' }; }
      lotes.push({ id: `lote-${++n}`, tenantId: t, comercio: c, gastoIds: [...ids], monto, estado: 'propuesto' });
      return { ok: true, estado: 'propuesto' };
    },
    async registrarEmision(t, c, k) {
      const f = fases.get(`${t}|${c}`) ?? { fase: 'supervisada' as FasePortal, emisionesConfirmadas: 0 };
      fases.set(`${t}|${c}`, { ...f, emisionesConfirmadas: f.emisionesConfirmadas + k });
    },
  };

  const deps: DepsControl = {
    repo,
    salidas: { async bitacora(tenantId, accion, entidadId, detalle) { bitacora.push({ tenantId, accion, entidadId, detalle }); } },
    verificacionDe: (c) => (c === 'capufe' ? 'exento' : opciones.verificados?.includes(c) ? 'verificado' : opciones.obsoletos?.includes(c) ? 'obsoleto' : 'no_verificado'),
    hoyMx: () => hoy,
  };

  const CONTROL_BASE: ControlEmision = { emisionReal: true, maxMontoTicket: 1500, maxTicketsLote: 3, maxTicketsDia: 10, maxMontoDia: 10_000 };
  return {
    deps, repo, controles, fases, lotes, cupos, bitacora, falla, hoy,
    encender(tenantId: string, extra: Partial<ControlEmision> = {}) { controles.set(tenantId, { ...CONTROL_BASE, ...extra }); },
    confirmarLote(tenantId: string, comercio: string) { const l = lotes.find((x) => x.tenantId === tenantId && x.comercio === comercio && x.estado === 'propuesto'); if (!l) throw new Error('no hay lote propuesto'); l.estado = 'confirmado'; return l; },
    ponerFase(tenantId: string, comercio: string, fase: FasePortal, emisiones = 3) { fases.set(`${tenantId}|${comercio}`, { fase, emisionesConfirmadas: emisiones }); },
  };
}
