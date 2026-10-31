import type { Item } from '../rutas';
import type { MenuV2 } from './menu-por-perfil';

// ═══════════════════════════════════════════════════════════════════════════
// LOS DESTINOS DE LA BARRA INFERIOR MÓVIL (ESTILO §11): datos puros, sin React.
//
// UN solo modelo filtrado por rol: parte del MISMO menú que el sidebar y la hoja «Más» (`menuPorPerfil`, que ya aplica
// `puedeVerRuta(rol, href, perfil)`), así que la barra nunca ofrece una ruta que el rol o el perfil no abren. Hasta 4 destinos
// elegidos por preferencia del rol, completados en el orden del menú (sin el pie) si el rol ve menos de los preferidos; el quinto lugar es
// siempre «Más» (la hoja con el árbol completo, el tema y la cuenta). Rol sin ninguna ruta en este panel (el vendedor tiene
// el suyo, /vendedor) ⇒ sin destinos ⇒ no se pinta la barra.
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_DESTINOS = 4;

/** Etiquetas cortas (11 px, una línea) para los nombres largos del menú. El resto usa el nombre del menú tal cual. */
const ETIQUETA_CORTA: Readonly<Record<string, string>> = {
  '/dashboard/contador': 'Resumen',
  '/dashboard/agentes/liquidacion': 'Liquidación',
  '/dashboard/agentes/peajes': 'Peajes',
  '/dashboard/agentes/carta-porte': 'Carta Porte',
  '/dashboard/agentes/vigia': 'Clientes',
  '/dashboard/agentes/conductores': 'Operadores',
  '/dashboard/agentes/facturas': 'Facturas',
  '/dashboard/agentes/cobranza': 'Cobranza',
  '/dashboard/agentes/proveedores': 'Proveedores',
  '/dashboard/chat': 'Preguntar',
  '/dashboard/viajes-en-vivo': 'En vivo',
};

/**
 * Preferencia por rol (la primera que el menú ofrece gana). Dueño y superadmin: el día a día de la operación. Contador: lo
 * fiscal y el dinero. Encargado: despacho y viajes. Un rol que no está aquí (p. ej. uno nuevo) cae al orden del menú.
 */
const PREFERENCIA: Readonly<Record<string, readonly string[]>> = {
  superadmin: ['/dashboard', '/dashboard/agentes/liquidacion', '/dashboard/despacho', '/dashboard/viajes', '/dashboard/chat'],
  flota_admin: ['/dashboard', '/dashboard/agentes/liquidacion', '/dashboard/despacho', '/dashboard/viajes', '/dashboard/chat'],
  contador: ['/dashboard/contador', '/dashboard/agentes/liquidacion', '/dashboard/agentes/peajes', '/dashboard/agentes/carta-porte', '/dashboard/chat'],
  encargado: ['/dashboard', '/dashboard/despacho', '/dashboard/viajes', '/dashboard/operadores', '/dashboard/unidades'],
};

export interface DestinoMovil { href: string; nombre: string; etiqueta: string; Icono: Item['Icono'] }

/**
 * Los ítems candidatos, sin repetir href y en el orden del menú: Resumen y grupos. El pie (Mi perfil, Ayuda…) NO es destino de
 * barra —vive en «Más» y en el menú de la cuenta— salvo que el rol no vea nada más. Notificaciones tampoco: vive en la cabecera.
 */
function itemsDelMenu(menu: MenuV2): Item[] {
  const vistos = new Set<string>();
  const unicos = (lista: Item[]) => lista.filter((i) => !vistos.has(i.href) && vistos.add(i.href) && i.href !== '/dashboard/notificaciones');
  const principal = unicos([...menu.resumen, ...menu.grupos.flatMap((g) => g.items)]);
  return principal.length > 0 ? principal : unicos(menu.pie);
}

/** Hasta `MAX_DESTINOS` destinos para el rol (con el que se filtra el menú) y su menú ya filtrado. */
export function destinosMovil(rol: string, menu: MenuV2): DestinoMovil[] {
  const ofrecidos = itemsDelMenu(menu);
  const porHref = new Map(ofrecidos.map((i) => [i.href, i]));
  const elegidos: Item[] = [];
  for (const h of PREFERENCIA[rol] ?? []) {
    const it = porHref.get(h);
    if (it && elegidos.length < MAX_DESTINOS) elegidos.push(it);
  }
  for (const it of ofrecidos) {
    if (elegidos.length >= MAX_DESTINOS) break;
    if (!elegidos.includes(it)) elegidos.push(it);
  }
  return elegidos.map((i) => ({ href: i.href, nombre: i.nombre, etiqueta: ETIQUETA_CORTA[i.href] ?? i.nombre, Icono: i.Icono }));
}
