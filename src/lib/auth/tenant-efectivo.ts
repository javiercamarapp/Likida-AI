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
import { puedeVerRuta, inicioDe, rolEfectivo } from './visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { SessionTenant } from './session';

export interface TenantEfectivo extends SessionTenant {
  tenantId: string;
  /** Nombre real de la flota SOLO cuando un superadmin está viendo una
   *  flota real distinta de la demo — null en cualquier otro caso (incluida
   *  la demo, que no necesita el badge "viendo como superadmin"). */
  tenantNombre: string | null;
  /**
   * `false` SOLO cuando se comprobó que el uuid al que apunta esta página no
   * tiene fila en `tenant`. Existe porque `DEMO_TENANT_ID` es una variable de
   * entorno, no una llave foránea: cuando la flota demo se borra —como el
   * 4-ago-2026, que dejó la base en cero tenants— el superadmin sigue
   * entrando, todas las consultas salen vacías, y el panel afirma "aún no hay
   * liquidaciones". Es la misma clase de mentira que `estadoPanel` ya evita
   * para una consulta caída: cero filas de una flota que NO EXISTE no es un
   * dato sobre el negocio del cliente.
   *
   * Un error de la consulta deja esto en `true`: no saber si existe no es
   * evidencia de que no exista, y anunciar "no hay flota" por un bache de red
   * sería exactamente el error que se quiere cerrar, en el otro sentido.
   */
  tenantExiste: boolean;
}

/**
 * El `?vista=`/`?tenant=`/`?rol=` que hay que volver a colgar de un redirect
 * de esta función — el equivalente de `sufijoTenant` para el REBOTE.
 *
 * `redirect(inicioDe(rol))` se llevaba una ruta pelona, así que previsualizar
 * al contador desde `/dashboard` (que no es suyo) aterrizaba en
 * `/dashboard/contador` SIN `?rol=contador`: el superadmin acababa mirando la
 * pantalla con sus propios ojos, sin cinta que lo avisara y con el menú
 * completo, creyendo que eso era lo que ve un contador. El modo se apagaba
 * solo, en silencio, justo en el salto que lo estrenaba.
 *
 * Solo se arma para una sesión REAL de superadmin: para cualquier otro rol
 * `rolEfectivo` ignora `?rol=` de todas formas, y arrastrarlo aquí sería
 * pasear un parámetro que no hace nada.
 */
function sufijoPrevisualizacion(
  esSuperadmin: boolean,
  sp: { vista?: string; tenant?: string; rol?: string } | undefined,
): string {
  if (!esSuperadmin || !sp) return '';
  const qs = new URLSearchParams();
  if (sp.tenant) qs.set('tenant', sp.tenant);
  else if (sp.vista) qs.set('vista', sp.vista);
  if (sp.rol) qs.set('rol', sp.rol);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export async function resolverTenantEfectivo(
  destino: string,
  sp: { vista?: string; tenant?: string; rol?: string } | undefined,
  opts: { esRaiz?: boolean } = {},
): Promise<TenantEfectivo> {
  const sesionReal = await requireSessionTenant(destino);

  // "Ver como": un superadmin puede mirar el panel con los ojos de otro rol
  // (`?rol=encargado`) para comparar qué ve cada quien. Solo QUITA visibilidad
  // y solo si la sesión real es superadmin — ver `rolEfectivo`.
  const rol = rolEfectivo(sesionReal.rol, sp?.rol);
  const sesion = { ...sesionReal, rol };

  // ¿ESTA PANTALLA EXISTE PARA ESTE ROL? — antes de resolver nada más.
  //
  // Hasta aquí, encargado y contador entraban al mismo panel que el dueño y
  // veían todo: rentabilidad, cobranza, facturación, clientes. RLS no podía
  // evitarlo (`tenant_data` es por tenant, no por rol: los tres comparten
  // exactamente las mismas filas) y esconder el link tampoco — se teclea la
  // URL. Se gatea aquí porque `destino` ES la ruta y todas las páginas de
  // /dashboard con datos ya pasan por esta función.
  //
  // El rebote CONSERVA la previsualización (`sufijoPrevisualizacion`): un
  // superadmin que entra "como contador" por una ruta que el contador no ve
  // tiene que aterrizar en la de él SIGUIENDO siendo contador. No abre nada:
  // `rolEfectivo` vuelve a filtrar el parámetro en la página de destino, y
  // para un rol real el sufijo sale vacío. Y no hay bucle: el destino es
  // `inicioDe(rolEfectivo)`, que por construcción ese rol sí puede ver.
  if (!puedeVerRuta(sesion.rol, destino)) {
    redirect(`${inicioDe(sesion.rol)}${sufijoPrevisualizacion(sesionReal.rol === 'superadmin', sp)}`);
  }

  // `?rol=` cuenta como intención de ver el panel del cliente, igual que
  // `?vista=demo` — si no, "ver como encargado" desde la raíz rebotaba a
  // /admin y la comparación era imposible justo en la pantalla de inicio,
  // que es la que más cambia entre un rol y otro.
  if (opts.esRaiz && sesionReal.rol === 'superadmin' && sp?.vista !== 'demo' && !sp?.tenant && !sp?.rol) {
    redirect('/admin');
  }

  let tenantId = sesion.tenantId;
  let tenantNombre: string | null = null;
  let tenantExiste = true;
  if (sesionReal.rol === 'superadmin' && sp?.tenant) {
    const { data: t } = await supabaseAdmin().from('tenant').select('id, nombre').eq('id', sp.tenant).maybeSingle();
    if (t) {
      tenantId = t.id as string;
      tenantNombre = t.nombre as string;
    }
  }

  // ¿EXISTE LA FLOTA QUE ESTA PÁGINA VA A CONSULTAR?
  //
  // Solo para superadmin, y no por ahorrar: `app_user.tenant_id` tiene llave
  // foránea contra `tenant` (app_user_tenant_id_fkey), así que el tenant de un
  // dueño, un contador o un encargado NO PUEDE no existir. El del superadmin
  // sí: sale de `DEMO_TENANT_ID`, una variable de entorno que nada obliga a
  // apuntar a una fila viva. Preguntarlo para todos sería una consulta de más
  // en cada carga de cada cliente para responder algo que el esquema ya
  // garantiza.
  if (sesionReal.rol === 'superadmin' && tenantNombre === null) {
    const { data, error } = await supabaseAdmin().from('tenant').select('id').eq('id', tenantId).maybeSingle();
    if (!error) tenantExiste = data !== null;
  }

  return { ...sesion, tenantId, tenantNombre, tenantExiste };
}
