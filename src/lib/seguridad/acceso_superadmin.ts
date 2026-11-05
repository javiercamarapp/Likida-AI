import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// BITÁCORA DE LECTURAS Y DESCARGAS DEL SUPERADMIN — F9, CT-ENT-01 (migración 0997).
//
// `firmarImpersonacion` deja UNA firma por (actor, flota, día); `evento_seguridad` guarda los exportes de dinero. Esto cierra lo que un
// cliente enterprise pregunta: qué páginas leyó y qué descargó alguien de Likida en su flota. Solo rutas (sin querystring), jamás
// contenido.
//
// APAGADO por omisión (`LIKIDA_BITACORA_ACCESO_SUPERADMIN=activo` la enciende): escribe en una tabla nueva (0997) que Javier aplica a
// mano, y la retención (D7) y si el cliente la ve están por decidir. REGLA: best-effort total — vigilar un camino jamás lo tumba — y
// tolera que la tabla aún no exista.
// ═══════════════════════════════════════════════════════════════════════════

export type TipoAccesoSuperadmin = 'lectura' | 'descarga' | 'ver_como';

export function bitacoraAccesoSuperadminActiva(env: Record<string, string | undefined> = process.env): boolean {
  return (env.LIKIDA_BITACORA_ACCESO_SUPERADMIN ?? '').trim().toLowerCase() === 'activo';
}

/** PURA. Solo la ruta: sin query ni hash, acotada a 200 caracteres (el CHECK de la 0997). */
export function rutaSinQuery(destino: string): string {
  const limpia = destino.split(/[?#]/)[0] || '/';
  return limpia.slice(0, 200);
}

const VENTANA_MS = 60_000;
const vistos = new Map<string, number>();

/** PURA salvo el mapa por instancia: una misma (actor, flota, tipo, ruta) dentro del minuto no vuelve a escribir. */
export function yaRegistradoReciente(clave: string, ahoraMs: number): boolean {
  const antes = vistos.get(clave);
  if (antes !== undefined && ahoraMs - antes < VENTANA_MS) return true;
  if (vistos.size > 2000) {
    for (const [k, t] of vistos) if (ahoraMs - t >= VENTANA_MS) vistos.delete(k);
  }
  vistos.set(clave, ahoraMs);
  return false;
}

export function _reiniciarDedupParaPruebas(): void {
  vistos.clear();
}

export async function registrarAccesoSuperadmin(a: {
  actor: string;
  tenantId: string | null;
  tipo: TipoAccesoSuperadmin;
  ruta: string;
  detalle?: Record<string, unknown>;
}): Promise<void> {
  if (!bitacoraAccesoSuperadminActiva()) return;
  try {
    const ruta = rutaSinQuery(a.ruta);
    if (yaRegistradoReciente(`${a.actor}|${a.tenantId ?? ''}|${a.tipo}|${ruta}`, Date.now())) return;
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const { error } = await supabaseAdmin().from('superadmin_acceso').insert({
      actor: a.actor, tenant_id: a.tenantId, tipo: a.tipo, ruta, detalle: a.detalle ?? {},
    });
    if (error) logger.warn('superadmin_acceso.no_escribio', { err: error.message });
  } catch (e) {
    logger.warn('superadmin_acceso.no_escribio', { err: e instanceof Error ? e.message : String(e) });
  }
}
