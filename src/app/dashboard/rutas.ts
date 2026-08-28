import {
  LayoutGrid, MessageCircle, Route, ReceiptText, LifeBuoy, Settings, CreditCard, ClipboardList,
  BellRing, Truck, Users, FileQuestion, Map, MessagesSquare, Scale, Fuel, Building2, Plug,
  // `Blocks` se fue con la entrada de «Integraciones», fusionada en Conexiones.
  ChartNoAxesCombined, UserRound, BookOpen, Container, Handshake, FileText, KeyRound,
  ScrollText,
  UsersRound,
  ShieldCheck,
  Siren,
  RadioTower,
  Calculator,
  Stamp,
  ScanEye,
  CloudDownload,
  CalendarClock,
} from 'lucide-react';

/**
 * El mapa de navegación de /dashboard — REESCRITO desde cero el
 * 13-ago-2026 con la estructura que fijó
 * Javier: categorías (AGENTES / OPERACIÓN / DINERO Y FISCAL / SISTEMA) y
 * un bloque inferior fijo con su propio fondo (Soporte y Configuración).
 *
 * Las listas de las páginas viejas (SIDEBAR_PRINCIPAL, NEGOCIO, FISCAL,
 * GESTION) se fueron con este rewrite — "las páginas borradas ya no
 * sirven, empezaremos desde cero". Cada categoría se llena conforme sus
 * páginas se construyen; una categoría vacía no se pinta (un encabezado
 * sin items le anuncia al usuario lo que no existe).
 */
export type Item = { href: string; nombre: string; Icono: typeof LayoutGrid };

/** Las automatizaciones de Likida — nombradas por la TAREA que le quitan al
 *  cliente, no por la tecnología (auditoría 5, 17-ago-2026: el jefe de
 *  tráfico no compra seis agentes; compra liquidar viajes). "Agentes" como
 *  concepto vive en /admin: es arquitectura nuestra, no modelo mental del
 *  cliente. Las RUTAS no cambian — solo el lenguaje. */
export const AUTOMATIZACIONES: Item[] = [
  { href: '/dashboard/agentes/liquidacion', nombre: 'Liquidación automática', Icono: Route },
  { href: '/dashboard/agentes/facturas', nombre: 'Facturas en automático', Icono: ReceiptText },
  // Fase 1 del plan (14-ago-2026): cobra COMPROBANTES, no dinero.
  { href: '/dashboard/agentes/cobranza', nombre: 'Seguimiento de comprobantes', Icono: BellRing },
  // F4: habla con los choferes — avisos, hitos, despacho por WA.
  { href: '/dashboard/agentes/conductores', nombre: 'Comunicación con operadores', Icono: MessagesSquare },
  // F5: el conciliador del "martirio" — estado de cuenta del TAG/monedero
  // contra los gastos reales de los viajes.
  { href: '/dashboard/agentes/peajes', nombre: 'Conciliación de peajes', Icono: Scale },
  // F6: la factura del taller que hoy se captura a mano en el ERP.
  { href: '/dashboard/agentes/proveedores', nombre: 'Facturas de proveedores', Icono: Building2 },
  // Fases B-C del blueprint de Carta Porte (25-ago-2026): al despachar,
  // pregunta por WhatsApp lo que falta declarar y arma el borrador validado.
  { href: '/dashboard/agentes/carta-porte', nombre: 'Carta Porte en automático', Icono: ScrollText },
];

export const OPERACION: Item[] = [
  { href: '/dashboard/despacho', nombre: 'Despacho', Icono: ClipboardList },
  // El Registro (F2): la fuente de verdad navegable. Acción en Despacho;
  // aquí se consulta y se cruza.
  { href: '/dashboard/viajes', nombre: 'Viajes', Icono: Truck },
  { href: '/dashboard/operadores', nombre: 'Operadores', Icono: Users },
  // El registro que la LFT 132 fr. XXXIV obliga a llevar desde el decreto del
  // 01-may-2026 (mig. 0241). Se llama «Jornada» y no «Cumplimiento laboral» a
  // propósito: Likida registra y avisa, no certifica que la flota cumpla.
  { href: '/dashboard/jornada', nombre: 'Jornada', Icono: CalendarClock },
  // El activo que produce el dinero, con sus vigencias de ley (14-ago-2026).
  { href: '/dashboard/unidades', nombre: 'Unidades', Icono: Container },
  // F3: los viajes vivos sobre México — trayecto ilustrativo, sin GPS, y la
  // página lo declara. La /dashboard/mapa vieja (borrada el 10-ago) no
  // dibujaba nada; esta dibuja lo que SÍ es verdad.
  { href: '/dashboard/mapa', nombre: 'Mapa', Icono: Map },
  // A3 (auditoría 4, 14-ago-2026): por viaje en curso, si necesita el
  // complemento y qué dato falta — partido 19 del cliente / 18 del
  // transportista, que es como la ley parte la responsabilidad.
  { href: '/dashboard/carta-porte', nombre: 'Carta Porte', Icono: ScrollText },
  // Fase 5: el directorio que el escalamiento de emergencias consulta — la
  // grúa, la póliza con su 800 de siniestros y los contactos del operador.
  { href: '/dashboard/emergencias', nombre: 'Emergencias', Icono: Siren },
  // Capa F del agente de ayuda en ruta: las incidencias vivas con su timeline
  // y los botones de intervención — el humano siempre puede tomar el control.
  { href: '/dashboard/asistencia', nombre: 'Mesa de control', Icono: RadioTower },
];

export const DINERO_FISCAL: Item[] = [
  // La bandeja de la oficina (F2): montos a la vista, o sea `dinero`.
  { href: '/dashboard/huerfanos', nombre: 'Comprobantes sin viaje', Icono: FileQuestion },
  // La MESA de conciliación línea a línea. Existía desde antes del rewrite
  // del sidebar y quedó alcanzable solo por URL — F5 la devuelve al menú
  // porque el Agente de Peajes manda gente a resolver aquí.
  { href: '/dashboard/combustible-casetas', nombre: 'Combustible y casetas', Icono: Fuel },
  // F7: margen real y cartera de clientes. La pantalla dice qué la enciende
  // mientras `ingreso_flete` y `factura_emitida` sigan vacías.
  { href: '/dashboard/rentabilidad', nombre: 'Rentabilidad y cobranza', Icono: ChartNoAxesCombined },
  // El lado del ingreso: quién paga el flete y cuánto debe.
  { href: '/dashboard/clientes', nombre: 'Clientes y tarifas', Icono: Handshake },
  // A8 (27-ago-2026): la ganancia real ANTES de aceptar el viaje — costos
  // declarados + casetas MEDIDAS en los viajes liquidados de la ruta.
  { href: '/dashboard/cotizaciones', nombre: 'Cotizador', Icono: Calculator },
  { href: '/dashboard/facturacion', nombre: 'Facturación a clientes', Icono: FileText },
  // 0227 (auditoría Fable c6-3): el botón que EMITE el CFDI con complemento
  // Carta Porte. Estaba dentro del borrador, que es `operacion` — así que el
  // jefe de tráfico podía timbrar y el contador ni siquiera llegaba. Aquí es
  // donde le toca vivir: es papel fiscal con el flete adentro.
  { href: '/dashboard/timbrado', nombre: 'Timbrado (Carta Porte)', Icono: Stamp },
  // A19 (27-ago-2026): las vigilancias que el dueño o el contador declaran
  // escribiéndolas en español. Va en DINERO porque ahí es donde se declaran
  // los topes de gasto y la cartera vencida; el canal de cada aviso lo decide
  // la plantilla, no el menú.
  { href: '/dashboard/reglas', nombre: 'Mis reglas', Icono: ScanEye },
  // 0231: los CFDI que el comercio YA timbró al RFC de la flota, bajados del
  // buzón del SAT y cruzados solos contra el ticket. Va en DINERO porque
  // declara un RFC, consume el tope diario de ese contribuyente ante el SAT y
  // deja gastos facturados.
  { href: '/dashboard/descarga-sat', nombre: 'Descarga del SAT', Icono: CloudDownload },
];

export const SISTEMA: Item[] = [
  // El corpus de `normas/` consultable: de dónde sale el fundamento de cada
  // cifra fiscal, con su estado de verificación a la vista.
  { href: '/dashboard/conocimiento', nombre: 'Conocimiento normativo', Icono: BookOpen },
  // F7 (chasis de agentes): la salud MEDIDA de cada conector de la flota, el
  // catálogo de sistemas y la captura de accesos — las tres en una pantalla.
  //
  // «Integraciones» ERA una entrada aparte y se quitó del menú en agosto-2026:
  // contestaba la misma pregunta que ésta con otra consulta y otro texto, y dos
  // renglones del sidebar para un solo trabajo obligan a adivinar cuál abrir.
  // La ruta sigue viva como redirect (los enlaces guardados no se rompen), pero
  // no se ofrece dos veces.
  { href: '/dashboard/conexiones', nombre: 'Conexiones', Icono: Plug },
  // A6 (auditoría 4, 14-ago-2026): la emisión y revocación de las llaves de
  // /v1. El openapi prometía "se emite desde el panel" sin que el panel
  // existiera — `tenant_api_key` no tenía un solo INSERT en src/.
  { href: '/dashboard/llaves-api', nombre: 'Llaves de API', Icono: KeyRound },
  // Las tres huérfanas del sidebar (16-ago-2026): existían en AREA_POR_RUTA
  // pero no aquí — el dueño no llegaba a ellas navegando, solo tecleando la
  // URL. `puedeVerRuta` sigue decidiendo quién las ve (usuarios/políticas
  // son administracion: solo el dueño; ARCO es operacion).
  { href: '/dashboard/usuarios', nombre: 'Usuarios del equipo', Icono: UsersRound },
  { href: '/dashboard/onboarding', nombre: 'Perfil de la flota', Icono: ClipboardList },
  { href: '/dashboard/politicas', nombre: 'Políticas de gasto', Icono: Scale },
  { href: '/dashboard/arco', nombre: 'Solicitudes ARCO', Icono: ShieldCheck },
];

/** El bloque INFERIOR fijo (Soporte / Configuración),
 *  con fondo propio — las dos páginas existen desde antes del rediseño. */
export const ABAJO: Item[] = [
  // El "alertas primero" con página propia (14-ago-2026). Vive
  // abajo y no en una categoría porque no es un área del negocio: es la
  // bandeja de lo que hoy te toca, cruzada de todas las áreas que tu rol ve.
  { href: '/dashboard/notificaciones', nombre: 'Notificaciones', Icono: BellRing },
  { href: '/dashboard/mi-perfil', nombre: 'Mi perfil', Icono: UserRound },
  { href: '/dashboard/soporte', nombre: 'Centro de ayuda', Icono: LifeBuoy },
  // Suscripción vive aquí y no en una categoría: es el plan de la cuenta, no
  // un área del negocio, y nada debe ser alcanzable solo tecleando URL. Fue
  // el aterrizaje del contador mientras su panel estuvo borrado (10→14-ago-
  // 2026); hoy `inicioDe` lo manda a /dashboard/contador, cuyo link de
  // Resumen lo pinta el sidebar directamente (sidebar-nav.tsx).
  { href: '/dashboard/suscripcion', nombre: 'Plan y facturación', Icono: CreditCard },
  { href: '/dashboard/configuracion', nombre: 'Configuración', Icono: Settings },
];

/** Lista plana — punto de extensión del ⌘K de este panel. */
export const TODAS_LAS_RUTAS: Item[] = [
  { href: '/dashboard', nombre: 'Resumen', Icono: LayoutGrid },
  // El chat vive a PRIMER NIVEL del sidebar (no en una categoría) desde el
  // 17-ago-2026 — pero el ⌘K lo sigue necesitando aquí.
  { href: '/dashboard/chat', nombre: 'Pregunta a tus datos', Icono: MessageCircle },
  ...OPERACION, ...DINERO_FISCAL, ...AUTOMATIZACIONES, ...SISTEMA, ...ABAJO,
];
