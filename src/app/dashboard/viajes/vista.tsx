import { cifrasUniformes } from '../formato';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { TarjetaTabla } from '../bloque';
import { CajonAlta } from '../cajon-alta';
import { Eye, Inbox } from 'lucide-react';
import { numero, fechaMx, mxn } from '@/lib/formato';
import { PillAviso, PillEstatusViaje } from './pills';
import { ImportarViajes, type AccionImportar } from './importar';
import { EnlacePagina, NavPaginas } from '../paginador';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { BarraFiltros, BotonEnlace, EstadoVacio, FiltroBusqueda, FiltroOpciones, Icono } from '@/app/ui-v2/componentes';
import { CajonVistaRapida, EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import './registro.css';
import { ahoraMs } from '@/lib/saludo';
import { SelloDato, TablaLista, type ColumnaTabla } from '@/app/ui-v2/datos';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';

export type FiltroViajes = 'todos' | 'abiertos' | 'en_cuadre' | 'liquidados' | 'escalados';

/** La fila del registro v2 (22-ago-2026): la ficha operativa del viaje más,
 *  SOLO si la página lo permitió (`verDinero`), el anticipo y lo que su
 *  liquidación comprobó. Los tres pesos vienen `null` cuando el rol no ve
 *  finanzas — la página los deja en el servidor, la vista no los pinta. */
export interface FilaRegistroViaje {
  id: string; folio: string; origen: string | null; destino: string | null;
  estatus: string; operadorNombre: string | null; unidadEco: string | null;
  fechaInicio: string | null;
  intakePendientes: number;
  avisadoEn: string | null; aceptadoEn: string | null; escaladoEn: string | null;
  avisosEnviados: number;
  /** `null` = el rol no ve pesos (no "sin anticipo"). */
  anticipo: number | null;
  /** `null` = sin liquidación todavía, o sin permiso. */
  comprobado: number | null;
  diferencia: number | null;
  liqId: string | null;
  liqEstatus: string | null;
}

const ROTULO_FILTRO = {
  todos: 'viajes.filtro.todos', abiertos: 'viajes.filtro.abiertos', en_cuadre: 'viajes.filtro.en_cuadre',
  liquidados: 'viajes.filtro.liquidados', escalados: 'viajes.filtro.escalados',
} as const satisfies Record<FiltroViajes, string>;

/** Arma un href a esta misma página conservando el sufijo de
 *  previsualización (`?tenant=`/`?vista=`/`?rol=`) y los controles (filtro,
 *  búsqueda, cursor de página). Un `null` quita el parámetro. El `p` de la
 *  paginación por número (hasta el 22-ago-2026) se BORRA siempre: cambiar de
 *  filtro o de búsqueda vuelve a la primera página, y un `p` heredado ya no
 *  significa nada (ver page.tsx). */
export function hrefRegistro(
  sufijo: string,
  controles: { f?: FiltroViajes | null; q?: string | null; c?: string | null; ver?: string | null },
): string {
  const params = new URLSearchParams(sufijo.startsWith('?') ? sufijo.slice(1) : sufijo);
  if (controles.f && controles.f !== 'todos') params.set('f', controles.f); else params.delete('f');
  if (controles.q) params.set('q', controles.q); else params.delete('q');
  if (controles.c) params.set('c', controles.c); else params.delete('c');
  // `ver` abre el cajón de vista rápida de esa fila; sin él (cambiar de filtro, de búsqueda o de página) el cajón se cierra.
  if (controles.ver) params.set('ver', controles.ver); else params.delete('ver');
  params.delete('p');
  const qs = params.toString();
  return `/dashboard/viajes${qs ? `?${qs}` : ''}`;
}


/** Las columnas del registro. Los tres pesos (anticipo, comprobado, diferencia) SOLO existen si el rol ve dinero: para el jefe de
 *  tráfico ni la cabecera se arma. El orden es el del servidor (cursor, del más reciente al más antiguo): ninguna cabecera ordena,
 *  porque ordenar solo la página visible fingiría ordenar el total. */
function columnasViajes(hrefVista: (id: string) => string, verDinero: boolean, tr: TrOperacion): ColumnaTabla<FilaRegistroViaje>[] {
  const { t, idioma } = tr;
  const dinero: ColumnaTabla<FilaRegistroViaje>[] = verDinero ? [
    { id: 'anticipo', titulo: t('viajes.col.anticipo'), alinear: 'der', celda: (v) => (v.anticipo === null ? <span className="rv-tl__nada">—</span> : mxn(v.anticipo, idioma)) },
    { id: 'comprobado', titulo: t('viajes.col.comprobado'), alinear: 'der', celda: (v) => (v.comprobado === null ? <span className="rv-tl__tenue rv-tl__nada">—</span> : mxn(v.comprobado, idioma)) },
    {
      id: 'diferencia', titulo: t('viajes.col.diferencia'), alinear: 'der',
      celda: (v) => v.diferencia === null ? <span className="rv-tl__tenue rv-tl__nada">—</span>
        : <span className={v.diferencia === 0 ? 'rv-tl__ok' : v.diferencia > 0 ? 'rv-tl__warn' : 'rv-tl__bad'}>{v.diferencia === 0 ? t('viajes.exacta') : mxn(Math.abs(v.diferencia), idioma)}</span>,
    },
  ] : [];
  return [
    {
      id: 'viaje', titulo: t('viajes.col.viaje'), principal: true,
      celda: (v) => {
        const ruta = v.origen && v.destino ? `${v.origen} → ${v.destino}` : v.origen ?? v.destino ?? null;
        return (
          <>
            <span className="rv-reg__folio">{v.folio}</span>
            <span className="rv-tl__sub">{ruta ?? t('viajes.sinruta')}</span>
          </>
        );
      },
    },
    { id: 'operador', titulo: t('viajes.col.operador'), celda: (v) => v.operadorNombre ? <span className="rv-reg__nombre" title={v.operadorNombre}>{v.operadorNombre}</span> : <span className="rv-tl__tenue">{t('viajes.sinasignar')}</span> },
    { id: 'unidad', titulo: t('viajes.col.unidad'), corta: true, celda: (v) => (v.unidadEco ? <span className="rv-reg__mono">{v.unidadEco}</span> : <span className="rv-tl__tenue rv-tl__nada">—</span>) },
    { id: 'inicio', titulo: t('viajes.col.inicio'), corta: true, celda: (v) => <span className="rv-tl__apagado">{v.fechaInicio ? fechaMx(v.fechaInicio, idioma) : '—'}</span> },
    ...dinero,
    { id: 'aviso', titulo: t('viajes.col.aviso'), corta: true, celda: (v) => (v.estatus === 'liquidado' ? <span className="rv-tl__tenue rv-tl__nada">—</span> : <PillAviso v={v} tr={tr} />) },
    { id: 'estatus', titulo: t('viajes.col.estatus'), corta: true, celda: (v) => <PillEstatusViaje estatus={v.estatus} tr={tr} /> },
    {
      id: 'accion', titulo: t('viajes.col.accion'), alinear: 'der', tituloOculto: true,
      celda: (v) => (
        <BotonEnlace variante="ghost" tamano="sm" href={hrefVista(v.id)} className="rv-tl__enlace">
          {t('viajes.vr.ver')} <Icono icono={Eye} tam={16} />
        </BotonEnlace>
      ),
    },
  ];
}

/**
 * El Registro de Viajes (F2), v2: navegable, filtrable, buscable y paginado
 * (nunca más de `porPagina` filas por render). Los pesos solo se pintan
 * cuando la página los mandó (`verDinero`); para el jefe de tráfico las
 * tres columnas no existen, ni vacías.
 */
export function VistaViajes({ tr = TR_OPERACION_ES,
  filas, filtro, conteos, sufijo, importar, puedeImportar, verDinero, q, cursor, siguiente, hayMas, porPagina, ver = null,
}: { tr?: TrOperacion;
  filas: FilaRegistroViaje[];
  filtro: FiltroViajes;
  conteos: {
    total: number | null; abiertos: number | null; enCuadre: number | null;
    liquidados: number | null; escalados: number | null;
  };
  sufijo: string;
  importar: AccionImportar;

  /** Solo quien puede crear viajes ve el botón de importar. */
  puedeImportar: boolean;
  /** `puedeVerArea(rol, 'dinero')`, decidido en la página. */
  verDinero: boolean;
  q: string;
  /** Cursor de ESTA página (`null` = la primera). Solo decide si se ofrece
   *  "Volver al inicio": el contenido ya vino paginado del servidor. */
  cursor: string | null;
  /** Cursor de la página siguiente; `null` si no la hay. */
  siguiente: string | null;
  hayMas: boolean;
  porPagina: number;
  /** Id del viaje cuyo cajón de vista rápida está abierto (`?ver=`); `null` = cerrado. */
  ver?: string | null;
}) {
  const { t, idioma } = tr;
  const conteo = (n: number | null): { valor: string; estado?: 'error'; reintentar?: boolean } => (n === null ? { valor: '—', estado: 'error', reintentar: true } : { valor: numero(n, idioma) });
  const params = new URLSearchParams(sufijo.startsWith('?') ? sufijo.slice(1) : sufijo);
  const hrefVista = (id: string) => hrefRegistro(sufijo, { f: filtro, q, c: cursor, ver: id });
  const hrefCerrar = hrefRegistro(sufijo, { f: filtro, q, c: cursor });
  const seleccion = ver ? filas.findIndex((f) => f.id === ver) : -1;
  const sel = seleccion >= 0 ? filas[seleccion] : null;
  // «25 de N» solo cuando N es verdad: el conteo del filtro vigente, sin búsqueda (la búsqueda no tiene conteo propio) y sin paginar por cursor.
  const totalFiltro = { todos: conteos.total, abiertos: conteos.abiertos, en_cuadre: conteos.enCuadre, liquidados: conteos.liquidados, escalados: conteos.escalados }[filtro];
  const pie = !q && !cursor && totalFiltro !== null
    ? t('viajes.pie.de', { n: numero(filas.length, idioma), total: numero(totalFiltro, idioma) })
    : t('viajes.pie.pagina', { n: numero(filas.length, idioma) });

  // Un conteo que no se pudo leer es `null`: NUNCA se pinta como 0. La celda dice «No disponible ahora. No es cero.» y ofrece Reintentar.
  const cifras: PropsCifra[] = [
    { etiqueta: t('viajes.cifra.total'), ...conteo(conteos.total), nota: 'histórico', info: 'viajes.total' },
    { etiqueta: t('viajes.cifra.abiertos'), ...conteo(conteos.abiertos), info: 'viajes.abiertos' },
    { etiqueta: t('viajes.cifra.cuadre'), ...conteo(conteos.enCuadre), info: 'viajes.en_cuadre' },
    { etiqueta: t('viajes.cifra.escalados'), ...conteo(conteos.escalados), tono: (conteos.escalados ?? 0) > 0 ? 'bad' : undefined, info: 'viajes.escalados' },
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={t('viajes.titulo')}
      apoyo={t('viajes.apoyo')}
      cifras={cifrasUniformes(cifras)}
      selloCifras={selloHoy(t('viajes.sello'))}
      etiquetaCifras={t('viajes.sello')}
      filtros={(
        // GET puro: la búsqueda vive en la URL y sobrevive a recargar, compartir y volver atrás. El sufijo y el filtro viajan como
        // campos ocultos para no perderse al enviar; el estado es un enlace (hrefRegistro) con la búsqueda vigente.
        <BarraFiltros enLinea accion="/dashboard/viajes" buscar etiqueta={t('viajes.filtros')} nActivos={(filtro !== 'todos' ? 1 : 0) + (q ? 1 : 0)} limpiarHref={hrefRegistro(sufijo, {})}
          ocultos={[...params.entries(), ...(filtro !== 'todos' ? [['f', filtro] as [string, string]] : [])]}>
          <FiltroOpciones etiqueta={t('viajes.filtro.estado')} valor={filtro} porDefecto="todos"
            opciones={(Object.keys(ROTULO_FILTRO) as FiltroViajes[]).map((f) => ({ valor: f, rotulo: t(ROTULO_FILTRO[f]), href: hrefRegistro(sufijo, { f, q }) }))} />
          <FiltroBusqueda nombre="q" valor={q} placeholder={t('viajes.buscar.ph')} etiqueta={t('viajes.buscar.aria')} />
        </BarraFiltros>
      )}
      acciones={puedeImportar ? (
        <CajonAlta id="importar" titulo={t('viajes.importar.tms')} disparador={t('viajes.importar.tms')} tamano="xl">
          <ImportarViajes importar={importar} verDinero={verDinero} />
        </CajonAlta>
      ) : undefined}
      vistaRapida={sel ? (
        <CajonVistaRapida
          titulo={sel.folio}
          subtitulo={t('viajes.vr.sub', { n: numero(seleccion + 1, idioma), total: numero(filas.length, idioma) })}
          hrefCerrar={hrefCerrar}
          cifras={[
            { etiqueta: t('viajes.col.estatus'), valor: t(`viajes.estatus.${sel.estatus}` as 'viajes.estatus.abierto') },
            { etiqueta: t('viajes.col.operador'), valor: sel.operadorNombre ?? '—' },
            { etiqueta: t('viajes.col.unidad'), valor: sel.unidadEco ?? '—' },
            { etiqueta: t('viajes.col.inicio'), valor: sel.fechaInicio ? fechaMx(sel.fechaInicio, idioma) : '—' },
          ]}
          pie={sel.liqId ? (
            <BotonEnlace variante="primary" tamano="sm" href={`/dashboard/${sel.liqId}${sufijo}`}>{t('viajes.vr.abrir')}</BotonEnlace>
          ) : (
            // Sin liquidación todavía no hay ficha que abrir: el viaje se sigue en Despacho. La vista rápida siempre cierra con su acción primaria.
            <BotonEnlace variante="primary" tamano="sm" href={`/dashboard/despacho${sufijo}`}>{t('viajes.vr.despacho')}</BotonEnlace>
          )}
        >
          <div className="rv-reg__vr-extra">
            <PillAviso v={sel} tr={tr} />
            {verDinero ? (
              <dl className="rv-reg__vr-dinero">
                <div><dt>{t('viajes.col.anticipo')}</dt><dd>{sel.anticipo === null ? '—' : mxn(sel.anticipo, idioma)}</dd></div>
                <div><dt>{t('viajes.col.comprobado')}</dt><dd>{sel.comprobado === null ? '—' : mxn(sel.comprobado, idioma)}</dd></div>
                <div><dt>{t('viajes.col.diferencia')}</dt><dd>{sel.diferencia === null ? '—' : sel.diferencia === 0 ? t('viajes.exacta') : mxn(Math.abs(sel.diferencia), idioma)}</dd></div>
              </dl>
            ) : null}
          </div>
        </CajonVistaRapida>
      ) : null}
    >
      <TarjetaTabla titulo={t('viajes.tabla.etiqueta')} contador={pie}>
        {filas.length === 0 ? (
          <EstadoVacio contenido icono={Inbox} titulo={q || filtro !== 'todos' ? t('viajes.vacio.sincoincidencias') : t('viajes.vacio.sinviajes')}>
            {q
              ? (filtro !== 'todos' ? t('viajes.vacio.busqueda.filtro', { q, filtro: t(ROTULO_FILTRO[filtro]) }) : t('viajes.vacio.busqueda', { q }))
              : filtro === 'todos'
                ? t('viajes.vacio.primero')
                : t('viajes.vacio.filtro', { filtro: t(ROTULO_FILTRO[filtro]) })}
          </EstadoVacio>
        ) : (
          <TablaLista<FilaRegistroViaje>
            etiqueta={t('viajes.tabla.etiqueta')}
            columnas={columnasViajes(hrefVista, verDinero, tr)}
            filas={filas}
            idFila={(v) => v.id}
            base="/dashboard/viajes"
            params={{}}
            pie={(
              <>
                <div className="rv-tl__sellos"><SelloDato tipo="observado" fuente={t('viajes.sello')} leidoEn={ahoraMs()} edad={false} /></div>
                {verDinero ? <p className="rv-tl__nota">{t('viajes.nota.diferencia')}</p> : null}
                {/* Paginación por CURSOR (escala 50k, 22-ago-2026): nunca más de `porPagina` filas por render. No se dice "página N de M": el
                    cursor es la posición del último viaje visto y "Siguientes" continúa desde ahí. Hacia atrás sirve el botón del navegador o
                    "Volver al inicio". */}
                {(cursor || hayMas) && (
                  <div className="rv-reg__pie">
                    <span className="rv-reg__nota">{t('viajes.pie', { n: numero(porPagina, idioma) })}</span>
                    <NavPaginas>
                      {cursor ? <EnlacePagina href={hrefRegistro(sufijo, { f: filtro, q })} direccion="inicio" /> : null}
                      {hayMas && siguiente ? <EnlacePagina href={hrefRegistro(sufijo, { f: filtro, q, c: siguiente })} direccion="siguiente" /> : null}
                    </NavPaginas>
                  </div>
                )}
              </>
            )}
          />
        )}
      </TarjetaTabla>
    </EsqueletoTablaMaestra>
  );
}
