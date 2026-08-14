// ═══════════════════════════════════════════════════════════════════════════
// QUÉ PANTALLAS EXISTEN PARA CADA ROL — una sola fuente, y no es el sidebar.
//
// `permisos.ts` decide qué ACCIÓN se ofrece encima de un dato que el rol ya
// puede ver (exportar, asignar, administrar). Esto decide algo distinto y
// anterior: si la PANTALLA existe siquiera para ese rol.
//
// Hacía falta porque `encargado` y `contador` entraban al mismo /dashboard
// que el dueño y veían TODO: rentabilidad, cobranza, facturación, clientes.
// El encargado es el jefe de tráfico — despacha, no factura — y enseñarle el
// margen de la flota no es un detalle de UI, es exponerle a un puesto medio
// las finanzas completas de la empresa.
//
// SE APLICA EN DOS SITIOS, Y LOS DOS HACEN FALTA:
//   1. el sidebar, para no pintar el link;
//   2. la PÁGINA, con `exigirVer()`, porque un link que no se pinta se
//      escribe a mano en la barra de direcciones. Esconder sin gatear es el
//      patrón que la 0045 ya tuvo que cerrar para el chofer: la UI lo
//      escondía, la consulta no.
//
// RLS no puede resolver esto: `tenant_data` es por TENANT, no por rol, y los
// tres roles de oficina comparten exactamente las mismas filas. Lo que
// cambia es qué se le enseña a cada quien, y eso se decide aquí.
// ═══════════════════════════════════════════════════════════════════════════

/** Las secciones en que se parte el panel, por naturaleza del dato. */
export type Area = 'operacion' | 'dinero' | 'administracion';

/**
 * Qué áreas ve cada rol del dominio de `app_user.rol` (0044).
 *
 * `operador` NO aparece: no tiene login (retirado el 7-ago-2026, solo
 * WhatsApp). Un rol desconocido cae al `??` de `areasDe` y no ve nada: fail
 * closed, igual que `permisos.ts`.
 */
const AREAS_POR_ROL: Record<string, readonly Area[]> = {
  superadmin: ['operacion', 'dinero', 'administracion'],
  flota_admin: ['operacion', 'dinero', 'administracion'],
  // El jefe de tráfico: despacha y da seguimiento. No ve finanzas ni toca la
  // configuración de la cuenta. Es el rol para el que existe este archivo.
  encargado: ['operacion'],
  // El contador vive del dinero y del papel. No despacha: asignarle un viaje
  // a un chofer no es su trabajo y la matriz de permisos ya se lo niega.
  contador: ['dinero'],
};

export function areasDe(rol: string): readonly Area[] {
  return AREAS_POR_ROL[rol] ?? [];
}

export function puedeVerArea(rol: string, area: Area): boolean {
  return areasDe(rol).includes(area);
}

/**
 * A qué área pertenece cada ruta de /dashboard.
 *
 * Explícito y no por prefijo a propósito: una ruta nueva que nadie clasifique
 * cae a `undefined`, y `puedeVerRuta` la niega. Es preferible que una pantalla
 * nueva no se vea a que se vea de más — el error caro es el segundo.
 *
 * Las 17 páginas de "dueño de flota" (despacho, viajes, pod, incidencias,
 * unidades, operadores, mapa, documentos, analitica, chat, valor-ahorro,
 * rentabilidad, clientes, cotizador, cuadre, facturacion, cobranza) se
 * borraron el 10-ago-2026 para rehacerse desde cero, y las 6 del panel del
 * CONTADOR (`/dashboard/contador` y sus 5 subrutas) las siguieron el mismo
 * día — sus entradas salieron de este mapa junto con la página.
 * `puedeVerRuta` niega por default (`area !== undefined`), así que una URL
 * vieja simplemente deja de abrir para todos, dueño incluido — el efecto
 * correcto mientras no exista nada que gatear. `/dashboard` se queda: sigue
 * siendo Resumen para todos los roles, incluido el jefe de tráfico
 * (`inicio-operacion.tsx`). Con el panel del contador vacío, `inicioDe`
 * (abajo) ya no lo manda a `/dashboard/contador` — ver esa función.
 */
const AREA_POR_RUTA: Record<string, Area> = {
  '/dashboard': 'operacion',
  // Nuevo viaje — reconstruida el 12-ago-2026 (la segunda). Es `operacion`:
  // crear/asignar es del encargado también; el server action re-gatea con
  // puedeAsignar adentro.
  '/dashboard/despacho': 'operacion',
  // El Registro (F2, 14-ago-2026). Los DOS son `operacion` y por eso sus
  // páginas dejan el dinero en el servidor (la fuga del 4-ago fue
  // exactamente anticipos y % por chofer a la vista del encargado —
  // `dinero_por_area.test.ts` los escanea).
  '/dashboard/viajes': 'operacion',
  '/dashboard/operadores': 'operacion',
  // El mapa (F3): viajes vivos sobre México, sin un peso en pantalla.
  '/dashboard/mapa': 'operacion',
  // El Agente de Conductores (F4) es el ÚNICO agente de operación: no toca
  // un peso y su usuario diario es el jefe de tráfico. Sus hermanos
  // (liquidación/facturas/cobranza) siguen en dinero.
  '/dashboard/agentes/conductores': 'operacion',
  '/dashboard/arco': 'operacion',
  '/dashboard/soporte': 'operacion',

  // Dinero — lo que el encargado no ve
  // AGENTES (13-ago-2026): las ventanas de los dos agentes enseñan montos
  // comprobados y colas de facturación — área dinero.
  '/dashboard/agentes/liquidacion': 'dinero',
  '/dashboard/agentes/facturas': 'dinero',
  // Cobranza de COMPROBANTES (0089): la página no enseña pesos, pero es la
  // cola del cierre contable — el dolor del contador — y opera al bloque
  // AGENTES completo. Si un día el jefe de tráfico debe perseguir
  // comprobantes, ese cambio lo decide Javier, no un prefijo.
  '/dashboard/agentes/cobranza': 'dinero',
  // El conciliador (F5): montos del estado de cuenta a la vista — dinero.
  '/dashboard/agentes/peajes': 'dinero',
  // Proveedores (F6): facturas y totales — dinero, y la decisión es del
  // contador/dueño.
  '/dashboard/agentes/proveedores': 'dinero',
  // La bandeja de huérfanos (F2): enseña montos de comprobantes — dinero.
  '/dashboard/huerfanos': 'dinero',
  '/dashboard/combustible-casetas': 'dinero',
  // Rentabilidad y cobranza a clientes (F7): margen y cartera — dinero puro.
  '/dashboard/rentabilidad': 'dinero',
  // Preguntar a la IA — reconstruida el 12-ago-2026 (la primera de las 17).
  // Es `dinero` porque responde montos comprobados/IVA/peaje (§12: las
  // cifras se piden DESPUÉS de este gateo).
  '/dashboard/chat': 'dinero',
  // Lo que Likida le cobra a la flota (0052). Es `dinero` y no
  // `administracion` porque el contador necesita las facturas de Likida para su
  // propia contabilidad — es el mismo criterio que la RLS de la 0052, que las
  // abre a `ve_finanzas()`. CONTRATAR sí es del dueño, y eso se gatea adentro.
  '/dashboard/suscripcion': 'dinero',

  // Administración de la cuenta — solo el dueño
  // Conexiones (F7): la configuración de conectores de la cuenta.
  '/dashboard/conexiones': 'administracion',
  '/dashboard/usuarios': 'administracion',
  '/dashboard/politicas': 'administracion',
  '/dashboard/configuracion': 'administracion',
};

export function areaDeRuta(href: string): Area | undefined {
  return AREA_POR_RUTA[href];
}

export function puedeVerRuta(rol: string, href: string): boolean {
  const area = areaDeRuta(href);
  return area !== undefined && puedeVerArea(rol, area);
}

/**
 * Los roles cuyo panel NO ES ÉSTE, con la dirección del suyo.
 *
 * Está aparte de `AREAS_POR_ROL` a propósito, y la separación es la que
 * impide que arreglar el rebote se convierta en una fuga: darle un área a un
 * rol para que `inicioDe` supiera a dónde mandarlo le abriría de paso TODAS
 * las rutas de esa área en `puedeVerRuta`. Aquí no gana visibilidad de nada:
 * solo se declara la puerta de salida.
 *
 * Vacío desde el 7-ago-2026: el chofer (`operador`) era el único caso —
 * tenía panel propio en /chofer. Retirado su login (solo WhatsApp de aquí en
 * adelante), no queda ningún rol con casa fuera de /dashboard. Se deja la
 * tabla declarada, no el `Record` en línea: es el punto de extensión para el
 * día que un rol futuro sí la necesite.
 */
const PANEL_PROPIO: Record<string, string> = {};

/**
 * A dónde mandar a un rol que no puede ver donde está parado.
 *
 * No es `/dashboard` fijo: para el contador, `/dashboard` es de operación y
 * lo rebotaría otra vez — un bucle de redirects, que es peor que la fuga que
 * se quería evitar.
 */
/** Los roles que un superadmin puede PREVISUALIZAR con `?rol=`. */
const PREVISUALIZABLES = new Set(['flota_admin', 'encargado', 'contador']);

/**
 * Qué rol manda para decidir visibilidad — el de la sesión, salvo que un
 * superadmin esté mirando el panel "como" otro.
 *
 * Existe porque los tres roles de oficina comparten la MISMA URL: no había
 * forma de comparar qué ve el dueño contra qué ve el jefe de tráfico sin
 * tener la contraseña de los dos. Y las cuentas de prueba nunca recibieron
 * su magic link (el remitente sandbox de Resend rechaza los alias).
 *
 * SOLO PUEDE QUITAR, NUNCA DAR. Se honra únicamente si el rol REAL de la
 * sesión es superadmin —que ya ve las tres áreas—, así que el resultado es
 * siempre un subconjunto de lo que esa sesión podía ver. Para cualquier otro
 * rol el parámetro se ignora en silencio: si se honrara, `?rol=flota_admin`
 * en la barra de direcciones sería una escalada de privilegios de un solo
 * teclazo.
 */
export function rolEfectivo(rolReal: string, rolPedido?: string | null): string {
  if (rolReal !== 'superadmin') return rolReal;
  if (!rolPedido || !PREVISUALIZABLES.has(rolPedido)) return rolReal;
  return rolPedido;
}

export function inicioDe(rol: string): string {
  // PRIMERO el panel ajeno: un rol que vive fuera de /dashboard no se rebota
  // adentro ni por accidente. Hoy solo aplica al chofer, que no tiene áreas,
  // así que el orden no cambia nada — lo cambiaría el día que alguien le dé
  // un área a un rol de esta tabla, y ese es justo el día en que importa.
  const propio = PANEL_PROPIO[rol];
  if (propio) return propio;

  if (puedeVerArea(rol, 'operacion')) return '/dashboard';
  // El panel del contador (`/dashboard/contador`) se borró el 10-ago-2026
  // para rehacerse desde cero — mandarlo ahí sería un bucle (`puedeVerRuta`
  // lo negaría otra vez, sin área declarada). Mientras no exista un panel
  // propio, aterriza en la única pantalla de `dinero` que le sigue quedando
  // Y que de verdad es suya: Plan & Facturación, las facturas de Likida que
  // ya necesitaba para su propia contabilidad. La rama sigue siendo por
  // ÁREA y no por nombre de rol: cualquier rol futuro que solo vea dinero
  // aterriza aquí sin que haya que acordarse de agregarlo.
  if (puedeVerArea(rol, 'dinero')) return '/dashboard/suscripcion';
  return '/sin-acceso';
}
