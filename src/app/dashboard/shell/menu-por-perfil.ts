import { AUTOMATIZACIONES, OPERACION, DINERO_FISCAL, SISTEMA, ABAJO, PUESTA_EN_MARCHA, type Item } from '../rutas';
import { puedeVerRuta, type PerfilTenant } from '@/lib/auth/visibilidad';
import { LayoutGrid, MessageCircle } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// EL MENÚ DEL SHELL v2 — datos puros, sin React ni base.
//
// Misma fuente que el menú de siempre (`../rutas.ts`: mismas rutas y MISMOS NOMBRES, nada se renombra mientras se valida
// el rediseño) y el mismo filtro (`puedeVerRuta(rol, href, perfil)`), que es el que gatea las páginas: dos listas que se
// desincronizan dejan un enlace que, al clic, rebota. Lo que cambia es el AGRUPADO:
//
//   · bajo el perfil `cinco_agentes`: Resumen · Agentes (A1-A5, un ítem por agente) · Operación · Puesta en marcha ·
//     Cuenta y conexiones · pie (Notificaciones, Mi perfil, Ayuda);
//   · sin perfil: el menú genérico actual (Operación, Dinero y fiscal, Automatizaciones, Sistema).
//
// El módulo es de datos: lo importan el sidebar (escritorio) y la hoja «Más» (móvil), así que las dos navegaciones no
// pueden divergir.
// ═══════════════════════════════════════════════════════════════════════════

export interface GrupoMenu {
  /** Estable, para `id`/`aria-labelledby`. */
  id: string;
  titulo: string;
  items: Item[];
}

export interface MenuV2 {
  /** El Resumen de cada rol (+ el chat, a primer nivel), arriba y sin título de grupo. */
  resumen: Item[];
  grupos: GrupoMenu[];
  /** El bloque inferior fijo (Notificaciones, Mi perfil, Centro de ayuda y, sin perfil, Plan y Configuración). */
  pie: Item[];
}

const RESUMEN: Item = { href: '/dashboard', nombre: 'Resumen', Icono: LayoutGrid };
const RESUMEN_CONTADOR: Item = { ...RESUMEN, href: '/dashboard/contador' };
const CHAT: Item = { href: '/dashboard/chat', nombre: 'Pregunta a tus datos', Icono: MessageCircle };

const TODAS: readonly Item[] = [...OPERACION, ...DINERO_FISCAL, ...AUTOMATIZACIONES, ...SISTEMA, ...ABAJO, PUESTA_EN_MARCHA];

/** Los ítems de `rutas.ts` por href, en el orden pedido. Un href que ya no existe en `rutas.ts` rompe `menu_por_perfil.test.ts`. */
function porHref(...hrefs: string[]): Item[] {
  return hrefs.map((h) => TODAS.find((i) => i.href === h)).filter((i): i is Item => Boolean(i));
}

/** Los grupos de un tenant CON perfil `cinco_agentes`. */
const GRUPOS_CINCO_AGENTES: ReadonlyArray<{ id: string; titulo: string; hrefs: string[] }> = [
  {
    id: 'agentes', titulo: 'Agentes',
    hrefs: [
      '/dashboard/agentes/liquidacion', '/dashboard/agentes/peajes', '/dashboard/agentes/carta-porte',
      '/dashboard/agentes/vigia', '/dashboard/agentes/conductores',
    ],
  },
  {
    id: 'operacion', titulo: 'Operación',
    hrefs: [
      '/dashboard/despacho', '/dashboard/viajes', '/dashboard/operadores', '/dashboard/unidades', '/dashboard/patios',
      '/dashboard/mapa', '/dashboard/viajes-en-vivo', '/dashboard/carta-porte', '/dashboard/carta-porte/documentos',
      '/dashboard/whatsapp',
    ],
  },
  { id: 'puesta-en-marcha', titulo: 'Puesta en marcha', hrefs: ['/dashboard/puesta-en-marcha'] },
  {
    id: 'cuenta', titulo: 'Cuenta y conexiones',
    hrefs: [
      '/dashboard/conexiones', '/dashboard/usuarios', '/dashboard/llaves-api', '/dashboard/arco', '/dashboard/legal',
    ],
  },
];

const PIE_CINCO_AGENTES = ['/dashboard/notificaciones', '/dashboard/mi-perfil', '/dashboard/soporte'];

/**
 * El menú que ve un rol con un perfil de tenant. `rol` es el rol con el que se FILTRA (el previsualizado, si el real es
 * superadmin: ver `useSufijoYRol`). Una sección sin ítems visibles no se pinta.
 */
export function menuPorPerfil(rol: string, perfil?: PerfilTenant | null): MenuV2 {
  const ve = (it: Item) => puedeVerRuta(rol, it.href, perfil);
  // El Resumen de CADA QUIEN, un solo enlace: `/dashboard` es de `operacion`, así que el contador (solo `dinero`) aterriza en
  // `/dashboard/contador`. El dueño y el superadmin ven las dos y su Resumen sigue siendo `/dashboard`: nunca se pintan los dos.
  const resumenPropio = ve(RESUMEN) ? RESUMEN : ve(RESUMEN_CONTADOR) ? RESUMEN_CONTADOR : null;
  const resumen = [...(resumenPropio ? [resumenPropio] : []), ...(resumenPropio && ve(CHAT) ? [CHAT] : [])];

  if (perfil) {
    return {
      resumen,
      grupos: GRUPOS_CINCO_AGENTES
        .map((g) => ({ id: g.id, titulo: g.titulo, items: porHref(...g.hrefs).filter(ve) }))
        .filter((g) => g.items.length > 0),
      pie: porHref(...PIE_CINCO_AGENTES).filter(ve),
    };
  }
  const genericos: Array<[string, string, Item[]]> = [
    ['operacion', 'Operación', OPERACION], ['dinero', 'Dinero y fiscal', DINERO_FISCAL],
    ['automatizaciones', 'Automatizaciones', AUTOMATIZACIONES], ['sistema', 'Sistema', SISTEMA],
  ];
  return {
    resumen,
    grupos: genericos
      .map(([id, titulo, items]) => ({ id, titulo, items: items.filter(ve) }))
      .filter((g) => g.items.length > 0),
    pie: ABAJO.filter(ve),
  };
}

/** Todos los hrefs que el menú puede ofrecer a un rol (para la hoja «Más» y las pruebas de contrato). */
export function hrefsDelMenu(menu: MenuV2): string[] {
  return [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie].map((i) => i.href);
}

/**
 * ¿Cuál ítem está activo? El de href MÁS LARGO que sea la ruta o su prefijo (`/dashboard/carta-porte/documentos/abc`
 * activa «Documentos de clientes», no también «Carta Porte»). `/dashboard` solo es activo en la raíz exacta.
 */
export function hrefActivo(pathname: string, menu: MenuV2): string | null {
  let mejor: string | null = null;
  for (const h of hrefsDelMenu(menu)) {
    const coincide = pathname === h || (h !== '/dashboard' && pathname.startsWith(`${h}/`));
    if (coincide && (mejor === null || h.length > mejor.length)) mejor = h;
  }
  return mejor;
}
