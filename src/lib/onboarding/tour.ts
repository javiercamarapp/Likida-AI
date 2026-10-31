import type { Recorrido, PasoTour } from '@/app/ui-v2/movimiento/tour/tipos';
import { menuPorPerfil, hrefsDelMenu, type MenuV2 } from '@/app/dashboard/shell/menu-por-perfil';
import { nombreDeRol } from '@/lib/auth/roles';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { ANCLA_TITULO, PANTALLAS } from './pantallas';
import { anclaNav, slugDe } from './anclas';
import { pistaDeRol, rolTienePermiso } from './roles';
import type { ClaveVariante, Modo, Pista, TextosPantalla } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL RECORRIDO SE DERIVA DEL MENÚ REAL (no es una lista aparte). Por cada pantalla que el rol ve:
//   <slug>.ir      señala el ítem del menú (avanza al hacer clic o con «Llévame»)
//   <slug>.que     qué es la pantalla
//   <slug>.clave   el elemento clave
//   <slug>.accion  solo si el rol tiene el permiso de actuar ahí
// y un paso final `cierre`. Los ids son los mismos en el modo corto y el completo: lo guardado vale para los dos.
// ═══════════════════════════════════════════════════════════════════════════

const HREF_ASISTENTE_PERFIL = '/dashboard/puesta-en-marcha';
const HREF_ASISTENTE_FLOTA = '/dashboard/arranque';

/** Pantallas del menú de un rol/perfil que tienen contenido de recorrido, en el orden del menú. */
export function pantallasDelMenu(menu: MenuV2): string[] {
  return hrefsDelMenu(menu).filter((h) => Object.hasOwn(PANTALLAS, h));
}

type Clave = 'ir' | 'que' | 'clave' | 'accion';
/** Qué pasos de qué pantallas entran en el modo corto, por pista. Las que el rol no ve se omiten. Con el cierre suman ~12. */
export const ESENCIALES: Readonly<Record<Pista, ReadonlyArray<readonly [string, readonly Clave[]]>>> = {
  dueno: [
    ['/dashboard', ['ir', 'que', 'clave']], ['/dashboard/chat', ['ir', 'que']], ['/dashboard/agentes/liquidacion', ['ir', 'que']],
    ['/dashboard/despacho', ['ir', 'que']], ['/dashboard/puesta-en-marcha', ['ir', 'que']], ['/dashboard/arranque', ['ir', 'que']],
    ['/dashboard/conexiones', ['ir', 'que']],
  ],
  encargado: [
    ['/dashboard', ['ir', 'que', 'clave']], ['/dashboard/despacho', ['ir', 'que']], ['/dashboard/viajes', ['ir', 'que']],
    ['/dashboard/operadores', ['ir', 'que']], ['/dashboard/viajes-en-vivo', ['ir', 'que']],
  ],
  contador: [
    ['/dashboard/contador', ['ir', 'que', 'clave']], ['/dashboard/agentes/liquidacion', ['ir', 'que', 'clave']],
    ['/dashboard/agentes/peajes', ['ir', 'que']], ['/dashboard/facturacion', ['ir', 'que']], ['/dashboard/notificaciones', ['ir', 'que']],
  ],
  nomina: [
    ['/dashboard/agentes/liquidacion', ['ir', 'que', 'clave']], ['/dashboard/notificaciones', ['ir', 'que']], ['/dashboard/mi-perfil', ['ir', 'que']],
  ],
};

function variante(rol: string, perfil: PerfilTenant | null | undefined): ClaveVariante[] {
  const claves: ClaveVariante[] = [];
  if (rol === 'contador' || rol === 'encargado' || rol === 'nomina') claves.push(rol);
  if (perfil === 'cinco_agentes') claves.push('cinco_agentes');
  return claves;
}

/** Textos de una pantalla para un rol/perfil: el general, con la variante del rol o del perfil encima si la hay. */
export function textosDe(href: string, rol: string, perfil?: PerfilTenant | null): { que: string; claveTitulo: string; claveTexto: string } {
  const def = PANTALLAS[href];
  let que = def.que, claveTitulo = def.clave.titulo, claveTexto = def.clave.texto;
  for (const k of variante(rol, perfil)) {
    const v = def.variantes?.[k];
    if (!v) continue;
    if (v.que) que = v.que;
    if (v.claveTitulo) claveTitulo = v.claveTitulo;
    if (v.claveTexto) claveTexto = v.claveTexto;
  }
  return { que, claveTitulo, claveTexto };
}

export function accionDe(href: string, rol: string): TextosPantalla['accion'] | null {
  const acc = PANTALLAS[href]?.accion;
  return acc && rolTienePermiso(rol, acc.permiso) ? acc : null;
}

export function nombreDePantalla(menu: MenuV2, href: string): string {
  return [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie].find((i) => i.href === href)?.nombre ?? href;
}

/** El paso de cierre; ofrece pasar al asistente (Puesta en marcha / Arranque) si el rol lo ve. */
function cierre(menu: MenuV2): PasoTour {
  const hrefs = hrefsDelMenu(menu);
  const asistente = hrefs.includes(HREF_ASISTENTE_PERFIL) ? HREF_ASISTENTE_PERFIL : hrefs.includes(HREF_ASISTENTE_FLOTA) ? HREF_ASISTENTE_FLOTA : null;
  return {
    id: 'cierre', tipo: 'cierre', ilu: 'cierre',
    titulo: 'Listo. Aquí te dejo',
    texto: asistente
      ? 'Vuelve a la Guía cuando quieras: repite el recorrido o salta a una pantalla. Lo siguiente es tu lista de primeros pasos.'
      : 'Vuelve a la Guía cuando quieras: repite el recorrido o salta a una pantalla. Si algo no queda claro, abre el Centro de ayuda.',
    ...(asistente ? { cta: { etiqueta: asistente === HREF_ASISTENTE_PERFIL ? 'Ir a Puesta en marcha' : 'Ir a Arranque', ruta: asistente } } : {}),
  };
}

/** Los pasos de UNA pantalla (ir, que, clave, accion), con `previa` como ruta donde está el menú al llegar. */
function pasosDePantalla(href: string, rol: string, perfil: PerfilTenant | null | undefined, menu: MenuV2, previa: string | undefined): Record<Clave, PasoTour | null> {
  const t = textosDe(href, rol, perfil), def = PANTALLAS[href], slug = slugDe(href), nombre = nombreDePantalla(menu, href);
  const base = { pantalla: href, nombrePantalla: nombre, ilu: def.ilu, tipo: 'info' as const };
  const acc = accionDe(href, rol);
  return {
    ir: {
      ...base, tipo: 'ir', id: `${slug}.ir`, ruta: previa, ancla: anclaNav(href), lado: 'derecha',
      titulo: `Ve a ${nombre}`,
      texto: `Haz clic en «${nombre}» en el menú. Si prefieres, pulsa Llévame y lo hago por ti.`,
      avance: { tipo: 'accion', evento: 'click' },
      accion: { verbo: 'Aprieta', objetivo: nombre },
    },
    que: { ...base, id: `${slug}.que`, ruta: href, ancla: ANCLA_TITULO, lado: 'abajo', titulo: nombre, texto: t.que },
    clave: { ...base, id: `${slug}.clave`, ruta: href, ancla: def.clave.ancla, lado: 'abajo', titulo: t.claveTitulo, texto: t.claveTexto },
    accion: acc ? {
      ...base, id: `${slug}.accion`, ruta: href, ancla: acc.ancla, lado: 'abajo', titulo: acc.titulo, texto: acc.texto,
      accion: { verbo: acc.verbo, objetivo: acc.objetivo },
    } : null,
  };
}

/** Construye el recorrido de un rol/perfil. null = el rol no tiene recorrido (vendedor, rol desconocido) o su menú está vacío. */
export function construirRecorrido(rol: string, perfil: PerfilTenant | null | undefined, modo: Modo = 'completo'): Recorrido | null {
  const pista = pistaDeRol(rol);
  if (!pista) return null;
  const menu = menuPorPerfil(rol, perfil);
  const hrefs = pantallasDelMenu(menu);
  if (hrefs.length === 0) return null;

  const elegidas: Array<{ href: string; claves: readonly Clave[] | null }> = modo === 'corto'
    ? ESENCIALES[pista].filter(([h]) => hrefs.includes(h)).map(([href, claves]) => ({ href, claves }))
    : hrefs.map((href) => ({ href, claves: null }));
  const lista = elegidas.length > 0 ? elegidas : hrefs.map((href) => ({ href, claves: null }));

  const pasos: PasoTour[] = [];
  let previa: string | undefined;
  lista.forEach(({ href, claves }, grupo) => {
    const todos = pasosDePantalla(href, rol, perfil, menu, previa);
    for (const k of ['ir', 'que', 'clave', 'accion'] as const) {
      const paso = todos[k];
      if (paso && (!claves || claves.includes(k))) pasos.push({ ...paso, grupo });
    }
    previa = href;
  });
  pasos.push(cierre(menu));
  const nombre = pista === 'dueno' ? nombreDeRol('flota_admin') : nombreDeRol(rol);
  return { id: `${pista}.${modo}`, version: 1, titulo: `Recorrido: ${nombre}`, pasos, pista, modo };
}

/** Cuántos pasos cuenta la tarjeta: los saltos de menú («ir») no cuentan, el cierre sí. */
export const contarPasos = (pasos: readonly PasoTour[]): number => pasos.filter((p) => p.tipo !== 'ir').length;

/** Pantallas del recorrido, en orden, con el índice de su primer paso. */
export function pantallasDeRecorrido(r: Recorrido): Array<{ href: string; nombre: string; desde: number }> {
  const salida: Array<{ href: string; nombre: string; desde: number }> = [];
  r.pasos.forEach((p, i) => {
    if (p.pantalla && !salida.some((g) => g.href === p.pantalla)) salida.push({ href: p.pantalla, nombre: p.nombrePantalla ?? p.pantalla, desde: i });
  });
  return salida;
}
