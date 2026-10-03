import { CheckCircle2, CircleAlert, CircleDashed, Clock, MapPin, MapPinOff, Camera, UserCog, Flag } from 'lucide-react';
import Link from 'next/link';
import { fechaHoraMx, numero, porcentaje } from '@/lib/formato';
import type { CatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';
import { textoTiempo } from '@/lib/likida/conductor/planificador';
import type { Excepcion, FilaTablero, HitoVista, IndicadoresVista, Semaforo, Tablero, TipoExcepcion } from '@/lib/likida/conductor/tablero';
import type { Estancia } from '@/lib/likida/conductor/estadias_anden';
import { AccionesHito, FormaAsignarSitios, type AccionOficinaServidor, type ModoAccion, type OpcionSitio } from './acciones-forma';

// ═══════════════════════════════════════════════════════════════════════════
// EL TABLERO DE HITOS (0385) — la pantalla del jefe de tráfico.
//
// Presentación pura: recibe el modelo ya armado (`armarTablero`) y no lee nada. CERO pesos
// (área `operacion`). Cada cifra dice de dónde sale; un indicador sin datos dice «sin datos»,
// no «0».
// ═══════════════════════════════════════════════════════════════════════════

export interface FiltrosVista {
  terminalId: string;
  clienteId: string;
  operadorId: string;
  semaforo: Semaforo | '';
  dias: number;
}

const SEMAFORO: Record<Semaforo, { etiqueta: string; color: string; fondo: string }> = {
  sin_reporte: { etiqueta: 'Sin reporte', color: 'var(--bad)', fondo: 'var(--badbg)' },
  atrasado: { etiqueta: 'Atrasado', color: 'var(--warn)', fondo: 'var(--warnbg)' },
  a_tiempo: { etiqueta: 'A tiempo', color: 'var(--ok)', fondo: 'var(--okbg)' },
  sin_ancla: { etiqueta: 'Sin ancla', color: 'var(--muted)', fondo: 'var(--canvas)' },
  completo: { etiqueta: 'Completo', color: 'var(--muted)', fondo: 'var(--canvas)' },
};
export const ORDEN_SEMAFORO: Semaforo[] = ['sin_reporte', 'atrasado', 'a_tiempo', 'sin_ancla', 'completo'];

const EXCEPCION: Record<TipoExcepcion, string> = {
  escalado_sin_atender: 'Escalado sin atender', sin_reporte: 'Sin reporte', atrasado: 'Atrasado', sin_coincidencia: 'Ubicación sin coincidencia',
  llegada_sin_confirmar: 'Llegada sin confirmar', llegada_sin_sitio: 'Llegada sin sitio para conciliar',
  estadia_excedida: 'Estadía excedida', horas_incoherentes: 'Horas incoherentes',
};
const GRAVEDAD: Record<1 | 2 | 3, { texto: string; color: string }> = {
  3: { texto: 'Urgente', color: 'var(--bad)' }, 2: { texto: 'Revisar', color: 'var(--warn)' }, 1: { texto: 'Vigilar', color: 'var(--muted)' },
};

export function PuntoSemaforo({ s }: { s: Semaforo }) {
  const c = SEMAFORO[s];
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ color: c.color, background: c.fondo }}>
      <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />
      {c.etiqueta}
    </span>
  );
}

function Kpi({ titulo, valor, nota, tono }: { titulo: string; valor: string; nota?: string; tono?: 'warn' | 'bad' }) {
  return (
    <div className="card p-3.5">
      <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{titulo}</div>
      <div className="cifra-mono text-[20px] font-medium mt-1" style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
      {nota && <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</div>}
    </div>
  );
}

const minutos = (m: number): string => (m < 60 ? `${numero(Math.round(m))} min` : textoTiempo(m));

export function IndicadoresHitos({ i, dias }: { i: IndicadoresVista | null; dias: number }) {
  if (i === null) {
    return <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No se pudieron calcular los indicadores ahora mismo.</p>;
  }
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi titulo="Hitos reportados sin insistencia"
          valor={i.tasaSinInsistencia === null ? 'sin datos' : porcentaje(i.tasaSinInsistencia * 100, 0)}
          nota={i.recibidos === 0 ? 'ningún hito recibido en el periodo' : `de ${numero(i.recibidos)} hitos; a lo más un mensaje del agente`} />
        <Kpi titulo="Tiempo medio de respuesta"
          valor={i.minutosRespuestaPromedio === null ? 'sin datos' : minutos(i.minutosRespuestaPromedio)}
          nota={i.conRespuestaMedida === 0 ? 'ninguna solicitud con respuesta medible' : `sobre ${numero(i.conRespuestaMedida)} solicitudes contestadas`} />
        <Kpi titulo="Hitos escalados" valor={numero(i.escalados)} tono={i.escalados > 0 ? 'warn' : undefined} nota="agotaron la escalera de recordatorios" />
        <Kpi titulo="Validados con ubicación" valor={numero(i.validadosUbicacion)}
          nota={i.sinCoincidencia > 0 ? `${numero(i.sinCoincidencia)} sin coincidencia por revisar` : 'pin o GPS dentro del sitio'} />
      </div>
      <p className="text-[11px] mt-2" style={{ color: 'var(--faint)' }}>
        Hitos con actividad en los últimos {dias} {dias === 1 ? 'día' : 'días'}, con los mismos filtros de abajo.
        {i.capturadosOficina > 0 ? ` ${numero(i.capturadosOficina)} los capturó la oficina a mano.` : ''}
        {i.omitidos > 0 ? ` ${numero(i.omitidos)} se dieron por omitidos (el chofer avisó el siguiente).` : ''}
      </p>
    </div>
  );
}

export function FiltrosTablero({ f, catalogos, ocultos, accionUrl }: {
  f: FiltrosVista; catalogos: CatalogosFiltro | null; ocultos: Record<string, string>; accionUrl: string;
}) {
  const sel = 'hairline rounded-lg px-2 h-8 text-[12.5px] outline-none focus:border-[var(--muted)]';
  return (
    <form method="get" action={accionUrl} className="flex flex-wrap items-end gap-2.5" aria-label="Filtros del tablero">
      {Object.entries(ocultos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="text-[11px] font-medium">Patio
        <select name="terminal" defaultValue={f.terminalId} className={`${sel} block mt-1`}>
          <option value="">Todos</option>
          {(catalogos?.terminales ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-medium">Cliente
        <select name="cliente" defaultValue={f.clienteId} className={`${sel} block mt-1`}>
          <option value="">Todos</option>
          {(catalogos?.clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-medium">Chofer
        <select name="chofer" defaultValue={f.operadorId} className={`${sel} block mt-1`}>
          <option value="">Todos</option>
          {(catalogos?.operadores ?? []).map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-medium">Semáforo
        <select name="semaforo" defaultValue={f.semaforo} className={`${sel} block mt-1`}>
          <option value="">Todos</option>
          {ORDEN_SEMAFORO.map((s) => <option key={s} value={s}>{SEMAFORO[s].etiqueta}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-medium">Indicadores de
        <select name="dias" defaultValue={String(f.dias)} className={`${sel} block mt-1`}>
          <option value="1">último día</option><option value="7">últimos 7 días</option><option value="30">últimos 30 días</option>
        </select>
      </label>
      <button type="submit" className="h-8 px-3 rounded-lg text-[12.5px] font-medium hairline transition-colors hover:bg-[var(--canvas)]">Aplicar</button>
      {(f.terminalId || f.clienteId || f.operadorId || f.semaforo) && (
        <Link href={accionUrl + (Object.keys(ocultos).length ? `?${new URLSearchParams(ocultos).toString()}` : '')} className="text-[12px] underline" style={{ color: 'var(--muted)' }}>Quitar filtros</Link>
      )}
    </form>
  );
}

/** Qué se le puede hacer a una excepción. Las acciones tienen su propio candado en el servidor. */
function modosDeExcepcion(e: Excepcion): ModoAccion[] {
  switch (e.tipo) {
    case 'escalado_sin_atender': return ['atender', 'capturar'];
    case 'sin_reporte':
    case 'atrasado': return e.hitoId ? ['capturar'] : [];
    case 'sin_coincidencia':
    case 'llegada_sin_confirmar':
    case 'llegada_sin_sitio': return e.hitoId ? ['validar'] : [];
    default: return [];
  }
}

export function ColaExcepciones({ excepciones, puedeActuar, accion }: { excepciones: Excepcion[]; puedeActuar: boolean; accion: AccionOficinaServidor }) {
  return (
    <section className="card p-4" aria-label="Cola de excepciones">
      <h2 className="font-display text-[15px] font-semibold mb-1">Cola de excepciones</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>Lo que pide una decisión tuya, lo más urgente primero.</p>
      {excepciones.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Nada pendiente: ningún hito escalado, atrasado ni sin coincidencia en los viajes que se listan.</p>
      ) : (
        <ul className="space-y-3">
          {excepciones.slice(0, 50).map((e, i) => {
            const g = GRAVEDAD[e.gravedad];
            return (
              <li key={`${e.viajeId}-${e.tipo}-${e.hitoId ?? i}`} className="text-[12.5px] pb-3 border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: g.color }}>{g.texto}</span>
                  <span className="font-medium">{EXCEPCION[e.tipo]}</span>
                  <span className="font-medium">{e.folio ?? 'viaje sin folio'}</span>
                  {e.desde && <span className="ml-auto text-[11px]" style={{ color: 'var(--faint)' }}>desde {fechaHoraMx(e.desde)}</span>}
                </div>
                <p className="mt-0.5" style={{ color: 'var(--muted)' }}>{e.texto}</p>
                {puedeActuar && <AccionesHito accion={accion} modos={modosDeExcepcion(e)} hitoId={e.hitoId} viajeId={e.viajeId} />}
              </li>
            );
          })}
        </ul>
      )}
      {excepciones.length > 50 && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--faint)' }}>Se muestran las 50 más urgentes de {numero(excepciones.length)}.</p>
      )}
    </section>
  );
}

const FOTO_TEXTO: Record<string, string> = { sello: 'sello', anden: 'andén', recibido: 'recibido', otra: 'foto' };
const FUENTE_TEXTO: Record<string, string> = { texto: 'texto', boton: 'botón', ubicacion: 'ubicación', foto: 'foto', sistema: 'sistema', oficina: 'oficina' };

/**
 * R10-8: por qué se ve «omitido». Antes TODO omitido decía «avisó el siguiente», incluso el hito escalado que cerró el barrido de viajes
 * abiertos hace más de 30 días (`viaje_abierto_vencido`): la oficina creía que el chofer había avisado el siguiente y nadie lo capturó.
 */
function textoOmitido(h: HitoVista): string {
  if (h.omitidoMotivo === 'viaje_abierto_vencido') {
    return `cerrado sin reporte: el viaje lleva más de 30 días abierto${h.escaladoEn ? ' y ya se había escalado' : ''} · captúralo a mano si hace falta`;
  }
  return 'omitido (avisó el siguiente)';
}

function CeldaHito({ h, puedeActuar, accion, viajeId }: { h: HitoVista; puedeActuar: boolean; accion: AccionOficinaServidor; viajeId: string }) {
  const resuelto = h.estado === 'recibido' || h.estado === 'validado';
  const Icono = h.estado === 'validado' ? CheckCircle2 : resuelto ? CheckCircle2 : h.estado === 'escalado' ? Flag : h.estado === 'omitido' ? CircleDashed : Clock;
  const color = h.estado === 'validado' ? 'var(--ok)' : resuelto ? 'var(--ok)' : h.estado === 'escalado' ? 'var(--bad)' : 'var(--faint)';
  const modos: ModoAccion[] = [];
  if (puedeActuar) {
    if (h.estado === 'esperado' || h.estado === 'escalado' || h.estado === 'omitido') modos.push('capturar');
    if (h.estado === 'recibido') modos.push('validar');
  }
  return (
    <li className="min-w-[150px] flex-1 text-[12px] space-y-0.5">
      <div className="flex items-center gap-1.5 font-medium">
        <Icono width={13} height={13} strokeWidth={1.75} style={{ color }} aria-hidden />
        <span>{h.etiqueta}</span>
      </div>
      {resuelto && h.horaMensaje ? (
        <div className="cifra-mono" title="Hora del mensaje del chofer (no del evento físico)">{fechaHoraMx(h.horaMensaje)}</div>
      ) : (
        <div style={{ color: 'var(--faint)' }}>
          {h.estado === 'omitido' ? textoOmitido(h) : h.estado === 'escalado' ? `escalado${h.atendidaEn ? ' · atendido' : ''}` : h.tocaDesde ? `toca desde ${fechaHoraMx(h.tocaDesde)}` : 'pendiente'}
        </div>
      )}
      {resuelto && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style={{ color: 'var(--muted)' }}>
          {h.fuente && <span>vía {FUENTE_TEXTO[h.fuente] ?? h.fuente}</span>}
          {h.validadoPor && <span style={{ color: 'var(--ok)' }}>validado ({h.validadoPor === 'gps' ? 'ubicación' : h.validadoPor})</span>}
          {h.fotos.map((f) => (
            <a key={f.id} href={`/api/v1/evidencias/${f.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline" title="Abrir la foto (el enlace dura 10 minutos)">
              <Camera width={11} height={11} aria-hidden />{FOTO_TEXTO[f.tipo]}
            </a>
          ))}
        </div>
      )}
      {h.contacto && <div className="text-[11px]" style={{ color: 'var(--muted)' }}>Lo atiende {h.contacto}</div>}
      {h.sinContacto && <div className="text-[11px]" style={{ color: 'var(--faint)' }}>sin contacto en andén</div>}
      {h.validacion && h.validacion.resultado !== 'sin_dato' && (
        <div className="text-[11px] flex items-start gap-1" style={{ color: h.validacion.resultado === 'validado' ? 'var(--ok)' : 'var(--warn)' }} title={h.validacion.texto}>
          {h.validacion.resultado === 'validado' ? <MapPin width={11} height={11} aria-hidden className="mt-0.5 shrink-0" /> : <MapPinOff width={11} height={11} aria-hidden className="mt-0.5 shrink-0" />}
          <span>{h.validacion.resultado === 'validado' ? `en el sitio (${numero(h.validacion.distanciaM ?? 0)} m)` : `fuera del sitio (${numero(h.validacion.distanciaM ?? 0)} m)`}</span>
        </div>
      )}
      {h.validacion?.resultado === 'sin_dato' && <div className="text-[11px]" style={{ color: 'var(--faint)' }}>ubicación sin dato</div>}
      {h.accionesOficina.length > 0 && (
        <div className="text-[11px] flex items-start gap-1" style={{ color: 'var(--muted)' }}>
          <UserCog width={11} height={11} aria-hidden className="mt-0.5 shrink-0" />
          <span>{h.accionesOficina[0].email}: «{h.accionesOficina[0].motivo}»</span>
        </div>
      )}
      {modos.length > 0 && <AccionesHito accion={accion} modos={modos} hitoId={h.id} viajeId={viajeId} />}
    </li>
  );
}

function ResumenEstancia({ e }: { e: Estancia }) {
  const texto = e.fase === 'cerrada' ? `${minutos(e.minutos ?? 0)} (cerrada)`
    : e.fase === 'en_curso' ? `${minutos(e.minutos ?? 0)} y sigue en el andén`
      : e.fase === 'incoherente' ? 'horas incoherentes' : e.fase === 'sin_llegada' ? 'sin llegada registrada' : 'sin salida registrada';
  return <span>{e.lugar === 'carga' ? 'En carga' : 'En descarga'}: <span className="cifra-mono">{texto}</span></span>;
}

export function TarjetaViaje({ f, puedeActuar, accion, accionSitios, sitios }: {
  f: FilaTablero; puedeActuar: boolean; accion: AccionOficinaServidor; accionSitios: AccionOficinaServidor; sitios: OpcionSitio[];
}) {
  const v = f.viaje;
  return (
    <li className="card p-3.5 space-y-2.5" aria-label={`Viaje ${v.folio ?? v.id}`}>
      <div className="flex items-center gap-2.5 flex-wrap">
        <PuntoSemaforo s={f.semaforo} />
        <span className="font-medium text-[13px]">{v.folio ?? 'sin folio'}</span>
        <span className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{v.operadorNombre ?? 'Sin operador'}</span>
        <span className="text-[12px]" style={{ color: 'var(--faint)' }}>
          {[v.terminalNombre, v.clienteNombre].filter(Boolean).join(' · ')}
        </span>
        <span className="ml-auto text-[12px]" style={{ color: 'var(--muted)' }}>{v.origen ?? '—'} → {v.destino ?? '—'}</span>
      </div>
      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{f.motivo}</p>
      {(f.sitioCarga || f.sitioDescarga) ? (
        <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Se valida contra: {f.sitioCarga ?? 'carga sin sitio asignado'} → {f.sitioDescarga ?? 'descarga sin sitio asignado'}</p>
      ) : (
        <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Sin sitios asignados: las llegadas de este viaje no se pueden validar contra la ubicación.</p>
      )}
      {puedeActuar && <FormaAsignarSitios accion={accionSitios} viajeId={v.id} sitios={sitios} />}
      <ol className="flex flex-wrap gap-x-4 gap-y-3">
        {f.hitos.map((h) => <CeldaHito key={h.id} h={h} puedeActuar={puedeActuar} accion={accion} viajeId={v.id} />)}
      </ol>
      {f.estancias.length > 0 && (
        <p className="text-[12px] flex flex-wrap gap-x-4" style={{ color: 'var(--muted)' }}>
          {f.estancias.map((e) => <ResumenEstancia key={e.lugar} e={e} />)}
        </p>
      )}
    </li>
  );
}

export function TableroHitos({
  tablero, indicadores, dias, filtros, catalogos, ocultos, accionUrl, puedeActuar, accion, accionSitios, sitios,
}: {
  tablero: Tablero; indicadores: IndicadoresVista | null; dias: number; filtros: FiltrosVista; catalogos: CatalogosFiltro | null;
  ocultos: Record<string, string>; accionUrl: string; puedeActuar: boolean; accion: AccionOficinaServidor;
  /** Asignar el sitio de carga y de descarga de un viaje (misma firma que las demás acciones del tablero). */
  accionSitios: AccionOficinaServidor; sitios: OpcionSitio[];
}) {
  return (
    <div className="space-y-4">
      <IndicadoresHitos i={indicadores} dias={dias} />
      <section className="card p-4 space-y-3" aria-label="Viajes y semáforo">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-display text-[15px] font-semibold mr-2">Viajes en curso</h2>
          {ORDEN_SEMAFORO.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>
              <PuntoSemaforo s={s} /><span className="cifra-mono">{numero(tablero.conteos[s])}</span>
            </span>
          ))}
        </div>
        <FiltrosTablero f={filtros} catalogos={catalogos} ocultos={ocultos} accionUrl={accionUrl} />
        {tablero.hayMas && (
          <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
            Hay más viajes en curso de los que este tablero lista: usa los filtros (patio, cliente o chofer) para ver el resto.
          </p>
        )}
      </section>
      <ColaExcepciones excepciones={tablero.excepciones} puedeActuar={puedeActuar} accion={accion} />
      {tablero.filas.length === 0 ? (
        <section className="card p-4 text-[12.5px] flex items-center gap-2" style={{ color: 'var(--muted)' }}>
          <CircleAlert width={14} height={14} aria-hidden />
          {filtros.terminalId || filtros.clienteId || filtros.operadorId || filtros.semaforo
            ? 'Ningún viaje en curso cumple esos filtros.'
            : 'No hay viajes aceptados en curso: cuando un chofer acepte un viaje aparece aquí con sus cinco hitos.'}
        </section>
      ) : (
        <ul className="space-y-3">
          {tablero.filas.map((f) => <TarjetaViaje key={f.viaje.id} f={f} puedeActuar={puedeActuar} accion={accion} accionSitios={accionSitios} sitios={sitios} />)}
        </ul>
      )}
    </div>
  );
}
