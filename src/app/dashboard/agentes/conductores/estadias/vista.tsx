import { Download } from 'lucide-react';
import { numero } from '@/lib/formato';
import { horaExactaMx, type FilaEstadia, type ResumenEstadias } from '@/lib/likida/conductor/estadias_anden';
import { textoTiempo } from '@/lib/likida/conductor/planificador';
import type { CatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';
import { BarraFiltros, FiltroFecha, FiltroOpciones, MarcoPagina, Aviso, BotonEnlace } from '@/app/ui-v2/componentes';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ESTADÍAS EN ANDÉN (0385) — cuánto tiempo estuvo cada unidad en cada parada. CERO pesos en
// pantalla (área `operacion`): el renglón de cobro con horas libres y tarifa vive en el CSV de
// /v1/estadias, que ven el dueño y el contador.
// ═══════════════════════════════════════════════════════════════════════════

export interface FiltrosEstadias { desde: string; hasta: string; terminalId: string; clienteId: string; operadorId: string }

const FASE: Record<string, string> = {
  cerrada: 'Cerrada', en_curso: 'En curso (sigue en el andén)', sin_salida: 'Sin salida registrada', incoherente: 'Horas incoherentes', sin_llegada: 'Sin llegada registrada',
};
const FUENTE = { chofer: 'mensaje del chofer', oficina: 'captura de oficina', sistema: 'sistema' } as const;
const VALIDACION = { validado: 'validada con ubicación', sin_coincidencia: 'ubicación sin coincidencia', sin_dato: 'sin dato de ubicación' } as const;

const minutos = (m: number | null): string => (m === null ? '—' : m < 60 ? `${numero(m)} min` : textoTiempo(m));

/** Promedio de minutos de las paradas CERRADAS de un lugar, o null si no hay. Honesto: «sobre N paradas cerradas». */
export function promedioCerradas(filas: readonly FilaEstadia[], lugar: 'carga' | 'descarga'): { promedio: number; n: number } | null {
  const xs = filas.filter((f) => f.estancia.lugar === lugar && f.estancia.fase === 'cerrada' && f.estancia.minutos !== null).map((f) => f.estancia.minutos as number);
  return xs.length === 0 ? null : { promedio: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), n: xs.length };
}

export function VistaEstadias({ sufijo, filtros, catalogos, filas, resumen, truncada, error, csvUrl, ocultos, zonaHoraria }: {
  /** Zona de la flota para las horas exactas (México por omisión). */
  zonaHoraria?: string;
  sufijo: string; filtros: FiltrosEstadias; catalogos: CatalogosFiltro | null;
  filas: FilaEstadia[]; resumen: ResumenEstadias; truncada: boolean; error: string | null;
  /** Solo si el rol ve dinero: el CSV de cobro (con horas libres, tarifa y monto propuesto). */
  csvUrl: string | null; ocultos: Record<string, string>;
}) {
  const hay = Boolean(filtros.terminalId || filtros.clienteId || filtros.operadorId);
  const hrefLimpio = `?${new URLSearchParams(ocultos).toString()}`;
  const carga = promedioCerradas(filas, 'carga');
  const descarga = promedioCerradas(filas, 'descarga');
  return (
    <MarcoPagina titulo="Estadías en andén" apoyo="El tiempo entre la llegada y la salida de cada carga y descarga, con la hora exacta del mensaje del chofer." acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/conductores${sufijo}`}>Volver al tablero</BotonEnlace>}>
      <Aviso tono="info">
        La hora es la <strong>hora exacta del mensaje del chofer</strong> (no telemetría del evento físico). Cada fila dice de dónde salió la hora, si la ubicación la validó y cuántas fotos la respaldan.
      </Aviso>

      <section className="card p-4 space-y-3" aria-label="Filtros">
        <BarraFiltros accion="?" ocultos={ocultos} etiqueta="Filtros de estadías" nActivos={hay ? 1 : 0} limpiarHref={hrefLimpio}>
          <FiltroFecha nombre="desde" etiqueta="Desde" valor={filtros.desde} />
          <FiltroFecha nombre="hasta" etiqueta="Hasta" valor={filtros.hasta} />
          <FiltroOpciones nombre="terminal" etiqueta="Patio" valor={filtros.terminalId} opciones={[{ valor: '', rotulo: 'Todos' }, ...(catalogos?.terminales ?? []).map((t) => ({ valor: t.id, rotulo: t.nombre }))]} />
          <FiltroOpciones nombre="cliente" etiqueta="Cliente" valor={filtros.clienteId} opciones={[{ valor: '', rotulo: 'Todos' }, ...(catalogos?.clientes ?? []).map((c) => ({ valor: c.id, rotulo: c.nombre }))]} />
          <FiltroOpciones nombre="chofer" etiqueta="Chofer" valor={filtros.operadorId} opciones={[{ valor: '', rotulo: 'Todos' }, ...(catalogos?.operadores ?? []).map((o) => ({ valor: o.id, rotulo: o.nombre }))]} />
          {csvUrl && (
            <a href={csvUrl} className="rv-btn rv-btn--primary rv-btn--sm">
              <Download aria-hidden strokeWidth={1.75} />CSV para cobro de estadías
            </a>
          )}
        </BarraFiltros>
        {!csvUrl && (
          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>El CSV de cobro (horas libres, tarifa y monto propuesto) lo descargan el dueño de la flota y el contador.</p>
        )}
        <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Periodo por la hora del aviso de LLEGADA, en días de México, ambos inclusive.</p>
      </section>

      {error ? (
        <section className="card p-4 text-[12px]" style={{ color: 'var(--bad)' }}>{error}</section>
      ) : (
        <>
          <TiraCifras sello={selloHoy('Estadías en andén')}>
            <Cifra etiqueta="Paradas del periodo" info="conductores_estadias.paradas" valor={numero(resumen.paradas)} nota={`${numero(resumen.cerradas)} cerradas · ${numero(resumen.enCurso)} en curso`} />
            <Cifra etiqueta="Tiempo medio en carga" info="conductores_estadias.medio_carga" valor={carga ? minutos(carga.promedio) : null} nota={carga ? `sobre ${numero(carga.n)} paradas cerradas` : 'ninguna carga cerrada'} />
            <Cifra etiqueta="Tiempo medio en descarga" info="conductores_estadias.medio_descarga" valor={descarga ? minutos(descarga.promedio) : null} nota={descarga ? `sobre ${numero(descarga.n)} paradas cerradas` : 'ninguna descarga cerrada'} />
            <Cifra etiqueta="En el andén ahora" info="conductores_estadias.en_anden" valor={numero(resumen.enCurso)} tono={resumen.enCurso > 0 ? 'warn' : undefined} nota="llegaron y aún no avisan su salida" />
          </TiraCifras>
          {truncada && (
            <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
              Hay más viajes con llegada en este periodo de los que una lectura trae: acorta el periodo o filtra por patio, cliente o chofer. Lo que ves NO es el total.
            </p>
          )}
          <section className="card p-4" aria-label="Paradas">
            {filas.length === 0 ? (
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Ninguna parada con llegada registrada en ese periodo y con esos filtros.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left etiqueta-mono text-[11px] uppercase" style={{ color: 'var(--faint)' }}>
                      <th className="py-1.5 pr-3">Viaje</th><th className="pr-3">Chofer</th><th className="pr-3">Parada</th><th className="pr-3">Llegada (hora del mensaje)</th>
                      <th className="pr-3">Salida</th><th className="pr-3 text-right">Tiempo</th><th className="pr-3">Estado</th><th>Respaldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f, i) => (
                      <tr key={`${f.viaje.id}-${f.estancia.lugar}-${i}`} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                        <td className="py-1.5 pr-3 font-medium">{f.viaje.folio ?? 'sin folio'}<div className="text-[11px] font-normal" style={{ color: 'var(--faint)' }}>{f.viaje.clienteNombre ?? ''}</div></td>
                        <td className="pr-3">{f.viaje.operadorNombre ?? '—'}<div className="text-[11px]" style={{ color: 'var(--faint)' }}>{f.viaje.terminalNombre ?? ''}</div></td>
                        <td className="pr-3">{f.estancia.lugar === 'carga' ? 'Carga' : 'Descarga'}<div className="text-[11px]" style={{ color: 'var(--faint)' }}>{f.sitio ?? ''}</div></td>
                        <td className="pr-3 cifra-mono">{horaExactaMx(f.estancia.llegada?.en ?? null, zonaHoraria) || '—'}<div className="text-[11px] font-sans" style={{ color: 'var(--faint)' }}>{f.estancia.llegada ? FUENTE[f.estancia.llegada.fuente] : ''}</div></td>
                        <td className="pr-3 cifra-mono">{horaExactaMx(f.estancia.salida?.en ?? null, zonaHoraria) || '—'}<div className="text-[11px] font-sans" style={{ color: 'var(--faint)' }}>{f.estancia.salida ? FUENTE[f.estancia.salida.fuente] : ''}</div></td>
                        <td className="pr-3 text-right cifra-mono">{minutos(f.estancia.minutos)}</td>
                        <td className="pr-3">{FASE[f.estancia.fase]}</td>
                        <td className="text-[11px]" style={{ color: 'var(--muted)' }}>
                          {f.estancia.llegada ? (f.estancia.llegada.validacion ? VALIDACION[f.estancia.llegada.validacion] : 'sin veredicto') : '—'}
                          <div>{(f.estancia.llegada?.evidencias ?? 0) + (f.estancia.salida?.evidencias ?? 0)} foto(s)</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </MarcoPagina>
  );
}

