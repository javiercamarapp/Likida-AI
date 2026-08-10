import {
  LayoutGrid, Fuel,
  LifeBuoy, Users, ScrollText, Settings, CreditCard, ShieldCheck,
} from 'lucide-react';

/**
 * El mapa de navegación de /dashboard — mismo patrón que admin/rutas.ts
 * (plano, sin 'use client': lo consume el sidebar client y, si algún día
 * hace falta, un ⌘K de este panel también).
 *
 * INICIO/OPERACION/FISCAL/DOCUMENTOS_DINERO/SIDEBAR_PRINCIPAL quedaron
 * VACÍOS el 10-ago-2026: las 17 páginas de "dueño de flota" (despacho,
 * viajes, incidencias, operadores, cuadre, facturación, cobranza, valor y
 * ahorro, unidades, POD, analítica, chat, rentabilidad, clientes, mapa,
 * cotizador, documentos) y las 6 del panel del CONTADOR (Panel fiscal,
 * Deducciones perdidas, CFDI recibidos, Combustible & casetas,
 * Retenciones, Liquidaciones) se borraron el mismo día para rehacerse
 * desde cero, pensando en cómo las usa cada tipo de cliente — no es un
 * hueco, es la salida de pista. El catálogo de qué función de datos
 * respaldaba a cada una de las 17 de dueño de flota vive en
 * `docs/conocimiento/41-inventario-dueno-flota-pre-rediseno.md`, y esa
 * lógica SIGUE en `lib/likida/*` sin tocar — lo que se fue es la página.
 * `inicioDe` (visibilidad.ts) ya no manda al contador a `/dashboard/
 * contador` — aterriza en Suscripción mientras no exista panel propio.
 * NEGOCIO conserva `combustible-casetas` (la operativa, no la del
 * contador — no era parte de esas 23). GESTION (cuenta/cumplimiento —
 * ARCO, Soporte, Usuarios, Políticas, Suscripción, Configuración) no se
 * tocó: no es "el software", pedido explícito de Javier.
 */
export type Item = { href: string; nombre: string; Icono: typeof LayoutGrid };

export const INICIO: Item[] = [];

export const NEGOCIO: Item[] = [
  { href: '/dashboard/combustible-casetas', nombre: 'Combustible & Casetas', Icono: Fuel },
];

export const OPERACION: Item[] = [];

export const FISCAL: Item[] = [];

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
