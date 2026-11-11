'use server';

// Acciones de la pantalla de avisos (marcar leído, preferencias, horario). Cada una vuelve a resolver QUIÉN es y QUÉ ámbito toca en el
// servidor: lo que manda el navegador (panel, flota) es una petición, no una autorización.
import { clienteAvisos } from '@/lib/avisos/cliente';
import { requireSuperadmin } from '@/lib/auth/guard';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { leerAvisosAdmin } from '@/app/ui-v2/avisos/fuente-admin';
import { leerAvisosFlota } from '@/app/ui-v2/avisos/fuente-flota';
import { guardarPreferencia, guardarSilencio, marcarLeidas } from '@/lib/avisos/estado';
import { esCanal, esCategoriaDe, type Ambito } from '@/lib/avisos/modelo';
import type { FuenteAvisos } from '@/lib/avisos/bandeja';

export type Destino = { panel: 'admin' } | { panel: 'flota'; tenant: string | null };
export type ResultadoAviso = { ok: true; cambiadas?: number } | { ok: false; error: string };

const MAX_CLAVES = 500;
const MAX_LARGO_CLAVE = 300;

async function contexto(d: Destino): Promise<{ ambito: Ambito; userId: string; fuente: () => Promise<FuenteAvisos> }> {
  if (d.panel === 'admin') {
    const s = await requireSuperadmin();
    return { ambito: { tipo: 'admin' }, userId: s.userId, fuente: () => leerAvisosAdmin() };
  }
  const t = await resolverTenantEfectivo('/dashboard/notificaciones', d.tenant ? { tenant: d.tenant } : undefined);
  return { ambito: { tipo: 'flota', tenantId: t.tenantId }, userId: t.userId, fuente: () => leerAvisosFlota(t.tenantId, t.rol) };
}

/** Marca o desmarca avisos. Marcar solo escribe claves de avisos VIGENTES y silenciables (un plazo legal o una fuente ciega no se oculta). */
export async function marcarAvisos(d: Destino, claves: string[], leido: boolean): Promise<ResultadoAviso> {
  if (!Array.isArray(claves) || typeof leido !== 'boolean') return { ok: false, error: 'peticion_invalida' };
  let limpias = [...new Set(claves.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= MAX_LARGO_CLAVE))].slice(0, MAX_CLAVES);
  const { ambito, userId, fuente } = await contexto(d);
  if (leido) {
    const vigentes = new Set((await fuente()).avisos.filter((a) => a.silenciable).map((a) => a.clave));
    limpias = limpias.filter((c) => vigentes.has(c));
  }
  const r = await marcarLeidas(clienteAvisos(), ambito, userId, limpias, leido);
  return r.ok ? { ok: true, cambiadas: r.cambiadas } : { ok: false, error: r.error };
}

export async function guardarPreferenciaAviso(d: Destino, categoria: string, canal: string, activo: boolean): Promise<ResultadoAviso> {
  const { ambito, userId } = await contexto(d);
  if (!esCategoriaDe(ambito.tipo, categoria) || !esCanal(canal) || typeof activo !== 'boolean') return { ok: false, error: 'fuera_catalogo' };
  const r = await guardarPreferencia(clienteAvisos(), ambito, userId, categoria, canal, activo);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function guardarSilencioAviso(d: Destino, entrada: unknown): Promise<ResultadoAviso> {
  const { ambito, userId } = await contexto(d);
  const r = await guardarSilencio(clienteAvisos(), ambito, userId, entrada);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
