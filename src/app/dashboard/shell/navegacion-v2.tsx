'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { moduloProximamenteDeRuta, rutaProximamente, type PerfilTenant } from '@/lib/auth/visibilidad';
import type { Item } from '../rutas';
import { useSufijoYRol } from '../sidebar-nav';
import { EnlaceCuenta } from '../enlace-cuenta';
import { SelectorTema } from '../../selector-tema';
import { WidgetUso } from '../../admin/ui/kit';
import { menuPorPerfil, hrefActivo, type MenuV2 } from './menu-por-perfil';

// ═══════════════════════════════════════════════════════════════════════════
// LA NAVEGACIÓN v2 — una sola pieza para el sidebar de escritorio y la hoja «Más» del móvil.
//
// Contrato que NO se rompe (de las pruebas de navegación y de los e2e): enlaces `<a href>` reales, el mismo sufijo
// `?tenant/?vista/?rol` en cada uno (`useSufijoYRol`, EXPORTADO desde `sidebar-nav.tsx` y reutilizado, no copiado),
// los mismos nombres de siempre, y `aria-current="page"` en el ítem activo (el sidebar de siempre no lo tenía).
// ═══════════════════════════════════════════════════════════════════════════

/** Iniciales para el avatar de la tarjeta de cuenta (mientras llega el Monograma de las primitivas). */
export function iniciales(nombre: string | null): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return 'F';
  const dos = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : partes[0].slice(0, 2);
  return dos.toUpperCase();
}

/** `/dashboard/agentes/peajes` → `agentes-peajes`; la raíz → `resumen`. */
export function anclaDe(href: string): string {
  return href.replace(/^\/dashboard\/?/, '').replace(/\//g, '-') || 'resumen';
}

function Fila({ item, sufijo, activo, perfil, insignia, alNavegar }: {
  item: Item; sufijo: string; activo: boolean; perfil?: PerfilTenant | null; insignia?: string; alNavegar?: () => void;
}) {
  // «Próximamente» (fase 1 del perfil): el módulo se ve pero su enlace va a la pantalla única de anuncio.
  const modulo = perfil ? moduloProximamenteDeRuta(perfil, item.href) : null;
  const destino = modulo ? rutaProximamente(modulo) : item.href;
  const esActivo = activo && !modulo;
  return (
    <li>
      <Link
        href={`${destino}${sufijo}`}
        className="rv-item"
        aria-current={esActivo ? 'page' : undefined}
        aria-label={modulo ? `${item.nombre}, próximamente` : undefined}
        title={modulo ? `${item.nombre} (Próximamente)` : item.nombre}
        // Ancla ESTABLE para el recorrido guiado (`data-tour`): no depende de clases ni de textos.
        data-tour={`nav-${anclaDe(item.href)}`}
        onClick={alNavegar}
      >
        <item.Icono className="rv-item__ico" width={16} height={16} strokeWidth={1.75} aria-hidden />
        <span className="rv-item__txt">{item.nombre}</span>
        {modulo && <span className="rv-chip" aria-hidden>Próximamente</span>}
        {!modulo && insignia && <span className="rv-insignia">{insignia}</span>}
      </Link>
    </li>
  );
}

function Lista({ items, ...resto }: { items: Item[]; sufijo: string; activo: string | null; perfil?: PerfilTenant | null; insignias?: Record<string, string>; alNavegar?: () => void }) {
  return (
    <ul className="rv-lista">
      {items.map((it) => (
        <Fila key={it.href} item={it} sufijo={resto.sufijo} activo={resto.activo === it.href} perfil={resto.perfil}
          insignia={resto.insignias?.[it.href]} alNavegar={resto.alNavegar} />
      ))}
    </ul>
  );
}

/** El árbol completo: Resumen, grupos y (opcional) pie. Lo pinta el sidebar y la hoja «Más». */
export function ArbolMenu({ menu, sufijo, pathname, perfil, insignias, alNavegar, conPie = false }: {
  menu: MenuV2; sufijo: string; pathname: string; perfil?: PerfilTenant | null;
  insignias?: Record<string, string>; alNavegar?: () => void; conPie?: boolean;
}) {
  const activo = hrefActivo(pathname, menu);
  const props = { sufijo, activo, perfil, insignias, alNavegar };
  return (
    <>
      {menu.resumen.length > 0 && <Lista items={menu.resumen} {...props} />}
      {menu.grupos.map((g) => (
        <section key={g.id} aria-labelledby={`rv-g-${g.id}`} className="rv-grupo">
          <h2 id={`rv-g-${g.id}`} className="rv-grupo__t">{g.titulo}</h2>
          <Lista items={g.items} {...props} />
        </section>
      ))}
      {conPie && menu.pie.length > 0 && <Lista items={menu.pie} {...props} />}
    </>
  );
}

/** El pie: tema y tarjeta de cuenta (avatar, nombre, rol y salir). */
export function PieCuenta({ nombre, rol, rolEtiqueta, cerrarSesion }: { nombre: string | null; rol: string; rolEtiqueta: string; cerrarSesion?: () => Promise<void> }) {
  return (
    <div className="rv-cuenta">
      <span className="rv-avatar" aria-hidden>{iniciales(nombre)}</span>
      <div className="rv-cuenta__txt">
        {/* Mismo contrato de sufijo que el menú: un superadmin que previsualiza una flota no pierde `?tenant=`. */}
        <EnlaceCuenta rol={rol} className="rv-cuenta__nombre">{(nombre ?? '').trim() || 'Mi cuenta'}</EnlaceCuenta>
        <div className="rv-cuenta__rol">{rolEtiqueta}</div>
      </div>
      {cerrarSesion && (
        <form action={cerrarSesion} className="rv-cuenta__salir">
          <button type="submit" title="Cerrar sesión" aria-label="Cerrar sesión" className="rv-icono-boton">
            <LogOut width={14} height={14} strokeWidth={1.75} aria-hidden />
          </button>
        </form>
      )}
    </div>
  );
}

/** El pie compartido: ítems fijos, uso de IA (solo sin perfil), selector de tema y cuenta. */
export function PieMenu({ menu, sufijo, pathname, perfil, rol, rolEtiqueta, nombre, usoIa, cerrarSesion, insignias, alNavegar }: {
  menu: MenuV2; sufijo: string; pathname: string; perfil?: PerfilTenant | null; rol: string; rolEtiqueta: string; nombre: string | null;
  usoIa?: { pct: number } | null; cerrarSesion?: () => Promise<void>; insignias?: Record<string, string>; alNavegar?: () => void;
}) {
  const activo = hrefActivo(pathname, menu);
  return (
    <>
      {usoIa !== undefined && !perfil && (
        <div className="rv-uso">
          <WidgetUso
            etiqueta="Análisis con IA · hoy"
            valor={usoIa ? `${usoIa.pct}%` : null}
            detalle={usoIa ? 'del análisis incluido hoy — se renueva a medianoche' : undefined}
            tope={usoIa ? { usado: usoIa.pct, limite: 100 } : null}
            href={`/dashboard/chat${sufijo}`} hrefTexto="Preguntar a tus datos"
          />
        </div>
      )}
      {menu.pie.length > 0 && <Lista items={menu.pie} sufijo={sufijo} activo={activo} perfil={perfil} insignias={insignias} alNavegar={alNavegar} />}
      <div className="rv-tema"><SelectorTema /></div>
      <PieCuenta nombre={nombre} rol={rol} rolEtiqueta={rolEtiqueta} cerrarSesion={cerrarSesion} />
    </>
  );
}

/** Lee lo que la navegación necesita del entorno del cliente (ruta, sufijo del superadmin y rol con que se filtra). */
export function useMenuV2(rol: string, perfil?: PerfilTenant | null) {
  const pathname = usePathname();
  const { sufijo, rolMenu } = useSufijoYRol(rol);
  return { pathname, sufijo, menu: menuPorPerfil(rolMenu, perfil) };
}
