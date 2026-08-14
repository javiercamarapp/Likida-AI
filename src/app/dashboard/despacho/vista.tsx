import { ClipboardList, Inbox, Truck, Users } from 'lucide-react';
import type { TableroOperacion, ViajeSinAsignar, CargaOperador } from '@/lib/likida/operacion';
import type { ViajeRow } from '@/lib/likida/analytics';
import { numero, fechaCorta } from '@/lib/formato';
import { BarraPagina } from '../resumen-visual';
import { FormaViaje, type AccionCrearViaje } from '../forma-viaje';
import { AsignarFila, BotonReenviar, AltaOperador, type AccionDespacho } from './acciones';

/** Tope de las listas — declarado en pantalla cuando recorta. */
const MAX_FILAS = 12;

/**
 * El render del Despacho (13-ago-2026) — la página donde se ACTÚA: crear
 * viaje, asignar y avisar, insistirle al chofer, dar de alta operadores.
 * La foto de la mañana (tablero de solo lectura) vive en el Resumen del
 * encargado; aquí cada sección tiene su botón y todos funcionan.
 *
 * CERO PESOS EN TODA LA PANTALLA a propósito: esta página es del área
 * `operacion` y el jefe de tráfico no ve dinero. El anticipo se CAPTURA en
 * la forma (el motor lo necesita) pero no se lista ni se suma en ninguna
 * columna — el estándar de siempre del despacho.
 */
export function VistaDespacho({
  tablero, sinAsignar, activos, operadores, carga, crear, asignarYAvisar, reenviarAviso, altaOperador,
}: {
  tablero: TableroOperacion | null;
  sinAsignar: ViajeSinAsignar[];
  activos: ViajeRow[];
  operadores: Array<{ id: string; nombre: string }>;
  carga: CargaOperador[] | null;
  crear: AccionCrearViaje;
  asignarYAvisar: AccionDespacho;
  reenviarAviso: AccionDespacho;
  altaOperador: AccionDespacho;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ClipboardList width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Despacho"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          {tablero === null ? (
            <div className="card p-4">
              <p className="text-[12.5px] text-center" style={{ color: 'var(--muted)' }}>
                No se pudo leer el tablero ahora mismo — las colas de abajo siguen siendo reales.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
              <Kpi titulo="Viajes activos" valor={numero(tablero.viajesActivos)} />
              <Kpi titulo="Por asignar" valor={numero(tablero.porAsignar)} tono={tablero.porAsignar > 0 ? 'warn' : undefined} />
              <Kpi titulo="Unidades libres" valor={numero(tablero.unidadesDisponibles)} />
              <Kpi titulo="En taller" valor={numero(tablero.unidadesEnTaller)} />
              <Kpi titulo="Incidencias" valor={numero(tablero.incidenciasAbiertas)} tono={tablero.incidenciasAbiertas > 0 ? 'warn' : undefined} />
              <Kpi titulo="POD pendientes" valor={numero(tablero.podPendientes)} />
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-4">
            {/* ── La cola que reparte el día ── */}
            <section className="card p-4 lg:col-span-2 flex flex-col">
              <h2 className="font-display text-[15px] font-semibold">Por asignar</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                Viajes sin chofer — se asigna y el aviso de WhatsApp sale en el mismo paso
              </p>
              {sinAsignar.length === 0 ? (
                <Leyenda icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Nada sin repartir. Los viajes que crees sin operador caen aquí.
                </Leyenda>
              ) : (
                <div className="space-y-3">
                  {sinAsignar.slice(0, MAX_FILAS).map((v) => (
                    <div key={v.id} className="rounded-xl hairline p-3 space-y-2" style={{ background: 'var(--canvas)' }}>
                      <div className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="font-medium">{v.folio ?? 'Sin folio'}</span>
                        <span className="truncate" style={{ color: 'var(--muted)' }}>
                          {v.origen ?? '—'} → {v.destino ?? '—'}
                        </span>
                        <span className="shrink-0" style={{ color: 'var(--faint)' }}>{fechaCorta(v.fechaInicio)}</span>
                      </div>
                      {operadores.length === 0 ? (
                        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                          No hay operadores dados de alta — usa el alta rápida de la derecha.
                        </p>
                      ) : (
                        <AsignarFila viajeId={v.id} operadores={operadores} asignarYAvisar={asignarYAvisar} />
                      )}
                    </div>
                  ))}
                  {sinAsignar.length > MAX_FILAS && (
                    <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
                      Se muestran {MAX_FILAS} — hay {numero(sinAsignar.length - MAX_FILAS)} más sin asignar.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* ── Crear operación nueva ── */}
            <section className="card p-4">
              <h2 className="font-display text-[15px] font-semibold mb-1">Nuevo viaje</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                Nace abierto: desde ese momento el operador puede mandar comprobantes por WhatsApp
              </p>
              <FormaViaje action={crear} operadores={operadores} />
            </section>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            {/* ── Lo vivo, con el estado del aviso ── */}
            <section className="card p-4 lg:col-span-2 flex flex-col">
              <h2 className="font-display text-[15px] font-semibold">En curso</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                Abiertos y en cuadre, con el estado del aviso al chofer
              </p>
              {activos.length === 0 ? (
                <Leyenda icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Ningún viaje en curso ahora mismo.
                </Leyenda>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left" style={{ color: 'var(--faint)' }}>
                        <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Viaje</th>
                        <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Ruta</th>
                        <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Operador</th>
                        <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Inicio</th>
                        <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Aviso</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {activos.slice(0, MAX_FILAS).map((v) => (
                        <tr key={v.id} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                          <td className="py-2 font-medium">{v.folio}</td>
                          <td className="py-2 truncate max-w-[180px]" style={{ color: 'var(--muted)' }}>
                            {v.origen ?? '—'} → {v.destino ?? '—'}
                          </td>
                          <td className="py-2">{v.operadorNombre ?? <span style={{ color: 'var(--faint)' }}>Sin asignar</span>}</td>
                          <td className="py-2" style={{ color: 'var(--muted)' }}>{fechaCorta(v.fechaInicio)}</td>
                          <td className="py-2"><PillAviso v={v} /></td>
                          <td className="py-2 text-right">
                            {/* Con operador y sin aceptar, siempre hay algo que
                                mandar: "Avisar" si el aviso nunca salió (el fallo
                                silencioso al crear), "Reavisar" para insistir. */}
                            {!v.aceptadoEn && v.operadorNombre && (
                              <BotonReenviar viajeId={v.id} yaAvisado={v.avisadoEn !== null} reenviarAviso={reenviarAviso} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {activos.length > MAX_FILAS && (
                    <p className="text-[12px] mt-3" style={{ color: 'var(--faint)' }}>
                      Se muestran {MAX_FILAS} — hay {numero(activos.length - MAX_FILAS)} más en curso.
                    </p>
                  )}
                </div>
              )}
            </section>

            <div className="space-y-4">
              {/* ── Alta rápida ── */}
              <section className="card p-4">
                <h2 className="font-display text-[15px] font-semibold mb-1">Alta rápida de operador</h2>
                <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                  Nombre y WhatsApp — la lada 52 y los duplicados los cuida el servidor
                </p>
                <AltaOperador altaOperador={altaOperador} />
              </section>

              {/* ── Quién trae cuánto ── */}
              <section className="card p-4 flex flex-col">
                <h2 className="font-display text-[15px] font-semibold">Carga por operador</h2>
                <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>El que trae más sale arriba — ¿a quién NO le cargas otro?</p>
                {carga === null ? (
                  <Leyenda>No se pudo leer la carga ahora mismo.</Leyenda>
                ) : carga.length === 0 ? (
                  <Leyenda icono={<Users width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                    Sin operadores dados de alta todavía.
                  </Leyenda>
                ) : (
                  <div className="space-y-1.5">
                    {carga.slice(0, 8).map((c) => (
                      <div key={c.operadorId} className="flex items-center justify-between gap-2 text-[12.5px]">
                        <span className="truncate">
                          {c.nombre}
                          {!c.activo && <span className="text-[11px] ml-1" style={{ color: 'var(--faint)' }}>· inactivo</span>}
                        </span>
                        <span className="cifra-mono shrink-0" style={{ color: 'var(--muted)' }}>
                          {numero(c.enCurso)} en curso{c.sinPod > 0 ? ` · ${numero(c.sinPod)} sin POD` : ''}
                        </span>
                      </div>
                    ))}
                    {carga.length > 8 && (
                      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>y {numero(carga.length - 8)} más.</p>
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/** El estado del aviso, con las cuatro marcas reales de la confirmación
 *  (0058): sin avisar → avisado (con el conteo) → aceptó / escalado.
 *  Exportada desde F2: el registro de Viajes pinta el MISMO estado — dos
 *  copias de este mapa se separan en el primer estatus nuevo. */
export function PillAviso({ v }: { v: Pick<ViajeRow, 'aceptadoEn' | 'escaladoEn' | 'avisadoEn' | 'avisosEnviados'> }) {
  const pill = (texto: string, fg: string, bg: string) => (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ color: fg, background: bg }}>{texto}</span>
  );
  if (v.aceptadoEn) return pill('Aceptó', 'var(--ok)', 'var(--okbg)');
  if (v.escaladoEn) return pill('Escalado', 'var(--bad)', 'var(--badbg)');
  if (v.avisadoEn) return pill(v.avisosEnviados > 1 ? `Avisado ×${v.avisosEnviados}` : 'Avisado', 'var(--warn)', 'var(--warnbg)');
  return pill('Sin avisar', 'var(--muted)', 'var(--canvas)');
}

function Leyenda({ children, icono }: { children: React.ReactNode; icono?: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-[110px] flex items-center justify-center">
      <div className="text-center max-w-[32ch]">
        {icono && <div className="flex justify-center mb-2">{icono}</div>}
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{children}</p>
      </div>
    </div>
  );
}

function Kpi({ titulo, valor, tono }: { titulo: string; valor: string; tono?: 'warn' | 'bad' }) {
  return (
    <div className="card p-3.5">
      <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{titulo}</div>
      <div className="cifra-mono text-[20px] font-medium mt-1"
        style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
    </div>
  );
}
