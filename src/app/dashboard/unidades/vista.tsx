import { TarjetaTabla } from '../bloque';
import { cifrasUniformes } from '../formato';
import { Satellite, Truck } from 'lucide-react';
import type { UnidadRow, UnidadCruda } from '@/lib/likida/operacion';
import { clasificarVigencia, avisoVigencias, DIAS_AVISO, type ConteoVigencias } from '@/lib/likida/vigencias';
import { numero } from '@/lib/formato';
import { urlRegistro, type PaginaRegistroUI } from '../paginar-registro';
import { FiltroRegistro } from '../registro-filtro';
import { FormaUnidad, type AccionForma, type ProveedorGps, type PatioOpcion } from './forma';
import { ImportadorMasivo, type AccionImportacion } from '../importador-masivo';
import { AccionesEstadoUnidad, ReactivarUnidad, type AccionEstado } from './estado';
import {
  Aviso, AvisoCompacto, BotonEnlace, EstadoVacio, Icono, StatusChip, TablaBase, Tarjeta,
  type ColumnaBase, type TonoEstado,
} from '@/app/ui-v2/componentes';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { CajonVistaRapida, EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { CajonAlta } from '../cajon-alta';
import './unidades.css';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';

/** El tono de cada estado de vigencia: vencido y sin dato NO se pintan igual (sin dato no es vigente, es sin verificar). */
const TONO_VIGENCIA: Record<'vencido' | 'por_vencer' | 'vigente' | 'sin_dato', TonoEstado> = {
  vencido: 'bad', por_vencer: 'warn', vigente: 'ok', sin_dato: 'muted',
};

const TONO_ESTADO: Record<string, TonoEstado> = { disponible: 'ok', en_ruta: 'info', taller: 'warn', baja: 'muted' };

/** Los estados que `unidad.estado` admite, en palabras de persona. La fuente
 *  es `ESTADOS_UNIDAD` de `operacion.ts` (el mismo dominio que el servidor
 *  valida); aquí solo se re-declara el tipo para no arrastrar ese módulo —con
 *  su `supabaseAdmin`— al bundle del navegador. */
const ESTADO_UNIDAD: Record<string, string> = {
  disponible: 'Disponible',
  en_ruta: 'En ruta',
  taller: 'En taller',
  baja: 'Dada de baja',
};

/**
 * EL REGISTRO DE UNIDADES — el activo que produce el dinero, con los papeles
 * que la ley le exige para poder producirlo.
 *
 * Es el patrón de "vigencias que anclan" aplicado a la unidad, y en carga
 * pesa más: una unidad con la verificación
 * vencida no tiene un pendiente administrativo, tiene un riesgo de multa, de
 * detención y de un seguro que no responde.
 *
 * El motor ya existía entero (`getUnidades`): elige el papel MÁS PRÓXIMO a
 * vencer de los tres y devuelve los días, negativos si ya pasó. Esta pantalla
 * solo lo dice, y lo dice con las mismas palabras que `/dashboard/operadores`
 * usa para las licencias, porque el clasificador es el mismo módulo.
 *
 * SIN DATO NO ES VIGENTE, y por eso tiene su propia pastilla gris y su propio
 * contador: una unidad a la que nadie le capturó la póliza no está en regla,
 * está sin verificar. Pintarla verde es la mentira que el gerente descubriría
 * cuando lo pare un inspector.
 */
/** Lo capturado de una unidad, en la forma cruda que la forma edita. */
function aInicial(u: UnidadRow): UnidadCruda {
  return {
    numeroEconomico: u.numeroEconomico,
    placas: u.placas ?? '',
    marca: u.marca ?? '',
    modelo: u.modelo ?? '',
    anio: u.anio == null ? '' : String(u.anio),
    polizaVence: u.polizaVence ?? '',
    permisoSictVence: u.permisoSictVence ?? '',
    verificacionVence: u.verificacionVence ?? '',
    gpsProveedor: u.gpsProveedor ?? '',
    gpsDeviceId: u.gpsDeviceId ?? '',
  };
}

const INICIAL_VACIO: UnidadCruda = {
  numeroEconomico: '', placas: '', marca: '', modelo: '', anio: '',
  polizaVence: '', permisoSictVence: '', verificacionVence: '',
  gpsProveedor: '', gpsDeviceId: '',
};

/**
 * FE-12 (22-ago-2026): esta vista pintaba TODAS las unidades activas y, por
 * cada una, un `<FormaUnidad>` completo dentro de un `<details>`. Con 5,000
 * unidades eso son 5,000 formularios —ocho `<input>` cada uno— en el HTML de
 * una pantalla donde se edita UNA: megabytes servidos para nada, sin búsqueda
 * ni páginas por las que navegar.
 *
 * Ahora: `?q=` y `?p=` acotan lo que se pinta (`paginarRegistro`), y la forma
 * de edición existe SOLO para la fila que `?editar=<id>` nombra. Las demás
 * llevan un link — que es lo que un `<details>` cerrado siempre debió ser.
 */
export function VistaUnidades({ tr = TR_OPERACION_ES,
  pag, bajas, totalBajas, conteos, totalActivasConocido, puedeEditar, guardar, cambiarEstado, sufijo, camposOcultos, proveedoresGps,
  patios, patioDelJefe, terminalPorUnidad, editablePorUnidad, cargarUnidades, plantillaCsv, hrefPatios, taller,
}: { tr?: TrOperacion;
  /** El bloque del taller (órdenes y rutinas), armado en el servidor; entra como hijo del esqueleto para no quedar fuera del marco. */
  taller?: import('react').ReactNode;
  /** La página del parque ACTIVO, ya cortada y ordenada por la base
   *  (auditoría 24). El `total` y el `filtrados` los CONTÓ la base; el largo
   *  de esta página no es ninguno de los dos. */
  pag: PaginaRegistroUI<UnidadRow>;
  /** Una página de las dadas de baja. NO son todas: ver `totalBajas`. */
  bajas: readonly UnidadRow[];
  /** Cuántas hay dadas de baja EN TOTAL, para no llamar «5» a una lista
   *  topada en 25. */
  totalBajas: number;
  /** El semáforo de papeles sobre la FLOTA ENTERA. `null` = no se pudo
   *  contar, y entonces se pinta «—»: un 0 se leería como una medición. */
  conteos: ConteoVigencias & { activas: number } | null;
  /** ¿Se sabe cuántas unidades activas hay? Cuando no, el pie del filtro no
   *  puede afirmar el «de N» del parque. */
  totalActivasConocido: boolean;
  /** Si se PINTA la captura. La puerta real vive dentro del server action. */
  puedeEditar: boolean;
  guardar: AccionForma;
  /** Mover el estado operativo: taller, baja, o de vuelta a disponible
   *  (auditoría 20, H4). Misma puerta que `guardar`. */
  cambiarEstado: AccionEstado;
  /** El catálogo de rastreo, ya recortado a `{id, nombre}` en el servidor. */
  proveedoresGps: ProveedorGps[];
  /** `?tenant=`/`?vista=`/`?rol=` del superadmin. */
  sufijo: string;
  camposOcultos: Array<[string, string]>;
  /** Los patios de la flota (W2). */
  patios: PatioOpcion[];
  /** El nombre del patio de un jefe CON patio (altas y cargas caen ahí); null = toda la flota. */
  patioDelJefe: string | null;
  /** uuid de unidad → uuid de su patio (null = sin patio). */
  terminalPorUnidad: Record<string, string | null>;
  /** uuid de unidad → ¿cae dentro del alcance del usuario? (un jefe con patio
   *  solo edita las de su patio). Lo decide el servidor con el patio leído de la base. */
  editablePorUnidad: Record<string, boolean>;
  cargarUnidades: AccionImportacion;
  /** El CSV de la plantilla (con BOM), armado en el servidor. */
  plantillaCsv: string;
  hrefPatios: string;
}) {
  const { t, tp, idioma } = tr;
  const nombrePatio = new Map(patios.map((p) => [p.id, p.nombre] as const));
  // AUDITORÍA 20 (H4): las bajas ya no se pierden. Esta vista SIEMPRE filtró
  // `activo`, así que hasta hoy una unidad inactiva desaparecía de la pantalla
  // sin dejar rastro. Ahora que la baja existe, existe también el camino de
  // vuelta: un camión que se vendió y no se vendió, o una baja tecleada por
  // error, no pueden requerir SQL para deshacerse.
  //
  // AUDITORÍA 24: ni el orden ni el conteo se hacen ya aquí. El orden es el
  // del trabajo —lo vencido primero, sin papeles al final— y lo aplica la
  // base sobre el parque ENTERO; ordenar una página ya cortada solo reordena
  // 25 filas y escondería lo vencido en la página 3. El semáforo cuenta la
  // flota entera por el mismo motivo.
  const aviso = conteos ? avisoVigencias(conteos) : null;
  const hayFiltro = pag.q !== '';
  const vacio = !hayFiltro && pag.filtrados === 0 && totalBajas === 0;

  const hrefUnidad = (id: string | null) => urlRegistro('/dashboard/unidades', sufijo, { q: pag.q || null, p: pag.pagina, editar: id });
  const editada = pag.editando ? pag.filas.find((u) => u.id === pag.editando) : undefined;

  // Altas (formulario y carga masiva): cada una en su cajón lateral, abierto desde la cabecera de página (primario = alta). Sin unidades
  // el alta nace abierta: es la única forma de que deje de haber cero. Solo se pinta a quien puede administrar: el encargado la lee, no la escribe.
  const acciones = puedeEditar ? (
    <>
      <CajonAlta id="importar" titulo={t('un.carga.titulo')} disparador={t('un.carga.titulo')} tamano="xl">
        <ImportadorMasivo
          entidad="unidades" accion={cargarUnidades} plantillaCsv={plantillaCsv}
          archivoPlantilla="plantilla-unidades.csv"
          columnas={t('un.carga.cols')}
          hrefPatios={hrefPatios} patioDelJefe={patioDelJefe} tope={2_000}
        />
      </CajonAlta>
      <CajonAlta id="alta" titulo={t('un.alta.titulo')} descripcion={t('un.alta.resumen')} disparador={t('un.alta.titulo')} primario>
        <FormaUnidad accion={guardar} inicial={INICIAL_VACIO} idPrefijo="alta" proveedoresGps={proveedoresGps}
          patios={patios} terminalId="" patioFijo={patioDelJefe !== null} />
      </CajonAlta>
    </>
  ) : undefined;

  const columnas: ColumnaBase<UnidadRow>[] = [
    {
      id: 'unidad', titulo: t('un.col.unidad'), principal: true,
      celda: (u) => (
        <>
          {u.numeroEconomico}
          {u.placas && <span className="rv-un__placas"> · {u.placas}</span>}
          {(u.marca || u.modelo || u.anio) && <span className="rv-un__tenue">{[u.marca, u.modelo, u.anio].filter(Boolean).join(' · ')}</span>}
        </>
      ),
    },
    ...(patios.length > 0 ? [{
      id: 'patio', titulo: t('un.col.patio'),
      celda: (u: UnidadRow) => nombrePatio.get(terminalPorUnidad[u.id] ?? '') ?? <span className="rv-un__tenue">{t('un.sinpatio')}</span>,
    } satisfies ColumnaBase<UnidadRow>] : []),
    { id: 'estado', titulo: t('un.col.estado'), celda: (u) => <StatusChip tono={TONO_ESTADO[u.estado] ?? 'neutral'}>{ESTADO_UNIDAD[u.estado] ?? u.estado}</StatusChip> },
    {
      id: 'papeles', titulo: t('un.col.papeles'),
      celda: (u) => {
        const v = clasificarVigencia(u.diasAlVencimiento, u.queVence);
        return <StatusChip tono={TONO_VIGENCIA[v.estado]}>{v.rotulo}</StatusChip>;
      },
    },
    {
      id: 'taller', titulo: t('un.col.taller'),
      celda: (u) => (u.ordenesAbiertas > 0
        ? <StatusChip tono="warn">{tp('un.orden', u.ordenesAbiertas)}</StatusChip>
        : <span className="rv-un__tenue">{t('un.sinordenes')}</span>),
    },
    // Sin lectura de odómetro NO es 0 km: «—».
    { id: 'km', titulo: 'Km', alinear: 'der', celda: (u) => (u.kmActual !== null ? `${numero(u.kmActual, idioma)} km` : '—') },
    {
      // El GPS a la vista en la fila: «ligada» y «entrando» son cosas distintas. Sin dispositivo no se dice nada: no toda flota tiene
      // rastreo. La FECHA y no «al día»: `gps_visto_en` puede ser de hace tres semanas, y «conectado» a secas taparía justo a la
      // unidad que dejó de reportar.
      id: 'gps', titulo: t('un.col.rastreo'),
      celda: (u) => (u.gpsDeviceId ? (
        <span className="rv-un__gps" data-vivo={u.gpsVistoEn ? '' : undefined}>
          <Icono icono={Satellite} tam={14} />
          {u.gpsProveedor}{u.gpsVistoEn ? t('un.gps.ultima', { fecha: u.gpsVistoEn.slice(0, 10) }) : t('un.gps.ligada')}
        </span>
      ) : <span className="rv-un__tenue">{t('un.sinrastreo')}</span>),
    },
  ];
  columnas.push({
    // El estado operativo NO vive en la forma de edición: es una acción de un clic sobre un hecho del mundo («se fue al taller»,
    // «la vendimos»), no un campo que se captura junto a las placas. Va siempre visible, no solo en la fila que `?editar=` abrió.
    id: 'acciones', titulo: t('un.col.acciones'), alinear: 'der',
    celda: (u) => (
      <span className="rv-un__acciones">
        <BotonEnlace href={hrefUnidad(u.id)} variante="ghost" tamano="sm">{t('un.vr.ver')}</BotonEnlace>
        {puedeEditar && editablePorUnidad[u.id] ? (
          <AccionesEstadoUnidad accion={cambiarEstado} unidadId={u.id} estado={u.estado} numeroEconomico={u.numeroEconomico} />
        ) : null}
      </span>
    ),
  });

  // `—` y no 0 cuando no se pudo contar: un 0 aquí diría «no hay ninguna vencida», que es la afirmación más cara que esta pantalla puede
  // hacer en falso. `unidades` y no `activas`: con todo el parque dado de baja, «todavía no hay unidades» sería falso.
  const cifras: PropsCifra[] | undefined = vacio ? undefined : [
    { etiqueta: t('un.cifra.vencidos'), valor: conteos?.vencidos, tono: conteos && conteos.vencidos > 0 ? 'bad' : undefined, info: 'unidades.vencidas' },
    { etiqueta: t('un.cifra.vencen', { n: DIAS_AVISO }), valor: conteos?.porVencer, tono: conteos && conteos.porVencer > 0 ? 'warn' : undefined, info: 'unidades.por_vencer' },
    { etiqueta: t('un.cifra.enregla'), valor: conteos?.vigentes, info: 'unidades.en_regla' },
    { etiqueta: t('un.cifra.sinpapeles'), valor: conteos?.sinDato, info: 'unidades.sin_papeles' },
  ];
  const puedeCorregir = puedeEditar && editada !== undefined && editablePorUnidad[editada.id];

  return (
    <EsqueletoTablaMaestra
      titulo={t('un.titulo')}
      apoyo={t('un.apoyo')}
      acciones={acciones}
      cifras={cifrasUniformes(cifras)}
      filtros={vacio ? undefined : (
        <FiltroRegistro ruta="/dashboard/unidades" sufijo={sufijo} pagina={pag}
          sustantivo="unidades" camposOcultos={camposOcultos} />
      )}
      avisos={(
        <>
          {aviso && <Aviso tono="error" titulo={t('un.aviso.titulo')}>{aviso}</Aviso>}
          {!vacio && hayFiltro && !totalActivasConocido && (
            // No se pudo contar el parque entero, así que el «de N» del pie sería un número inventado. Se dice.
            <AvisoCompacto tono="warn" resumen={t('un.aviso.parque')} />
          )}
        </>
      )}
      vistaRapida={editada ? (
        <CajonVistaRapida
          titulo={editada.numeroEconomico}
          subtitulo={[editada.placas, editada.marca, editada.modelo, editada.anio].filter(Boolean).join(' · ') || undefined}
          hrefCerrar={hrefUnidad(null)}
          cifras={[
            { etiqueta: t('un.col.estado'), valor: ESTADO_UNIDAD[editada.estado] ?? editada.estado },
            { etiqueta: t('un.col.papeles'), valor: clasificarVigencia(editada.diasAlVencimiento, editada.queVence).rotulo },
            { etiqueta: 'Km', valor: editada.kmActual !== null ? `${numero(editada.kmActual, idioma)} km` : '—' },
            { etiqueta: t('un.col.taller'), valor: editada.ordenesAbiertas > 0 ? tp('un.orden', editada.ordenesAbiertas) : t('un.sinordenes') },
          ]}
        >
          {puedeCorregir ? (
            <div className="rv-un__editor">
              <p className="rv-un__nota">{t('un.corregir', { eco: editada.numeroEconomico })}</p>
              <FormaUnidad accion={guardar} id={editada.id} inicial={aInicial(editada)} idPrefijo={`u-${editada.id}`}
                proveedoresGps={proveedoresGps} gpsVistoEn={editada.gpsVistoEn}
                patios={patios} terminalId={terminalPorUnidad[editada.id] ?? ''} patioFijo={patioDelJefe !== null} />
            </div>
          ) : null}
        </CajonVistaRapida>
      ) : null}
    >
      {vacio ? (
        <EstadoVacio pantalla contenido icono={Truck} titulo={t('un.vacio.titulo')}
          accion={puedeEditar ? <BotonEnlace tamano="sm" href={urlRegistro('/dashboard/unidades', sufijo, { abrir: 'alta' })}>{t('un.alta.titulo')}</BotonEnlace> : undefined}>
          {t('un.vacio.nota')}
          {puedeEditar ? t('un.vacio.manual') : ''}
        </EstadoVacio>
      ) : (
        <>
          <TarjetaTabla titulo={t('un.tabla.etiqueta')} contador={numero(pag.filtrados, idioma)}>
          <TablaBase<UnidadRow> etiqueta={t('un.tabla.etiqueta')} columnas={columnas} filas={pag.filas} idFila={(u) => u.id} tarjetaMovil
            vacio={{ titulo: t('un.vacio.sincoincidencias'), texto: t('un.vacio.busqueda', { q: pag.q }) }} />
          </TarjetaTabla>
          <p className="rv-un__nota">{t('un.nota.papel')}</p>
        </>
      )}

      {/* LAS QUE YA NO ESTÁN EN EL PARQUE. Aparte y al final: no cuentan en los cuatro contadores de arriba (una póliza vencida de un
          camión vendido no es un pendiente) ni se ofrecen en Despacho. Pero SE VEN: un activo dado de baja que desaparece de la
          pantalla se lee como borrado, y no lo está: su historial de viajes y de taller sigue completo. */}
      {totalBajas > 0 && (
        <Tarjeta titulo={t('un.bajas', { n: numero(totalBajas, idioma) })} info="unidades.bajas">
          <p className="rv-un__nota">
            {t('un.bajas.nota')}
          </p>
          <ul className="rv-un__lista">
            {bajas.map((u) => (
              <li key={u.id}>
                <div>
                  <strong>{u.numeroEconomico}</strong>
                  {u.placas && <span className="rv-un__placas"> · {u.placas}</span>}
                  {(u.marca || u.modelo || u.anio) && (
                    <span className="rv-un__tenue">{[u.marca, u.modelo, u.anio].filter(Boolean).join(' · ')}</span>
                  )}
                </div>
                {puedeEditar && editablePorUnidad[u.id] && <ReactivarUnidad accion={cambiarEstado} unidadId={u.id} />}
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {taller}
    </EsqueletoTablaMaestra>
  );
}
