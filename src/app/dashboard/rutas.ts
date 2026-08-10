import {
  LayoutGrid, Fuel, ReceiptText, FileText, Landmark,
  LifeBuoy, Users, ScrollText, Settings, TriangleAlert, CreditCard, Percent, ShieldCheck,
} from 'lucide-react';

/**
 * El mapa de navegación de /dashboard — mismo patrón que admin/rutas.ts
 * (plano, sin 'use client': lo consume el sidebar client y, si algún día
 * hace falta, un ⌘K de este panel también).
 *
 * INICIO/OPERACION/DOCUMENTOS_DINERO/SIDEBAR_PRINCIPAL quedaron VACÍOS el
 * 10-ago-2026: las 17 páginas de "dueño de flota" (despacho, viajes,
 * incidencias, operadores, cuadre, facturación, cobranza, valor y ahorro,
 * unidades, POD, analítica, chat, rentabilidad, clientes, mapa, cotizador,
 * documentos) se borraron para rehacerse desde cero, pensando en cómo las
 * usa cada tipo de cliente — no es un hueco, es la salida de pista. El
 * catálogo de qué función de datos respaldaba a cada una vive en
 * `docs/conocimiento/41-inventario-dueno-flota-pre-rediseno.md`, y esa
 * lógica SIGUE en `lib/likida/*` sin tocar — lo que se fue es la página.
 * NEGOCIO conserva `combustible-casetas` (no era parte de esas 17). FISCAL
 * (panel del contador) y GESTION (cuenta/cumplimiento — ARCO, Soporte,
 * Usuarios, Políticas, Suscripción, Configuración) tampoco se tocaron: son
 * de otro rol o no son "el software", pedido explícito de Javier.
 */
export type Item = { href: string; nombre: string; Icono: typeof LayoutGrid };

export const INICIO: Item[] = [];

export const NEGOCIO: Item[] = [
  { href: '/dashboard/combustible-casetas', nombre: 'Combustible & Casetas', Icono: Fuel },
];

export const OPERACION: Item[] = [];

/**
 * El panel del CONTADOR de la flota — su grupo propio, arriba de todo.
 *
 * Va en su propia sección y no dentro de "Documentos & Dinero" porque para el
 * rol `contador` esa sección entera es su panel: mezclarlo le dejaría el menú
 * como una lista plana de nueve links sin jerarquía. Para el dueño
 * (`flota_admin`), que ve las dos, la separación dice qué es la vista fiscal y
 * qué es la operativa del dinero.
 */
export const FISCAL: Item[] = [
  { href: '/dashboard/contador', nombre: 'Panel fiscal', Icono: Landmark },
  { href: '/dashboard/contador/deducciones', nombre: 'Deducciones perdidas', Icono: TriangleAlert },
  { href: '/dashboard/contador/cfdi', nombre: 'CFDI recibidos', Icono: FileText },
  { href: '/dashboard/contador/combustible', nombre: 'Combustible & casetas', Icono: Fuel },
  { href: '/dashboard/contador/retenciones', nombre: 'Retenciones', Icono: Percent },
  { href: '/dashboard/contador/liquidaciones', nombre: 'Liquidaciones (lectura)', Icono: ReceiptText },
];

export const DOCUMENTOS_DINERO: Item[] = [];

export const GESTION: Item[] = [
  { href: '/dashboard/arco', nombre: 'Privacidad (ARCO)', Icono: ShieldCheck },
  { href: '/dashboard/soporte', nombre: 'Soporte & Quejas', Icono: LifeBuoy },
  { href: '/dashboard/usuarios', nombre: 'Usuarios & Roles', Icono: Users },
  { href: '/dashboard/politicas', nombre: 'Políticas', Icono: ScrollText },
  { href: '/dashboard/suscripcion', nombre: 'Plan & Facturación', Icono: CreditCard },
  { href: '/dashboard/configuracion', nombre: 'Configuración', Icono: Settings },
];

/** Lista plana — no hay command palette en /dashboard todavía, pero deja
 *  listo el mismo punto de extensión que admin/rutas.ts. */
export const TODAS_LAS_RUTAS: Item[] = [
  { href: '/dashboard', nombre: 'Resumen', Icono: LayoutGrid },
  ...INICIO, ...NEGOCIO, ...OPERACION, ...FISCAL, ...DOCUMENTOS_DINERO, ...GESTION,
];

/**
 * El sidebar que se PINTA (dirección visual del 7-ago-2026) — plano, sin
 * secciones. Vacío el 10-ago-2026 junto con OPERACION: las 8 páginas que
 * traía (Despacho, Viajes, Incidencias, Operadores, Cuadre, Facturación,
 * Cobranza, Valor y ahorro) se borraron para el rediseño desde cero. Se
 * vuelve a llenar página por página conforme se reconstruyan.
 */
export const SIDEBAR_PRINCIPAL: Item[] = [];
