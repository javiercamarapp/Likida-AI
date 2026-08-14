import {
  LayoutGrid, MessageCircle, Route, ReceiptText, LifeBuoy, Settings, CreditCard, ClipboardList,
  BellRing, Truck, Users, FileQuestion, Map, MessagesSquare,
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
];

export const OPERACION: Item[] = [
  { href: '/dashboard/despacho', nombre: 'Despacho', Icono: ClipboardList },
  // El Registro (F2): la fuente de verdad navegable. Acción en Despacho;
  // aquí se consulta y se cruza.
  { href: '/dashboard/viajes', nombre: 'Viajes', Icono: Truck },
  { href: '/dashboard/operadores', nombre: 'Operadores', Icono: Users },
  // F3: los viajes vivos sobre México — trayecto ilustrativo, sin GPS, y la
  // página lo declara. La /dashboard/mapa vieja (borrada el 10-ago) no
  // dibujaba nada; esta dibuja lo que SÍ es verdad.
  { href: '/dashboard/mapa', nombre: 'Mapa', Icono: Map },
];

export const DINERO_FISCAL: Item[] = [
  // La bandeja de la oficina (F2): montos a la vista, o sea `dinero`.
  { href: '/dashboard/huerfanos', nombre: 'Comprobantes sin viaje', Icono: FileQuestion },
];

export const SISTEMA: Item[] = [
  { href: '/dashboard/chat', nombre: 'Chatea con tus datos', Icono: MessageCircle },
];

/** El bloque INFERIOR fijo (referencia Handle: Help Center / Settings),
 *  con fondo propio — las dos páginas existen desde antes del rediseño. */
export const ABAJO: Item[] = [
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
