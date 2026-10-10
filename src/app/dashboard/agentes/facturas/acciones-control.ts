'use server';

import { revalidatePath } from 'next/cache';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import {
  encenderEmisionReal, apagarEmisionReal, cambiarLimites, decidirLote, promoverPortal, devolverASupervisada,
  type ResultadoOp,
} from '@/lib/likida/autofactura/control_emision_repo';

// Server actions del control de la emisión real (0542). A NIVEL DE MÓDULO: cada una vuelve a resolver sesión, rol
// y flota desde la cookie y NUNCA acepta un tenant_id del cliente. La base vuelve a comprobar el rol (dueño /
// contador) y el mandato en la RPC: aquí solo se traduce.

const RUTA = '/dashboard/agentes/facturas';
export type RespuestaControl = { ok?: string; error?: string };

async function sesion() {
  const s = await requireSessionTenant(RUTA);
  return puedeVerArea(s.rol, 'dinero') ? s : null;
}
const clave = (fd: FormData, campo: string) => String(fd.get(campo) ?? '').trim().slice(0, 64);
const numero = (fd: FormData, campo: string) => Number(String(fd.get(campo) ?? '').replace(/[,\s$]/g, ''));
const responder = (r: ResultadoOp): RespuestaControl => { revalidatePath(RUTA); return r.ok ? { ok: r.mensaje } : { error: r.motivo }; };
const SIN_PERMISO: RespuestaControl = { error: 'Tu rol no puede decidir sobre la emisión de facturas de la flota.' };

export async function accionEncenderEmision(_p: RespuestaControl | null, _fd: FormData): Promise<RespuestaControl> {
  const s = await sesion(); if (!s) return SIN_PERMISO;
  return responder(await encenderEmisionReal(s.tenantId, s.userId));
}
export async function accionApagarEmision(_p: RespuestaControl | null, _fd: FormData): Promise<RespuestaControl> {
  const s = await sesion(); if (!s) return SIN_PERMISO;
  return responder(await apagarEmisionReal(s.tenantId, s.userId));
}
export async function accionCambiarLimites(_p: RespuestaControl | null, fd: FormData): Promise<RespuestaControl> {
  const s = await sesion(); if (!s) return SIN_PERMISO;
  return responder(await cambiarLimites(s.tenantId, s.userId, {
    maxMontoTicket: numero(fd, 'maxMontoTicket'), maxTicketsLote: numero(fd, 'maxTicketsLote'),
    maxTicketsDia: numero(fd, 'maxTicketsDia'), maxMontoDia: numero(fd, 'maxMontoDia'),
  }));
}
export async function accionDecidirLote(_p: RespuestaControl | null, fd: FormData): Promise<RespuestaControl> {
  const s = await sesion(); if (!s) return SIN_PERMISO;
  const id = clave(fd, 'loteId');
  if (!id) return { error: 'Falta el lote.' };
  return responder(await decidirLote(s.tenantId, s.userId, id, clave(fd, 'decision') === 'confirmar', clave(fd, 'motivo') || undefined));
}
export async function accionPromoverPortal(_p: RespuestaControl | null, fd: FormData): Promise<RespuestaControl> {
  const s = await sesion(); if (!s) return SIN_PERMISO;
  const c = clave(fd, 'comercio'); if (!c) return { error: 'Falta el portal.' };
  return responder(await promoverPortal(s.tenantId, s.userId, c));
}
export async function accionDevolverPortal(_p: RespuestaControl | null, fd: FormData): Promise<RespuestaControl> {
  const s = await sesion(); if (!s) return SIN_PERMISO;
  const c = clave(fd, 'comercio'); if (!c) return { error: 'Falta el portal.' };
  return responder(await devolverASupervisada(s.tenantId, s.userId, c));
}
