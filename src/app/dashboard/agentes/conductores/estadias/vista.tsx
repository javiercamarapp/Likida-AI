import Link from 'next/link';
import { Timer, Download } from 'lucide-react';
import { BarraPagina } from '../../../resumen-visual';
import { numero } from '@/lib/formato';
import { horaExactaMx, type FilaEstadia, type ResumenEstadias } from '@/lib/likida/conductor/estadias_anden';
import { textoTiempo } from '@/lib/likida/conductor/planificador';
import type { CatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';

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

export function VistaEstadias({ sufijo, filtros, catalogos, filas, resumen, truncada, error, csvUrl, ocultos }: {
  sufijo: string; filtros: FiltrosEstadias; catalogos: CatalogosFiltro | null;
  filas: FilaEstadia[]; resumen: ResumenEstadias; truncada: boolean; error: string | null;
  /** Solo si el rol ve dinero: el CSV de cobro (con horas libres, tarifa y monto propuesto). */
  csvUrl: string | null; ocultos: Record<string, string>;
}) {
  const sel = 'hairline rounded-lg px-2 h-8 text-[12.5px]';
  const carga = promedioCerradas(filas, 'carga');
  const descarga = promedioCerradas(filas, 'descarga');
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<Timer width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Estadías en andén" />
        <div className="px-5 py-5 flex-1 space-y-4">
          <p className="text-[12.5px] max-w-[80ch]" style={{ color: 'var(--muted)' }}>
            El tiempo entre la llegada y la salida de cada carga y descarga, con la <strong>hora exacta del mensaje del chofer</strong> (no
            telemetría del evento físico). Cada fila dice de dónde salió la hora, si la ubicación la validó y cuántas fotos la respaldan.{' '}
            <Link href={`/dashboard/agentes/conductores${sufijo}`} className="underline">Volver al tablero</Link>
          </p>

          <section className="card p-4 space-y-3" aria-label="Filtros">
            <form method="get" className="flex flex-wrap items-end gap-2.5">
              {Object.entries(ocultos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <label className="text-[11px] font-medium">Desde<input type="date" name="desde" defaultValue={filtros.desde} className={`${sel} block mt-1`} /></label>
              <label className="text-[11px] font-medium">Hasta<input type="date" name="hasta" defaultValue={filtros.hasta} className={`${sel} block mt-1`} /></label>
              <label className="text-[11px] font-medium">Patio
                <select name="terminal" defaultValue={filtros.terminalId} className={`${sel} block mt-1`}>
                  <option value="">Todos</option>{(catalogos?.terminales ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-medium">Cliente
                <select name="cliente" defaultValue={filtros.clienteId} className={`${sel} block mt-1`}>
                  <option value="">Todos</option>{(catalogos?.clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-medium">Chofer
                <select name="chofer" defaultValue={filtros.operadorId} className={`${sel} block mt-1`}>
                  <option value="">Todos</option>{(catalogos?.operadores ?? []).map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              </label>
              <button type="submit" className="h-8 px-3 rounded-lg text-[12.5px] font-medium hairline transition-colors hover:bg-[var(--canvas)]">Aplicar</button>
              {csvUrl && (
                <a href={csvUrl} className="h-8 px-3 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5" style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                  <Download width={13} height={13} strokeWidth={1.75} aria-hidden />CSV para cobro de estadías
                </a>
              )}
            </form>
            {!csvUrl && (
              <p className="text-[11px]" style={{ color: 'var(--faint)' }}>El CSV de cobro (horas libres, tarifa y monto propuesto) lo descargan el dueño de la flota y el contador.</p>
            )}
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Periodo por la hora del aviso de LLEGADA, en días de México, ambos inclusive.</p>
          </section>

          {error ? (
            <section className="card p-4 text-[12.5px]" style={{ color: 'var(--bad)' }}>{error}</section>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi titulo="Paradas del periodo" valor={numero(resumen.paradas)} nota={`${numero(resumen.cerradas)} cerradas · ${numero(resumen.enCurso)} en curso`} />
                <Kpi titulo="Tiempo medio en carga" valor={carga ? minutos(carga.promedio) : 'sin datos'} nota={carga ? `sobre ${numero(carga.n)} paradas cerradas` : 'ninguna carga cerrada'} />
                <Kpi titulo="Tiempo medio en descarga" valor={descarga ? minutos(descarga.promedio) : 'sin datos'} nota={descarga ? `sobre ${numero(descarga.n)} paradas cerradas` : 'ninguna descarga cerrada'} />
                <Kpi titulo="En el andén ahora" valor={numero(resumen.enCurso)} tono={resumen.enCurso > 0 ? 'warn' : undefined} nota="llegaron y aún no avisan su salida" />
              </div>
              {truncada && (
                <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
                  Hay más viajes con llegada en este periodo de los que una lectura trae: acorta el periodo o filtra por patio, cliente o chofer. Lo que ves NO es el total.
                </p>
              )}
              <section className="card p-4" aria-label="Paradas">
                {filas.length === 0 ? (
                  <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Ninguna parada con llegada registrada en ese periodo y con esos filtros.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="text-left etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>
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
                            <td className="pr-3 cifra-mono">{horaExactaMx(f.estancia.llegada?.en ?? null) || '—'}<div className="text-[11px] font-sans" style={{ color: 'var(--faint)' }}>{f.estancia.llegada ? FUENTE[f.estancia.llegada.fuente] : ''}</div></td>
                            <td className="pr-3 cifra-mono">{horaExactaMx(f.estancia.salida?.en ?? null) || '—'}<div className="text-[11px] font-sans" style={{ color: 'var(--faint)' }}>{f.estancia.salida ? FUENTE[f.estancia.salida.fuente] : ''}</div></td>
                            <td className="pr-3 text-right cifra-mono">{minutos(f.estancia.minutos)}</td>
                            <td className="pr-3">{FASE[f.estancia.fase]}</td>
                            <td className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
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
        </div>
      </div>
    </main>
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
