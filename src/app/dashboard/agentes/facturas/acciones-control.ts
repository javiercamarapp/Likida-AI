'use server';

import { revalidatePath } from 'next/cache';
import { resolverTenantAtadoFirmado, CAMPO_FLOTA_PINTADA, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerArea, esDuenoDeFlota } from '@/lib/auth/visibilidad';
import {
  encenderEmisionReal, apagarEmisionReal, cambiarLimites, decidirLote, promoverPortal, devolverASupervisada,
  type ResultadoOp,
} from '@/lib/likida/autofactura/control_emision_repo';
import { getT } from '@/lib/i18n/servidor';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

// Server actions del control de la emisión real (0542). A NIVEL DE MÓDULO: cada una vuelve a resolver sesión, rol
// y flota desde la cookie y NUNCA acepta un tenant_id del cliente. La base vuelve a comprobar el rol (dueño /
// contador) y el mandato en la RPC: aquí solo se traduce.

const RUTA = '/dashboard/agentes/facturas';
export type RespuestaControl = { ok?: string; error?: string };

const sinPermiso = (tx: TAgentes = TR_ES.t) => ({ error: tx('rest.tu_rol_no_puede_decidir_sobre') });
const soloDueno = (tx: TAgentes = TR_ES.t) => ({ error: tx('rest.solo_el_dueno_de_la_flota') });

/** MX-002: la flota sale de la que la pantalla pintó (campo firmado), no de la cookie compartida entre pestañas. */
type Sesion = NonNullable<Awaited<ReturnType<typeof resolverTenantAtadoFirmado>>>;
type Puerta = { s: Sesion } | { error: string };
async function sesion(fd: FormData): Promise<Puerta> {
  const s = await resolverTenantAtadoFirmado(RUTA, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
  const { t: tx } = await getT('agentes');
  return puedeVerArea(s.rol, 'dinero') ? { s } : { error: sinPermiso(tx).error };
}
/** A37-S13-09: encender la emisión, cambiar límites y promover un portal son del DUEÑO (la base lo exige: `flota_admin`). Apagar, decidir un lote y devolver a supervisada admiten también al contador. */
async function sesionDueno(fd: FormData): Promise<Puerta> {
  const r = await sesion(fd);
  const { t: tx } = await getT('agentes');
  if ('error' in r) return r.error === sinPermiso(tx).error ? { error: soloDueno(tx).error } : r;
  return esDuenoDeFlota(r.s.rol) ? r : { error: soloDueno(tx).error };
}
const clave = (fd: FormData, campo: string) => String(fd.get(campo) ?? '').trim().slice(0, 64);
const numero = (fd: FormData, campo: string) => Number(String(fd.get(campo) ?? '').replace(/[,\s$]/g, ''));
const responder = (r: ResultadoOp): RespuestaControl => { revalidatePath(RUTA); return r.ok ? { ok: r.mensaje } : { error: r.motivo }; };

export async function accionEncenderEmision(_p: RespuestaControl | null, fd: FormData): Promise<RespuestaControl> {
  const r = await sesionDueno(fd); if ('error' in r) return { error: r.error };
  const { s } = r;
  return responder(await encenderEmisionReal(s.tenantId, s.userId));
}
export async function accionApagarEmision(_p: RespuestaControl | null, fd: FormData): Promise<RespuestaControl> {
  const r = await sesion(fd); if ('error' in r) return { error: r.error };
  const { s } = r;
  return responder(await apagarEmisionReal(s.tenantId, s.userId));
}
export async function accionCambiarLimites(_p: RespuestaControl | null, fd: FormData): Promise<RespuestaControl> {
  const r = await sesionDueno(fd); if ('error' in r) return { error: r.error };
  const { s } = r;
  return responder(await cambiarLimites(s.tenantId, s.userId, {
    maxMontoTicket: numero(fd, 'maxMontoTicket'), maxTicketsLote: numero(fd, 'maxTicketsLote'),
    maxTicketsDia: numero(fd, 'maxTicketsDia'), maxMontoDia: numero(fd, 'maxMontoDia'),
  }));
}
export async function accionDecidirLote(_p: RespuestaControl | null, fd: FormData): Promise<RespuestaControl> {
  const { t: tx } = await getT('agentes');
  const r = await sesion(fd); if ('error' in r) return { error: r.error };
  const { s } = r;
  const id = clave(fd, 'loteId');
  if (!id) return { error: tx('rest.falta_el_lote') };
  // A37-S29-06: la huella de lo que la persona vio (tickets y monto del lote en pantalla); sin ella confirmar se rechaza.
  const tickets = Number(clave(fd, 'vistoTickets'));
  const monto = Number(clave(fd, 'vistoMonto'));
  const visto = clave(fd, 'vistoTickets') && clave(fd, 'vistoMonto') && Number.isFinite(tickets) && Number.isFinite(monto) ? { tickets, monto } : null;
  return responder(await decidirLote(s.tenantId, s.userId, id, clave(fd, 'decision') === 'confirmar', clave(fd, 'motivo') || undefined, visto));
}
export async function accionPromoverPortal(_p: RespuestaControl | null, fd: FormData): Promise<RespuestaControl> {
  const { t: tx } = await getT('agentes');
  const r = await sesionDueno(fd); if ('error' in r) return { error: r.error };
  const { s } = r;
  const c = clave(fd, 'comercio'); if (!c) return { error: tx('rest.falta_el_portal') };
  return responder(await promoverPortal(s.tenantId, s.userId, c));
}
export async function accionDevolverPortal(_p: RespuestaControl | null, fd: FormData): Promise<RespuestaControl> {
  const { t: tx } = await getT('agentes');
  const r = await sesion(fd); if ('error' in r) return { error: r.error };
  const { s } = r;
  const c = clave(fd, 'comercio'); if (!c) return { error: tx('rest.falta_el_portal') };
  return responder(await devolverASupervisada(s.tenantId, s.userId, c));
}
