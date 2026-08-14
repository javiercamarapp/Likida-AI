import {
  LayoutGrid, MessageCircle, Route, ReceiptText, LifeBuoy, Settings, CreditCard, ClipboardList,
  BellRing, Truck, Users, FileQuestion, Map, MessagesSquare, Scale, Fuel, Building2, Plug,
  ChartNoAxesCombined, UserRound, BookOpen, Container, Blocks, Handshake, FileText, KeyRound,
  ScrollText,
} from 'lucide-react';

/**
 * El mapa de navegación de /dashboard — REESCRITO desde cero el
 * 13-ago-2026 con la estructura de la referencia usehandle.ai que fijó
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

/** Los agentes de Likida — cada página es la ventana de un agente que
 *  trabaja solo: qué hizo, qué trae en cola, qué necesita de un humano. */
export const AGENTES: Item[] = [
  // El rótulo del sidebar es más corto que el título de la página (Agente de
  // Liquidación de Ruta) a propósito — 13-ago: "que el nombre no se corte".
  { href: '/dashboard/agentes/liquidacion', nombre: 'Agente de Liquidación', Icono: Route },
  { href: '/dashboard/agentes/facturas', nombre: 'Agente de Facturas', Icono: ReceiptText },
  // El tercero (Fase 1 del plan, 14-ago-2026): cobra COMPROBANTES, no dinero.
  { href: '/dashboard/agentes/cobranza', nombre: 'Agente de Cobranza', Icono: BellRing },
  // El cuarto (F4): habla con los choferes — avisos, hitos, despacho por WA.
  { href: '/dashboard/agentes/conductores', nombre: 'Agente de Conductores', Icono: MessagesSquare },
  // El quinto (F5): el conciliador del "martirio" — estado de cuenta del
  // TAG/monedero contra los gastos reales de los viajes.
  { href: '/dashboard/agentes/peajes', nombre: 'Agente de Peajes', Icono: Scale },
  // El sexto (F6): la factura del taller que hoy se captura a mano en el ERP.
  { href: '/dashboard/agentes/proveedores', nombre: 'Agente de Proveedores', Icono: Building2 },
];

export const OPERACION: Item[] = [
  { href: '/dashboard/despacho', nombre: 'Despacho', Icono: ClipboardList },
  // El Registro (F2): la fuente de verdad navegable. Acción en Despacho;
  // aquí se consulta y se cruza.
  { href: '/dashboard/viajes', nombre: 'Viajes', Icono: Truck },
  { href: '/dashboard/operadores', nombre: 'Operadores', Icono: Users },
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
  { href: '/dashboard/facturacion', nombre: 'Facturación a clientes', Icono: FileText },
];

export const SISTEMA: Item[] = [
  { href: '/dashboard/chat', nombre: 'Chatea con tus datos', Icono: MessageCircle },
  // El corpus de `normas/` consultable: de dónde sale el fundamento de cada
  // cifra fiscal, con su estado de verificación a la vista.
  { href: '/dashboard/conocimiento', nombre: 'Conocimiento normativo', Icono: BookOpen },
  // F7 (chasis Handle): la salud MEDIDA de cada conector de la flota.
  { href: '/dashboard/conexiones', nombre: 'Conexiones', Icono: Plug },
  // La otra mitad del chasis: los SISTEMAS del cliente (ERP, GPS, TAG), contra
  // las CREDENCIALES que vive en Conexiones. Handle separa igual las dos.
  { href: '/dashboard/integraciones', nombre: 'Integraciones', Icono: Blocks },
  // A6 (auditoría 4, 14-ago-2026): la emisión y revocación de las llaves de
  // /v1. El openapi prometía "se emite desde el panel" sin que el panel
  // existiera — `tenant_api_key` no tenía un solo INSERT en src/.
  { href: '/dashboard/llaves-api', nombre: 'Llaves de API', Icono: KeyRound },
];

/** El bloque INFERIOR fijo (referencia Handle: Help Center / Settings),
 *  con fondo propio — las dos páginas existen desde antes del rediseño. */
export const ABAJO: Item[] = [
  // El "alertas primero" de Handle con página propia (14-ago-2026). Vive
  // abajo y no en una categoría porque no es un área del negocio: es la
  // bandeja de lo que hoy te toca, cruzada de todas las áreas que tu rol ve.
  { href: '/dashboard/notificaciones', nombre: 'Notificaciones', Icono: BellRing },
  { href: '/dashboard/mi-perfil', nombre: 'Mi perfil', Icono: UserRound },
  { href: '/dashboard/soporte', nombre: 'Centro de ayuda', Icono: LifeBuoy },
  // Suscripción vive aquí y no en una categoría: es la casa de aterrizaje
  // del contador (inicioDe) y nada debe ser alcanzable solo tecleando URL.
  { href: '/dashboard/suscripcion', nombre: 'Plan y facturación', Icono: CreditCard },
  { href: '/dashboard/configuracion', nombre: 'Configuración', Icono: Settings },
];

/** Lista plana — punto de extensión del ⌘K de este panel. */
export const TODAS_LAS_RUTAS: Item[] = [
  { href: '/dashboard', nombre: 'Resumen', Icono: LayoutGrid },
  ...AGENTES, ...OPERACION, ...DINERO_FISCAL, ...SISTEMA, ...ABAJO,
];
