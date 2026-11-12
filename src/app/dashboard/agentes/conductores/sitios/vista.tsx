import Link from 'next/link';
import { numero } from '@/lib/formato';
import { DIAS_TEXTOS_SIN_SITIO, PLANTILLA_CSV_SITIOS, TOP_TEXTOS_SIN_SITIO, type TextoSinSitio } from '@/lib/likida/conductor/sitios';
import type { SitioFila } from '@/lib/likida/conductor/repo_validacion';
import { FilaTextoSinSitio, FormaImportarEquivalencias } from './formas_equivalencias';
import { FormaCatalogo } from './formas_catalogo';
import { CajonImportarSitios } from './cajon-importar';
import { FormaEstadoSitio } from './formas_estado';
import { CajonSitio, FormaImportar, SITIO_VACIO, type AccionSitio, type SitioEditable } from './formas';
import '../conductores.css';
import { AvisoCompacto, BarraFiltros, BotonEnlace, Disclosure, FiltroBusqueda, Tarjeta, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// SOLO tipos: la vista no debe arrastrar al bundle el acceso a datos.

const tipoTexto = (tx: TAgentes = TR_ES.t): Record<string, string> => ({ cliente: tx('vigia.vista.cliente'), planta: tx('rest.planta'), anden: tx('rest.anden'), patio: tx('rest.patio'), punto_interes: tx('rest.punto_de_interes') });

export interface PropsVistaSitios {
  sufijo: string;
  sitios: SitioFila[] | null;
  hayMas: boolean;
  /** A37-S13-03: los sitios activos que ofrecen los selectores (padre y «Textos sin sitio»), SIN el filtro `?q` de la tabla; `undefined` = usar `sitios`. */
  selectorSitios?: Array<{ id: string; nombre: string }>;
  selectorHayMas?: boolean;
  clientes: Array<{ id: string; nombre: string }>;
  puedeEditar: boolean;
  editando: SitioFila | null;
  busqueda: string;
  accionGuardar: AccionSitio;
  accionImportar: AccionSitio;
  /** Archivar/reactivar: una forma con estado por fila (A37-S13-06: el resultado se muestra). */
  accionEstado: AccionSitio;
  /**
   * T-A5-17, equivalencias texto→sitio. Todo opcional: sin `textosSinSitio` la sección no se pinta (`null` = no se pudo leer).
   * `descargaCsv` es el listado ya armado como `data:` URI (solo texto del lugar, sin datos de personas).
   */
  textosSinSitio?: TextoSinSitio[] | null;
  textosTruncado?: boolean;
  descargaCsv?: string | null;
  accionImportarEquivalencias?: AccionSitio;
  /** T-SYS-25: catálogo depurado (analizar / importar por lotes + lista de validación por terminal). Opcional: sin él no se pinta. */
  accionCatalogo?: AccionSitio;
  accionAsignarEquivalencia?: AccionSitio;
  tr?: TrAgentes;
}

const aEditable = (s: SitioFila): SitioEditable => ({
  id: s.id, nombre: s.nombre, tipo: s.tipo, codigo: s.codigo ?? '', direccion: s.direccion ?? '', lat: String(s.lat), lng: String(s.lng),
  radio_m: String(s.radioM), cliente_id: s.clienteId ?? '', padre_id: s.padreId ?? '',
});

export function VistaSitios(p: PropsVistaSitios) {
  const tr = p.tr ?? TR_ES;
  const { t: tx } = tr;
  const padres = p.selectorSitios ?? (p.sitios ?? []).filter((s) => s.activa).map((s) => ({ id: s.id, nombre: s.nombre }));
  const avisoSelector = p.selectorHayMas ? tx('rest.hay_mas_sitios_activos_de_los_2') : null;
  const columnasSitios: readonly ColumnaBase<SitioFila>[] = [
    { id: 'nombre', titulo: tx('conductores.forma.nombre'), principal: true, celda: (s) => <><span className="rv-cd__medio">{s.nombre}</span>{!s.activa && <span className="rv-cd__micro"> (archivado)</span>}</> },
    { id: 'tipo', titulo: tx('rest.tipo'), celda: (s) => tipoTexto(tx)[s.tipo] ?? s.tipo },
    { id: 'codigo', titulo: tx('rest.codigo'), celda: (s) => <span className="rv-ag-num">{s.codigo ?? '—'}</span> },
    { id: 'centro', titulo: tx('rest.centro_lat_lng'), celda: (s) => <span className="rv-ag-num">{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</span> },
    { id: 'radio', titulo: tx('rest.radio'), alinear: 'der', celda: (s) => <span className="rv-ag-num">{numero(s.radioM)} m</span> },
    { id: 'cliente', titulo: tx('vigia.vista.cliente'), celda: (s) => s.clienteNombre ?? '—' },
    { id: 'fuente', titulo: tx('rest.origen_del_dato'), celda: (s) => (s.fuente === 'csv' ? 'importado de CSV' : 'captura manual') },
    {
      id: 'acciones', titulo: tx('rest.acciones'), alinear: 'der',
      celda: (s) => (p.puedeEditar ? (
        <span className="rv-cd__linea">{ricoT(tx('rest.e0_editar_e0'), { e0: (c) => <Link href={`/dashboard/agentes/conductores/sitios?editar=${s.id}${p.sufijo.startsWith('?') ? `&${p.sufijo.slice(1)}` : ''}`} className="rv-cd__enlace">{c}</Link> })}<FormaEstadoSitio accion={p.accionEstado} id={s.id} activa={s.activa} />
        </span>
      ) : null),
    },
  ];
  const columnasTextos: readonly ColumnaBase<TextoSinSitio>[] = [
    { id: 'texto', titulo: tx('rest.texto'), principal: true, celda: (x) => <span className="rv-cd__medio rv-cd__romper">{x.texto}</span> },
    { id: 'lado', titulo: tx('rest.lado'), celda: (x) => (x.lado === 'ambos' ? 'origen y destino' : x.lado) },
    { id: 'viajes', titulo: tx('rest.viajes'), alinear: 'der', celda: (x) => <span className="rv-ag-num">{numero(x.frecuencia)}</span> },
    ...(p.puedeEditar ? [{
      id: 'que', titulo: tx('rest.que_es_2'),
      celda: (x: TextoSinSitio) => (p.accionAsignarEquivalencia ? <FilaTextoSinSitio accion={p.accionAsignarEquivalencia} texto={x.texto} lado={x.lado} sitios={padres} /> : null),
    } satisfies ColumnaBase<TextoSinSitio>] : []),
  ];
  // Con «hay más» el recuento es parcial: se rotula con «+» y nunca se presenta como total.
  const mas = p.hayMas ? '+' : '';
  const lista = p.sitios ?? [];
  return (
    <EsqueletoTablaMaestra
      titulo={tx('rest.catalogo_de_sitios')}
      apoyo={tx('rest.clientes_plantas_y_andenes_con_su')}
      acciones={(
        <>
          {p.puedeEditar && (
            <CajonImportarSitios disparador={tx('rest.importar')} titulo={tx('rest.importar_sitios_desde_csv')}>
              <section>
                {/* sin-info: título de un formulario de carga dentro del cajón de importar, no una cifra ni un recuadro de datos */}
                <h3>{tx('rest.importar_desde_csv')}</h3>
                <p className="rv-cd__nota">{ricoT(tx('rest.columnas_code_codigo_nombre_tipo_lat'), { code: (c) => <code>{c}</code> })}</p>
                <Disclosure titulo={tx('rest.ver_el_formato_de_ejemplo')} variante="linea">
                  <pre className="rv-cd__bloque rv-cd__mono">{PLANTILLA_CSV_SITIOS}</pre>
                  <p className="rv-cd__micro">{tx('rest.el_ejemplo_trae_las_coordenadas_en')}</p>
                </Disclosure>
                <FormaImportar accion={p.accionImportar} />
              </section>
              {p.accionCatalogo && (
                <section>
                  {/* sin-info: título de un formulario de carga dentro del cajón de importar, no una cifra ni un recuadro de datos */}
                  <h3>{tx('rest.catalogo_depurado_de_origenes_y_destinos')}</h3>
                  <p className="rv-cd__nota">{ricoT(tx('rest.sin_tope_de_filas_columnas_code'), { code: (c) => <code>{c}</code>, strong: (c) => <strong>{c}</strong> })}</p>
                  <FormaCatalogo accion={p.accionCatalogo} />
                </section>
              )}
              {p.accionImportarEquivalencias && p.textosSinSitio !== undefined && (
                <section>
                  {/* sin-info: título de un formulario de carga dentro del cajón de importar, no una cifra ni un recuadro de datos */}
                  <h3>{tx('rest.importar_equivalencias_desde_csv')}</h3>
                  <p className="rv-cd__nota">{ricoT(tx('rest.columnas_code_texto_geocerca_codigo_tipo'), { code: (c) => <code>{c}</code> })}</p>
                  <FormaImportarEquivalencias accion={p.accionImportarEquivalencias} />
                </section>
              )}
            </CajonImportarSitios>
          )}
          {p.puedeEditar && <CajonSitio key="nuevo" accion={p.accionGuardar} inicial={SITIO_VACIO} clientes={p.clientes} padres={padres} disparador={tx('rest.nuevo_sitio')} variante="primary" />}
          {p.puedeEditar && p.editando && (
            <CajonSitio key={p.editando.id} accion={p.accionGuardar} inicial={aEditable(p.editando)} clientes={p.clientes} padres={padres} abiertoInicial
              cerrarHref={`/dashboard/agentes/conductores/sitios${p.sufijo}`} />
          )}
          <BotonEnlace tamano="sm" variante="ghost" href={`/dashboard/agentes/conductores${p.sufijo}`}>{tx('rest.volver_al_tablero')}</BotonEnlace>
        </>
      )}
      filtros={(
        <BarraFiltros buscar accion="?" enLinea etiqueta={tx('rest.buscar_sitios')} ocultos={p.sufijo.startsWith('?') ? [...new URLSearchParams(p.sufijo.slice(1))] : []}
          nActivos={p.busqueda ? 1 : 0} limpiarHref={p.sufijo || '?'}>
          <FiltroBusqueda nombre="q" valor={p.busqueda} placeholder={tx('rest.buscar_por_nombre_o_codigo')} etiqueta={tx('rest.buscar_sitios')} />
        </BarraFiltros>
      )}
      avisos={(
        <AvisoCompacto
          tono="info"
          resumen={tx('rest.el_agente_compara_cada_ya_llegue')}
          mas={<>{ricoT(tx('rest.compara_contra_el_pin_de_whatsapp'), { strong: (c) => <strong>{c}</strong> })}</>}
        />
      )}
      cifras={p.sitios === null ? undefined : [
        { etiqueta: tx('f26d.sitios.registrados'), valor: `${numero(lista.length)}${mas}` },
        { etiqueta: tx('f26d.sitios.activos'), valor: `${numero(lista.filter((s) => s.activa).length)}${mas}` },
        { etiqueta: tx('f26d.sitios.archivados'), valor: `${numero(lista.filter((s) => !s.activa).length)}${mas}` },
        ...(p.textosSinSitio !== undefined ? [{ etiqueta: tx('f26d.sitios.textos_pendientes'), valor: p.textosSinSitio ? `${numero(p.textosSinSitio.length)}${p.textosTruncado ? '+' : ''}` : null }] : []),
      ]}
      etiquetaCifras={tx('rest.sitios_registrados')}
    >
      <span className="rv-ag-sin-filete-marca" hidden aria-hidden="true" />
      <Tarjeta titulo={tx('rest.sitios_registrados')} info="conductores_sitios.registrados"
        estado={p.sitios === null ? 'error' : p.sitios.length === 0 ? 'vacio' : 'ok'}
        mensaje={p.sitios === null ? tx('rest.no_se_pudo_leer_el_catalogo_3') : p.busqueda ? tx('rest.ningun_sitio_coincide_con_esa_busqueda') : tx('rest.aun_sin_sitios')}
        detalle={p.busqueda ? undefined : tx('rest.todavia_no_hay_sitios_crea_uno')}>
        <div className="rv-cd__pila">
          <TablaBase etiqueta={tx('rest.sitios')} columnas={columnasSitios} filas={p.sitios ?? []} idFila={(s) => s.id} densa tarjetaMovil />
          {p.hayMas && <p className="rv-cd__nota" data-tono="warn">{tx('rest.hay_mas_sitios_de_los_que')}</p>}
          {avisoSelector && p.puedeEditar && <p role="status" className="rv-cd__nota" data-tono="warn">{avisoSelector}</p>}
        </div>
      </Tarjeta>

      {!p.puedeEditar && (
        <p className="rv-cd__nota" data-tono="faint">{tx('rest.solo_el_dueno_de_la_flota_9')}</p>
      )}

      {p.textosSinSitio !== undefined && (
        <Tarjeta titulo={tx('rest.textos_sin_sitio')} info="conductores_sitios.textos_sin_sitio"
          estado={p.textosSinSitio === null ? 'error' : p.textosSinSitio.length === 0 ? 'vacio' : 'ok'}
          mensaje={p.textosSinSitio === null ? tx('rest.no_se_pudo_leer_la_lista_2') : tx('rest.sin_textos_pendientes')}
          detalle={tx('rest.no_hay_textos_sin_sitio_en', { diasTextosSinSitio: DIAS_TEXTOS_SIN_SITIO })}>
          <div className="rv-cd__pila">
            <p className="rv-cd__nota">{tx('rest.el_origen_y_el_destino_de', { topTextosSinSitio: TOP_TEXTOS_SIN_SITIO, diasTextosSinSitio: DIAS_TEXTOS_SIN_SITIO })}</p>
            {p.textosSinSitio !== null && p.textosSinSitio.length > 0 && (
              <TablaBase etiqueta={tx('rest.textos_de_viaje_sin_sitio')} columnas={columnasTextos} filas={p.textosSinSitio} idFila={(x) => x.textoNormalizado} densa tarjetaMovil />
            )}
            {avisoSelector && p.puedeEditar && <p role="status" className="rv-cd__nota" data-tono="warn">{avisoSelector}{' '}{tx('rest.para_uno_que_no_aparezca_usa')}</p>}
            {p.textosTruncado && <p className="rv-cd__nota" data-tono="warn">{tx('rest.hay_mas_viajes_de_los_que')}</p>}
            {p.descargaCsv && p.textosSinSitio !== null && p.textosSinSitio.length > 0 && (
              <p className="rv-cd__nota">{ricoT(tx('rest.e0_descargar_esta_lista_como_csv'), { e0: (c) => <a href={p.descargaCsv ?? undefined} download="textos-sin-sitio.csv" className="rv-cd__enlace">{c}</a>, e1: (c) => <span className="rv-cd__faint">{c}</span> })}</p>
            )}
          </div>
        </Tarjeta>
      )}
    </EsqueletoTablaMaestra>
  );
}
