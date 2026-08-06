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
 * `operador` NO aparece: su vista es /chofer con RLS propia (0045), no este
 * panel. Un rol desconocido cae al `??` de `areasDe` y no ve nada: fail
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
 */
const AREA_POR_RUTA: Record<string, Area> = {
  '/dashboard': 'operacion',

  // Operación
  '/dashboard/despacho': 'operacion',
  '/dashboard/viajes': 'operacion',
  '/dashboard/pod': 'operacion',
  '/dashboard/incidencias': 'operacion',
  '/dashboard/unidades': 'operacion',
  '/dashboard/operadores': 'operacion',
  '/dashboard/mapa': 'operacion',
  '/dashboard/documentos': 'operacion',
  '/dashboard/analitica': 'operacion',
  '/dashboard/chat': 'dinero',
  '/dashboard/arco': 'operacion',
  '/dashboard/soporte': 'operacion',

  // Dinero — lo que el encargado no ve
  //
  // El panel del CONTADOR. Es `dinero` y no un área nueva a propósito: el
  // contador ya tiene exactamente esa área y nada más, así que un cuarto valor
  // en el enum solo serviría para esconderle estas pantallas al dueño, que
  // también las quiere. Lo que hace al panel del contador de SOLO LECTURA no
  // es el área: es que ninguna de sus páginas expone una acción (ver
  // `permisos.ts` — `puedeAsignar`/`puedeAdministrar` ya le dicen que no).
  '/dashboard/contador': 'dinero',
  '/dashboard/contador/deducciones': 'dinero',
  '/dashboard/contador/cfdi': 'dinero',
  '/dashboard/contador/combustible': 'dinero',
  '/dashboard/contador/retenciones': 'dinero',
  '/dashboard/contador/liquidaciones': 'dinero',

  '/dashboard/valor-ahorro': 'dinero',
  '/dashboard/rentabilidad': 'dinero',
  '/dashboard/clientes': 'dinero',
  '/dashboard/combustible-casetas': 'dinero',
  '/dashboard/cotizador': 'dinero',
  '/dashboard/cuadre': 'dinero',
  '/dashboard/facturacion': 'dinero',
  '/dashboard/cobranza': 'dinero',
  // Lo que Likida le cobra a la flota (0052). Es `dinero` y no
  // `administracion` porque el contador necesita las facturas de Likida para su
  // propia contabilidad — es el mismo criterio que la RLS de la 0052, que las
  // abre a `ve_finanzas()`. CONTRATAR sí es del dueño, y eso se gatea adentro.
  '/dashboard/suscripcion': 'dinero',

  // Administración de la cuenta — solo el dueño
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
 * impide que arreglar el rebote se convierta en una fuga: darle un área al
 * chofer para que `inicioDe` supiera a dónde mandarlo le abriría de paso
 * TODAS las rutas de esa área en `puedeVerRuta` — que es exactamente la
 * pantalla que no puede ver. Aquí no gana visibilidad de nada: solo se
 * declara la puerta de salida.
 */
const PANEL_PROPIO: Record<string, string> = {
  // El chofer. Antes caía al `/sin-acceso` de abajo porque no tenía áreas y
  // no había un panel suyo al que mandarlo; desde que existe /chofer, decirle
  // "no tienes acceso" a alguien que SÍ tiene panel es mentira, y la lee
  // justo cuando teclea /dashboard por costumbre o llega por un enlace viejo.
  operador: '/chofer',
};

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
  // El contador aterriza en SU panel, no en el cuadre. Antes caía en
  // `/dashboard/cuadre` porque era la primera página de `dinero` que existía;
  // ahora existe una hecha para él, y es la que abre en la mañana. La rama
  // sigue siendo por ÁREA y no por nombre de rol: cualquier rol futuro que
  // solo vea dinero aterriza aquí sin que haya que acordarse de agregarlo.
  if (puedeVerArea(rol, 'dinero')) return '/dashboard/contador';
  return '/sin-acceso';
}
