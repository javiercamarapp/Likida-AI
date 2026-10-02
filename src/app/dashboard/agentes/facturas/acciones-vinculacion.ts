'use server';

import { revalidatePath } from 'next/cache';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { iniciarVinculacion, cancelarVinculacion, estadoVisible } from '@/lib/likida/autofactura/vinculacion_remota';
import { crearDepsVinculacion } from '@/lib/likida/autofactura/vinculacion_remota_repo';

// Server actions de la vinculación asistida (0540). A NIVEL DE MÓDULO (no closures): cada
// una vuelve a resolver sesión, rol y flota desde la cookie y NUNCA acepta un tenant_id del
// cliente. La base vuelve a comprobar el rol (`crear_vinculacion_portal`).

const RUTA = '/dashboard/agentes/facturas';

export type ResultadoVincular =
  | { ok: true; codigo: string; comando: string; expiraEn: string; comercio: string; nombre: string }
  | { ok: false; error: string };

export type EstadoVinculacionPantalla =
  | { ok: true; estado: 'ninguna' | 'pendiente' | 'reclamada' | 'completada' | 'fallida' | 'expirada' | 'cancelada'; motivo: string | null; expiraEn: string | null }
  | { ok: false };

async function sesionDeVinculacion() {
  const s = await requireSessionTenant(RUTA);
  if (!puedeVerArea(s.rol, 'dinero')) return null;
  return s;
}

export async function accionIniciarVinculacion(_prev: ResultadoVincular | null, fd: FormData): Promise<ResultadoVincular> {
  const s = await sesionDeVinculacion();
  if (!s) return { ok: false, error: 'Tu rol no puede vincular portales de la flota.' };
  const comercio = String(fd.get('comercio') ?? '').trim().slice(0, 64);
  const r = await iniciarVinculacion({ tenantId: s.tenantId, userId: s.userId, comercio }, crearDepsVinculacion());
  if (!r.ok) return { ok: false, error: r.motivo };
  revalidatePath(RUTA);
  return { ok: true, codigo: r.codigo, comando: r.comando, expiraEn: r.expiraEn, comercio: r.comercio, nombre: r.nombre };
}

export async function accionCancelarVinculacion(_prev: { ok?: string; error?: string } | null, fd: FormData): Promise<{ ok?: string; error?: string }> {
  const s = await sesionDeVinculacion();
  if (!s) return { error: 'Tu rol no puede cancelar vinculaciones.' };
  const comercio = String(fd.get('comercio') ?? '').trim().slice(0, 64);
  const n = await cancelarVinculacion({ tenantId: s.tenantId, userId: s.userId, comercio }, crearDepsVinculacion());
  revalidatePath(RUTA);
  return n > 0 ? { ok: 'Vinculación cancelada: el código dejó de servir.' } : { error: 'No había una vinculación en curso para este portal.' };
}

/** El sondeo de la pantalla mientras el contralor entra al portal (cada pocos segundos). */
export async function accionEstadoVinculacion(comercio: string): Promise<EstadoVinculacionPantalla> {
  const s = await sesionDeVinculacion();
  if (!s) return { ok: false };
  const lista = await crearDepsVinculacion().repo.listar(s.tenantId);
  if (lista === null) return { ok: false };
  const ultima = lista.find((x) => x.comercio === String(comercio).slice(0, 64)) ?? null;
  return { ok: true, estado: estadoVisible(ultima, new Date()), motivo: ultima?.motivo ?? null, expiraEn: ultima?.expiraEn ?? null };
}
