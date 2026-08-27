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
 * (`inicio-operacion.tsx`). La RAÍZ del panel del contador volvió el
 * 14-ago-2026 (`/dashboard/contador`, sin las 5 subrutas viejas) y con ella
 * `inicioDe` (abajo) vuelve a mandarlo ahí — ver esa función.
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
  // El Registro de Unidades (14-ago-2026): el activo que produce el dinero y
  // sus vigencias de ley. Es `operacion` porque el jefe de tráfico es
  // exactamente quien debe enterarse de que una unidad no puede salir, y la
  // pantalla no enseña un peso.
  '/dashboard/unidades': 'operacion',
  // El mapa (F3): viajes vivos sobre México, sin un peso en pantalla.
  '/dashboard/mapa': 'operacion',
  // Carta Porte (A3, 14-ago-2026): cero pesos en pantalla, y la declaración
  // de ruta ("¿pisa federal?") es del jefe de tráfico — la regla 2.7.7.2.1
  // exige plena certeza de quien CONOCE la ruta, no del que ve el dinero.
  '/dashboard/carta-porte': 'operacion',
  // El Agente de Conductores (F4) es agente de operación: no toca un peso y
  // su usuario diario es el jefe de tráfico. Sus hermanos
  // (liquidación/facturas/cobranza) siguen en dinero.
  '/dashboard/agentes/conductores': 'operacion',
  // El Agente de Carta Porte (Fases B-C, 25-ago-2026): mismo criterio que su
  // pantalla /dashboard/carta-porte — cero pesos, y la declaración de ruta es
  // del jefe de tráfico. La página del borrador
  // (/dashboard/carta-porte/borrador/<uuid>) es dinámica y se gatea con la
  // llave de su padre, como /dashboard/<uuid> gatea su área a mano.
  '/dashboard/agentes/carta-porte': 'operacion',
  '/dashboard/arco': 'operacion',
  '/dashboard/soporte': 'operacion',
  // Notificaciones (14-ago-2026) — el "alertas primero". Su VISIBILIDAD la
  // da RUTAS_TODO_ROL (16-ago: el comentario viejo prometía "todos los
  // roles" pero `operacion` dejaba fuera al contador); esta entrada se
  // conserva porque cada alerta se filtra ADENTRO con `puedeVerRuta` contra
  // la pantalla donde se resuelve — un encargado no recibe el renglón de
  // huérfanos ni su conteo.
  '/dashboard/notificaciones': 'operacion',
  // Mi perfil (14-ago-2026) — visibilidad por RUTAS_TODO_ROL (16-ago: TODO
  // rol edita su nombre y su foto, incluido el contador que `operacion`
  // dejaba fuera); las server actions escriben contra el userId de sesión.
  '/dashboard/mi-perfil': 'operacion',

  // Dinero — lo que el encargado no ve
  // La casa del contador, reconstruida el 14-ago-2026 (la raíz sola; sus 5
  // subrutas viejas no volvieron). Es `dinero` y no un área nueva: es el
  // Resumen de quien vive del dinero y del papel, y el dueño también puede
  // abrirla. Además es el aterrizaje de `inicioDe` para el rol que solo ve
  // dinero — sin esta línea, ese rebote sería el bucle que esa función evita.
  '/dashboard/contador': 'dinero',
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
  // El lado del INGRESO (0048/0049), que existía en la base y estaba dormido.
  // Los dos son `dinero`: quién te paga, cuánto y cuánto debe es exactamente lo
  // que el jefe de tráfico no ve.
  '/dashboard/clientes': 'dinero',
  '/dashboard/facturacion': 'dinero',
  // TIMBRADO (0227, auditoría Fable c6-3). El botón que emite el CFDI vivía
  // dentro del borrador de Carta Porte, que es `operacion`: el ENCARGADO
  // podía timbrar —un acto fiscal irreversible— y para poder hacerlo la
  // pantalla le pintaba flete, IVA, retención y total. Los dos errores son el
  // mismo error: el timbre no es operación, es dinero.
  //
  // Ruta propia y no una excepción dentro de `/dashboard/carta-porte`: el mapa
  // de este archivo asigna UN área por ruta, y una pantalla que hubiera que
  // gatear "para unos sí y para otros no" rompe esa regla justo donde más
  // caro es. El borrador sigue siendo del jefe de tráfico (la declaración de
  // ruta es suya, regla 2.7.7.2.1) y desde ahí solo hay un LINK — el dinero y
  // el botón viven de este lado. `/dashboard/timbrado/<uuid>` es dinámica y
  // gatea a mano contra esta misma llave, como `/dashboard/<uuid>`.
  '/dashboard/timbrado': 'dinero',
  // El cotizador (0225, A8): costos, márgenes y precio sugerido — la
  // definición misma de lo que el encargado no ve. Espejo de la RLS
  // `ve_finanzas()` que la 0051 le puso a `cotizacion`.
  '/dashboard/cotizaciones': 'dinero',
  // Preguntar a la IA — reconstruida el 12-ago-2026 (la primera de las 17).
  // Es `dinero` porque responde montos comprobados/IVA/peaje (§12: las
  // cifras se piden DESPUÉS de este gateo).
  '/dashboard/chat': 'dinero',
  // Conocimiento normativo (14-ago-2026) — de dónde sale el fundamento de cada
  // cifra fiscal. Es `dinero` porque su lector es el contador: quien decide con
  // esto es quien firma la declaración. La ley es la misma para todas las
  // flotas, así que la página no recibe tenantId; aquí solo se gatea el acceso.
  '/dashboard/conocimiento': 'dinero',
  // Lo que Likida le cobra a la flota (0052). Es `dinero` y no
  // `administracion` porque el contador necesita las facturas de Likida para su
  // propia contabilidad — es el mismo criterio que la RLS de la 0052, que las
  // abre a `ve_finanzas()`. CONTRATAR sí es del dueño, y eso se gatea adentro.
  '/dashboard/suscripcion': 'dinero',

  // Administración de la cuenta — solo el dueño
  // Conexiones (F7): la configuración de conectores de la cuenta.
  '/dashboard/conexiones': 'administracion',
  // Integraciones (chasis de agentes, 14-ago-2026): con qué sistemas del cliente
  // conecta Likida y CÓMO conecta hoy con cada uno. Es `administracion` —
  // decidir conectar el ERP o el GPS es del dueño, no del jefe de tráfico.
  '/dashboard/integraciones': 'administracion',
  // Llaves de API (A6, 14-ago-2026): una llave es CONTROL, no dato — con
  // ella se lee desde fuera, sin sesión, todo lo que su área permita. Mismo
  // criterio que la RLS de la 0093 (`administra_flota()`): ni el contador ni
  // el encargado la ven, solo el dueño y el superadmin.
  // Directorio de emergencia (Fase 5): grúas, póliza y contactos del
  // operador. Es `operacion` — el jefe de tráfico es quien conoce a los
  // proveedores de carretera y quien captura; el dueño también entra.
  '/dashboard/emergencias': 'operacion',
  // Mesa de control (Capa F): las incidencias de asistencia vivas y los
  // botones de intervención. `operacion` por la misma razón que Emergencias —
  // quien decide sobre una grúa a las 3 a.m. es el jefe de tráfico o el dueño.
  '/dashboard/asistencia': 'operacion',
  '/dashboard/llaves-api': 'administracion',
  '/dashboard/usuarios': 'administracion',
  '/dashboard/politicas': 'administracion',
  '/dashboard/configuracion': 'administracion',
  // Perfil operativo de la flota (onboarding del dueño, Fase 3).
  '/dashboard/onboarding': 'administracion',
};

/**
 * Rutas de la CUENTA/PERSONA, no de un área del negocio: las ve todo rol
 * CONOCIDO (16-ago-2026). Antes vivían solo en `AREA_POR_RUTA` como
 * `operacion` con comentarios que prometían "para todos los roles" — y el
 * contador (que solo ve `dinero`) no las veía: la intención declarada y el
 * mecanismo se contradecían. Explícito y no por prefijo, como todo aquí.
 * Su entrada en `AREA_POR_RUTA` se conserva porque Notificaciones filtra
 * cada alerta ADENTRO contra la pantalla donde se resuelve.
 */
const RUTAS_TODO_ROL: ReadonlySet<string> = new Set([
  '/dashboard/notificaciones',
  '/dashboard/mi-perfil',
  '/dashboard/soporte',
]);

export function areaDeRuta(href: string): Area | undefined {
  return AREA_POR_RUTA[href];
}

export function puedeVerRuta(rol: string, href: string): boolean {
  // Un rol desconocido no ve nada, ni siquiera su perfil: fail closed.
  if (RUTAS_TODO_ROL.has(href)) return areasDe(rol).length > 0;
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
 * Estuvo vacío del 7-ago-2026 (salió el chofer con /chofer) al 14-ago-2026,
 * cuando entró `vendedor` (0105): rol de LIKIDA con tenant null cuya casa es
 * /vendedor. NO aparece en `AREAS_POR_ROL` a propósito — esa ausencia es la
 * garantía (vía el `?? []` de `areasDe`) de que un vendedor no abre NINGUNA
 * pantalla de /dashboard: su trabajo son prospectos, no los datos de una
 * flota. Aquí solo se declara su puerta de salida.
 */
const PANEL_PROPIO: Record<string, string> = {
  vendedor: '/vendedor',
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
  // adentro ni por accidente. Desde el 14-ago-2026 aplica al `vendedor`
  // (0105): sin áreas, su destino es /vendedor. El orden importaría el día
  // que alguien le dé un área a un rol de esta tabla — por eso va primero.
  const propio = PANEL_PROPIO[rol];
  if (propio) return propio;

  if (puedeVerArea(rol, 'operacion')) return '/dashboard';
  // El rol que solo ve dinero aterriza en el panel del contador. La raíz se
  // reconstruyó el 14-ago-2026: mientras estuvo borrada (10→14-ago) esta
  // rama mandaba a `/dashboard/suscripcion` — la única pantalla de `dinero`
  // que era suya de verdad — porque rebotar a una ruta sin área declarada
  // habría sido un bucle (`puedeVerRuta` niega lo no clasificado). Hoy
  // `/dashboard/contador` está declarada como `dinero` en AREA_POR_RUTA, así
  // que por construcción el destino sí se puede ver y el bucle no existe.
  // La rama sigue siendo por ÁREA y no por nombre de rol: cualquier rol
  // futuro que solo vea dinero aterriza aquí sin que haya que acordarse de
  // agregarlo.
  if (puedeVerArea(rol, 'dinero')) return '/dashboard/contador';
  return '/sin-acceso';
}

/**
 * LA PUERTA DE ENTRADA: a qué panel aterriza una sesión que llega SIN destino
 * explícito — el `/auth/callback` de un magic link, y desde el 17-ago-2026
 * también la raíz `/`, que dejó de ser landing de marketing (esa vive en
 * likida.ai, otro proyecto) y ahora solo reparte.
 *
 * NO ES `inicioDe`, y la diferencia importa: `inicioDe` responde "a dónde
 * rebote a quien NO puede ver donde está parado" y por eso trabaja por área,
 * mandando al superadmin —que ve las tres— a /dashboard. Aquí la pregunta es
 * otra: cuál es la CASA de ese rol. La del superadmin es /admin, su consola de
 * negocio; /dashboard es el panel de un cliente y, sin flota elegida,
 * `requireSessionTenant` lo mandaría al selector.
 *
 * Solo decide el aterrizaje: quien no deba estar ahí lo rebota la puerta de
 * ese panel (`requireSuperadmin`, `requireSessionTenant` — que resuelve
 * también al `vendedor` y al rol sin fila). Esta función no autoriza nada.
 */
export function puertaDeEntrada(rol: string): string {
  return rol === 'superadmin' ? '/admin' : '/dashboard';
}
