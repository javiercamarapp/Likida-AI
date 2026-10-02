import type { RepoVinculacion, SalidasVinculacion, SolicitudVinculacion, DepsVinculacion, EstadoSolicitud } from './vinculacion_remota';

// Dobles en memoria de los puertos de la vinculación (para la prueba E2E y las unitarias).
// Replican las reglas de las RPC de la 0540: una viva por (flota, portal), el código sirve una
// vez, vencida no se reclama, cerrar solo desde reclamada.

export function crearMemoriaVinculacion(reloj: { ahora: Date }) {
  const filas: Array<SolicitudVinculacion & { hash: string }> = [];
  let n = 0;

  const repo: RepoVinculacion = {
    async crear(a) {
      for (const f of filas) {
        if (f.tenantId === a.tenantId && f.comercio === a.comercio && (f.estado === 'pendiente' || f.estado === 'reclamada') && Date.parse(f.expiraEn) <= reloj.ahora.getTime()) {
          f.estado = 'expirada'; f.cerradaEn = reloj.ahora.toISOString();
        }
      }
      if (filas.some((f) => f.tenantId === a.tenantId && f.comercio === a.comercio && (f.estado === 'pendiente' || f.estado === 'reclamada'))) {
        return { ok: false, motivo: 'ya hay una vinculación en curso para este portal: termínala o cancélala antes de pedir otra' };
      }
      const id = `sol-${++n}`;
      filas.push({
        id, hash: a.hash, tenantId: a.tenantId, comercio: a.comercio, estado: 'pendiente',
        creadaEn: reloj.ahora.toISOString(), expiraEn: new Date(reloj.ahora.getTime() + a.ttlMin * 60_000).toISOString(),
        reclamadaEn: null, cerradaEn: null, cookies: null, motivo: null,
      });
      return { ok: true, id };
    },
    async reclamar(hash) {
      const f = filas.find((x) => x.hash === hash);
      if (!f) return { ok: false, motivo: 'código desconocido' };
      if ((f.estado === 'pendiente' || f.estado === 'reclamada') && Date.parse(f.expiraEn) <= reloj.ahora.getTime()) {
        f.estado = 'expirada'; f.cerradaEn = reloj.ahora.toISOString();
        return { ok: false, motivo: 'el código venció: pide otro en el panel' };
      }
      if (f.estado !== 'pendiente') return { ok: false, motivo: 'el código ya se usó o se canceló' };
      f.estado = 'reclamada'; f.reclamadaEn = reloj.ahora.toISOString();
      return { ok: true, id: f.id, tenantId: f.tenantId, comercio: f.comercio, expiraEn: f.expiraEn };
    },
    async reclamadaPorHash(hash) {
      const f = filas.find((x) => x.hash === hash && x.estado === 'reclamada');
      return f ? { id: f.id, tenantId: f.tenantId, comercio: f.comercio, expiraEn: f.expiraEn } : null;
    },
    async cerrar(a) {
      const f = filas.find((x) => x.id === a.id && x.tenantId === a.tenantId);
      if (!f) return { ok: false, motivo: 'solicitud inexistente en esta flota' };
      if (f.estado !== 'reclamada') return { ok: false, motivo: 'la solicitud no está en curso' };
      if (a.estado === 'completada' && Date.parse(f.expiraEn) <= reloj.ahora.getTime()) {
        f.estado = 'expirada'; f.cerradaEn = reloj.ahora.toISOString();
        return { ok: false, motivo: 'la solicitud venció antes de completarse' };
      }
      f.estado = a.estado as EstadoSolicitud; f.cerradaEn = reloj.ahora.toISOString(); f.cookies = a.cookies ?? null; f.motivo = a.motivo ?? null;
      return { ok: true };
    },
    async cancelar(tenantId, comercio) {
      let c = 0;
      for (const f of filas) if (f.tenantId === tenantId && f.comercio === comercio && (f.estado === 'pendiente' || f.estado === 'reclamada')) { f.estado = 'cancelada'; c++; }
      return c;
    },
    async listar(tenantId) {
      return filas.filter((f) => f.tenantId === tenantId).map(({ hash: _h, ...s }) => s).reverse();
    },
  };

  const guardadas = new Map<string, { storageState: string; capturadaEn: string }>();
  const vinculados = new Map<string, string>();
  const bitacora: Array<{ tenantId: string; accion: string; comercio: string; detalle: Record<string, unknown> }> = [];
  const salidas: SalidasVinculacion & { fallaCofre: boolean } = {
    fallaCofre: false,
    async guardarSesion(tenantId, comercio, storageState, capturadaEn) {
      if (salidas.fallaCofre) throw new Error('El cofre no está configurado (falta LIKIDA_COFRE_LLAVE).');
      guardadas.set(`${tenantId}|${comercio}`, { storageState, capturadaEn });
    },
    async anotarVinculado(tenantId, comercio, ahora) { vinculados.set(`${tenantId}|${comercio}`, ahora); },
    async bitacora(tenantId, _actor, accion, comercio, detalle) { bitacora.push({ tenantId, accion, comercio, detalle }); },
  };

  const deps: DepsVinculacion = { repo, salidas, ahora: () => reloj.ahora };
  return { repo, salidas, deps, guardadas, vinculados, bitacora, filas };
}
