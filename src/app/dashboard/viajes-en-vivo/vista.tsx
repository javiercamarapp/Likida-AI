import { cifrasUniformes } from '../formato';
import { TarjetaTabla } from '../bloque';
import { Aviso, BarraFiltros, Boton, BotonEnlace, EstadoVacio, FiltroInterruptor, FiltroOpciones, Icono, StatusChip, Tarjeta, TablaBase, type ColumnaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { MapPin, MapPinOff, ShieldAlert } from 'lucide-react';
import { fechaHoraMx, numero } from '@/lib/formato';
import { ETIQUETA_DESTINO, type TareaAbierta } from '@/lib/likida/orquestador/escalamiento';
import { textoAntiguedad, type FilaViaje, type TableroViajes, type TipoExcepcionViaje } from '@/lib/likida/orquestador/tablero_viajes';
import type { NivelFrescura } from '@/lib/likida/orquestador/enganche_gps';
import { ActualizarSolo } from './actualizar_solo';
import { PillSemaforo } from '../viajes/pills';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import './en-vivo.css';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// EL TABLERO DE VIAJES EN VIVO — presentación pura (el modelo ya viene armado
// por `armarTableroViajes`; aquí no se lee nada). Área `operacion`: CERO pesos.
//
// Cada viaje con su último hito, su posición y qué tan vieja es, y sus
// excepciones. Una posición vieja se pinta como vieja (no se esconde); «sin
// posición» y «no se pudo leer el GPS» son frases distintas.
//
// ENGANCHE: el MAPA con el semáforo de obsolescencia vive en la rama del GPS
// (`/dashboard/mapa`); aquí solo se enlaza (`hrefMapa`), no se duplica.
// ═══════════════════════════════════════════════════════════════════════════

export interface FiltrosVistaViajes { terminalId: string; clienteId: string; soloExcepciones: boolean }
export interface CatalogoVista { terminales: Array<{ id: string; nombre: string }>; clientes: Array<{ id: string; nombre: string }> }

const frescuraTr = (t: TResto = T_RESTO_ES): Record<NivelFrescura, { etiqueta: string; tono: TonoEstado }> => ({
  en_vivo: { etiqueta: t('op.en_vivo'), tono: 'ok' }, atrasada: { etiqueta: t('op.atrasada'), tono: 'warn' }, obsoleta: { etiqueta: t('op.obsoleta'), tono: 'bad' },
});
export const etiquetaExcepcion = (t: TResto = T_RESTO_ES): Record<TipoExcepcionViaje, string> => ({
  escalado_sin_atender: t('op.escalado_sin_atender'), sin_reporte: t('op.sin_reporte'), atrasado: t('op.atrasado'), sin_coincidencia: t('op.ubicacion_sin_coincidencia'),
  llegada_sin_confirmar: t('op.llegada_sin_confirmar'), llegada_sin_sitio: t('op.llegada_sin_sitio_para_conciliar'), estadia_excedida: t('op.estadia_excedida'), horas_incoherentes: t('op.horas_incoherentes'),
  sin_senal_de_vida: t('op.sin_senal_de_vida'), gps_obsoleto: t('op.gps_obsoleto'), sin_posicion: t('op.sin_posicion'), sin_unidad: t('op.sin_tractor_asignado'), sin_a_quien_escalar: t('op.sin_a_quien_escalar'), patio_entrega_distinto: t('op.patio_de_entrega_distinto'),
  pendiente_cruce_largo: t('op.pendiente_de_cruce_por_mucho_tiempo'), salida_tms_discrepante: t('op.salida_del_tms_sin_confirmar'), local_abierto_sin_ccp: 'Sin Carta Porte (viaje local abierto)', sin_ruta_autorizada: t('op.sin_ruta_autorizada'),
});
export const ETIQUETA_EXCEPCION = etiquetaExcepcion();
const gravedadTr = (t: TResto = T_RESTO_ES): Record<1 | 2 | 3, { texto: string; tono: TonoEstado }> => ({
  3: { texto: t('op.urgente'), tono: 'bad' }, 2: { texto: t('op.revisar'), tono: 'warn' }, 1: { texto: t('op.vigilar'), tono: 'muted' },
});


function Filtros({ f, c, accionUrl, ocultos, t = T_RESTO_ES }: { f: FiltrosVistaViajes; c: CatalogoVista; accionUrl: string; ocultos: Record<string, string>; t?: TResto }) {
  const hay = Boolean(f.terminalId || f.clienteId || f.soloExcepciones);
  return (
    <BarraFiltros enLinea accion={accionUrl} ocultos={ocultos} etiqueta={t('op.filtros_de_viajes_en_vivo')} nActivos={hay ? 1 : 0} limpiarHref={accionUrl}>
      <FiltroOpciones nombre="terminal" etiqueta={t('op.terminal')} valor={f.terminalId} opciones={[{ valor: '', rotulo: t('cfg.todas') }, ...c.terminales.map((t) => ({ valor: t.id, rotulo: t.nombre }))]} />
      <FiltroOpciones nombre="cliente" etiqueta={t('cfg.cliente')} valor={f.clienteId} opciones={[{ valor: '', rotulo: t('op.todos') }, ...c.clientes.map((x) => ({ valor: x.id, rotulo: x.nombre }))]} />
      <FiltroInterruptor nombre="vista" valor="excepciones" etiqueta={t('op.solo_con_excepciones')} marcado={f.soloExcepciones} />
    </BarraFiltros>
  );
}

function Posicion({ f, gpsDisponible, t = T_RESTO_ES }: { f: FilaViaje; gpsDisponible: boolean; t?: TResto }) {
  if (!f.posicion && !gpsDisponible) {
    return <span className="rv-vv__apagado"><Icono icono={MapPinOff} tam={16} />{' '}{t('op.gps_no_consultado')}</span>;
  }
  if (!f.posicion) {
    const sinTractor = f.excepciones.some((e) => e.tipo === 'sin_unidad');
    return <span className="rv-vv__apagado"><Icono icono={MapPinOff} tam={16} /> {sinTractor ? 'Sin tractor asignado' : t('op.sin_posicion_reportada')}</span>;
  }
  const fr = frescuraTr(t)[f.posicion.frescura];
  return (
    <span className="rv-vv__item">
      <StatusChip tono={fr.tono}><Icono icono={MapPin} tam={16} /> {fr.etiqueta}</StatusChip>
      <span className="rv-vv__sub rv-vv__num">
        {f.posicion.antiguedadMin < 0 ? 'hora ilegible' : textoAntiguedad(f.posicion.antiguedadMin)} · {f.posicion.lat.toFixed(3)}, {f.posicion.lng.toFixed(3)}
      </span>
    </span>
  );
}

function columnas(gpsDisponible: boolean, t: TResto = T_RESTO_ES): ColumnaBase<FilaViaje>[] {
  return [
    {
      id: 'viaje', titulo: t('op.viaje'), principal: true,
      celda: (f) => (
        <>
          <span className="rv-vv__folio">{f.folio ?? 'sin folio'}</span>
          <span className="rv-vv__sub">{f.origen ?? '?'} → {f.destino ?? '?'}</span>
          <span className="rv-vv__sub" data-tenue>{[f.chofer, f.terminal, f.cliente].filter(Boolean).join(' · ')}</span>
        </>
      ),
    },
    {
      id: 'estado', titulo: t('llaves.estado'),
      celda: (f) => (
        <span className="rv-vv__item">
          <PillSemaforo semaforo={f.semaforo} />
          <span className="rv-vv__sub">
            {f.ultimoHito ? <>{t('op.ultimo')}{' '}{f.ultimoHito.etiqueta}{f.ultimoHito.cuando ? ` · ${fechaHoraMx(f.ultimoHito.cuando)}` : ''}</> : 'Sin hitos registrados'}
          </span>
          {f.escalado && (
            <StatusChip tono={f.escalado.atendido ? 'muted' : 'bad'}>
              <Icono icono={ShieldAlert} tam={16} />{' '}{t('op.escalado_a_trafico_nivel', { nivel: f.escalado.nivel })}{f.escalado.atendido ? ', atendido' : ', sin atender'}
            </StatusChip>
          )}
        </span>
      ),
    },
    { id: 'posicion', titulo: t('op.posicion_del_tractor'), celda: (f) => <Posicion t={t} f={f} gpsDisponible={gpsDisponible} /> },
    {
      id: 'excepciones', titulo: t('op.excepciones'),
      celda: (f) => f.excepciones.length === 0
        ? <span className="rv-vv__apagado">{t('op.sin_excepciones')}</span>
        : (
          <ul className="rv-vv__lista">
            {f.excepciones.map((e, i) => (
              <li key={`${e.tipo}-${i}`} className="rv-vv__item">
                <span className="rv-vv__fila-chip"><StatusChip tono={gravedadTr(t)[e.gravedad].tono}>{gravedadTr(t)[e.gravedad].texto}</StatusChip> {etiquetaExcepcion(t)[e.tipo]}</span>
                <span className="rv-vv__sub">{e.texto}</span>
              </li>
            ))}
          </ul>
        ),
    },
  ];
}

const avisoAtencion = (t: TResto = T_RESTO_ES): Record<string, string> => ({
  ya_atendida: t('op.esa_tarea_ya_estaba_cerrada_otra'),
  sin_permiso: t('op.tu_rol_no_puede_atender_esa'),
  no_se_pudo: t('op.no_pude_confirmar_la_tarea_intenta'),
});

export function TareasAbiertas({ tareas, accion, ocultos, aviso = null, errorLectura = false, t = T_RESTO_ES }: {
  tareas: TareaAbierta[] | null;
  aviso?: string | null;
  accion: ((fd: FormData) => Promise<void>) | null;
  ocultos: Record<string, string>;
  /** A37-L-docs-ux-calidad-01: la LECTURA falló (timeout/5xx). Distinto de `null` (base sin la 0650): aquí hay un error que
   *  decir, no una pantalla vacía que parezca «sin pendientes» cuando puede haber una escalación de dinero abierta. */
  errorLectura?: boolean; t?: TResto;
}) {
  if (errorLectura) {
    return (
      <Tarjeta titulo={t('op.tareas_del_asistente')} info="viajes_en_vivo.tareas" estado="error" reintentar
        mensaje={t('op.no_pude_leer_las_tareas_abiertas')} />
    );
  }
  if (tareas === null) return null; // base sin la 0650: el asistente avisa por chat que no puede escalar
  return (
    <Tarjeta titulo={t('op.tareas_del_asistente')} info="viajes_en_vivo.tareas">
      {aviso && avisoAtencion(t)[aviso] && <p role="status" className="rv-vv__sub">{avisoAtencion(t)[aviso]}</p>}
      {tareas.length === 0
        ? <EstadoVacio contenido titulo={t('op.sin_tareas_abiertas')}>{t('op.no_hay_tareas_abiertas_cuando_el')}</EstadoVacio>
        : (
          <ul className="rv-vv__lista">
            {tareas.map((tarea) => (
              <li key={tarea.id} className="rv-vv__tarea">
                <div className="rv-vv__tarea-txt">{rico(t('op.e0_para_e0', { etiquetaDestino: ETIQUETA_DESTINO[tarea.destino] }), { e0: (c) => <span>{c}</span> })}<span className="rv-vv__sub" data-tenue>{fechaHoraMx(tarea.creadaEn)}{tarea.viajeFolio ? ` · viaje ${tarea.viajeFolio}` : ''}</span>
                  <span className="rv-vv__sub">{tarea.resumen}</span>
                </div>
                {accion && (
                  <form action={accion}>
                    {Object.entries(ocultos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                    <input type="hidden" name="id" value={tarea.id} />
                    <Boton type="submit" tamano="sm">{t('op.marcar_atendida')}</Boton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
    </Tarjeta>
  );
}

export function VistaViajesEnVivo({ tablero, filtros, catalogo, accionUrl, ocultos, pregunta, tareas, notificaciones, mapa, totalEnCurso, sinSeguimiento = 0, t = T_RESTO_ES }: {
  tablero: TableroViajes;
  filtros: FiltrosVistaViajes;
  catalogo: CatalogoVista;
  accionUrl: string;
  ocultos: Record<string, string>;
  /** @deprecated sin efecto: «Ver el mapa» se retiró (la pestaña Mapa ya lo es). */
  hrefMapa?: string;
  /** Hay chat disponible para este perfil: se ofrece el enlace a «Pregunta a tus datos» (la caja propia de esta página se retiró). */
  pregunta?: ReactNodeLike;
  tareas: ReactNodeLike;
  /** La sección «Notificaciones» (a quién le llega el aviso de una tarea nueva). Solo la ve quien puede configurarla. */
  notificaciones?: ReactNodeLike;
  /** El mapa de los viajes del tablero (componente de cliente armado en el servidor con `mapaDelTablero`). Va antes de la tabla: la tabla es su equivalente. */
  mapa?: ReactNodeLike;
  /** Los viajes en curso de la flota contados en la base (los mismos que cuenta el Mapa). `null` = no se pudo contar; sin él se usa el conteo del tablero. */
  totalEnCurso?: number | null;
  /** Viajes en curso (base) que el tablero del conductor aún no sigue: la tabla vacía lo dice en vez de negar el viaje. */
  sinSeguimiento?: number; t?: TResto;
}) {
  const c = tablero.conteos;
  const cifras: PropsCifra[] = [
    // Un mismo rótulo da la misma cifra en todas las pantallas: «en curso» es lo que cuenta el Mapa (abiertos y en cuadre). El tablero sólo
    // sigue a los que el conductor ya aceptó; esa diferencia se dice en la nota, no se esconde.
    typeof totalEnCurso === 'number'
      ? { etiqueta: t('op.viajes_en_curso'), valor: numero(totalEnCurso), nota: t('op.con_seguimiento_del_conductor', { n: numero(c.viajes) }), info: 'viajes_en_vivo.en_curso' }
      : { etiqueta: t('op.viajes_en_curso'), valor: numero(c.viajes), nota: tablero.hayMas ? t('op.hay_mas_viajes_activos_que_los') : undefined, info: 'viajes_en_vivo.en_curso' },
    { etiqueta: t('op.con_excepcion'), valor: numero(c.conExcepcion), tono: c.conExcepcion > 0 ? 'warn' : undefined, info: 'viajes_en_vivo.con_excepcion' },
    { etiqueta: t('op.sin_senal_de_vida'), valor: numero(c.sinSenal), nota: t('op.chofer_y_tractor_callados'), tono: c.sinSenal > 0 ? 'bad' : undefined, info: 'viajes_en_vivo.sin_senal' },
    { etiqueta: t('op.llegadas_sin_confirmar'), valor: numero(c.llegadaSinConfirmar), nota: t('op.escalados_a_trafico', { numero: numero(c.escaladosATrafico) }), info: 'viajes_en_vivo.llegadas_sin_confirmar' },
  ];
  return (
    <EsqueletoTablaMaestra
      titulo={t('op.viajes_en_vivo')}
      apoyo={t('op.viajes_en_curso_con_su_ultimo', { fechaHoraMx: fechaHoraMx(tablero.generadoEn) })}
      acciones={(
        <>
          <ActualizarSolo />
          {/* El chat vive en «Pregunta a tus datos» (un solo compositor); aquí solo se enlaza, sin una caja propia. «Ver el mapa» se retiró: ya es la pestaña Mapa. */}
          {pregunta ? <BotonEnlace href={`/dashboard/chat${ocultos.tenant ? `?tenant=${encodeURIComponent(ocultos.tenant)}` : ''}`}>{t('op.preguntale_al_asistente')}</BotonEnlace> : null}
        </>
      )}
      filtros={<Filtros t={t} f={filtros} c={catalogo} accionUrl={accionUrl} ocultos={ocultos} />}
      avisos={!tablero.gpsDisponible ? <Aviso tono="warn">{t('op.no_se_pudieron_leer_las_posiciones')}</Aviso> : undefined}
      cifras={cifrasUniformes(cifras)}
      selloCifras={selloHoy('Viajes en curso')}
    >
      {mapa}
      <TarjetaTabla titulo={t('op.viajes_en_vivo_y_su_estado')} contador={tablero.hayMas ? undefined : numero(tablero.filas.length)}>
        <TablaBase<FilaViaje>
          etiqueta={t('op.viajes_en_vivo_y_su_estado')}
          columnas={columnas(tablero.gpsDisponible, t)}
          filas={tablero.filas}
          idFila={(f) => f.viajeId}
          tarjetaMovil
          vacio={{
            titulo: t('op.sin_viajes_que_mostrar'),
            texto: filtros.terminalId || filtros.clienteId || filtros.soloExcepciones ? t('op.ningun_viaje_cumple_los_filtros') : sinSeguimiento > 0 ? t('op.viajes_sin_seguimiento', { n: numero(sinSeguimiento) }) : t('op.no_hay_viajes_en_curso'),
          }}
        />
      </TarjetaTabla>
      {tareas}
      {notificaciones ? <Tarjeta titulo={t('op.notificaciones_de_los_avisos')}>{notificaciones}</Tarjeta> : null}
    </EsqueletoTablaMaestra>
  );
}

type ReactNodeLike = import('react').ReactNode;
