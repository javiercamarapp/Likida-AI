'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BarraFiltros, BotonEnlace, FiltroBusqueda, Icono } from '@/app/ui-v2/componentes';
import { numero } from '@/lib/formato';
import { useT, useIdioma } from '@/lib/i18n/proveedor';
import { dashboard_b as dashboard_bEs } from '@/lib/i18n/es/dashboard_b';

// La parte con TEXTO de `registro-filtro.tsx` (que es de servidor y recibe filas enteras): aquí solo entran primitivos y enlaces ya
// armados, así que el idioma se lee con `useT` sin serializar las filas al navegador.

export function BuscadorRegistro({ ruta, sustantivo, camposOcultos, nombreQ, q, limpiarHref }: {
  ruta: string; sustantivo: string; camposOcultos: Array<[string, string]>; nombreQ: string; q: string; limpiarHref: string;
}) {
  const { t } = useT('dashboard_b', dashboard_bEs);
  return (
    <BarraFiltros buscar accion={ruta} enLinea etiqueta={t('reg.buscar_en', { sustantivo })} ocultos={camposOcultos} nActivos={q !== '' ? 1 : 0}
      limpiarHref={limpiarHref}>
      <FiltroBusqueda nombre={nombreQ} valor={q} placeholder={t('reg.buscar_ph', { sustantivo })} etiqueta={t('reg.buscar_en', { sustantivo })} />
    </BarraFiltros>
  );
}

/** El texto «25 de N» + la paginación Anterior / Siguiente. Una sola pieza para el encabezado (modo clásico) y el pie de la tabla. */
export function ConteoRegistroTexto({ hayFiltro, filtrados, total, nFilas, sustantivo, paginas, paginaActual, hrefAnterior, hrefSiguiente }: {
  hayFiltro: boolean; filtrados: number; total: number; nFilas: number; sustantivo: string; paginas: number; paginaActual: number;
  hrefAnterior: string; hrefSiguiente: string;
}) {
  const { t } = useT('dashboard_b', dashboard_bEs);
  const idioma = useIdioma();
  return (
  <div className="flex items-center gap-3 text-[12px] text-[var(--muted)]">
    <span>
      {hayFiltro
        ? t(filtrados === 1 ? 'reg.coincide' : 'reg.coinciden', { n: numero(filtrados, idioma), total: numero(total, idioma) })
        : t('reg.de', { n: numero(nFilas, idioma), total: numero(total, idioma), sustantivo })}
    </span>
    {paginas > 1 && (
      <span className="flex items-center gap-2">
        {paginaActual > 1 ? (
          <BotonEnlace href={hrefAnterior}
            variante="ghost" tamano="sm" rel="prev" icono={<Icono icono={ChevronLeft} tam={14} />}>{t('pag.anterior')}</BotonEnlace>
        ) : <span className="inline-flex items-center gap-1 px-2.5 text-[var(--faint)]"><Icono icono={ChevronLeft} tam={14} />{t('pag.anterior')}</span>}
        <span className="tabular">{t('reg.pagina', { n: numero(paginaActual, idioma), total: numero(paginas, idioma) })}</span>
        {paginaActual < paginas ? (
          <BotonEnlace href={hrefSiguiente}
            variante="ghost" tamano="sm" rel="next">{t('pag.siguiente')}<Icono icono={ChevronRight} tam={14} /></BotonEnlace>
        ) : <span className="inline-flex items-center gap-1 px-2.5 text-[var(--faint)]">{t('pag.siguiente')}<Icono icono={ChevronRight} tam={14} /></span>}
      </span>
    )}
  </div>
  );
}
