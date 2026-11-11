import {
  LayoutGrid, Sparkles, Bot, BadgeCheck, Inbox, Globe2, Truck, Cpu, Receipt, TrendingUp,
  Blocks, ShieldCheck, Users, HeartPulse, LifeBuoy, Code2, Bell, UserRound, Eye,
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
// sigue viva como pestaña de su grupo (misma ruta) y todas siguen en ⌘K. Es el árbol final 3.1 del plan maestro del admin: cuatro
// secciones (Agentes, Negocio, Control, Sistema); «Plataforma» ya no existe (Integraciones pasó a Sistema).
/** El Copiloto es entrada de PRIMER NIVEL: va justo debajo de «Resumen», fuera de las cuatro secciones (decisión del dueño, 11-nov-2026). Es la puerta que
 *  sustituye recorrer pantallas. Lo pintan el sidebar y la hoja «Más» del móvil tras el Resumen; ⌘K lo lista en `todasLasRutas`. */
export const COPILOTO: Item = { href: '/admin/copiloto', nombre: 'Copiloto', Icono: Sparkles };

export const AGENTES: Item[] = [
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
  // Bandeja: lo que espera al dueño. Su `href` es «Tu turno» (la primera pestaña); Escalaciones lleva el conteo vivo (ver `conteos-pestanas.ts`).
  { href: '/admin/tu-turno', nombre: 'Bandeja', Icono: Inbox, pestanas: [
    { href: '/admin/tu-turno', nombre: 'Tu turno' },
    { href: '/admin/aprobaciones', nombre: 'Aprobaciones' },
    { href: '/admin/escalaciones', nombre: 'Escalaciones' },
  ] },
  // Ventas: el Cerebro de ventas (el mapa de prospectos, que se conserva entero) y el equipo de vendedores. «Tu turno» ya no vive aquí.
  { href: '/admin/mapa-prospectos', nombre: 'Ventas', Icono: Globe2, pestanas: [
    { href: '/admin/mapa-prospectos', nombre: 'Cerebro de ventas' },
    { href: '/admin/vendedores', nombre: 'Vendedores' },
  ] },
  // Clientes: lista y ficha 360 (`/admin/flotas/[id]`); sin pestañas. «Nuevo acceso» pasó a Equipo.
  { href: '/admin/flotas', nombre: 'Clientes', Icono: Truck },
  { href: '/admin/consumo', nombre: 'Consumo de IA', Icono: Cpu, pestanas: [
    { href: '/admin/consumo', nombre: 'Consumo' },
    { href: '/admin/techo-ia', nombre: 'Techos' },
  ] },
  { href: '/admin/cobranza', nombre: 'Facturación', Icono: Receipt, pestanas: [
    { href: '/admin/cobranza', nombre: 'Cobranza' },
    { href: '/admin/costos-facturacion', nombre: 'Planes y cobro' },
    { href: '/admin/facturas', nombre: 'Facturas' },
  ] },
  { href: '/admin/crecimiento', nombre: 'Crecimiento', Icono: TrendingUp, pestanas: [
    { href: '/admin/crecimiento', nombre: 'Adquisición' },
    { href: '/admin/marketing', nombre: 'Estudio' },
  ] },
];

export const CONTROL: Item[] = [
  { href: '/admin/compliance', nombre: 'Seguridad y datos', Icono: ShieldCheck, pestanas: [
    { href: '/admin/compliance', nombre: 'Compliance y datos' },
    { href: '/admin/trust-safety', nombre: 'Trust & Safety' },
    { href: '/admin/mcp-clientes', nombre: 'Clientes MCP' },
    { href: '/admin/bitacora', nombre: 'Bitácora' },
  ] },
  { href: '/admin/equipo', nombre: 'Equipo', Icono: Users, pestanas: [
    { href: '/admin/equipo', nombre: 'Personas' },
  ] },
];

export const SISTEMA: Item[] = [
  // Los correos de alerta aterrizan en `/admin/salud-sistema` (Estado): esa URL no cambia. `/admin/corridas/<id>` cuelga de Corridas por prefijo.
  { href: '/admin/salud-sistema', nombre: 'Salud', Icono: HeartPulse, pestanas: [
    { href: '/admin/salud-sistema', nombre: 'Estado' },
    { href: '/admin/crons', nombre: 'Relojes' },
    { href: '/admin/observabilidad', nombre: 'Observabilidad' },
    { href: '/admin/corridas', nombre: 'Corridas' },
    { href: '/admin/capacidad-forecast', nombre: 'Capacidad' },
  ] },
  { href: '/admin/soporte', nombre: 'Soporte', Icono: LifeBuoy },
  { href: '/admin/integraciones', nombre: 'Integraciones', Icono: Blocks, pestanas: [
    { href: '/admin/integraciones', nombre: 'Integraciones' },
    { href: '/admin/whatsapp-infra', nombre: 'WhatsApp' },
  ] },
  { href: '/admin/dev', nombre: 'Desarrollo', Icono: Code2, pestanas: [
    { href: '/admin/dev', nombre: 'Vistas de rol' },
    { href: '/admin/actividad-codigo', nombre: 'Código' },
  ] },
];

/** Las cuatro secciones CON su rótulo — el MISMO agrupamiento y los MISMOS títulos que pinta el sidebar (`sidebar-nav.tsx`), exportados
 *  para que el grid de accesos del Inicio y el rótulo de área de cada pantalla (`areaDeRutaAdmin`) se generen DESDE este mapa. */
export const SECCIONES: Array<{ titulo: string; items: Item[] }> = [
  { titulo: 'Agentes', items: AGENTES },
  { titulo: 'Negocio', items: NEGOCIO },
  { titulo: 'Control', items: CONTROL },
  { titulo: 'Sistema', items: SISTEMA },
];

/** Pantallas que viven FUERA del menú, lista cerrada: la campana, el avatar y el «ver como». Todo `page.tsx` bajo `/admin` está en
 *  `SECCIONES`, aquí, o es un stub 308 (guarda `admin_paginas_en_menu`). Aparecen en ⌘K. */
export const FUERA_DEL_MENU: ReadonlyArray<{ href: string; nombre: string; Icono: typeof LayoutGrid; alias?: readonly string[] }> = [
  { href: '/admin/notificaciones', nombre: 'Avisos', Icono: Bell, alias: ['notificaciones', 'campana', 'pendientes'] },
  { href: '/admin/mi-perfil', nombre: 'Mi perfil', Icono: UserRound, alias: ['avatar', 'cuenta', 'contraseña'] },
  { href: '/admin/elegir-flota', nombre: 'Ver como una flota', Icono: Eye, alias: ['elegir flota', 'ver como'] },
];

const ENTRADAS: Item[] = [COPILOTO, ...SECCIONES.flatMap((s) => s.items)];
const coincide = (pathname: string, href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);
/** La entrada del sidebar a la que pertenece una ruta (por la ruta de la entrada o la de cualquiera de sus pestañas; las rutas con
 *  parámetro, p. ej. `/admin/flotas/<id>`, cuentan por prefijo). `null` si no es de ninguna (Inicio…); las de `FUERA_DEL_MENU` (Avisos, Mi perfil…) devuelven una entrada sin pestañas. */
export function entradaDeRuta(pathname: string): Item | null {
  for (const it of ENTRADAS) {
    if (coincide(pathname, it.href) || (it.pestanas ?? []).some((p) => coincide(pathname, p.href))) return it;
  }
  // Las pantallas fuera del menú (Avisos, Mi perfil, Ver como…) también dan nombre a la cabecera; no son de ninguna sección ni llevan pestañas.
  const fuera = FUERA_DEL_MENU.find((f) => coincide(pathname, f.href));
  if (fuera) return { href: fuera.href, nombre: fuera.nombre, Icono: fuera.Icono };
  return null;
}

/** La pestaña activa de una entrada para una ruta: la de href más largo que coincide (así `/admin/qa/<id>` es «Pruebas reales»). */
export function pestanaActiva(item: Item, pathname: string): Pestana | null {
  const candidatas = (item.pestanas ?? []).filter((p) => coincide(pathname, p.href));
  return candidatas.sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

/** Palabras con las que la gente busca una pantalla y que NO están en su nombre (⌘K las encuentra: «kill switch» → Agentes). Por `href`. */
export const ALIAS_BUSQUEDA: Readonly<Record<string, readonly string[]>> = {
  '/admin/agentes': ['kill switch', 'apagar', 'encender', 'interruptor', 'palanca'],
  '/admin/compliance': ['arco', 'privacidad', 'datos personales'],
  '/admin/bitacora': ['auditoría', 'auditoria', 'registro', 'quién hizo', 'historial'],
  '/admin/techo-ia': ['techo', 'tope', 'presupuesto de ia'],
  '/admin/usuarios/nuevo': ['invitar', 'invitación', 'alta de usuario', 'nuevo usuario'],
  '/admin/corridas': ['traza', 'trazas', 'corrida'],
  '/admin/salud-sistema': ['latidos', 'alertas', 'estado del sistema'],
  '/admin/mapa-prospectos': ['cerebro', 'prospectos', 'mapa'],
  '/admin/tu-turno': ['turno', 'pendientes'],
  '/admin/flotas': ['flotas', 'clientes', 'alta de flota'],
};

/** Una ruta de la lista plana: lo que busca ⌘K. `alias` = otras palabras que la encuentran. */
export type RutaPlana = { href: string; nombre: string; Icono: typeof LayoutGrid; alias?: readonly string[] };

/** Lista plana de todas las rutas (no cites el conteo) — la usa `command-palette.tsx` (⌘K). Una ENTRADA aparece con su nombre; cada
 *  pestaña con el de «Entrada · Pestaña» (así «Agentes · OCR» se encuentra por «ocr»). La primera pestaña comparte `href` con su entrada,
 *  así que no se repite: su nombre pasa a ser alias de la entrada («Bandeja» se encuentra por «tu turno»). Las tres pantallas fuera del
 *  menú también están. Una `href` aparece UNA sola vez (es la llave de la lista del buscador). */
export function todasLasRutas(traducir?: (nombre: string) => string): RutaPlana[] {
  // Con `traducir` (otro idioma) los nombres salen traducidos y los nombres en español pasan a alias: «bandeja» sigue encontrando Inbox.
  const nom = (n: string) => (traducir ? traducir(n) : n);
  const conEspanol = (n: string): string[] => (traducir && traducir(n) !== n ? [n] : []);
  return [
    { href: '/admin', nombre: nom('Inicio'), Icono: LayoutGrid, alias: [...conEspanol('Inicio'), 'resumen', 'centro de mando'] },
    ...ENTRADAS.flatMap((it): RutaPlana[] => {
      const primera = (it.pestanas ?? []).find((p) => p.href === it.href);
      const entrada: RutaPlana = {
        href: it.href, nombre: nom(it.nombre), Icono: it.Icono,
        alias: [
          ...conEspanol(it.nombre),
          ...(primera && primera.nombre !== it.nombre ? [nom(primera.nombre), ...conEspanol(primera.nombre)] : []),
          ...(ALIAS_BUSQUEDA[it.href] ?? []),
        ],
      };
      const resto = (it.pestanas ?? []).filter((p) => p.href !== it.href)
        .map((p): RutaPlana => ({
          href: p.href, nombre: `${nom(it.nombre)} · ${nom(p.nombre)}`, Icono: it.Icono,
          alias: [...(traducir ? [`${it.nombre} · ${p.nombre}`] : []), ...(ALIAS_BUSQUEDA[p.href] ?? [])],
        }));
      return [entrada, ...resto];
    }),
    ...FUERA_DEL_MENU.map((f): RutaPlana => ({ href: f.href, nombre: nom(f.nombre), Icono: f.Icono, alias: [...conEspanol(f.nombre), ...(f.alias ?? [])] })),
  ];
}
export const TODAS_LAS_RUTAS: RutaPlana[] = todasLasRutas();

/** Minúsculas y sin acentos, para que «bitacora» encuentre «Bitácora» en ⌘K. */
export const planoBusqueda = (t: string): string => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** ¿La consulta (ya en `planoBusqueda`) encuentra esta fila de ⌘K por su nombre o por alguno de sus alias? */
export function coincideBusqueda(etiqueta: string, alias: readonly string[] | undefined, consultaPlana: string): boolean {
  return planoBusqueda(etiqueta).includes(consultaPlana) || (alias ?? []).some((a) => planoBusqueda(a).includes(consultaPlana));
}
