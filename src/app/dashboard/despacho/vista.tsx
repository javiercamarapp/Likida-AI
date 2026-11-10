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
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { Aviso, BarraFiltros, EstadoVacio, FilaTarjetas, FiltroBusqueda, MarcoPagina, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import './despacho.css';

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
export function VistaDespacho({
  tablero, sinAsignar, totalSinAsignar, activos, sufijo, folioPedido, buscarCatalogo, totalOperadores, totalClientes, totalUnidades,
  puedeCapturarDinero = false, puedeCapturarAnticipo = false, topeAnticipo, topeAnticipoOrigen, carga, crear, asignarYAvisar, asignarUnidadViaje, reenviarAviso, altaOperador,
}: {
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
    { id: 'viaje', titulo: 'Viaje', principal: true, celda: (v) => <span className="rv-dsp__folio">{v.folio}</span> },
    { id: 'ruta', titulo: 'Ruta', celda: (v) => <span className="rv-dsp__ruta">{v.origen ?? '—'} → {v.destino ?? '—'}</span> },
    { id: 'operador', titulo: 'Operador', celda: (v) => v.operadorNombre ? <span className="rv-dsp__nombre" title={v.operadorNombre}>{v.operadorNombre}</span> : <span className="rv-dsp__tenue">Sin asignar</span> },
    {
      id: 'unidad', titulo: 'Unidad',
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
    { id: 'inicio', titulo: 'Inicio', celda: (v) => <span className="rv-dsp__mono">{fechaCorta(v.fechaInicio)}</span> },
    { id: 'aviso', titulo: 'Aviso', celda: (v) => <PillAviso v={v} /> },
    {
      id: 'accion', titulo: 'Acción', alinear: 'der',
      // Con operador y sin aceptar, siempre hay algo que mandar: "Avisar" si el aviso nunca salió (el fallo silencioso al crear),
      // "Reavisar" para insistir.
      celda: (v) => (!v.aceptadoEn && v.operadorNombre ? <BotonReenviar viajeId={v.id} yaAvisado={v.avisadoEn !== null} reenviarAviso={reenviarAviso} /> : null),
    },
  ];

  return (
    <MarcoPagina titulo="Despacho" apoyo="Aquí se actúa: crea el viaje, asigna operador y unidad, avisa e insiste al chofer y da de alta operadores.">

      {tablero === null ? (
        <Aviso tono="warn">No se pudo leer el tablero ahora mismo — las colas de abajo siguen siendo reales.</Aviso>
      ) : (
        <TiraCifras sello={selloHoy('Tablero de despacho')}>
          <Cifra etiqueta="Viajes activos" valor={numero(tablero.viajesActivos)} info="despacho.viajes_activos" />
          <Cifra etiqueta="Sin unidad" valor={numero(tablero.sinUnidad)} tono={tablero.sinUnidad > 0 ? 'warn' : undefined} info="despacho.sin_unidad" />
          <Cifra etiqueta="Unidades libres" valor={numero(tablero.unidadesDisponibles)} info="despacho.unidades_libres" />
          <Cifra etiqueta="En taller" valor={numero(tablero.unidadesEnTaller)} info="despacho.en_taller" />
          <Cifra etiqueta="Incidencias" valor={numero(tablero.incidenciasAbiertas)} tono={tablero.incidenciasAbiertas > 0 ? 'warn' : undefined} info="despacho.incidencias" />
          <Cifra etiqueta="POD pendientes" valor={numero(tablero.podPendientes)} info="despacho.pod_pendientes" />
        </TiraCifras>
      )}

      <FilaTarjetas variante="8-4">
        {/* ── La cola que reparte el día ── */}
        <Tarjeta titulo="Por asignar" info="despacho.por_asignar">
          <p className="rv-dsp__nota">Viajes sin chofer — se asigna y el aviso de WhatsApp sale en el mismo paso</p>
          {sinAsignar.length === 0 ? (
            <EstadoVacio contenido icono={Inbox} titulo="Nada sin repartir">
              Los viajes que crees sin operador caen aquí.
            </EstadoVacio>
          ) : (
            <div className="rv-dsp__cola">
              {sinAsignar.slice(0, MAX_FILAS).map((v) => (
                <div key={v.id} className="rv-dsp__item">
                  <div className="rv-dsp__item-cab">
                    <span>{v.folio ?? 'Sin folio'}</span>
                    <span className="rv-dsp__ruta">{v.origen ?? '—'} → {v.destino ?? '—'}</span>
                    <span className="rv-dsp__fecha">{fechaCorta(v.fechaInicio)}</span>
                  </div>
                  {totalOperadores === 0 ? (
                    <p className="rv-dsp__nota">No hay operadores dados de alta — usa el alta rápida de la derecha.</p>
                  ) : (
                    <AsignarFila viajeId={v.id} buscarCatalogo={buscarCatalogo}
                      totalOperadores={totalOperadores} asignarYAvisar={asignarYAvisar} />
                  )}
                </div>
              ))}
              {(totalSinAsignar ?? sinAsignar.length) > MAX_FILAS && (
                <p className="rv-dsp__nota">
                  Se muestran {MAX_FILAS} — hay {numero((totalSinAsignar ?? sinAsignar.length) - MAX_FILAS)} más sin asignar.
                </p>
              )}
            </div>
          )}
        </Tarjeta>

        {/* ── Crear operación nueva ── */}
        <Tarjeta titulo="Nuevo viaje" info="despacho.nuevo_viaje">
          <p className="rv-dsp__nota">Nace abierto: desde ese momento el operador puede mandar comprobantes por WhatsApp</p>
          <FormaViaje action={crear} buscarCatalogo={buscarCatalogo} puedeCapturarDinero={puedeCapturarDinero} puedeCapturarAnticipo={puedeCapturarAnticipo} topeAnticipo={topeAnticipo} topeAnticipoOrigen={topeAnticipoOrigen}
            totalOperadores={totalOperadores} totalClientes={totalClientes} totalUnidades={totalUnidades} />
        </Tarjeta>
      </FilaTarjetas>

      <FilaTarjetas variante="8-4">
        {/* ── Lo vivo, con el estado del aviso ── */}
        <Tarjeta titulo="En curso" info="despacho.en_curso"
          acciones={(
            // FE-2: buscador por folio — antes no había forma de llegar a un viaje en curso que no estuviera entre los 12 más urgentes
            // de la primera página. GET plano, con el sufijo de previsualización como hidden para no perderlo al buscar.
            <BarraFiltros buscar accion="/dashboard/despacho" enLinea etiqueta="Buscar viaje en curso" nActivos={folioPedido ? 1 : 0}
              limpiarHref={`/dashboard/despacho${sufijo}`}
              ocultos={[...new URLSearchParams(sufijo.startsWith('?') ? sufijo.slice(1) : sufijo).entries()]}>
              <FiltroBusqueda nombre="q" valor={folioPedido} placeholder="Folio…" etiqueta="Buscar viaje en curso por folio" />
            </BarraFiltros>
          )}>
          <p className="rv-dsp__nota">Primero lo que nadie ha aceptado, y entre eso lo avisado hace más tiempo</p>
          {activos.error !== null ? (
            <EstadoVacio contenido icono={Truck} titulo="No se pudo leer En curso">
              Vuelve a intentar en un momento.
            </EstadoVacio>
          ) : activosSinContar ? (
            // `total === null`: la base no confirmó nada — "ningún viaje" sería una afirmación que la lectura no sostiene.
            <EstadoVacio contenido icono={Truck} titulo="No se pudo contar los viajes">
              No se pudo contar cuántos viajes en curso hay ahora mismo. Vuelve a intentar en un momento.
            </EstadoVacio>
          ) : activosVacioDeNegocio ? (
            // `total === 0`: aquí sí es cierto que no hay ni un viaje en curso (el folio buscado tampoco tiene coincidencias, si lo hay).
            <EstadoVacio contenido icono={Truck} titulo={folioPedido ? 'Sin coincidencias' : 'Ningún viaje en curso ahora mismo'}>
              {folioPedido ? `Ningún viaje en curso con folio "${folioPedido}".` : 'Los viajes con operador y sin cerrar aparecen aquí.'}
            </EstadoVacio>
          ) : activosVacioDeConsulta ? (
            // `total > 0` pero ESTA página no trajo filas (FE-M1): un `?p=` guardado o "atrás" sobre una cola que ya avanzó. Los viajes
            // existen — lo que está vacío es la página pedida, no la flota — y por eso el rango impreso es "0–0".
            <EstadoVacio contenido icono={Truck} titulo="Esta página no tiene viajes" accion={<div className="rv-dsp__pagina-vacia">
                <span>0–0 de {numero(activos.total ?? 0)} en curso</span>
                <NavPaginas>
                  {activos.pagina > 1 && <EnlacePagina href={hrefPaginaActivos(sufijo, folioPedido, activos.pagina - 1)} direccion="anterior" />}
                  {ultimaPaginaConDatos !== null && ultimaPaginaConDatos !== activos.pagina && (
                    <EnlacePagina href={hrefPaginaActivos(sufijo, folioPedido, ultimaPaginaConDatos)} direccion="siguiente" etiqueta={`Ir a la última página (${numero(ultimaPaginaConDatos)})`} />
                  )}
                </NavPaginas>
              </div>}>
              {folioPedido
                ? `No hay viajes con folio "${folioPedido}" en esta página: hay ${numero(activos.total ?? 0)} coincidencias.`
                : `Hay ${numero(activos.total ?? 0)} en curso, pero no en esta página.`}
            </EstadoVacio>
          ) : (
            <>
              <TablaBase<ViajeEnCursoRow> etiqueta="Viajes por despachar" columnas={columnasActivos} filas={activos.filas} idFila={(v) => v.id} tarjetaMovil />
              {/* FE-2: `activos.total` es el conteo REAL de la consulta (`count: 'exact'`), no `filas.length` sobre un recorte fijo — y
                  hay paginación de verdad para llegar al resto. */}
              <div className="rv-dsp__pie">
                <p>
                  {activos.total !== null
                    ? `${numero((activos.pagina - 1) * activos.porPagina + 1)}–${numero((activos.pagina - 1) * activos.porPagina + activos.filas.length)} de ${numero(activos.total)} en curso`
                    : `Página ${numero(activos.pagina)} — no se pudo contar el total.`}
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
                  Se pueden recorrer hasta {numero(activos.paginaMax * activos.porPagina)} de{' '}
                  {numero(activos.total ?? 0)} en curso — el resto está en el{' '}
                  <Link href={`/dashboard/viajes${sufijo}`} className="rv-dsp__enlace">registro</Link>.
                </Aviso>
              )}
            </>
          )}
        </Tarjeta>

        <div className="rv-dsp__pila">
          {/* ── Alta rápida ── */}
          <Tarjeta titulo="Alta rápida de operador" info="despacho.alta_operador">
            <p className="rv-dsp__nota">Nombre y WhatsApp — la lada 52 y los duplicados los cuida el servidor</p>
            <AltaOperador altaOperador={altaOperador} />
          </Tarjeta>

          {/* ── Quién trae cuánto ── */}
          <Tarjeta titulo="Carga por operador" info="despacho.carga">
            <p className="rv-dsp__nota">El que trae más sale arriba — ¿a quién NO le cargas otro?</p>
            {carga === null ? (
              <EstadoVacio contenido icono={Users} titulo="No se pudo leer la carga">Vuelve a intentar en un momento.</EstadoVacio>
            ) : carga.length === 0 ? (
              <EstadoVacio contenido icono={Users} titulo="Sin operadores todavía">
                Da de alta uno con el formulario de arriba.
              </EstadoVacio>
            ) : (
              <ul className="rv-dsp__carga">
                {carga.slice(0, 8).map((c) => (
                  <li key={c.operadorId}>
                    <span>
                      {c.nombre}
                      {!c.activo && <span className="rv-dsp__inactivo"> · inactivo</span>}
                    </span>
                    <span>
                      {numero(c.enCurso)} en curso{c.sinPod > 0 ? ` · ${numero(c.sinPod)} sin POD` : ''}
                    </span>
                  </li>
                ))}
                {carga.length > 8 && <li className="rv-dsp__nota">y {numero(carga.length - 8)} más.</li>}
              </ul>
            )}
          </Tarjeta>
        </div>
      </FilaTarjetas>
    </MarcoPagina>
  );
}
