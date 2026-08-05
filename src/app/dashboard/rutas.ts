import {
  LayoutGrid, TrendingUp, LineChart, Sparkles, DollarSign, Users2, Fuel,
  Truck, Wrench, UserCog, Map, Calculator, ScanText, ReceiptText, FileText, Landmark, Send,
  LifeBuoy, Users, ScrollText, Settings, TriangleAlert, PackageCheck, CreditCard, Percent,
} from 'lucide-react';

/**
 * El mapa de navegación de /dashboard — mismo patrón que admin/rutas.ts
 * (plano, sin 'use client': lo consume el sidebar client y, si algún día
 * hace falta, un ⌘K de este panel también). Grupos e íconos siguen el PASO 4
 * del documento que Javier pegó; el orden importa (Cuadre/Documentos antes
 * que las Fase X, es el núcleo real del producto).
 */
export type Item = { href: string; nombre: string; Icono: typeof LayoutGrid };

export const INICIO: Item[] = [
  { href: '/dashboard/valor-ahorro', nombre: 'Valor & Ahorro (ROI)', Icono: TrendingUp },
  { href: '/dashboard/analitica', nombre: 'Analítica & Reportes', Icono: LineChart },
  { href: '/dashboard/chat', nombre: 'Chatea con tus Datos', Icono: Sparkles },
];

export const NEGOCIO: Item[] = [
  { href: '/dashboard/rentabilidad', nombre: 'Rentabilidad / Finanzas', Icono: DollarSign },
  { href: '/dashboard/clientes', nombre: 'Clientes', Icono: Users2 },
  { href: '/dashboard/combustible-casetas', nombre: 'Combustible & Casetas', Icono: Fuel },
];

export const OPERACION: Item[] = [
  // Despacho va PRIMERO del grupo a propósito: es la pantalla de aterrizaje
  // del encargado, la única del panel donde se escribe en la base en vez de
  // solo leerla, y la que se abre en la mañana antes que ninguna otra.
  { href: '/dashboard/despacho', nombre: 'Despacho', Icono: Send },
  { href: '/dashboard/viajes', nombre: 'Viajes', Icono: Truck },
  { href: '/dashboard/pod', nombre: 'POD & Evidencias', Icono: PackageCheck },
  { href: '/dashboard/incidencias', nombre: 'Incidencias', Icono: TriangleAlert },
  { href: '/dashboard/unidades', nombre: 'Unidades', Icono: Wrench },
  { href: '/dashboard/operadores', nombre: 'Operadores', Icono: UserCog },
  { href: '/dashboard/mapa', nombre: 'Mapa en vivo', Icono: Map },
  { href: '/dashboard/cotizador', nombre: 'Cotizador', Icono: Calculator },
];

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

export const DOCUMENTOS_DINERO: Item[] = [
  { href: '/dashboard/documentos', nombre: 'Documentos (OCR)', Icono: ScanText },
  { href: '/dashboard/cuadre', nombre: 'Cuadre / Liquidación', Icono: ReceiptText },
  { href: '/dashboard/facturacion', nombre: 'Facturación', Icono: FileText },
  { href: '/dashboard/cobranza', nombre: 'Cobranza', Icono: Landmark },
];

export const GESTION: Item[] = [
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
