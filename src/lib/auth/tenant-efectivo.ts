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
import { logger } from '@/lib/logger';
import { TZ_MX } from '@/lib/formato';
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

/** Hoy en día MX (`AAAA-MM-DD`), que es el "día" del dedup de impersonación:
 *  el reloj de quien opera el sistema, no el de UTC — a las 7pm de CDMX ya es
 *  mañana en UTC y el dedup partiría una sesión de revisión en dos firmas. */
function diaMx(): string {
  // `en-CA` porque su formato de fecha ES `AAAA-MM-DD` — no hay que rearmar.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_MX, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * LA IMPERSONACIÓN SE FIRMA (0110, pieza 3 del informe): cuando un superadmin
 * abre el panel de una flota REAL con `?tenant=` — no la demo, no `?vista=demo`
 * —, queda una entrada en `bitacora_auditoria`. La auditoría encontró que el
 * "ver como" no dejaba rastro: el acceso más privilegiado del sistema era el
 * único invisible.
 *
 * UNA VEZ POR (actor, flota, día MX), no por carga de página: una sesión de
 * revisión son decenas de páginas y firmar cada una enterraría la bitácora en
 * su propio ruido. El dedup es el PK de `impersonacion_dia` (0110): el upsert
 * con `ignoreDuplicates` devuelve fila SOLO cuando ganó el insert, y solo ese
 * camino escribe la bitácora — dos pestañas simultáneas no duplican la firma
 * porque la base decide quién ganó, no un `select` previo con carrera.
 *
 * JAMÁS ROMPE LA RESOLUCIÓN: todo fallo se traga con logger. Dejar a un
 * superadmin fuera del panel de un cliente porque la firma no se pudo
 * escribir sería bloquear la operación por su propia auditoría. Se AWAITEA a
 * propósito (no fire-and-forget puro): una promesa suelta en una función
 * serverless puede morir con la invocación y la firma se perdería en
 * silencio; el costo es un upsert indexado en la carga de página que ya hizo
 * la consulta del tenant.
 */
async function firmarImpersonacion(actorId: string, tenantId: string): Promise<void> {
  try {
    const dia = diaMx();
    const { data, error } = await supabaseAdmin()
      .from('impersonacion_dia')
      .upsert(
        { actor_id: actorId, tenant_id: tenantId, dia },
        { onConflict: 'actor_id,tenant_id,dia', ignoreDuplicates: true },
      )
      .select('dia');
    if (error) {
      logger.warn('impersonacion.no_firmada', { tenant: tenantId, err: error.message });
      return;
    }
    // Sin fila devuelta = ya estaba firmado hoy. No se re-escribe la bitácora.
    if (!data || data.length === 0) return;

    const { error: errBitacora } = await supabaseAdmin().from('bitacora_auditoria').insert({
      tenant_id: tenantId,
      actor_id: actorId,
      accion: 'impersonacion.dashboard',
      entidad: 'tenant',
      entidad_id: tenantId,
      detalle: { dia },
    });
    if (errBitacora) {
      logger.warn('impersonacion.bitacora_no_escribio', { tenant: tenantId, err: errBitacora.message });
    }
  } catch (e) {
    logger.warn('impersonacion.no_firmada', {
      tenant: tenantId, err: e instanceof Error ? e.message : String(e),
    });
  }
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
      // Solo aquí: `?tenant=` que RESOLVIÓ a una flota real. `?vista=demo` no
      // pasa por este if y no se firma — mirar la demo no es mirar a un
      // cliente. Ver `firmarImpersonacion` para el dedup y el porqué de que
      // un fallo del registro nunca tumbe esta página.
      await firmarImpersonacion(sesionReal.userId, t.id as string);
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
