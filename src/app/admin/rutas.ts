import {
  LayoutGrid, Sparkles, Bot, BadgeCheck, Inbox, Globe2, Truck, Cpu, Receipt, TrendingUp,
  Blocks, ShieldCheck, Users, HeartPulse, LifeBuoy, Code2,
} from 'lucide-react';

/**
 * El mapa de navegación de /admin — plano, SIN 'use client', a propósito:
 * lo consumen tanto Client Components (`sidebar-nav.tsx`,
 * `command-palette.tsx`) como Server Components (`sidebar-nav-iconos.tsx`).
 * Importar una constante desde un archivo 'use client' hacia un Server
 * Component no funciona (`TODAS_LAS_RUTAS.map is not a function` —
 * Next.js la sustituye por una referencia de cliente, no el arreglo real);
 * un módulo plano no tiene ese problema, se ejecuta igual en ambos lados.
 */
export type Pestana = {
  href: string; nombre: string;
  /** Número a la derecha de la pestaña (`null` = sin dato, nunca 0 inventado). Lo llena `requiereAccion()` en fases siguientes. */
  conteo?: number | null;
  /** El conteo pide acción. */
  atencion?: boolean;
};
/** Una ENTRADA del sidebar. `pestanas`: las páginas hermanas del grupo (cada una conserva su ruta y sus enlaces); la barra de pestañas
 *  `PestanasHub` (vía `pestanas-admin.tsx`) las pinta bajo el encabezado de cualquiera de ellas y el sidebar marca la entrada como activa en todas. */
export type Item = { href: string; nombre: string; Icono: typeof LayoutGrid; pestanas?: readonly Pestana[] };

// 16 entradas (antes 43 en el sidebar): el dueño pidió menos páginas pero poder hacer lo mismo o más. Nada se pierde: cada pantalla
// sigue viva como pestaña de su grupo (misma ruta) y todas siguen en ⌘K.
export const AGENTES: Item[] = [
  // El copiloto va PRIMERO: es la puerta que sustituye recorrer pantallas.
  { href: '/admin/copiloto', nombre: 'Copiloto', Icono: Sparkles },
  { href: '/admin/agentes', nombre: 'Agentes', Icono: Bot, pestanas: [
    { href: '/admin/agentes', nombre: 'Panel' },
    { href: '/admin/agente-ocr', nombre: 'OCR' },
    { href: '/admin/agente-cuadre', nombre: 'Cuadre' },
    { href: '/admin/agente-whatsapp', nombre: 'WhatsApp' },
    { href: '/admin/conversaciones', nombre: 'Conversaciones' },
    { href: '/admin/model-ops', nombre: 'Modelos' },
  ] },
  { href: '/admin/evals', nombre: 'Calidad', Icono: BadgeCheck, pestanas: [
    { href: '/admin/evals', nombre: 'Exámenes' },
    { href: '/admin/qa', nombre: 'Pruebas reales' },
    { href: '/admin/calidad-evals', nombre: 'Resumen' },
  ] },
];

export const NEGOCIO: Item[] = [
  { href: '/admin/escalaciones', nombre: 'Bandeja', Icono: Inbox, pestanas: [
    { href: '/admin/escalaciones', nombre: 'Escalaciones' },
    { href: '/admin/aprobaciones', nombre: 'Aprobaciones' },
  ] },
  // Ventas: «Tu turno» (la bandeja del dueño), el Cerebro de ventas (el mapa de prospectos, que se conserva entero) y el equipo.
  { href: '/admin/tu-turno', nombre: 'Ventas', Icono: Globe2, pestanas: [
    { href: '/admin/tu-turno', nombre: 'Tu turno' },
    { href: '/admin/mapa-prospectos', nombre: 'Cerebro' },
    { href: '/admin/vendedores', nombre: 'Vendedores' },
  ] },
  { href: '/admin/flotas', nombre: 'Clientes', Icono: Truck, pestanas: [
    { href: '/admin/flotas', nombre: 'Flotas' },
    { href: '/admin/usuarios/nuevo', nombre: 'Nuevo usuario' },
  ] },
  { href: '/admin/consumo', nombre: 'Consumo de IA', Icono: Cpu, pestanas: [
    { href: '/admin/consumo', nombre: 'Consumo' },
    { href: '/admin/techo-ia', nombre: 'Techos' },
  ] },
  { href: '/admin/cobranza', nombre: 'Facturación', Icono: Receipt, pestanas: [
    { href: '/admin/cobranza', nombre: 'Cobranza' },
    { href: '/admin/costos-facturacion', nombre: 'Costos y planes' },
  ] },
  { href: '/admin/crecimiento', nombre: 'Crecimiento', Icono: TrendingUp, pestanas: [
    { href: '/admin/crecimiento', nombre: 'Adquisición' },
    { href: '/admin/marketing', nombre: 'Estudio' },
  ] },
];

export const PLATAFORMA: Item[] = [
  { href: '/admin/integraciones', nombre: 'Integraciones', Icono: Blocks, pestanas: [
    { href: '/admin/integraciones', nombre: 'Integraciones' },
    { href: '/admin/whatsapp-infra', nombre: 'WhatsApp' },
  ] },
];

export const CONTROL: Item[] = [
  { href: '/admin/compliance', nombre: 'Seguridad y datos', Icono: ShieldCheck, pestanas: [
    { href: '/admin/compliance', nombre: 'Compliance y datos' },
    { href: '/admin/trust-safety', nombre: 'Trust & Safety' },
    { href: '/admin/mcp-clientes', nombre: 'Clientes MCP' },
  ] },
  { href: '/admin/equipo', nombre: 'Equipo', Icono: Users },
];

export const SISTEMA: Item[] = [
  { href: '/admin/salud-sistema', nombre: 'Salud', Icono: HeartPulse, pestanas: [
    { href: '/admin/salud-sistema', nombre: 'Estado' },
    { href: '/admin/crons', nombre: 'Relojes' },
    { href: '/admin/observabilidad', nombre: 'Observabilidad' },
    { href: '/admin/capacidad-forecast', nombre: 'Capacidad' },
  ] },
  { href: '/admin/soporte', nombre: 'Soporte', Icono: LifeBuoy },
  { href: '/admin/dev', nombre: 'Desarrollo', Icono: Code2, pestanas: [
    { href: '/admin/dev', nombre: 'Vistas de rol' },
    { href: '/admin/actividad-codigo', nombre: 'Código' },
  ] },
];

/** Las cinco secciones CON su rótulo — el MISMO agrupamiento y los MISMOS títulos que pinta el sidebar (`sidebar-nav.tsx`), exportados
 *  para que el grid de accesos del Inicio se genere DESDE este mapa. */
export const SECCIONES: Array<{ titulo: string; items: Item[] }> = [
  { titulo: 'Agentes', items: AGENTES },
  { titulo: 'Negocio', items: NEGOCIO },
  { titulo: 'Plataforma', items: PLATAFORMA },
  { titulo: 'Control', items: CONTROL },
  { titulo: 'Sistema', items: SISTEMA },
];

const ENTRADAS: Item[] = [...AGENTES, ...NEGOCIO, ...PLATAFORMA, ...CONTROL, ...SISTEMA];
const coincide = (pathname: string, href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

/** La entrada del sidebar a la que pertenece una ruta (por la ruta de la entrada o la de cualquiera de sus pestañas; las rutas con
 *  parámetro, p. ej. `/admin/flotas/<id>`, cuentan por prefijo). `null` si no es de ninguna (Inicio, Mi perfil, Notificaciones…). */
export function entradaDeRuta(pathname: string): Item | null {
  for (const it of ENTRADAS) {
    if (coincide(pathname, it.href) || (it.pestanas ?? []).some((p) => coincide(pathname, p.href))) return it;
  }
  return null;
}

/** La pestaña activa de una entrada para una ruta: la de href más largo que coincide (así `/admin/qa/<id>` es «Pruebas reales»). */
export function pestanaActiva(item: Item, pathname: string): Pestana | null {
  const candidatas = (item.pestanas ?? []).filter((p) => coincide(pathname, p.href));
  return candidatas.sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

/** Lista plana de todas las rutas (no cites el conteo) — la usan `command-palette.tsx` (⌘K) y `sidebar-nav-iconos.tsx`. Cada pestaña
 *  aparece con su nombre completo («Agentes · OCR») para que ⌘K encuentre cualquier pantalla. */
export const TODAS_LAS_RUTAS: Item[] = [
  { href: '/admin', nombre: 'Inicio', Icono: LayoutGrid },
  ...ENTRADAS.flatMap((it) => [
    { href: it.href, nombre: it.nombre, Icono: it.Icono },
    ...(it.pestanas ?? []).filter((p) => p.href !== it.href).map((p) => ({ href: p.href, nombre: `${it.nombre} · ${p.nombre}`, Icono: it.Icono })),
  ]),
];
