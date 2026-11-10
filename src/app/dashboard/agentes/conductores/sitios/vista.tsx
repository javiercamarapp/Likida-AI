import Link from 'next/link';
import { numero } from '@/lib/formato';
import { DIAS_TEXTOS_SIN_SITIO, PLANTILLA_CSV_SITIOS, TOP_TEXTOS_SIN_SITIO, type TextoSinSitio } from '@/lib/likida/conductor/sitios';
import type { SitioFila } from '@/lib/likida/conductor/repo_validacion';
import { FilaTextoSinSitio, FormaImportarEquivalencias } from './formas_equivalencias';
import { FormaCatalogo } from './formas_catalogo';
import { FormaEstadoSitio } from './formas_estado';
import { FormaImportar, FormaSitio, SITIO_VACIO, type AccionSitio, type SitioEditable } from './formas';
import '../conductores.css';
import { AvisoCompacto, BarraFiltros, BotonEnlace, Disclosure, FiltroBusqueda, MarcoPagina, StatusChip, Tarjeta, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';

// SOLO tipos: la vista no debe arrastrar al bundle el acceso a datos.

const TIPO_TEXTO: Record<string, string> = { cliente: 'Cliente', planta: 'Planta', anden: 'Andén', patio: 'Patio', punto_interes: 'Punto de interés' };

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
}

const aEditable = (s: SitioFila): SitioEditable => ({
  id: s.id, nombre: s.nombre, tipo: s.tipo, codigo: s.codigo ?? '', direccion: s.direccion ?? '', lat: String(s.lat), lng: String(s.lng),
  radio_m: String(s.radioM), cliente_id: s.clienteId ?? '', padre_id: s.padreId ?? '',
});

export function VistaSitios(p: PropsVistaSitios) {
  const padres = p.selectorSitios ?? (p.sitios ?? []).filter((s) => s.activa).map((s) => ({ id: s.id, nombre: s.nombre }));
  const avisoSelector = p.selectorHayMas ? 'Hay más sitios activos de los que caben en el selector (solo salen los primeros por nombre).' : null;
  const columnasSitios: readonly ColumnaBase<SitioFila>[] = [
    { id: 'nombre', titulo: 'Nombre', principal: true, celda: (s) => <><span className="rv-cd__medio">{s.nombre}</span>{!s.activa && <span className="rv-cd__micro"> (archivado)</span>}</> },
    { id: 'tipo', titulo: 'Tipo', celda: (s) => TIPO_TEXTO[s.tipo] ?? s.tipo },
    { id: 'codigo', titulo: 'Código', celda: (s) => <span className="cifra-mono">{s.codigo ?? '—'}</span> },
    { id: 'centro', titulo: 'Centro (lat, lng)', celda: (s) => <span className="cifra-mono">{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</span> },
    { id: 'radio', titulo: 'Radio', alinear: 'der', celda: (s) => <span className="cifra-mono">{numero(s.radioM)} m</span> },
    { id: 'cliente', titulo: 'Cliente', celda: (s) => s.clienteNombre ?? '—' },
    { id: 'fuente', titulo: 'Origen del dato', celda: (s) => (s.fuente === 'csv' ? 'importado de CSV' : 'captura manual') },
    {
      id: 'acciones', titulo: 'Acciones', tituloOculto: true, alinear: 'der',
      celda: (s) => (p.puedeEditar ? (
        <span className="rv-cd__linea">
          <Link href={`/dashboard/agentes/conductores/sitios?editar=${s.id}${p.sufijo.startsWith('?') ? `&${p.sufijo.slice(1)}` : ''}`} className="rv-cd__enlace">Editar</Link>
          <FormaEstadoSitio accion={p.accionEstado} id={s.id} activa={s.activa} />
        </span>
      ) : null),
    },
  ] as unknown as readonly ColumnaBase<SitioFila>[];
  const columnasTextos: readonly ColumnaBase<TextoSinSitio>[] = [
    { id: 'texto', titulo: 'Texto', principal: true, celda: (x) => <span className="rv-cd__medio rv-cd__romper">{x.texto}</span> },
    { id: 'lado', titulo: 'Lado', celda: (x) => (x.lado === 'ambos' ? 'origen y destino' : x.lado) },
    { id: 'viajes', titulo: 'Viajes', alinear: 'der', celda: (x) => <span className="cifra-mono">{numero(x.frecuencia)}</span> },
    ...(p.puedeEditar ? [{
      id: 'que', titulo: 'Qué es',
      celda: (x: TextoSinSitio) => (p.accionAsignarEquivalencia ? <FilaTextoSinSitio accion={p.accionAsignarEquivalencia} texto={x.texto} lado={x.lado} sitios={padres} /> : null),
    } satisfies ColumnaBase<TextoSinSitio>] : []),
  ];
  return (
    <MarcoPagina titulo="Catálogo de sitios" apoyo="Clientes, plantas y andenes con su centro y su radio. Ninguna coordenada se calcula ni se inventa." acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/conductores${p.sufijo}`}>Volver al tablero</BotonEnlace>}>
      <AvisoCompacto
        tono="info"
        resumen="El agente compara cada «ya llegué» contra el sitio del viaje. Ninguna coordenada se calcula ni se inventa."
        mas={<>Compara contra el pin de WhatsApp o el GPS. <strong>Ninguna coordenada se calcula ni se inventa</strong>: la capturas tú o viene en tu archivo. Un viaje sin sitio asignado queda «sin dato», nunca «no coincide».</>}
      />

      <Tarjeta titulo="Sitios registrados" info="conductores_sitios.registrados"
        acciones={
          <BarraFiltros buscar accion="?" enLinea etiqueta="Buscar sitios" ocultos={p.sufijo.startsWith('?') ? [...new URLSearchParams(p.sufijo.slice(1))] : []}
            nActivos={p.busqueda ? 1 : 0} limpiarHref={p.sufijo || '?'}>
            <FiltroBusqueda nombre="q" valor={p.busqueda} placeholder="Buscar por nombre o código" etiqueta="Buscar sitios" />
          </BarraFiltros>
        }
        estado={p.sitios === null ? 'error' : p.sitios.length === 0 ? 'vacio' : 'ok'}
        mensaje={p.sitios === null ? 'No se pudo leer el catálogo ahora mismo.' : p.busqueda ? 'Ningún sitio coincide con esa búsqueda.' : 'Aún sin sitios'}
        detalle={p.busqueda ? undefined : 'Todavía no hay sitios. Crea uno abajo o importa tu archivo: hasta entonces las llegadas se quedan «sin dato».'}>
        <div className="rv-cd__pila">
          <TablaBase etiqueta="Sitios" columnas={columnasSitios} filas={p.sitios ?? []} idFila={(s) => s.id} densa tarjetaMovil />
          {p.hayMas && <p className="rv-cd__nota" data-tono="warn">Hay más sitios de los que se listan: afina la búsqueda.</p>}
        </div>
      </Tarjeta>

      {p.puedeEditar ? (
        <>
          <Tarjeta titulo={p.editando ? `Editar «${p.editando.nombre}»` : 'Nuevo sitio'} info="conductores_sitios.formulario">
            <div className="rv-cd__pila">
              {avisoSelector && <p role="status" className="rv-cd__nota" data-tono="warn">{avisoSelector}</p>}
              <FormaSitio key={p.editando?.id ?? 'nuevo'} accion={p.accionGuardar} inicial={p.editando ? aEditable(p.editando) : SITIO_VACIO} clientes={p.clientes} padres={padres} />
              {p.editando && <Link href={`/dashboard/agentes/conductores/sitios${p.sufijo}`} className="rv-cd__enlace">Cancelar la edición</Link>}
            </div>
          </Tarjeta>
          <Tarjeta titulo="Importar desde CSV" info="conductores_sitios.importar_csv">
            <div className="rv-cd__pila">
              <p className="rv-cd__nota">
                Columnas: <code>codigo, nombre, tipo, lat, lng, radio_m, direccion, cliente, padre</code>. Todo o nada: si una fila falla, no se importa ninguna y te
                decimos cuál corregir. Re-importar el mismo archivo actualiza por <code>codigo</code>; no duplica.
              </p>
              <Disclosure titulo="Ver el formato de ejemplo" variante="linea">
                <pre className="rv-cd__bloque rv-cd__mono">{PLANTILLA_CSV_SITIOS}</pre>
                <p className="rv-cd__micro">El ejemplo trae las coordenadas en blanco a propósito: hay que llenarlas con las reales.</p>
              </Disclosure>
              <FormaImportar accion={p.accionImportar} />
            </div>
          </Tarjeta>
        </>
      ) : (
        <p className="rv-cd__nota" data-tono="faint">Solo el dueño de la flota o el jefe de tráfico editan el catálogo.</p>
      )}

      {p.puedeEditar && p.accionCatalogo && (
        <Tarjeta titulo="Catálogo depurado de orígenes y destinos" info="conductores_sitios.catalogo_depurado">
          <div className="rv-cd__pila">
            <p className="rv-cd__nota">
              Sin tope de filas. Columnas: <code>nombre, lat, lng, estatus, terminal, pais</code> (y opcionales <code>codigo, radio_m, direccion, tipo</code>).
              Los posibles duplicados (mismo nombre o a 100 m o menos) <strong>se reportan, nunca se fusionan solos</strong>. Las coordenadas ausentes, (0, 0),
              fuera de rango o fuera de México sin país declarado quedan «por validar» y no se importan; las inactivas tampoco. El reporte trae, por terminal,
              la lista de revisión de los sábados con el cupo diario elegido; las de EE. UU. van aparte. Solo lee tu archivo: no escribe en el sistema del cliente.
            </p>
            <FormaCatalogo accion={p.accionCatalogo} />
          </div>
        </Tarjeta>
      )}

      {p.textosSinSitio !== undefined && (
        <Tarjeta titulo="Textos sin sitio" info="conductores_sitios.textos_sin_sitio"
          estado={p.textosSinSitio === null ? 'error' : p.textosSinSitio.length === 0 ? 'vacio' : 'ok'}
          mensaje={p.textosSinSitio === null ? 'No se pudo leer la lista ahora mismo.' : 'Sin textos pendientes'}
          detalle={`No hay textos sin sitio en los viajes abiertos de los últimos ${DIAS_TEXTOS_SIN_SITIO} días.`}>
          <div className="rv-cd__pila">
            <p className="rv-cd__nota">
              El origen y el destino de un viaje llegan como texto libre. Estos son los {TOP_TEXTOS_SIN_SITIO} textos más frecuentes de los viajes abiertos
              de los últimos {DIAS_TEXTOS_SIN_SITIO} días que todavía no se ligan a ningún sitio: sin sitio no hay llegada que validar. Dile al sistema qué es cada
              uno: un sitio de tu catálogo, una instrucción («regresa sin carga») o algo que se ignora. Ante la duda no se asigna nada.
            </p>
            {p.textosSinSitio !== null && p.textosSinSitio.length > 0 && (
              <TablaBase etiqueta="Textos de viaje sin sitio" columnas={columnasTextos} filas={p.textosSinSitio} idFila={(x) => x.textoNormalizado} densa tarjetaMovil />
            )}
            {avisoSelector && p.puedeEditar && <p role="status" className="rv-cd__nota" data-tono="warn">{avisoSelector} Para uno que no aparezca, usa la importación de equivalencias por CSV (columna geocerca_codigo).</p>}
            {p.textosTruncado && <p className="rv-cd__nota" data-tono="warn">Hay más viajes de los que se leyeron: la cuenta es de una muestra.</p>}
            {p.descargaCsv && p.textosSinSitio !== null && p.textosSinSitio.length > 0 && (
              <p className="rv-cd__nota">
                <a href={p.descargaCsv} download="textos-sin-sitio.csv" className="rv-cd__enlace">Descargar esta lista como CSV</a>{' '}
                <span className="rv-cd__faint">para que se complete fuera del sistema (solo trae el texto del lugar; ningún dato de personas).</span>
              </p>
            )}
            {p.puedeEditar && p.accionImportarEquivalencias && (
              <div className="rv-cd__pila">
                <p className="rv-cd__rotulo">Importar equivalencias desde CSV</p>
                <p className="rv-cd__nota">
                  Columnas: <code>texto, geocerca_codigo, tipo, lado</code>. <code>tipo</code>: <code>sitio</code>, <code>sin_sitio</code> (instrucción) o <code>ignorar</code>;
                  <code> lado</code>: origen, destino o ambos (vacío = ambos). Cada fila se aprueba o se rechaza sola y te decimos cuál y por qué; las filas sin
                  completar se omiten. Re-importar el mismo archivo no cambia nada. El código del sitio tiene que existir ya en el catálogo.
                </p>
                <FormaImportarEquivalencias accion={p.accionImportarEquivalencias} />
              </div>
            )}
          </div>
        </Tarjeta>
      )}
    </MarcoPagina>
  );
}
