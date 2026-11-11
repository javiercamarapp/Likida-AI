import { cifrasUniformes } from '../formato';
import Link from 'next/link';
import { Inbox, Truck, Users } from 'lucide-react';
import type { TableroOperacion, ViajeSinAsignar, CargaOperador } from '@/lib/likida/operacion';
import type { Pagina, ViajeEnCursoRow } from '@/lib/likida/repo_paginado';
import { numero, fechaCorta } from '@/lib/formato';
import { FormaViaje, type AccionCrearViaje } from '../forma-viaje';
import type { BuscarCatalogo } from '../combo-catalogo';
import { AsignarFila, AsignarUnidadFila, BotonReenviar, AltaOperador, type AccionDespacho } from './acciones';
import { PillAviso } from '../viajes/pills';
import { EnlacePagina, NavPaginas } from '../paginador';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { CajonAlta } from '../cajon-alta';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { Aviso, BarraFiltros, EstadoVacio, FilaTarjetas, FiltroBusqueda, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import './despacho.css';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';

/** Tope de "Por asignar" — declarado en pantalla cuando recorta. "En curso"
 *  ya no usa esta constante: FE-2 le dio su propia paginación con `count`
 *  real (`activos`, abajo). */
const MAX_FILAS = 12;


/** El link a otra página de "En curso", conservando folio buscado y sufijo
 *  de previsualización — mismo patrón que `rentabilidad/vista.tsx`. */
function hrefPaginaActivos(sufijo: string, folioPedido: string, pagina: number): string {
  const params = new URLSearchParams(sufijo ? sufijo.slice(1) : '');
  if (pagina > 1) params.set('p', String(pagina)); else params.delete('p');
  if (folioPedido) params.set('q', folioPedido); else params.delete('q');
  const qs = params.toString();
  return `/dashboard/despacho${qs ? `?${qs}` : ''}`;
}

/**
 * El render del Despacho (13-ago-2026) — la página donde se ACTÚA: crear
 * viaje, asignar y avisar, insistirle al chofer, dar de alta operadores.
 * La foto de la mañana (tablero de solo lectura) vive en el Resumen del
 * encargado; aquí cada sección tiene su botón y todos funcionan.
 *
 * El encargado captura sólo operación. Los campos financieros y comerciales
 * se ofrecen únicamente a quien tiene permiso de dinero.
 */
export function VistaDespacho({ tr = TR_OPERACION_ES,
  tablero, sinAsignar, totalSinAsignar, activos, sufijo, folioPedido, buscarCatalogo, totalOperadores, totalClientes, totalUnidades,
  puedeCapturarDinero = false, puedeCapturarAnticipo = false, topeAnticipo, topeAnticipoOrigen, carga, crear, asignarYAvisar, asignarUnidadViaje, reenviarAviso, altaOperador,
}: { tr?: TrOperacion;
  puedeCapturarDinero?: boolean;
  /** Quien despacha captura anticipo aunque no vea dinero (E1-B). */
  puedeCapturarAnticipo?: boolean;
  topeAnticipo?: number;
  topeAnticipoOrigen?: 'politica' | 'umbral_revision';
  tablero: TableroOperacion | null;
  sinAsignar: ViajeSinAsignar[];
  /** El total REAL de viajes sin chofer (la lista trae a lo más `MAX_FILAS`). Sin él, `sinAsignar.length`. */
  totalSinAsignar?: number;
  /** FE-2: consulta propia, ordenada por urgencia y con `count` real —
   *  reemplaza el recorte a 12 de "los últimos 100 viajes creados". */
  activos: Pagina<ViajeEnCursoRow>;
  sufijo: string;
  folioPedido: string;
  /** FE-2: los catálogos ya NO viajan como listas — viaja el buscador. */
  buscarCatalogo: BuscarCatalogo;
  /** Cuántos operadores/clientes/unidades ACTIVOS hay (count exact, head).
   *  `null` = no se pudo contar; entonces la pantalla no afirma ninguna
   *  cifra ni concluye que el catálogo esté vacío. */
  totalOperadores: number | null;
  totalClientes: number | null;
  totalUnidades: number | null;
  carga: CargaOperador[] | null;
  crear: AccionCrearViaje;
  asignarYAvisar: AccionDespacho;
  asignarUnidadViaje: AccionDespacho;
  reenviarAviso: AccionDespacho;
  altaOperador: AccionDespacho;
}) {
  const { t, idioma } = tr;
  // ── FE-M1 (auditoría 28): vacío de CONSULTA vs vacío de NEGOCIO ─────────
  // `activos.filas.length === 0` puede significar tres cosas MUY distintas,
  // y solo `activos.total` (el `count: 'exact'` de la propia consulta, no
  // `filas.length`) distingue cuál es: no hay ni un viaje en curso en la
  // flota (`total === 0`), esta página en particular no trajo nada aunque sí
  // hay viajes en otras (`total > 0` — típicamente un `?p=` guardado o un
  // "atrás" del navegador sobre una cola que ya avanzó), o no se pudo contar
  // (`total === null`, la base no confirmó nada y "ningún viaje" sería una
  // afirmación que no se puede sostener). Antes de esto, los tres casos
  // pintaban la MISMA leyenda ("Ningún viaje en curso ahora mismo"), que solo
  // es cierta en el primero.
  const activosSinFilas = activos.error === null && activos.filas.length === 0;
  const activosVacioDeNegocio = activosSinFilas && activos.total === 0;
  const activosSinContar = activosSinFilas && activos.total === null;
  const activosVacioDeConsulta = activosSinFilas && activos.total !== null && activos.total > 0;
  // La última página que de verdad tiene datos — para el link "ir ahí" desde
  // una página vacía de consulta. Nunca rebasa `paginaMax`: más allá de ahí
  // la paginación no alcanza (FE-B1, abajo).
  const ultimaPaginaConDatos = activos.total !== null && activos.total > 0
    ? Math.min(Math.ceil(activos.total / activos.porPagina), activos.paginaMax)
    : null;

  // ── FE-B1: declarar el recorte de la paginación, no ofrecer un botón que
  // nunca avanza ── `truncada` (repo_paginado.ts) es `true` cuando el total
  // real rebasa `paginaMax * porPagina`: en la última página alcanzable
  // (`pagina === paginaMax`) "Siguiente →" apuntaba a `paginaMax + 1`, que
  // `leerPagina` clampa de vuelta al mismo `paginaMax` — un botón que se
  // puede pulsar para siempre sin que la lista cambie.
  const activosPuedeAvanzar = activos.pagina < activos.paginaMax
    && activos.filas.length === activos.porPagina
    && (activos.total === null || activos.pagina * activos.porPagina < activos.total);

  const columnasActivos: ColumnaBase<ViajeEnCursoRow>[] = [
    { id: 'viaje', titulo: t('dsp.col.viaje'), principal: true, celda: (v) => <span className="rv-dsp__folio">{v.folio}</span> },
    { id: 'ruta', titulo: t('dsp.col.ruta'), celda: (v) => <span className="rv-dsp__ruta">{v.origen ?? '—'} → {v.destino ?? '—'}</span> },
    { id: 'operador', titulo: t('dsp.col.operador'), celda: (v) => v.operadorNombre ? <span className="rv-dsp__nombre" title={v.operadorNombre}>{v.operadorNombre}</span> : <span className="rv-dsp__tenue">{t('dsp.sinasignar')}</span> },
    {
      id: 'unidad', titulo: t('dsp.col.unidad'),
      celda: (v) => (
        // "Asignar unidad después" vive aquí: el gemelo de asignar operador, sobre los viajes en curso. Sin catálogo no se pinta un
        // select hueco — se enseña lo que hay (la unidad actual o el guion).
        totalUnidades === 0 ? (
          <span className="rv-dsp__mono">{v.unidadEco ?? '—'}</span>
        ) : (
          <AsignarUnidadFila viajeId={v.id} unidadId={v.unidadId} unidadEco={v.unidadEco}
            buscarCatalogo={buscarCatalogo} totalUnidades={totalUnidades}
            asignarUnidadViaje={asignarUnidadViaje} />
        )
      ),
    },
    { id: 'inicio', titulo: t('dsp.col.inicio'), celda: (v) => <span className="rv-dsp__mono">{fechaCorta(v.fechaInicio, idioma)}</span> },
    { id: 'aviso', titulo: t('dsp.col.aviso'), celda: (v) => <PillAviso v={v} tr={tr} /> },
    {
      id: 'accion', titulo: t('dsp.col.accion'), alinear: 'der',
      // Con operador y sin aceptar, siempre hay algo que mandar: "Avisar" si el aviso nunca salió (el fallo silencioso al crear),
      // "Reavisar" para insistir.
      celda: (v) => (!v.aceptadoEn && v.operadorNombre ? <BotonReenviar viajeId={v.id} yaAvisado={v.avisadoEn !== null} reenviarAviso={reenviarAviso} /> : null),
    },
  ];

  const cifras: PropsCifra[] | undefined = tablero === null ? undefined : [
    { etiqueta: t('dsp.cifra.activos'), valor: numero(tablero.viajesActivos, idioma), info: 'despacho.viajes_activos' },
    { etiqueta: t('dsp.cifra.sinunidad'), valor: numero(tablero.sinUnidad, idioma), tono: tablero.sinUnidad > 0 ? 'warn' : undefined, info: 'despacho.sin_unidad' },
    { etiqueta: t('dsp.cifra.libres'), valor: numero(tablero.unidadesDisponibles, idioma), info: 'despacho.unidades_libres' },
    { etiqueta: t('dsp.cifra.taller'), valor: numero(tablero.unidadesEnTaller, idioma), info: 'despacho.en_taller' },
    { etiqueta: t('dsp.cifra.incidencias'), valor: numero(tablero.incidenciasAbiertas, idioma), tono: tablero.incidenciasAbiertas > 0 ? 'warn' : undefined, info: 'despacho.incidencias' },
    { etiqueta: t('dsp.cifra.pod'), valor: numero(tablero.podPendientes, idioma), info: 'despacho.pod_pendientes' },
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={t('dsp.titulo')}
      apoyo={t('dsp.apoyo')}
      acciones={(
        <>
          {/* ── Alta rápida ── */}
          <CajonAlta id="alta-operador" titulo={t('dsp.alta')} descripcion={t('dsp.alta.nota')} disparador={t('dsp.alta')}>
            <AltaOperador altaOperador={altaOperador} />
          </CajonAlta>
          {/* ── Crear operación nueva ── */}
          <CajonAlta id="nuevo-viaje" titulo={t('dsp.nuevo')} descripcion={t('dsp.nuevo.nota')} disparador={t('dsp.nuevo')} primario tamano="xl">
            <FormaViaje action={crear} buscarCatalogo={buscarCatalogo} puedeCapturarDinero={puedeCapturarDinero} puedeCapturarAnticipo={puedeCapturarAnticipo} topeAnticipo={topeAnticipo} topeAnticipoOrigen={topeAnticipoOrigen}
              totalOperadores={totalOperadores} totalClientes={totalClientes} totalUnidades={totalUnidades} />
          </CajonAlta>
        </>
      )}
      cifras={cifrasUniformes(cifras)}
      filtros={(
        // FE-2: buscador por folio — antes no había forma de llegar a un viaje en curso que no estuviera entre los 12 más urgentes
        // de la primera página. GET plano, con el sufijo de previsualización como hidden para no perderlo al buscar.
        <BarraFiltros enLinea buscar accion="/dashboard/despacho" etiqueta={t('dsp.buscar.aria')} nActivos={folioPedido ? 1 : 0}
          limpiarHref={`/dashboard/despacho${sufijo}`}
          ocultos={[...new URLSearchParams(sufijo.startsWith('?') ? sufijo.slice(1) : sufijo).entries()]}>
          <FiltroBusqueda nombre="q" valor={folioPedido} placeholder={t('dsp.buscar.ph')} etiqueta={t('dsp.buscar.folio')} />
        </BarraFiltros>
      )}
      avisos={tablero === null ? <Aviso tono="warn">{t('dsp.tablero.error')}</Aviso> : undefined}
    >
      <FilaTarjetas variante="8-4">
        {/* ── La cola que reparte el día ── */}
        <Tarjeta titulo={t('dsp.porasignar')} info="despacho.por_asignar">
          <p className="rv-dsp__nota">{t('dsp.porasignar.nota')}</p>
          {sinAsignar.length === 0 ? (
            <EstadoVacio contenido icono={Inbox} titulo={t('dsp.nadasin')}>
              {t('dsp.nadasin.nota')}
            </EstadoVacio>
          ) : (
            <div className="rv-dsp__cola">
              {sinAsignar.slice(0, MAX_FILAS).map((v) => (
                <div key={v.id} className="rv-dsp__item">
                  <div className="rv-dsp__item-cab">
                    <span>{v.folio ?? t('dsp.sinfolio')}</span>
                    <span className="rv-dsp__ruta">{v.origen ?? '—'} → {v.destino ?? '—'}</span>
                    <span className="rv-dsp__fecha">{fechaCorta(v.fechaInicio, idioma)}</span>
                  </div>
                  {totalOperadores === 0 ? (
                    <p className="rv-dsp__nota">{t('dsp.sinoperadores')}</p>
                  ) : (
                    <AsignarFila viajeId={v.id} buscarCatalogo={buscarCatalogo}
                      totalOperadores={totalOperadores} asignarYAvisar={asignarYAvisar} />
                  )}
                </div>
              ))}
              {(totalSinAsignar ?? sinAsignar.length) > MAX_FILAS && (
                <p className="rv-dsp__nota">
                  {t('dsp.semuestran', { max: MAX_FILAS, n: numero((totalSinAsignar ?? sinAsignar.length) - MAX_FILAS, idioma) })}
                </p>
              )}
            </div>
          )}
        </Tarjeta>


        <div className="rv-dsp__pila">
          {/* ── Quién trae cuánto ── */}
          <Tarjeta titulo={t('dsp.carga')} info="despacho.carga">
            <p className="rv-dsp__nota">{t('dsp.carga.nota')}</p>
            {carga === null ? (
              <EstadoVacio contenido icono={Users} titulo={t('dsp.carga.error')}>{t('dsp.reintenta')}</EstadoVacio>
            ) : carga.length === 0 ? (
              <EstadoVacio contenido icono={Users} titulo={t('dsp.carga.vacio')}>
                {t('dsp.carga.vacio.nota')}
              </EstadoVacio>
            ) : (
              <ul className="rv-dsp__carga">
                {carga.slice(0, 8).map((c) => (
                  <li key={c.operadorId}>
                    <span>
                      {c.nombre}
                      {!c.activo && <span className="rv-dsp__inactivo">{t('dsp.inactivo')}</span>}
                    </span>
                    <span>
                      {t('dsp.carga.fila', { n: numero(c.enCurso, idioma) })}{c.sinPod > 0 ? t('dsp.carga.sinpod', { n: numero(c.sinPod, idioma) }) : ''}
                    </span>
                  </li>
                ))}
                {carga.length > 8 && <li className="rv-dsp__nota">{t('dsp.carga.mas', { n: numero(carga.length - 8, idioma) })}</li>}
              </ul>
            )}
          </Tarjeta>
        </div>
      </FilaTarjetas>

      {/* A todo el ancho: con 7 columnas (select de unidad y botón de acción incluidos) no cabe en 8/12 y la acción quedaba cortada. */}
      <FilaTarjetas variante="12">
        {/* ── Lo vivo, con el estado del aviso ── */}
        <Tarjeta titulo={t('dsp.encurso')} info="despacho.en_curso" className="rv-tarjeta--tabla">
          <p className="rv-dsp__nota">{t('dsp.encurso.orden')}</p>
          {activos.error !== null ? (
            <EstadoVacio contenido icono={Truck} titulo={t('dsp.encurso.noleyo')}>
              {t('dsp.reintenta')}
            </EstadoVacio>
          ) : activosSinContar ? (
            // `total === null`: la base no confirmó nada — "ningún viaje" sería una afirmación que la lectura no sostiene.
            <EstadoVacio contenido icono={Truck} titulo={t('dsp.nocontar')}>
              {t('dsp.nocontar.nota')}
            </EstadoVacio>
          ) : activosVacioDeNegocio ? (
            // `total === 0`: aquí sí es cierto que no hay ni un viaje en curso (el folio buscado tampoco tiene coincidencias, si lo hay).
            <EstadoVacio contenido icono={Truck} titulo={folioPedido ? t('dsp.vacio.sincoincidencias') : t('dsp.vacio.ninguno')}>
              {folioPedido ? t('dsp.vacio.foliosin', { folio: folioPedido }) : t('dsp.vacio.ninguno.nota')}
            </EstadoVacio>
          ) : activosVacioDeConsulta ? (
            // `total > 0` pero ESTA página no trajo filas (FE-M1): un `?p=` guardado o "atrás" sobre una cola que ya avanzó. Los viajes
            // existen — lo que está vacío es la página pedida, no la flota — y por eso el rango impreso es "0–0".
            <EstadoVacio contenido icono={Truck} titulo={t('dsp.pagvacia')} accion={<div className="rv-dsp__pagina-vacia">
                <span>{t('dsp.pagvacia.cuenta', { n: numero(activos.total ?? 0, idioma) })}</span>
                <NavPaginas>
                  {activos.pagina > 1 && <EnlacePagina href={hrefPaginaActivos(sufijo, folioPedido, activos.pagina - 1)} direccion="anterior" />}
                  {ultimaPaginaConDatos !== null && ultimaPaginaConDatos !== activos.pagina && (
                    <EnlacePagina href={hrefPaginaActivos(sufijo, folioPedido, ultimaPaginaConDatos)} direccion="siguiente" etiqueta={t('dsp.pagvacia.ultima', { n: numero(ultimaPaginaConDatos, idioma) })} />
                  )}
                </NavPaginas>
              </div>}>
              {folioPedido
                ? t('dsp.pagvacia.folio', { folio: folioPedido, n: numero(activos.total ?? 0, idioma) })
                : t('dsp.pagvacia.hay', { n: numero(activos.total ?? 0, idioma) })}
            </EstadoVacio>
          ) : (
            <>
              <TablaBase<ViajeEnCursoRow> etiqueta={t('dsp.tabla.etiqueta')} columnas={columnasActivos} filas={activos.filas} idFila={(v) => v.id} tarjetaMovil className="rv-dsp__tabla" />
              {/* FE-2: `activos.total` es el conteo REAL de la consulta (`count: 'exact'`), no `filas.length` sobre un recorte fijo — y
                  hay paginación de verdad para llegar al resto. */}
              <div className="rv-dsp__pie">
                <p>
                  {activos.total !== null
                    ? t('dsp.pie.rango', { desde: numero((activos.pagina - 1) * activos.porPagina + 1, idioma), hasta: numero((activos.pagina - 1) * activos.porPagina + activos.filas.length, idioma), total: numero(activos.total, idioma) })
                    : t('dsp.pie.pagina', { n: numero(activos.pagina, idioma) })}
                </p>
                {(activos.pagina > 1 || activosPuedeAvanzar) && (
                  <NavPaginas>
                    {activos.pagina > 1 && <EnlacePagina href={hrefPaginaActivos(sufijo, folioPedido, activos.pagina - 1)} direccion="anterior" />}
                    {activosPuedeAvanzar && <EnlacePagina href={hrefPaginaActivos(sufijo, folioPedido, activos.pagina + 1)} direccion="siguiente" />}
                  </NavPaginas>
                )}
              </div>
              {/* FE-B1: `truncada` se declara, no se esconde — al tope de `paginaMax` ya no queda "Siguiente" que pulsar, pero sin este
                  párrafo el jefe de tráfico no tenía forma de saber que hay MÁS viajes en curso de los que esta paginación alcanza. */}
              {activos.truncada && (
                <Aviso tono="warn">
                  {t('dsp.trunc.pre', { a: numero(activos.paginaMax * activos.porPagina, idioma), b: numero(activos.total ?? 0, idioma) })}
                  <Link href={`/dashboard/viajes${sufijo}`} className="rv-dsp__enlace">{t('dsp.trunc.registro')}</Link>.
                </Aviso>
              )}
            </>
          )}
        </Tarjeta>
      </FilaTarjetas>
      <p className="rv-dsp__nota">{selloHoy('Tablero de despacho')}</p>
    </EsqueletoTablaMaestra>
  );
}
