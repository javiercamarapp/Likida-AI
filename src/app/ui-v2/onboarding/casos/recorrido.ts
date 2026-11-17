import type { Recorrido, PasoTour } from '@/app/ui-v2/movimiento/tour/tipos';
import { menuPorPerfil, hrefsDelMenu } from '@/app/dashboard/shell/menu-por-perfil';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import type { Idioma } from '@/lib/i18n/idioma';
import { anclaNav, slugDe } from '../anclas';
import { ctxOnb } from '../idioma';
import { CASOS, CASOS_EN } from './index';
import { ANCLA_CASO_POR_OMISION, type EtapaCaso } from './tipos';

export const idRecorridoCaso = (href: string) => `caso.${slugDe(href)}`;

/** Recorrido «Ver caso de esta pantalla»: ir a la pantalla (si no se está en ella), una tarjeta por paso del caso y un cierre.
 *  null si la pantalla no tiene caso o el rol no la abre (mismo filtro que los recorridos por agente: el menú real del rol y perfil). */
export function construirRecorridoCaso(href: string, rol: string, perfil: PerfilTenant | null | undefined, idioma: Idioma = 'es'): Recorrido | null {
  const es = CASOS[href];
  if (!es) return null;
  const caso = idioma === 'en' ? CASOS_EN[href] ?? es : es;
  const menu = menuPorPerfil(rol, perfil);
  if (!hrefsDelMenu(menu).includes(href)) return null;
  const item = [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie].find((i) => i.href === href);
  const cx = ctxOnb(idioma);
  const nombre = cx.nav(item?.nombre ?? href);
  const slug = slugDe(href);
  const base = { pantalla: href, nombrePantalla: nombre, ilu: 'lista', grupo: 0 };
  const pasos: PasoTour[] = [
    { ...base, tipo: 'ir', id: `${slug}.ir`, ancla: anclaNav(href), lado: 'derecha', titulo: cx.t('agente.ir.titulo', { nombre }),
      texto: cx.t('agente.ir.texto', { nombre }), avance: { tipo: 'accion', evento: 'click' }, accion: { verbo: cx.t('tour.ir.verbo'), objetivo: nombre } },
  ];
  caso.pasos.forEach((p, i) => {
    const etapa = cx.t(`caso.etapa.${p.etapa}` as `caso.etapa.${EtapaCaso}`);
    const ancla = p.ancla ?? ANCLA_CASO_POR_OMISION;
    pasos.push({ ...base, tipo: 'info', id: `${slug}.caso${i + 1}`, ruta: href, ancla, lado: 'abajo', titulo: `${etapa}: ${p.titulo}`, texto: p.texto });
    if (p.persona) pasos.push({ ...base, tipo: 'info', id: `${slug}.caso${i + 1}.persona`, ruta: href, ancla, lado: 'abajo', titulo: `${etapa}: ${cx.t('caso.persona.titulo')}`, texto: p.persona });
  });
  pasos.push({ tipo: 'cierre', ilu: 'cierre', id: 'cierre', titulo: cx.t('caso.cierre.titulo', { nombre }), texto: cx.t('caso.cierre.texto') });
  return { id: idRecorridoCaso(href), version: 1, titulo: `${cx.t('caso.titulo')}: ${caso.titulo}`, pasos, pista: 'caso', modo: 'completo' };
}

/** Un recorrido por cada pantalla con caso que el rol puede abrir. */
export function recorridosDeCasos(rol: string, perfil: PerfilTenant | null | undefined, idioma: Idioma = 'es'): Recorrido[] {
  return Object.keys(CASOS).map((h) => construirRecorridoCaso(h, rol, perfil, idioma)).filter((r): r is Recorrido => r !== null);
}
