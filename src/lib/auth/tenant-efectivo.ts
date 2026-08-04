// ═══════════════════════════════════════════════════════════════════════════
// A QUÉ FLOTA APUNTA CADA PÁGINA DE /dashboard/* — un solo lugar, no 20 copias.
//
// `requireSessionTenant` ya resuelve el tenant REAL de un flota_admin/
// operador/contador — para esos roles esta función no hace nada extra, solo
// pasa la sesión tal cual. El caso especial es SUPERADMIN: sin selector de
// flota (Fase 1 del roadmap), su `tenantId` por default es el del demo
// (0001_init.sql), y `?tenant=<id>` (desde "Ver dashboard" en /admin/flotas)
// o `?vista=demo` (desde el link del sidebar de /admin) son las dos formas
// de decirle a esta página CUÁL flota real quiere ver.
//
// `esRaiz` es el único parámetro que distingue la página de aterrizaje
// (`/dashboard`) del resto: SOLO ahí un superadmin que llega sin `?tenant=`
// ni `?vista=demo` (p.ej. por bookmark) se rebota a /admin — es SU consola,
// no la de un cliente. Las subpáginas (Viajes, Documentos, Cuadre…) NUNCA
// hacen ese rebote: si superadmin llegó aquí navegando desde el sidebar (que
// ya propaga `?tenant=`/`?vista=demo` en cada link, ver sidebar-nav.tsx), se
// respeta; si no trae ninguno, cae al tenant demo sin más — igual que
// `requireSessionTenant` ya hace, sin sorpresas.
import { redirect } from 'next/navigation';
import { requireSessionTenant } from './guard';
import { puedeVerRuta, inicioDe } from './visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { SessionTenant } from './session';

export interface TenantEfectivo extends SessionTenant {
  tenantId: string;
  /** Nombre real de la flota SOLO cuando un superadmin está viendo una
   *  flota real distinta de la demo — null en cualquier otro caso (incluida
   *  la demo, que no necesita el badge "viendo como superadmin"). */
  tenantNombre: string | null;
}

export async function resolverTenantEfectivo(
  destino: string,
  sp: { vista?: string; tenant?: string } | undefined,
  opts: { esRaiz?: boolean } = {},
): Promise<TenantEfectivo> {
  const sesion = await requireSessionTenant(destino);

  // ¿ESTA PANTALLA EXISTE PARA ESTE ROL? — antes de resolver nada más.
  //
  // Hasta aquí, encargado y contador entraban al mismo panel que el dueño y
  // veían todo: rentabilidad, cobranza, facturación, clientes. RLS no podía
  // evitarlo (`tenant_data` es por tenant, no por rol: los tres comparten
  // exactamente las mismas filas) y esconder el link tampoco — se teclea la
  // URL. Se gatea aquí porque `destino` ES la ruta y todas las páginas de
  // /dashboard con datos ya pasan por esta función.
  if (!puedeVerRuta(sesion.rol, destino)) redirect(inicioDe(sesion.rol));

  if (opts.esRaiz && sesion.rol === 'superadmin' && sp?.vista !== 'demo' && !sp?.tenant) {
    redirect('/admin');
  }

  let tenantId = sesion.tenantId;
  let tenantNombre: string | null = null;
  if (sesion.rol === 'superadmin' && sp?.tenant) {
    const { data: t } = await supabaseAdmin().from('tenant').select('id, nombre').eq('id', sp.tenant).maybeSingle();
    if (t) {
      tenantId = t.id as string;
      tenantNombre = t.nombre as string;
    }
  }

  return { ...sesion, tenantId, tenantNombre };
}
