'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Settings } from 'lucide-react';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';
import { moduloProximamenteDeRuta, rutaProximamente, type PerfilTenant } from '@/lib/auth/visibilidad';
import type { Item } from '../rutas';
import { useSufijoYRol } from '../sidebar-nav';
import { menuPorPerfil, hrefActivo, hrefsDelMenu, HREF_NOTIFICACIONES, HREF_PUESTA_EN_MARCHA, type MenuV2, type GrupoMenu } from './menu-por-perfil';
import MenuCuenta from './menu-cuenta';
import PieSidebar from '../../ui-v2/componentes/pie-sidebar';

// ═══════════════════════════════════════════════════════════════════════════
// LA NAVEGACIÓN v2 — una sola pieza para el sidebar de escritorio y la hoja «Más» del móvil.
//
// Contrato que NO se rompe (de las pruebas de navegación y de los e2e): enlaces `<a href>` reales, el mismo sufijo
// `?tenant/?vista/?rol` en cada uno (`useSufijoYRol`, EXPORTADO desde `sidebar-nav.tsx` y reutilizado, no copiado),
// los mismos nombres de siempre, y `aria-current="page"` en el ítem activo (el sidebar de siempre no lo tenía).
//
// ESTRUCTURA (ESTILO-LIKIDA §4): Resumen → AGENTES (caption estático + ítems sueltos, siempre visibles) → acordeón de
// UNA sola categoría abierta → pie fijo (Puesta en marcha <6/6 · tarjeta de cuenta; el resto, en el menú de la tarjeta).
// ═══════════════════════════════════════════════════════════════════════════

export { iniciales, anclaDe, avanceDe } from './nav-utiles';
import { iniciales, anclaDe, avanceDe } from './nav-utiles';
import { TRAZO_ICONO } from '../../ui-v2/componentes/icono';

type Insignias = Record<string, string> | undefined;

function Fila({ item, sufijo, activo, perfil, insignia, alNavegar, claseExtra }: {
  item: Item; sufijo: string; activo: boolean; perfil?: PerfilTenant | null; insignia?: string; alNavegar?: () => void; claseExtra?: string;
}) {
  // «Próximamente» (fase 1 del perfil): el módulo se ve pero su enlace va a la pantalla única de anuncio.
  const modulo = perfil ? moduloProximamenteDeRuta(perfil, item.href) : null;
  const destino = modulo ? rutaProximamente(modulo) : item.href;
  const { t } = useT('shell', shellEs);
  const esActivo = activo && !modulo;
  // Contador de pendientes: solo si es un número > 0 («requiere acción tuya»); si no, ausente.
  const n = insignia && /^\d+$/.test(insignia) ? Number(insignia) : 0;
  const rotulo = modulo ? t('nav.proximamente', { nombre: item.nombre }) : item.nombre;
  return (
    <li>
      {/* `title` se queda en los ítems CON texto visible: solo se ve en el riel (72 px), donde el texto se oculta, y un Tooltip repetiría
          el nombre accesible (aria-describedby) en cada fila. Los botones de SOLO icono sí usan `Tooltip`. */}
      <Link
        href={`${destino}${sufijo}`}
        className={claseExtra ? `rv-item ${claseExtra}` : 'rv-item'}
        aria-current={esActivo ? 'page' : undefined}
        aria-label={modulo ? rotulo : undefined}
        title={rotulo}
        // Ancla ESTABLE para el recorrido guiado (`data-tour`): no depende de clases ni de textos.
        data-tour={`nav-${anclaDe(item.href)}`}
        onClick={alNavegar}
      >
        <item.Icono className="rv-item__ico" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
        <span className="rv-item__txt">{item.nombre}</span>
        {modulo && <span className="rv-chip" aria-hidden>Próximamente</span>}
        {!modulo && n > 0 && <span className="rv-contador" aria-label={`${n} pendientes`}>{n > 99 ? '99+' : n}</span>}
      </Link>
    </li>
  );
}

function Lista({ items, sufijo, activo, perfil, insignias, alNavegar }: {
  items: Item[]; sufijo: string; activo: string | null; perfil?: PerfilTenant | null; insignias?: Insignias; alNavegar?: () => void;
}) {
  return (
    <ul className="rv-lista">
      {items.map((it) => (
        <Fila key={it.href} item={it} sufijo={sufijo} activo={activo === it.href} perfil={perfil}
          insignia={insignias?.[it.href]} alNavegar={alNavegar} />
      ))}
    </ul>
  );
}

/** Los ítems de un grupo, sin «Puesta en marcha» cuando el asistente va <6/6 (ahí vive como fila del pie, no duplicada). */
function itemsVisibles(g: GrupoMenu, insignias: Insignias): Item[] {
  return insignias?.[HREF_PUESTA_EN_MARCHA] ? g.items.filter((i) => i.href !== HREF_PUESTA_EN_MARCHA) : g.items;
}

/**
 * El árbol: Resumen, grupos y (opcional) pie. Lo pinta el sidebar (con acordeón de UNA categoría abierta) y la hoja «Más»
 * (`plano`: todo el árbol a la vista, sin acordeón).
 */
export function ArbolMenu({ menu, sufijo, pathname, perfil, insignias, alNavegar, conPie = false, plano = false }: {
  menu: MenuV2; sufijo: string; pathname: string; perfil?: PerfilTenant | null;
  insignias?: Insignias; alNavegar?: () => void; conPie?: boolean; plano?: boolean;
}) {
  const activo = hrefActivo(pathname, menu);
  const props = { sufijo, activo, perfil, insignias, alNavegar };
  const colapsables = menu.grupos.filter((g) => !g.estatico && !plano);
  const grupoDelActivo = menu.grupos.find((g) => !g.estatico && g.items.some((i) => i.href === activo))?.id ?? null;
  // Siempre UNA sola categoría abierta. Navegar a una ruta de otra categoría la abre (y cierra la que estaba abierta): se ajusta
  // durante el render (patrón de React para estado derivado de una prop), no en un efecto.
  const [est, setEst] = useState<{ ref: string | null; abierta: string | null }>({ ref: grupoDelActivo, abierta: grupoDelActivo ?? colapsables[0]?.id ?? null });
  if (est.ref !== grupoDelActivo) setEst({ ref: grupoDelActivo, abierta: grupoDelActivo ?? est.abierta });
  const abierta = est.abierta;
  const setAbierta = (id: string | null) => setEst({ ref: est.ref, abierta: id });
  const { t } = useT('shell', shellEs);
  // «Página actual»: si el usuario cerró (o abrió otra) la categoría de la pantalla en que está, esa pantalla no se ve en el árbol y
  // el sidebar parece no saber dónde estás. El bloque la repite arriba; en cuanto se abre su categoría, desaparece (nunca dos a la vez).
  const itemActual = !plano && grupoDelActivo && abierta !== grupoDelActivo
    ? menu.grupos.find((g) => g.id === grupoDelActivo)?.items.find((i) => i.href === activo) ?? null
    : null;

  // El ítem activo se deja a la vista cuando el árbol scrollea (p. ej. al llegar por ⌘K a una pantalla de abajo). Espera a que
  // termine de abrirse la categoría (180 ms) para medir con el alto final.
  useEffect(() => {
    if (plano || !activo || typeof document === 'undefined') return;
    const id = window.setTimeout(() => {
      document.querySelector<HTMLElement>('.rv-sb__nav [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 200);
    return () => window.clearTimeout(id);
  }, [plano, activo, abierta]);

  return (
    <>
      {menu.resumen.length > 0 && <Lista items={menu.resumen} {...props} />}
      {itemActual && (
        <section aria-labelledby="rv-g-pagina-actual" className="rv-grupo rv-pagina-actual" data-estatico>
          <p id="rv-g-pagina-actual" className="rv-grupo__t">{t('nav.paginaActual')}</p>
          <Lista items={[itemActual]} {...props} />
        </section>
      )}
      {menu.grupos.map((g) => {
        const items = itemsVisibles(g, insignias);
        if (items.length === 0) return null;
        const idT = `rv-g-${g.id}`;
        if (g.estatico || plano) {
          return (
            <section key={g.id} aria-labelledby={idT} className="rv-grupo" data-estatico>
              <h2 id={idT} className="rv-grupo__t">{g.titulo}</h2>
              <Lista items={items} {...props} />
            </section>
          );
        }
        const esta = abierta === g.id;
        return (
          <section key={g.id} aria-labelledby={idT} className="rv-grupo" data-abierto={esta ? '' : undefined}>
            <h2 className="rv-grupo__h">
              <button type="button" id={idT} className="rv-grupo__t rv-grupo__tog" aria-expanded={esta} aria-controls={`${idT}-c`}
                onClick={() => setAbierta(esta ? null : g.id)}>
                {g.titulo}
                <ChevronDown className="rv-grupo__chev" width={14} height={14} strokeWidth={TRAZO_ICONO} aria-hidden />
              </button>
            </h2>
            <div id={`${idT}-c`} className="rv-grupo__cuerpo" role="region" aria-labelledby={idT}>
              <div className="rv-grupo__int"><Lista items={items} {...props} /></div>
            </div>
          </section>
        );
      })}
      {conPie && menu.pie.length > 0 && <Lista items={menu.pie} {...props} />}
    </>
  );
}

/** «Puesta en marcha» en el pie (solo <6/6): 6 segmentos de 6 px + «3/6»; es un enlace al asistente. */
function FilaPuesta({ avance, sufijo, alNavegar, activo }: { avance: { n: number; t: number }; sufijo: string; alNavegar?: () => void; activo: boolean }) {
  const t = Math.min(Math.max(avance.t, 1), 12);
  return (
    <Link href={`${HREF_PUESTA_EN_MARCHA}${sufijo}`} className="rv-puesta" aria-current={activo ? 'page' : undefined}
      aria-label={`Puesta en marcha, ${avance.n} de ${avance.t}`} title="Puesta en marcha" data-tour="nav-puesta-en-marcha" onClick={alNavegar}>
      <span className="rv-puesta__txt">Puesta en marcha</span>
      <span className="rv-puesta__seg" aria-hidden>
        {[...Array(t)].map((_, i) => <i key={i} data-on={i < avance.n ? '' : undefined} />)}
      </span>
      <span className="rv-puesta__n" aria-hidden>{avance.n}/{avance.t}</span>
    </Link>
  );
}

/**
 * El pie fijo: el `PieSidebar` compartido con /admin (organización · Avisos · Administración (solo superadmin) · tema e idioma · tarjeta de
 * usuario) y, arriba, «Puesta en marcha» (solo <6/6). Mi perfil, Ayuda, Plan y Configuración siguen en el menú de la tarjeta.
 * «Avisos» lleva la cifra solo si `insignias` la trae (número entero); sin ella no se pinta ninguna: nunca un 0 inventado.
 */
export function PieMenu({ menu, sufijo, rol, rolEtiqueta, nombre, usoIa, cerrarSesion, insignias, perfil, alNavegar, pathname, organizacion }: {
  menu: MenuV2; sufijo: string; pathname: string; perfil?: PerfilTenant | null; rol: string; rolEtiqueta: string; nombre: string | null;
  usoIa?: { pct: number } | null; cerrarSesion?: () => Promise<void>; insignias?: Insignias; alNavegar?: () => void;
  /** La flota que se está viendo (nombre leído en el servidor). `null`/ausente = no se pudo saber: el pie lo dice. */
  organizacion?: { id: string; nombre: string } | null;
}) {
  const activo = hrefActivo(pathname, menu);
  // Todo lo que el pie ya no pinta como fila (Mi perfil, Ayuda y, en el menú genérico, Plan y Configuración) va al menú de la tarjeta.
  const filasMenuCuenta = menu.pie.filter((i) => i.href !== HREF_NOTIFICACIONES);
  const avance = avanceDe(insignias?.[HREF_PUESTA_EN_MARCHA]);
  const enMenu = menu.grupos.some((g) => g.items.some((i) => i.href === HREF_PUESTA_EN_MARCHA));
  const insigniaAvisos = insignias?.[HREF_NOTIFICACIONES];
  const pendientes = insigniaAvisos && /^\d+$/.test(insigniaAvisos) ? Number(insigniaAvisos) : undefined;
  const hayAvisos = hrefsDelMenu(menu).includes(HREF_NOTIFICACIONES);
  return (
    <PieSidebar
      alNavegar={alNavegar}
      extra={avance && enMenu ? <FilaPuesta avance={avance} sufijo={sufijo} alNavegar={alNavegar} activo={activo === HREF_PUESTA_EN_MARCHA} /> : undefined}
      organizacion={{
        opciones: organizacion === undefined ? [] : organizacion ? [{ valor: organizacion.id, nombre: organizacion.nombre }] : null,
        actual: organizacion?.id ?? null,
        hrefIr: () => `/dashboard${sufijo}`,
      }}
      avisos={hayAvisos ? { href: `${HREF_NOTIFICACIONES}${sufijo}`, pendientes } : null}
      acceso={rol === 'superadmin' ? { href: '/admin', texto: 'Administración de Likida', Icono: Settings } : null}
      tarjeta={<MenuCuenta nombre={nombre} rol={rol} rolEtiqueta={rolEtiqueta} sufijo={sufijo} filas={filasMenuCuenta}
        usoIaPct={usoIa === undefined || perfil ? undefined : usoIa?.pct ?? null} cerrarSesion={cerrarSesion} alNavegar={alNavegar} iniciales={iniciales(nombre)} />}
    />
  );
}

/** Lee lo que la navegación necesita del entorno del cliente (ruta, sufijo del superadmin y rol con que se filtra). */
export function useMenuV2(rol: string, perfil?: PerfilTenant | null) {
  const pathname = usePathname();
  const { sufijo, rolMenu } = useSufijoYRol(rol);
  return { pathname, sufijo, menu: menuPorPerfil(rolMenu, perfil) };
}
