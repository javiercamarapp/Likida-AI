import { Aviso, BarraFiltros, BotonEnlace, Disclosure, FiltroInterruptor, FiltroOpciones, Icono, MarcoPagina, StatusChip, Tarjeta, TablaBase, type ColumnaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { MapPin, MapPinOff, ShieldAlert } from 'lucide-react';
import { fechaHoraMx, numero } from '@/lib/formato';
import { ETIQUETA_DESTINO, type TareaAbierta } from '@/lib/likida/orquestador/escalamiento';
import { textoAntiguedad, type FilaViaje, type TableroViajes, type TipoExcepcionViaje } from '@/lib/likida/orquestador/tablero_viajes';
import type { NivelFrescura } from '@/lib/likida/orquestador/enganche_gps';
import { ActualizarSolo } from './actualizar_solo';
import { PillSemaforo } from '../viajes/pills';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import './en-vivo.css';

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

const FRESCURA: Record<NivelFrescura, { etiqueta: string; tono: TonoEstado }> = {
  en_vivo: { etiqueta: 'En vivo', tono: 'ok' }, atrasada: { etiqueta: 'Atrasada', tono: 'warn' }, obsoleta: { etiqueta: 'Obsoleta', tono: 'bad' },
};
export const ETIQUETA_EXCEPCION: Record<TipoExcepcionViaje, string> = {
  escalado_sin_atender: 'Escalado sin atender', sin_reporte: 'Sin reporte', atrasado: 'Atrasado', sin_coincidencia: 'Ubicación sin coincidencia',
  llegada_sin_confirmar: 'Llegada sin confirmar', llegada_sin_sitio: 'Llegada sin sitio para conciliar', estadia_excedida: 'Estadía excedida', horas_incoherentes: 'Horas incoherentes',
  sin_senal_de_vida: 'Sin señal de vida', gps_obsoleto: 'GPS obsoleto', sin_posicion: 'Sin posición', sin_unidad: 'Sin tractor asignado', sin_a_quien_escalar: 'Sin a quién escalar', patio_entrega_distinto: 'Patio de entrega distinto',
  pendiente_cruce_largo: 'Pendiente de cruce por mucho tiempo', salida_tms_discrepante: 'Salida del TMS sin confirmar', local_abierto_sin_ccp: 'Sin Carta Porte (viaje local abierto)', sin_ruta_autorizada: 'Sin ruta autorizada',
};
const GRAVEDAD: Record<1 | 2 | 3, { texto: string; tono: TonoEstado }> = {
  3: { texto: 'Urgente', tono: 'bad' }, 2: { texto: 'Revisar', tono: 'warn' }, 1: { texto: 'Vigilar', tono: 'muted' },
};


function Filtros({ f, c, accionUrl, ocultos }: { f: FiltrosVistaViajes; c: CatalogoVista; accionUrl: string; ocultos: Record<string, string> }) {
  const hay = Boolean(f.terminalId || f.clienteId || f.soloExcepciones);
  return (
    <BarraFiltros accion={accionUrl} ocultos={ocultos} etiqueta="Filtros de viajes en vivo" nActivos={hay ? 1 : 0} limpiarHref={accionUrl}>
      <FiltroOpciones nombre="terminal" etiqueta="Terminal" valor={f.terminalId} opciones={[{ valor: '', rotulo: 'Todas' }, ...c.terminales.map((t) => ({ valor: t.id, rotulo: t.nombre }))]} />
      <FiltroOpciones nombre="cliente" etiqueta="Cliente" valor={f.clienteId} opciones={[{ valor: '', rotulo: 'Todos' }, ...c.clientes.map((x) => ({ valor: x.id, rotulo: x.nombre }))]} />
      <FiltroInterruptor nombre="vista" valor="excepciones" etiqueta="Solo con excepciones" marcado={f.soloExcepciones} />
    </BarraFiltros>
  );
}

function Posicion({ f, gpsDisponible }: { f: FilaViaje; gpsDisponible: boolean }) {
  if (!f.posicion && !gpsDisponible) {
    return <span className="rv-vv__apagado"><Icono icono={MapPinOff} tam={16} /> GPS no consultado</span>;
  }
  if (!f.posicion) {
    const sinTractor = f.excepciones.some((e) => e.tipo === 'sin_unidad');
    return <span className="rv-vv__apagado"><Icono icono={MapPinOff} tam={16} /> {sinTractor ? 'Sin tractor asignado' : 'Sin posición reportada'}</span>;
  }
  const fr = FRESCURA[f.posicion.frescura];
  return (
    <span className="rv-vv__item">
      <StatusChip tono={fr.tono}><Icono icono={MapPin} tam={16} /> {fr.etiqueta}</StatusChip>
      <span className="rv-vv__sub rv-vv__num">
        {f.posicion.antiguedadMin < 0 ? 'hora ilegible' : textoAntiguedad(f.posicion.antiguedadMin)} · {f.posicion.lat.toFixed(3)}, {f.posicion.lng.toFixed(3)}
      </span>
    </span>
  );
}

function columnas(gpsDisponible: boolean): ColumnaBase<FilaViaje>[] {
  return [
    {
      id: 'viaje', titulo: 'Viaje', principal: true,
      celda: (f) => (
        <>
          <span className="rv-vv__folio">{f.folio ?? 'sin folio'}</span>
          <span className="rv-vv__sub">{f.origen ?? '?'} → {f.destino ?? '?'}</span>
          <span className="rv-vv__sub" data-tenue>{[f.chofer, f.terminal, f.cliente].filter(Boolean).join(' · ')}</span>
        </>
      ),
    },
    {
      id: 'estado', titulo: 'Estado',
      celda: (f) => (
        <span className="rv-vv__item">
          <PillSemaforo semaforo={f.semaforo} />
          <span className="rv-vv__sub">
            {f.ultimoHito ? <>Último: {f.ultimoHito.etiqueta}{f.ultimoHito.cuando ? ` · ${fechaHoraMx(f.ultimoHito.cuando)}` : ''}</> : 'Sin hitos registrados'}
          </span>
          {f.escalado && (
            <StatusChip tono={f.escalado.atendido ? 'muted' : 'bad'}>
              <Icono icono={ShieldAlert} tam={16} /> Escalado a tráfico (nivel {f.escalado.nivel}){f.escalado.atendido ? ', atendido' : ', sin atender'}
            </StatusChip>
          )}
        </span>
      ),
    },
    { id: 'posicion', titulo: 'Posición del tractor', celda: (f) => <Posicion f={f} gpsDisponible={gpsDisponible} /> },
    {
      id: 'excepciones', titulo: 'Excepciones',
      celda: (f) => f.excepciones.length === 0
        ? <span className="rv-vv__apagado">Sin excepciones</span>
        : (
          <ul className="rv-vv__lista">
            {f.excepciones.map((e, i) => (
              <li key={`${e.tipo}-${i}`} className="rv-vv__item">
                <span className="rv-vv__fila-chip"><StatusChip tono={GRAVEDAD[e.gravedad].tono}>{GRAVEDAD[e.gravedad].texto}</StatusChip> {ETIQUETA_EXCEPCION[e.tipo]}</span>
                <span className="rv-vv__sub">{e.texto}</span>
              </li>
            ))}
          </ul>
        ),
    },
  ];
}

const AVISO_ATENCION: Record<string, string> = {
  ya_atendida: 'Esa tarea ya estaba cerrada (otra persona se te adelantó): tu nota no se guardó.',
  sin_permiso: 'Tu rol no puede atender esa tarea.',
  no_se_pudo: 'No pude confirmar la tarea; intenta de nuevo.',
};

export function TareasAbiertas({ tareas, accion, ocultos, aviso = null, errorLectura = false }: {
  tareas: TareaAbierta[] | null;
  aviso?: string | null;
  accion: ((fd: FormData) => Promise<void>) | null;
  ocultos: Record<string, string>;
  /** A37-L-docs-ux-calidad-01: la LECTURA falló (timeout/5xx). Distinto de `null` (base sin la 0650): aquí hay un error que
   *  decir, no una pantalla vacía que parezca «sin pendientes» cuando puede haber una escalación de dinero abierta. */
  errorLectura?: boolean;
}) {
  if (errorLectura) {
    return (
      <Tarjeta titulo="Tareas del asistente" info="viajes_en_vivo.tareas" estado="error" reintentar
        mensaje="No pude leer las tareas abiertas; recarga la página. Esto no significa que no haya pendientes." />
    );
  }
  if (tareas === null) return null; // base sin la 0650: el asistente avisa por chat que no puede escalar
  return (
    <Tarjeta titulo="Tareas del asistente" info="viajes_en_vivo.tareas">
      {aviso && AVISO_ATENCION[aviso] && <p role="status" className="rv-vv__sub">{AVISO_ATENCION[aviso]}</p>}
      {tareas.length === 0
        ? <p className="rv-vv__apagado">No hay tareas abiertas. Cuando el asistente derive algo delicado a una persona, aparece aquí.</p>
        : (
          <ul className="rv-vv__lista">
            {tareas.map((t) => (
              <li key={t.id} className="rv-vv__tarea">
                <div className="rv-vv__tarea-txt">
                  <span>Para {ETIQUETA_DESTINO[t.destino]}</span>
                  <span className="rv-vv__sub" data-tenue>{fechaHoraMx(t.creadaEn)}{t.viajeFolio ? ` · viaje ${t.viajeFolio}` : ''}</span>
                  <span className="rv-vv__sub">{t.resumen}</span>
                </div>
                {accion && (
                  <form action={accion}>
                    {Object.entries(ocultos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="rv-btn rv-btn--secondary rv-btn--sm">Marcar atendida</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
    </Tarjeta>
  );
}

export function VistaViajesEnVivo({ tablero, filtros, catalogo, accionUrl, ocultos, hrefMapa, pregunta, tareas, notificaciones }: {
  tablero: TableroViajes;
  filtros: FiltrosVistaViajes;
  catalogo: CatalogoVista;
  accionUrl: string;
  ocultos: Record<string, string>;
  hrefMapa: string;
  /** La caja de preguntas del asistente (componente de cliente). */
  pregunta?: ReactNodeLike;
  tareas: ReactNodeLike;
  /** La sección «Notificaciones» (a quién le llega el aviso de una tarea nueva). Solo la ve quien puede configurarla. */
  notificaciones?: ReactNodeLike;
}) {
  const c = tablero.conteos;
  return (
    <MarcoPagina
      titulo="Viajes en vivo"
      apoyo={`Viajes en curso con su último hito y la posición del tractor, con qué tan vieja es. Actualizado ${fechaHoraMx(tablero.generadoEn)}.`}
      acciones={(
        <>
          <ActualizarSolo />
          <BotonEnlace tamano="sm" href={hrefMapa}>Ver el mapa</BotonEnlace>
        </>
      )}
    >

      {!tablero.gpsDisponible && (
        <Aviso tono="warn">No se pudieron leer las posiciones del GPS: aquí no se afirma que un tractor esté «sin señal», solo que no se pudo consultar.</Aviso>
      )}

      <TiraCifras sello={selloHoy('Viajes en curso')}>
        <Cifra etiqueta="Viajes en curso" valor={numero(c.viajes)} nota={tablero.hayMas ? 'Hay más viajes activos que los listados' : undefined} info="viajes_en_vivo.en_curso" />
        <Cifra etiqueta="Con excepción" valor={numero(c.conExcepcion)} tono={c.conExcepcion > 0 ? 'warn' : undefined} info="viajes_en_vivo.con_excepcion" />
        <Cifra etiqueta="Sin señal de vida" valor={numero(c.sinSenal)} nota="Chofer y tractor callados" tono={c.sinSenal > 0 ? 'bad' : undefined} info="viajes_en_vivo.sin_senal" />
        <Cifra etiqueta="Llegadas sin confirmar" valor={numero(c.llegadaSinConfirmar)} nota={`${numero(c.escaladosATrafico)} escalados a tráfico`} info="viajes_en_vivo.llegadas_sin_confirmar" />
      </TiraCifras>

      <Filtros f={filtros} c={catalogo} accionUrl={accionUrl} ocultos={ocultos} />

      <TablaBase<FilaViaje>
        etiqueta="Viajes en vivo y su estado"
        columnas={columnas(tablero.gpsDisponible)}
        filas={tablero.filas}
        idFila={(f) => f.viajeId}
        tarjetaMovil
        vacio={{
          titulo: 'Sin viajes que mostrar',
          texto: filtros.terminalId || filtros.clienteId || filtros.soloExcepciones ? 'Ningún viaje cumple los filtros.' : 'No hay viajes en curso.',
        }}
      />
      {tareas}
      {pregunta ? <Disclosure variante="linea" titulo="Pregúntale al asistente">{pregunta}</Disclosure> : null}
      {notificaciones ? <Disclosure variante="linea" titulo="Notificaciones de los avisos">{notificaciones}</Disclosure> : null}
    </MarcoPagina>
  );
}

type ReactNodeLike = import('react').ReactNode;
