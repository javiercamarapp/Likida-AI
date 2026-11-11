import { ENTRADAS_DASHBOARD, type Entrada, type Item } from '../rutas';
import { puedeVerRuta, type PerfilTenant } from '@/lib/auth/visibilidad';
import { LayoutGrid } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// EL MENÚ DEL SHELL v2 — datos puros, sin React ni base.
//
// Fase 8 (P-DAS-NAV): el menú ya no lista pantallas sino ENTRADAS (`ENTRADAS_DASHBOARD` en `../rutas.ts`, 26 en el catálogo),
// cada una con sus pantallas hermanas como PESTAÑAS. El filtro es el mismo que gatea las páginas, `puedeVerRuta(rol, href,
// perfil)`: dos listas que se desincronizan dejan un enlace que, al clic, rebota. Una pestaña solo existe si el rol y el perfil
// abren su ruta, y el `href` de la entrada es la PRIMERA pestaña visible (la entrada nunca apunta a una ruta que el rol no abre).
// Una entrada sin ninguna pestaña visible no se pinta.
//
//   · bajo el perfil `cinco_agentes`: Resumen · AGENTES (los cinco agentes, SIEMPRE visibles bajo un caption estático, sin
//     acordeón) · acordeón de UNA sola categoría abierta (Operación · Cuenta y conexiones) · pie (Notificaciones; Mi perfil y
//     Ayuda viven en el menú de la tarjeta de cuenta). «Puesta en marcha» es la fila del pie mientras el asistente va <6/6 y una
//     entrada de «Cuenta y conexiones» cuando termina (la insignia llega por props);
//   · sin perfil: Operación, Dinero y fiscal, Automatización y Cuenta, más el pie.
//
// El módulo es de datos: lo importan el sidebar (escritorio) y la hoja «Más» (móvil), así que las dos navegaciones no
// pueden divergir.
// ═══════════════════════════════════════════════════════════════════════════

export interface GrupoMenu {
  /** Estable, para `id`/`aria-labelledby`. */
  id: string;
  titulo: string;
  items: Item[];
  /** Caption estático con sus ítems siempre visibles (AGENTES). Los demás grupos son categorías de UN acordeón (una abierta). */
  estatico?: boolean;
}

export interface MenuV2 {
  /** El Resumen de cada rol (+ el chat, a primer nivel), arriba y sin título de grupo. */
  resumen: Item[];
  grupos: GrupoMenu[];
  /** El bloque inferior fijo (Notificaciones, Mi perfil, Centro de ayuda y, sin perfil, Plan y Configuración). */
  pie: Item[];
}

const porClave = (clave: string): Entrada => {
  const e = ENTRADAS_DASHBOARD.find((x) => x.clave === clave);
  if (!e) throw new Error(`Entrada de menú desconocida: ${clave}`);
  return e;
};

/**
 * La entrada tal como la ve un rol bajo un perfil: solo las pestañas cuya ruta abre, y `href` = la primera de ellas. `null` si
 * no abre ninguna (la entrada no existe para ese rol).
 */
export function entradaParaRol(e: Entrada, rol: string, perfil?: PerfilTenant | null): Item | null {
  const visibles = e.pestanas.filter((t) => (!t.soloConPerfil || perfil) && puedeVerRuta(rol, t.href, perfil));
  if (visibles.length === 0) return null;
  return { href: visibles[0].href, nombre: e.nombre, Icono: e.Icono, pestanas: visibles };
}

/** Los grupos de un tenant CON perfil `cinco_agentes`: entradas por clave. */
const GRUPOS_CINCO_AGENTES: ReadonlyArray<{ id: string; titulo: string; claves: string[]; estatico?: boolean }> = [
  { id: 'agentes', titulo: 'Agentes', estatico: true, claves: ['liquidacion', 'peajes', 'carta-porte-auto', 'servicio-cliente', 'comunicacion'] },
  { id: 'operacion', titulo: 'Operación', claves: ['viajes', 'equipo', 'carta-porte'] },
  { id: 'cuenta', titulo: 'Cuenta y conexiones', claves: ['puesta-en-marcha', 'conexiones', 'usuarios', 'legal'] },
];

const PIE_CINCO_AGENTES = ['notificaciones', 'mi-perfil', 'ayuda'];

/** Sin perfil: las cuatro categorías del menú, por el grupo de cada entrada. */
const GRUPOS_GENERICOS: ReadonlyArray<{ id: string; titulo: string; grupo: Entrada['grupo'] }> = [
  { id: 'operacion', titulo: 'Operación', grupo: 'operacion' },
  { id: 'dinero', titulo: 'Dinero y fiscal', grupo: 'dinero' },
  { id: 'automatizacion', titulo: 'Automatización', grupo: 'automatizacion' },
  { id: 'cuenta', titulo: 'Cuenta', grupo: 'cuenta' },
];
// «Configuración» es un ítem SUELTO bajo los grupos (como en Rovaq, junto a Avisos), no del grupo «Cuenta»: vive en `pie` para que
// todo consumidor del menú (cabecera, pestañas, recorrido, ⌘K) la siga encontrando, y `ArbolMenu` la pinta bajo los grupos.
// Mismo filtro por rol que antes (`entradaParaRol`): quien no abre /dashboard/configuracion sigue sin verla.
const PIE_GENERICO = ['notificaciones', 'mi-perfil', 'ayuda', 'plan', 'configuracion'];

/**
 * Grupos por PROPÓSITO del rol (identidad Rovaq): un grupo con una sola entrada que no es de lo que el rol hace mal rotula. Sin perfil:
 *   · jefe de tráfico: no ve dinero, así que «Carta Porte» (el documento del viaje) va en Operación y no solo en «Dinero y fiscal»;
 *   · contador: no despacha, así que su «Sin viaje» (comprobantes sin viaje) y Clientes y tarifas van en «Dinero y fiscal» y no en «Operación».
 * El catálogo (`ENTRADAS_DASHBOARD`) no cambia: solo en qué grupo se pinta la entrada para ese rol.
 */
const GRUPO_POR_ROL: Readonly<Record<string, Readonly<Record<string, Entrada['grupo']>>>> = {
  encargado: { 'carta-porte': 'operacion' },
  contador: { viajes: 'dinero', clientes: 'dinero' },
};

/** La ruta del asistente: fila del pie mientras va <6/6, ítem de «Cuenta y conexiones» cuando termina. */
export const HREF_PUESTA_EN_MARCHA = '/dashboard/puesta-en-marcha';
export const HREF_NOTIFICACIONES = '/dashboard/notificaciones';
/** El ítem suelto bajo los grupos (sin perfil): «Configuración». */
export const HREF_CONFIGURACION = '/dashboard/configuracion';

/**
 * El menú que ve un rol con un perfil de tenant. `rol` es el rol con el que se FILTRA (el previsualizado, si el real es
 * superadmin: ver `useSufijoYRol`). Una sección sin entradas visibles no se pinta.
 */
export function menuPorPerfil(rol: string, perfil?: PerfilTenant | null): MenuV2 {
  const ve = (clave: string): Item | null => entradaParaRol(porClave(clave), rol, perfil);
  const veTodas = (claves: string[]): Item[] => claves.map(ve).filter((i): i is Item => i !== null);
  // El Resumen de CADA QUIEN, un solo enlace: `/dashboard` es de `operacion`, así que el contador (solo `dinero`) aterriza en
  // `/dashboard/contador` (la entrada «Contador», que para él ES el Resumen). El dueño y el superadmin ven las dos rutas y su
  // Resumen sigue siendo `/dashboard`: nunca se pintan los dos.
  const resumenDueno = ve('resumen');
  const panelContador = ve('contador');
  const resumenPropio: Item | null = resumenDueno ?? (panelContador ? { ...panelContador, nombre: 'Resumen', Icono: LayoutGrid } : null);
  // «Pregunta a tus datos» va justo debajo de Resumen; si el rol no tiene Resumen bajo el perfil (el contador), queda de primera.
  const chat = ve('chat');
  const resumen = [...(resumenPropio ? [resumenPropio] : []), ...(chat ? [chat] : [])];

  if (perfil) {
    return {
      resumen,
      grupos: GRUPOS_CINCO_AGENTES
        .map((g) => ({ id: g.id, titulo: g.titulo, items: veTodas(g.claves), ...(g.estatico ? { estatico: true } : {}) }))
        .filter((g) => g.items.length > 0),
      pie: veTodas(PIE_CINCO_AGENTES),
    };
  }
  return {
    resumen,
    grupos: GRUPOS_GENERICOS
      .map((g) => ({ id: g.id, titulo: g.titulo, items: veTodas(ENTRADAS_DASHBOARD.filter((e) => e.clave !== 'configuracion' && (GRUPO_POR_ROL[rol]?.[e.clave] ?? e.grupo) === g.grupo).map((e) => e.clave)) }))
      .filter((g) => g.items.length > 0),
    pie: veTodas(PIE_GENERICO),
  };
}

const todosLosItems = (menu: MenuV2): Item[] => [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie];

/** Los `href` de entrada que el menú ofrece a un rol (para la hoja «Más» y las pruebas de contrato): uno por entrada. */
export function hrefsDelMenu(menu: MenuV2): string[] {
  return todosLosItems(menu).map((i) => i.href);
}

/** Todas las rutas que el menú alcanza: la de cada entrada y la de cada una de sus pestañas visibles (sin repetir). */
export function hrefsConPestanas(menu: MenuV2): string[] {
  return [...new Set(todosLosItems(menu).flatMap((i) => [i.href, ...(i.pestanas ?? []).map((p) => p.href)]))];
}

/**
 * ¿Cuál entrada está activa? Devuelve el `href` de la entrada cuyo href o cuya pestaña es el prefijo MÁS LARGO de la ruta
 * (`/dashboard/carta-porte/documentos/abc` activa «Carta Porte» por su pestaña «Documentos», no por la de «Viajes»).
 * `/dashboard` solo es activo en la raíz exacta.
 */
export function hrefActivo(pathname: string, menu: MenuV2): string | null {
  let mejor: { largo: number; href: string } | null = null;
  for (const it of todosLosItems(menu)) {
    for (const h of [it.href, ...(it.pestanas ?? []).map((p) => p.href)]) {
      const coincide = pathname === h || (h !== '/dashboard' && h !== '/admin' && pathname.startsWith(`${h}/`));
      if (coincide && (mejor === null || h.length > mejor.largo)) mejor = { largo: h.length, href: it.href };
    }
  }
  if (mejor === null && /^\/dashboard\/[0-9a-f-]{8,}$/i.test(pathname)) {
    // Ficha de un viaje (`/dashboard/<id de liquidacion>`): vive bajo «Viajes».
    return todosLosItems(menu).find((it) => it.href === '/dashboard/despacho')?.href ?? null;
  }
  return mejor?.href ?? null;
}
