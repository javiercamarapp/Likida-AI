import { CircleAlert, MapPin, MapPinOff, Radio, ShieldAlert } from 'lucide-react';
import { fechaHoraMx, numero } from '@/lib/formato';
import { ETIQUETA_DESTINO, type TareaAbierta } from '@/lib/likida/orquestador/escalamiento';
import { textoAntiguedad, type FilaViaje, type TableroViajes, type TipoExcepcionViaje } from '@/lib/likida/orquestador/tablero_viajes';
import type { NivelFrescura } from '@/lib/likida/orquestador/enganche_gps';
import type { Semaforo } from '@/lib/likida/conductor/tablero';

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

const SEMAFORO: Record<Semaforo, { etiqueta: string; color: string; fondo: string }> = {
  sin_reporte: { etiqueta: 'Sin reporte', color: 'var(--bad)', fondo: 'var(--badbg)' },
  atrasado: { etiqueta: 'Atrasado', color: 'var(--warn)', fondo: 'var(--warnbg)' },
  a_tiempo: { etiqueta: 'A tiempo', color: 'var(--ok)', fondo: 'var(--okbg)' },
  sin_ancla: { etiqueta: 'Sin ancla', color: 'var(--muted)', fondo: 'var(--canvas)' },
  completo: { etiqueta: 'Completo', color: 'var(--muted)', fondo: 'var(--canvas)' },
};
const FRESCURA: Record<NivelFrescura, { etiqueta: string; color: string }> = {
  en_vivo: { etiqueta: 'En vivo', color: 'var(--ok)' }, atrasada: { etiqueta: 'Atrasada', color: 'var(--warn)' }, obsoleta: { etiqueta: 'Obsoleta', color: 'var(--bad)' },
};
export const ETIQUETA_EXCEPCION: Record<TipoExcepcionViaje, string> = {
  escalado_sin_atender: 'Escalado sin atender', sin_reporte: 'Sin reporte', atrasado: 'Atrasado', sin_coincidencia: 'Ubicación sin coincidencia',
  llegada_sin_confirmar: 'Llegada sin confirmar', estadia_excedida: 'Estadía excedida', horas_incoherentes: 'Horas incoherentes',
  sin_senal_de_vida: 'Sin señal de vida', gps_obsoleto: 'GPS obsoleto', sin_posicion: 'Sin posición', sin_unidad: 'Sin tractor asignado',
};
const GRAVEDAD: Record<1 | 2 | 3, { texto: string; color: string }> = {
  3: { texto: 'Urgente', color: 'var(--bad)' }, 2: { texto: 'Revisar', color: 'var(--warn)' }, 1: { texto: 'Vigilar', color: 'var(--muted)' },
};

function Kpi({ titulo, valor, nota, tono }: { titulo: string; valor: string; nota?: string; tono?: 'warn' | 'bad' }) {
  return (
    <div className="card p-3.5">
      <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{titulo}</div>
      <div className="cifra-mono text-[20px] font-medium mt-1" style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
      {nota && <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</div>}
    </div>
  );
}

function Filtros({ f, c, accionUrl, ocultos }: { f: FiltrosVistaViajes; c: CatalogoVista; accionUrl: string; ocultos: Record<string, string> }) {
  const sel = 'hairline rounded-lg px-2 h-8 text-[12.5px] outline-none focus:border-[var(--muted)]';
  return (
    <form method="get" action={accionUrl} className="flex flex-wrap items-end gap-2.5" aria-label="Filtros de viajes en vivo">
      {Object.entries(ocultos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="text-[11px] font-medium">Terminal
        <select name="terminal" defaultValue={f.terminalId} className={`${sel} block mt-1`}>
          <option value="">Todas</option>
          {c.terminales.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-medium">Cliente
        <select name="cliente" defaultValue={f.clienteId} className={`${sel} block mt-1`}>
          <option value="">Todos</option>
          {c.clientes.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-medium inline-flex items-center gap-1.5 h-8">
        <input type="checkbox" name="vista" value="excepciones" defaultChecked={f.soloExcepciones} /> Solo con excepciones
      </label>
      <button type="submit" className="hairline rounded-lg px-3 h-8 text-[12.5px] font-medium">Aplicar</button>
      {(f.terminalId || f.clienteId || f.soloExcepciones) && <a href={accionUrl} className="text-[12px] underline" style={{ color: 'var(--muted)' }}>Quitar filtros</a>}
    </form>
  );
}

function Posicion({ f, gpsDisponible }: { f: FilaViaje; gpsDisponible: boolean }) {
  if (!f.posicion && !gpsDisponible) {
    return <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--faint)' }}><MapPinOff size={13} aria-hidden /> GPS no consultado</span>;
  }
  if (!f.posicion) {
    const sinTractor = f.excepciones.some((e) => e.tipo === 'sin_unidad');
    return (
      <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--faint)' }}>
        <MapPinOff size={13} aria-hidden /> {sinTractor ? 'Sin tractor asignado' : 'Sin posición reportada'}
      </span>
    );
  }
  const fr = FRESCURA[f.posicion.frescura];
  return (
    <span className="inline-flex flex-col gap-0.5 text-[12px]">
      <span className="inline-flex items-center gap-1" style={{ color: fr.color }}><MapPin size={13} aria-hidden /> {fr.etiqueta}</span>
      <span className="cifra-mono" style={{ color: 'var(--muted)' }}>
        {f.posicion.antiguedadMin < 0 ? 'hora ilegible' : textoAntiguedad(f.posicion.antiguedadMin)} · {f.posicion.lat.toFixed(3)}, {f.posicion.lng.toFixed(3)}
      </span>
    </span>
  );
}

function FilaTabla({ f, gpsDisponible }: { f: FilaViaje; gpsDisponible: boolean }) {
  const s = SEMAFORO[f.semaforo];
  return (
    <tr className="border-b align-top" style={{ borderColor: 'var(--line2)' }}>
      <td className="px-3 py-2.5">
        <div className="cifra-mono text-[13px] font-medium">{f.folio ?? 'sin folio'}</div>
        <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>{f.origen ?? '?'} → {f.destino ?? '?'}</div>
        <div className="text-[11.5px]" style={{ color: 'var(--faint)' }}>{[f.chofer, f.terminal, f.cliente].filter(Boolean).join(' · ')}</div>
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ color: s.color, background: s.fondo }}>{s.etiqueta}</span>
        <div className="text-[11.5px] mt-1" style={{ color: 'var(--muted)' }}>
          {f.ultimoHito ? <>Último: {f.ultimoHito.etiqueta}{f.ultimoHito.cuando ? ` · ${fechaHoraMx(f.ultimoHito.cuando)}` : ''}</> : 'Sin hitos registrados'}
        </div>
        {f.escalado && (
          <div className="text-[11.5px] mt-0.5 inline-flex items-center gap-1" style={{ color: f.escalado.atendido ? 'var(--muted)' : 'var(--bad)' }}>
            <ShieldAlert size={12} aria-hidden /> Escalado a tráfico (nivel {f.escalado.nivel}){f.escalado.atendido ? ', atendido' : ', sin atender'}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5"><Posicion f={f} gpsDisponible={gpsDisponible} /></td>
      <td className="px-3 py-2.5">
        {f.excepciones.length === 0
          ? <span className="text-[12px]" style={{ color: 'var(--faint)' }}>Sin excepciones</span>
          : (
            <ul className="space-y-1">
              {f.excepciones.map((e, i) => (
                <li key={`${e.tipo}-${i}`} className="text-[12px]">
                  <span className="font-medium" style={{ color: GRAVEDAD[e.gravedad].color }}>{GRAVEDAD[e.gravedad].texto} · {ETIQUETA_EXCEPCION[e.tipo]}</span>
                  <div style={{ color: 'var(--muted)' }}>{e.texto}</div>
                </li>
              ))}
            </ul>
          )}
      </td>
    </tr>
  );
}

export function TareasAbiertas({ tareas, accion, ocultos }: {
  tareas: TareaAbierta[] | null;
  accion: ((fd: FormData) => Promise<void>) | null;
  ocultos: Record<string, string>;
}) {
  if (tareas === null) return null; // base sin la 0650: el asistente avisa por chat que no puede escalar
  return (
    <section aria-label="Tareas que el asistente dejó para una persona" className="card p-4 space-y-2.5">
      <div className="flex items-center gap-2"><Radio size={15} aria-hidden /><h2 className="text-[13px] font-medium">Tareas del asistente</h2></div>
      {tareas.length === 0
        ? <p className="text-[12.5px]" style={{ color: 'var(--faint)' }}>No hay tareas abiertas. Cuando el asistente derive algo delicado a una persona, aparece aquí.</p>
        : (
          <ul className="space-y-2">
            {tareas.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 text-[12.5px]">
                <div>
                  <span className="font-medium">Para {ETIQUETA_DESTINO[t.destino]}</span>
                  <span style={{ color: 'var(--faint)' }}> · {fechaHoraMx(t.creadaEn)}{t.viajeFolio ? ` · viaje ${t.viajeFolio}` : ''}</span>
                  <div style={{ color: 'var(--muted)' }}>{t.resumen}</div>
                </div>
                {accion && (
                  <form action={accion}>
                    {Object.entries(ocultos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="hairline rounded-lg px-2.5 h-7 text-[12px]">Marcar atendida</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

export function VistaViajesEnVivo({ tablero, filtros, catalogo, accionUrl, ocultos, hrefMapa, tareas }: {
  tablero: TableroViajes;
  filtros: FiltrosVistaViajes;
  catalogo: CatalogoVista;
  accionUrl: string;
  ocultos: Record<string, string>;
  hrefMapa: string;
  tareas: ReactNodeLike;
}) {
  const c = tablero.conteos;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-[22px] font-semibold">Viajes en vivo</h1>
          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
            Todos los viajes en curso con su último hito, la posición del tractor y qué tan vieja es. Actualizado {fechaHoraMx(tablero.generadoEn)}.
          </p>
        </div>
        <a href={hrefMapa} className="text-[12.5px] underline" style={{ color: 'var(--muted)' }}>Ver el mapa</a>
      </header>

      {!tablero.gpsDisponible && (
        <div role="alert" className="card p-3 text-[12.5px] inline-flex items-center gap-2" style={{ color: 'var(--warn)' }}>
          <CircleAlert size={14} aria-hidden /> No se pudieron leer las posiciones del GPS: aquí no se afirma que un tractor esté «sin señal», solo que no se pudo consultar.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Kpi titulo="Viajes en curso" valor={numero(c.viajes)} nota={tablero.hayMas ? 'Hay más viajes activos que los listados' : undefined} />
        <Kpi titulo="Con excepción" valor={numero(c.conExcepcion)} tono={c.conExcepcion > 0 ? 'warn' : undefined} />
        <Kpi titulo="Sin señal de vida" valor={numero(c.sinSenal)} nota="Chofer y tractor callados" tono={c.sinSenal > 0 ? 'bad' : undefined} />
        <Kpi titulo="Llegadas sin confirmar" valor={numero(c.llegadaSinConfirmar)} nota={`${numero(c.escaladosATrafico)} escalados a tráfico`} />
      </div>

      <Filtros f={filtros} c={catalogo} accionUrl={accionUrl} ocultos={ocultos} />

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="etiqueta-mono text-[10px] uppercase border-b" style={{ color: 'var(--faint)', borderColor: 'var(--line2)' }}>
              <th className="px-3 py-2 font-normal">Viaje</th><th className="px-3 py-2 font-normal">Estado</th>
              <th className="px-3 py-2 font-normal">Posición del tractor</th><th className="px-3 py-2 font-normal">Excepciones</th>
            </tr>
          </thead>
          <tbody>
            {tablero.filas.length === 0
              ? <tr><td colSpan={4} className="px-3 py-6 text-[12.5px]" style={{ color: 'var(--faint)' }}>{filtros.terminalId || filtros.clienteId || filtros.soloExcepciones ? 'Ningún viaje cumple los filtros.' : 'No hay viajes en curso.'}</td></tr>
              : tablero.filas.map((f) => <FilaTabla key={f.viajeId} f={f} gpsDisponible={tablero.gpsDisponible} />)}
          </tbody>
        </table>
      </div>
      {tareas}
    </div>
  );
}

type ReactNodeLike = import('react').ReactNode;
