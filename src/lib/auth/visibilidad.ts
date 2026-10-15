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
  // Los PATIOS (W2, 1-oct-2026): crear/editar/borrar los administra el dueño (se
  // re-comprueba `puedeAdministrar` adentro de cada acción); el jefe de tráfico
  // los VE para saber cuál es el suyo. Cero pesos en pantalla.
  '/dashboard/patios': 'operacion',
  // La puesta en marcha (W2): el checklist guiado con estado real. Cero pesos.
  '/dashboard/arranque': 'operacion',
  // La guía de arranque del chofer (W2): el número de WhatsApp de Likida, el
  // enlace wa.me, el QR y el flujo. No enseña un peso; su lector natural es el
  // jefe de tráfico.
  '/dashboard/whatsapp': 'operacion',
  // El registro de jornada (LFT 132 fr. XXXIV, mig. 0241). Es `operacion` y no
  // `dinero` por dos razones: no enseña un peso, y el usuario natural es el
  // jefe de tráfico —él sabe a qué hora salió cada quien y es el único que
  // puede corregirlo con conocimiento. Corregir, en cambio, exige
  // `puedeAdministrar`: mover la hora registrada de un trabajador es un acto
  // con consecuencia jurídica (LFT 805).
  '/dashboard/jornada': 'operacion',
  // El Registro de Unidades (14-ago-2026): el activo que produce el dinero y
  // sus vigencias de ley. Es `operacion` porque el jefe de tráfico es
  // exactamente quien debe enterarse de que una unidad no puede salir, y la
  // pantalla no enseña un peso.
  '/dashboard/unidades': 'operacion',
  // El mapa (F3): viajes vivos sobre México, sin un peso en pantalla.
  '/dashboard/mapa': 'operacion',
  // Viajes en vivo (Ola 3b, orquestador): todos los viajes en curso con su último hito, la posición del tractor y
  // su antigüedad, y las excepciones. Es del jefe de tráfico y no enseña un peso. Las tareas que el asistente deja
  // para una persona se atienden aquí (la acción exige `puedeAsignar`).
  '/dashboard/viajes-en-vivo': 'operacion',
  // Carta Porte (A3, 14-ago-2026): cero pesos en pantalla, y la declaración
  // de ruta ("¿pisa federal?") es del jefe de tráfico — la regla 2.7.7.2.1
  // exige plena certeza de quien CONOCE la ruta, no del que ve el dinero.
  '/dashboard/carta-porte': 'operacion',
  // Documentos de clientes grandes (Agente 3, mig. 0420): la bandeja donde una persona revisa lo que el agente
  // leyó de un PDF/foto/Excel/XML/correo. Mismo criterio que /dashboard/carta-porte: cero pesos del negocio y su
  // usuario diario es el jefe de tráfico. La revisión (/dashboard/carta-porte/documentos/<uuid>) es dinámica y se
  // gatea con esta llave.
  '/dashboard/carta-porte/documentos': 'operacion',
  // El Agente de Conductores (F4) es agente de operación: no toca un peso y
  // su usuario diario es el jefe de tráfico. Sus hermanos
  // (liquidación/facturas/cobranza) siguen en dinero.
  '/dashboard/agentes/conductores': 'operacion',
  // 0385: el catálogo de sitios y las estadías en andén del Agente 5 — operación, cero pesos en pantalla (el cobro va por el CSV de /v1/estadias).
  // 0580: los convenios de clientes (perfiles con instrucciones de operación). Operación: el jefe de tráfico las carga y
  // las exporta; la tarifa y los requisitos de cobro solo se leen y se pintan con el área de dinero (la página y la base
  // lo comprueban aparte).
  '/dashboard/convenios': 'operacion',
  '/dashboard/agentes/conductores/sitios': 'operacion',
  '/dashboard/agentes/conductores/estadias': 'operacion',
  // Ola 3: la configuración de flota del Agente 5 (escalera, ventana, tope, contactos, webhook). La ve la operación; solo el
  // dueño guarda (`puedeAdministrar`, comprobado en la acción de servidor).
  '/dashboard/agentes/conductores/configuracion': 'operacion',
  // El Vigía de servicio al cliente (Agente 4, 0400): su usuario diario es el gerente de
  // servicio (flota_admin y encargado). Cero pesos en pantalla; el contador no atiende
  // clientes y no ve chats de clientes (la 0400 también se lo niega en la base).
  '/dashboard/agentes/vigia': 'operacion',
  // 0484: grupos de clientes críticos, histórico exportado de WhatsApp y su reporte (FAQs, temas, tiempos). Cero pesos; solo el dueño sube/borra.
  '/dashboard/agentes/vigia/historial': 'operacion',
  // T-A4-07: la carga del programa de despacho (CSV del día). Operación, cero pesos; sube el dueño o el encargado (se comprueba en la acción).
  '/dashboard/agentes/vigia/programa': 'operacion',
  // T-A4-37: tablero de estatus de importación derivado del programa. Operación, cero pesos; solo lee el archivo que se sube.
  '/dashboard/agentes/vigia/importacion': 'operacion',
  // T-A4-22: la bandeja de avisos de viaje (confirmación humana antes de avisar al cliente). Operación, cero pesos; decide el dueño o el encargado (se comprueba en la acción).
  '/dashboard/agentes/vigia/avisos': 'operacion',
  // El Agente de Carta Porte (Fases B-C, 25-ago-2026): mismo criterio que su
  // pantalla /dashboard/carta-porte — cero pesos, y la declaración de ruta es
  // del jefe de tráfico. La página del borrador
  // (/dashboard/carta-porte/borrador/<uuid>) es dinámica y se gatea con la
  // llave de su padre, como /dashboard/<uuid> gatea su área a mano.
  '/dashboard/agentes/carta-porte': 'operacion',
  // El catálogo del cliente del Agente de Carta Porte (T-A3-22): productos (SKU → clave SAT), remitentes/destinatarios y el
  // número interno del cliente. Misma área que su agente: cero pesos, lo usa el jefe de tráfico.
  '/dashboard/agentes/carta-porte/catalogo': 'operacion',
  // La configuración de la salida del Agente de Carta Porte (T-A3-32): modo, reintentos, frecuencia, destinatarios y plantilla.
  // Cambia a quién se avisa y cómo sale lo que el agente arma: solo dueño/administrador, como las demás configuraciones.
  '/dashboard/agentes/carta-porte/configuracion': 'administracion',
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
  // 0564: el formato de la liquidación de la flota (columnas de su Excel de muestra, documento por WhatsApp, copia al jefe y aviso de discrepancia). Dinero a la vista; solo el dueño guarda (`administracion`, comprobado en cada acción).
  '/dashboard/agentes/liquidacion/formato': 'dinero',
  // T-A1-30: configuración de la entrega del desglose por correo (destinatarios, renglón de viaje, guardas). Dinero a la vista; solo el dueño guarda (`administracion`, comprobado en la acción).
  '/dashboard/agentes/liquidacion/configuracion': 'dinero',
  '/dashboard/agentes/facturas': 'dinero',
  // Cobranza de COMPROBANTES (0089): la página no enseña pesos, pero es la
  // cola del cierre contable — el dolor del contador — y opera al bloque
  // AGENTES completo. Si un día el jefe de tráfico debe perseguir
  // comprobantes, ese cambio lo decide Javier, no un prefijo.
  '/dashboard/agentes/cobranza': 'dinero',
  // El conciliador (F5): montos del estado de cuenta a la vista — dinero.
  '/dashboard/agentes/peajes': 'dinero',
  // La configuración del conciliador (Agente 2, 1-oct-2026): TAGs de telepeaje,
  // catálogo de casetas, geocercas, mapeo de columnas por proveedor y el buzón
  // firmado. Mismo área que la ventana del agente: dinero. La llave del buzón
  // se enseña solo con `administracion` (adentro de la página).
  '/dashboard/agentes/peajes/configuracion': 'dinero',
  // El reporte de reclamación (Agente 2, ola 3b): los cruces que el GPS no respalda, para pedir al proveedor la revisión del cobro. Montos por cruce — dinero. El desglose va en `?desglose=` (se busca CON el tenant de la sesión).
  '/dashboard/agentes/peajes/reclamacion': 'dinero',
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
  // DESCARGA DEL SAT (0231): se declara el RFC de un contribuyente y cada
  // solicitud consume el tope diario que ese RFC tiene ante el SAT. Es
  // `dinero` por lo mismo que Timbrado: papel fiscal con dinero adentro, y la
  // pantalla enseña qué gasto quedó facturado.
  '/dashboard/descarga-sat': 'dinero',
  // LA BANDEJA DE CONCILIACIÓN (0243). Ruta propia y no una sección de la de
  // arriba porque es OTRO trabajo: aquélla se declara una vez (el RFC, el
  // modo, la e.firma), ésta se abre a diario y se pagina. Y `dinero` por el
  // mismo motivo, subido de tono: aquí no solo se enseña qué gasto quedó
  // facturado — se DECIDE. Ligar un CFDI a un gasto es afirmar una deducción,
  // y el guarda de área es el molde de `export/poliza` tras el hallazgo
  // SEG-19-1: el jefe de tráfico no ve las cifras de dinero de la flota, así
  // que menos todavía las mueve.
  '/dashboard/descarga-sat/bandeja': 'dinero',
  // El cotizador (0225, A8): costos, márgenes y precio sugerido — la
  // definición misma de lo que el encargado no ve. Espejo de la RLS
  // `ve_finanzas()` que la 0051 le puso a `cotizacion`.
  '/dashboard/cotizaciones': 'dinero',
  // MIS REGLAS (A19, 0229): las vigilancias que la flota declara en lenguaje
  // natural. Es `dinero` porque quien las declara tiene que poder declarar las
  // de dinero —topes de gasto, facturas sin cobrar, comprobantes sin CFDI— y
  // la ficha de cada regla enseña sus montos. Que algunas manden su aviso al
  // jefe de tráfico (las de operación: papeles, estadías, incidencias) no
  // cambia quién las DECLARA: el canal del aviso lo decide la plantilla
  // (`canal` en reglas/catalogo.ts), no esta llave.
  '/dashboard/reglas': 'dinero',
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
  // Integraciones: fusionada en Conexiones (agosto-2026). La ruta sobrevive
  // como REDIRECT —hay enlaces guardados y correos que apuntan aquí— y por eso
  // sigue declarada: una ruta sin área es una ruta que `puedeVerRuta` no sabe
  // gatear, y aunque el destino vuelva a comprobar, dejarla huérfana rompería
  // la invariante de que toda ruta del panel tiene dueño.
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
  // Términos, Aviso y MANDATO de autofacturación de la flota (0443, auditoría ola 1
  // #48): lo acepta y lo otorga quien obliga a la empresa — el dueño.
  '/dashboard/legal': 'administracion',
  // Sesiones MCP (H3, auditoría de dashboards 29-ago-2026): los accesos que
  // Claude/ChatGPT tienen a los datos de la flota vía OAuth (0260). MISMO
  // criterio que las llaves de API, porque es la MISMA clase de cosa: una
  // credencial que lee desde fuera del panel, sin sesión. Aquí se ven y se
  // cortan los de OTRA persona, y eso es del dueño. Las PROPIAS las corta
  // cada quien —contador y encargado incluidos— desde /dashboard/mi-perfil,
  // que es RUTAS_TODO_ROL: por eso son dos rutas y no una con excepciones
  // (este mapa asigna UN área por ruta a propósito).
  '/dashboard/sesiones-mcp': 'administracion',
  // Los hilos de WhatsApp de la flota (auditoría 20, H6). Es `administracion`
  // y NO `operacion`, aunque el interlocutor sea el chofer: en esa
  // conversación el bot dicta montos comprobados y diferencias de
  // liquidación, y el jefe de tráfico no ve el dinero de la flota. Un hilo de
  // WhatsApp es dinero en prosa, y `dinero_por_area.test.ts` no lo atraparía
  // porque no hay un `mxn(` en la página: las cifras vienen en los datos.
  // Tampoco `dinero`: el contador no tiene por qué leer la conversación
  // personal de un trabajador. Queda con el dueño, que es de quien es el dato.
  '/dashboard/conversaciones': 'administracion',
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

// ═══════════════════════════════════════════════════════════════════════════
// PERFIL DE TENANT `cinco_agentes` (mig. 0770) — la LISTA CERRADA.
//
// Un tenant con fila en `tenant_perfil` solo ve y solo puede operar lo que está
// aquí; TODO lo demás (el «stand-by») queda oculto e inoperante, sin borrarse.
// SIN FILA el tenant se comporta como siempre.
//
// ESTA ES LA ÚNICA LISTA QUE SE EDITA para ampliar o recortar el perfil de
// páginas. Las acciones de servidor, la API /v1, los exports, el chat, el MCP
// y los crons tienen sus listas hermanas más abajo (mismo perfil, mismo
// archivo, a propósito: una sola revisión en un solo lugar).
//
// FALLA CERRADO: lo que no está declarado se niega. Una pantalla nueva que
// nadie clasifique NO aparece en el perfil (el error caro es mostrar de más).
// `perfil_tenant.test.ts` exige que toda ruta de `AREA_POR_RUTA` esté o aquí o
// en `RUTAS_STAND_BY_PERFIL_CINCO_AGENTES`, para que "no la clasifiqué" sea una
// prueba roja y no un olvido silencioso.
//
// El perfil SOLO QUITA, nunca da: se aplica encima del rol (`puedeVerRuta`), así
// que el resultado es siempre un subconjunto de lo que el rol ya podía ver.
// ═══════════════════════════════════════════════════════════════════════════

/** Perfiles de tenant que conoce el código (dominio cerrado, igual que el CHECK de la 0770). */
export type PerfilTenant = 'cinco_agentes';

export const PERFILES_TENANT: readonly PerfilTenant[] = ['cinco_agentes'];

/** A qué agente (o a la base mínima) pertenece cada ruta permitida. */
export type ModuloPerfil = 'liquidacion' | 'peajes' | 'carta_porte' | 'vigia' | 'conductor' | 'base';

export const RUTAS_PERFIL_CINCO_AGENTES: Readonly<Record<string, ModuloPerfil>> = {
  // A1 · Liquidación. El detalle de una liquidación (`/dashboard/<uuid>`) es la
  // revisión de lo que el agente cuadró; se normaliza a '/dashboard/[id]'.
  '/dashboard/agentes/liquidacion': 'liquidacion',
  '/dashboard/agentes/liquidacion/formato': 'liquidacion',
  // Integración Liquidación + perfil: la configuración del agente es suya.
  '/dashboard/agentes/liquidacion/configuracion': 'liquidacion',
  '/dashboard/[id]': 'liquidacion',
  // A2 · Peajes.
  '/dashboard/agentes/peajes': 'peajes',
  '/dashboard/agentes/peajes/configuracion': 'peajes',
  '/dashboard/agentes/peajes/reclamacion': 'peajes',
  // A3 · Carta Porte (el borrador y la revisión de documentos cuelgan de estas
  // dos llaves: sus páginas dinámicas gatean con la de su padre).
  '/dashboard/agentes/carta-porte': 'carta_porte',
  '/dashboard/agentes/carta-porte/catalogo': 'carta_porte',
  '/dashboard/agentes/carta-porte/configuracion': 'carta_porte',
  '/dashboard/carta-porte': 'carta_porte',
  '/dashboard/carta-porte/documentos': 'carta_porte',
  // A4 · Vigía de servicio al cliente.
  '/dashboard/agentes/vigia': 'vigia',
  '/dashboard/agentes/vigia/historial': 'vigia',
  // Integración Vigía + perfil: las tres pantallas del Vigía (programa de despacho, importación, avisos) son suyas, no de otro frente.
  '/dashboard/agentes/vigia/programa': 'vigia',
  '/dashboard/agentes/vigia/importacion': 'vigia',
  '/dashboard/agentes/vigia/avisos': 'vigia',
  // A5 · Conductor (comunicación con operadores, hitos, estadías y su mapa).
  '/dashboard/agentes/conductores': 'conductor',
  '/dashboard/agentes/conductores/sitios': 'conductor',
  '/dashboard/agentes/conductores/estadias': 'conductor',
  '/dashboard/agentes/conductores/configuracion': 'conductor',
  '/dashboard/viajes-en-vivo': 'conductor',
  '/dashboard/mapa': 'conductor',
  // Base mínima: lo que los cinco necesitan para operar (viajes, operadores,
  // unidades, conexiones al sistema del cliente, WhatsApp) y lo de la persona.
  '/dashboard': 'base',
  '/dashboard/despacho': 'base',
  '/dashboard/viajes': 'base',
  '/dashboard/operadores': 'base',
  '/dashboard/unidades': 'base',
  '/dashboard/conexiones': 'base',
  '/dashboard/integraciones': 'base',
  '/dashboard/whatsapp': 'base',
  '/dashboard/notificaciones': 'base',
  '/dashboard/mi-perfil': 'base',
  '/dashboard/soporte': 'base',
  '/dashboard/legal': 'base',
};

/**
 * El STAND-BY, escrito a propósito: lo que existe en el producto y el perfil
 * oculta e inhabilita (sin borrar). No decide nada en runtime —el runtime es
 * "no está en la lista permitida, se niega"—; existe para que la prueba pueda
 * exigir que CADA ruta conocida esté clasificada en un lado u otro y para que
 * quien lea sepa que lo ausente de arriba es deliberado y no un descuido.
 */
export const RUTAS_STAND_BY_PERFIL_CINCO_AGENTES: readonly string[] = [
  '/dashboard/chat', '/dashboard/reglas', '/dashboard/rentabilidad', '/dashboard/clientes',
  '/dashboard/facturacion', '/dashboard/agentes/cobranza', '/dashboard/agentes/facturas',
  '/dashboard/agentes/proveedores', '/dashboard/huerfanos', '/dashboard/combustible-casetas',
  '/dashboard/timbrado', '/dashboard/descarga-sat', '/dashboard/descarga-sat/bandeja',
  '/dashboard/cotizaciones', '/dashboard/contador', '/dashboard/conocimiento',
  '/dashboard/convenios', '/dashboard/jornada', '/dashboard/patios', '/dashboard/asistencia',
  '/dashboard/emergencias', '/dashboard/arranque', '/dashboard/onboarding',
  '/dashboard/suscripcion', '/dashboard/llaves-api', '/dashboard/sesiones-mcp',
  '/dashboard/politicas', '/dashboard/usuarios', '/dashboard/arco', '/dashboard/configuracion',
  '/dashboard/conversaciones',
];

/**
 * La llave con la que una ruta se busca en las listas del perfil: quita query y
 * barra final, y las dinámicas conocidas (`/dashboard/<uuid>`, el detalle de
 * liquidación) se pliegan a su llave `[id]`. Cualquier otra cosa queda tal cual
 * y, si no está en la lista, se niega.
 */
export function claveRutaPerfil(href: string): string {
  const limpio = href.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (/^\/dashboard\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(limpio)) {
    return '/dashboard/[id]';
  }
  return limpio;
}

/** ¿Esta ruta está en la lista cerrada del perfil? Fail closed: perfil desconocido o ruta no declarada → no. */
export function rutaPermitidaEnPerfil(perfil: PerfilTenant | string, href: string): boolean {
  if (perfil !== 'cinco_agentes') return false;
  return Object.prototype.hasOwnProperty.call(RUTAS_PERFIL_CINCO_AGENTES, claveRutaPerfil(href));
}

// ═══════════════════════════════════════════════════════════════════════════
// «PRÓXIMAMENTE» DENTRO DEL PERFIL — FASE 1 (decisión del 15-oct-2026).
//
// El perfil `cinco_agentes` conserva su significado (la lista cerrada de arriba).
// Dentro de ella, los módulos de `MODULOS_PROXIMAMENTE_PERFIL` están en FASE 2:
//   · SE VEN en el menú con la etiqueta «Próximamente» (siguen en
//     `RUTAS_PERFIL_CINCO_AGENTES`, así que `rutaPermitidaEnPerfil` y
//     `puedeVerRuta` los dejan ver),
//   · pero NO se operan: su página real no se sirve (`exigirRutaDePerfil` manda a
//     la pantalla «Próximamente», sin datos ni acciones), y sus APIs, crons, chat
//     y MCP siguen apagados (`API_PROXIMAMENTE_PERFIL`, `CRONS_PROXIMAMENTE_PERFIL`).
//
// Encender la fase 2 para un tenant = sacar el módulo de esta lista (el código de
// A4/A5 sigue construyéndose en sus ramas y viaja sin borrar nada).
// ═══════════════════════════════════════════════════════════════════════════

/** Módulos del perfil que se muestran pero no se operan todavía. */
export const MODULOS_PROXIMAMENTE_PERFIL: readonly ModuloPerfil[] = ['vigia', 'conductor'];

/** El módulo al que pertenece una ruta del perfil, o `null` si no está en la lista cerrada. */
export function moduloDeRutaPerfil(perfil: PerfilTenant | string, href: string): ModuloPerfil | null {
  if (!rutaPermitidaEnPerfil(perfil, href)) return null;
  return RUTAS_PERFIL_CINCO_AGENTES[claveRutaPerfil(href)];
}

/** El módulo «próximamente» de una ruta (`vigia` | `conductor`), o `null` si la ruta es operable, ajena o sin perfil. */
export function moduloProximamenteDeRuta(perfil: PerfilTenant | string, href: string): ModuloPerfil | null {
  const m = moduloDeRutaPerfil(perfil, href);
  return m !== null && MODULOS_PROXIMAMENTE_PERFIL.includes(m) ? m : null;
}

/** ¿Esta ruta se muestra bajo el perfil pero está bloqueada como «Próximamente»? */
export function rutaProximamenteEnPerfil(perfil: PerfilTenant | string, href: string): boolean {
  return moduloProximamenteDeRuta(perfil, href) !== null;
}

/** ¿Esta ruta se puede OPERAR bajo el perfil? (permitida Y no «próximamente»). */
export function rutaOperativaEnPerfil(perfil: PerfilTenant | string, href: string): boolean {
  return rutaPermitidaEnPerfil(perfil, href) && !rutaProximamenteEnPerfil(perfil, href);
}

/** La pantalla única «Próximamente» de un módulo (la sirve `/dashboard/proximamente/[modulo]`). */
export function rutaProximamente(modulo: ModuloPerfil): string {
  return `/dashboard/proximamente/${modulo}`;
}

/**
 * Superficies de API que el perfil deja vivas, por PRIMER segmento bajo su raíz.
 * Todo segmento que no esté aquí se niega (falla cerrado) — incluida una ruta
 * nueva que se agregue mañana. Mismo criterio para las tres raíces.
 *
 *  · /api/v1/<recurso>  — los recursos de los cinco agentes y la base.
 *  · /api/export/<x>    — las descargas de los cinco agentes.
 *  · /api/dashboard/<x> — solo lo que no abre una puerta a lo demás: el chat,
 *    la ingesta de comprobantes, el chat de onboarding y el historial del chat
 *    quedan fuera (son del stand-by).
 */
export const API_PERFIL_CINCO_AGENTES: Readonly<Record<'v1' | 'export' | 'dashboard', readonly string[]>> = {
  v1: [
    'liquidaciones', 'liquidaciones-externas', // A1
    'peajes',                                   // A2
    'viajes', 'operadores', 'unidades',         // base
  ],
  export: [
    'liquidaciones', 'liquidaciones-externas', 'pdf', // A1
    'bitacora-peaje', 'bitacora-conciliada', 'peajes-reclamacion', 'peajes-revision', // A2
    'carta-porte-docs', 'carta-porte-xml',      // A3
  ],
  dashboard: [
    'evento', // el pageview del panel: cero datos, 204 siempre
  ],
};

/**
 * Superficies de API de los módulos «próximamente» (A4 y A5): existen, el perfil
 * las NIEGA hasta que el módulo se encienda. Mismo criterio que la lista de arriba.
 */
export const API_PROXIMAMENTE_PERFIL: Readonly<Record<'v1' | 'export' | 'dashboard', readonly string[]>> = {
  v1: ['hitos', 'estadias', 'sitios', 'conductor', 'evidencias'], // A5
  export: ['vigia-faqs'],                                          // A4
  dashboard: [],
};

/** ¿Esta ruta de API (`/api/v1/...`, `/api/export/...`, `/api/dashboard/...`) sigue viva bajo el perfil? */
export function apiPermitidaEnPerfil(perfil: PerfilTenant | string, pathname: string): boolean {
  if (perfil !== 'cinco_agentes') return false;
  const m = /^\/api\/(v1|export|dashboard)\/([^/?#]+)/.exec(pathname);
  if (!m) return false;
  return API_PERFIL_CINCO_AGENTES[m[1] as 'v1' | 'export' | 'dashboard'].includes(m[2]);
}

/**
 * Crons que SIGUEN corriendo para una flota con perfil (los de los cinco
 * agentes y la plomería compartida). Todo cron que no esté aquí SALTA los
 * tenants con perfil. Por nombre de ruta (`/api/cron/<nombre>`).
 */
export const CRONS_PERFIL_CINCO_AGENTES: readonly string[] = [
  'liquidaciones-externas', // A1: jala liquidaciones del sistema del cliente
  'peajes',                  // A2
  'carta-porte-docs',        // A3
  'gps',                     // sincroniza posiciones/eventos del proveedor del cliente (solo entrada de datos; no manda nada a nadie)
  // `escalar` es MIXTO: la escalación del conductor (A5, «próximamente»), la cobranza, los relojes
  // legales de incidencias y las reglas (stand-by) se saltan flotas con perfil por sección.
  'escalar',
  'wa-pendientes', 'wa-outbox', 'purgar', 'guardia', // plomería compartida
];

/**
 * Crons de los módulos «próximamente»: NO corren para flotas con perfil (cada uno
 * filtra por `tenantsConPerfilASaltar` en su ruta). Siguen corriendo para el resto.
 */
export const CRONS_PROXIMAMENTE_PERFIL: readonly string[] = ['vigia', 'conductor-hitos'];

/** Toda ruta que el mapa de áreas conoce — para las pruebas que exigen que cada una esté clasificada en el perfil. */
export function rutasConocidas(): string[] {
  return Object.keys(AREA_POR_RUTA);
}

export function areaDeRuta(href: string): Area | undefined {
  return AREA_POR_RUTA[href];
}

export function puedeVerRuta(rol: string, href: string, perfil?: PerfilTenant | null): boolean {
  // EL PERFIL DE LA FLOTA SOLO QUITA (0770): se evalúa ANTES del rol y, si la
  // ruta no está en la lista cerrada del perfil, se niega aunque el rol la
  // vería. Sin perfil (`undefined`/`null`) esta línea no hace nada y la función
  // se comporta exactamente como antes.
  if (perfil && !rutaPermitidaEnPerfil(perfil, href)) return false;
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
