import Link from 'next/link';
import { FileSpreadsheet, ArrowLeft, Upload, Trash2, Save } from 'lucide-react';
import { BarraPagina } from '../../../resumen-visual';
// SOLO tipos: el repo importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { ConfigFormatoFlota, TelefonosFlota } from '@/lib/likida/liquidacion_externa/repo';
import { ETIQUETA_CAMPO_RENGLON, ETIQUETA_CAMPO_ENCABEZADO } from '@/lib/likida/liquidacion_externa/formato_flota';

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesFormato { subirMuestra: Accion; guardarAjustes: Accion; quitar: Accion; guardarTelefonos?: Accion }

const CSS_INPUT = 'hairline text-[12.5px] px-2.5 py-1.5 rounded-lg w-full';
const ESTILO_INPUT = { background: 'var(--surface)', color: 'var(--ink)' } as const;
const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
const CSS_SECUNDARIO = 'hairline text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]';
const ESTILO_SECUNDARIO = { background: 'var(--surface)', color: 'var(--muted)' } as const;

function Etiqueta({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{t}</span>
      {children}
    </label>
  );
}

export function VistaFormatoLiquidacion({ sufijo, aviso, error, config, telefonos, puedeAdministrar, acciones }: {
  sufijo: string; aviso: string | null; error: string | null;
  config: ConfigFormatoFlota | null;
  /** Los teléfonos guardados, con o sin formato (0645). Sin él (`undefined`) se toman del formato, si hay. */
  telefonos?: TelefonosFlota | null; puedeAdministrar: boolean; acciones: AccionesFormato;
}) {
  const f = config?.formato ?? null;
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<FileSpreadsheet width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Formato de las liquidaciones"
          derecha={
            <Link href={`/dashboard/agentes/liquidacion${sufijo}`} className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70" style={{ color: 'var(--marca)' }}>
              <ArrowLeft width={12} height={12} strokeWidth={2} /> Volver al agente
            </Link>
          }
        />
        <div className="px-5 py-5 flex-1 space-y-4">
          {aviso && <p role="status" className="card p-3 text-[12.5px]" style={{ color: 'var(--ink)' }}>{aviso}</p>}
          {error && <p role="alert" className="card p-3 text-[12.5px]" style={{ color: 'var(--bad)' }}>{error}</p>}

          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-1">1. Tu formato</h2>
            <p className="text-[12px] mb-3" style={{ color: 'var(--muted)' }}>
              Tú calculas la liquidación en tu sistema; Likida toma el dato del pago y se lo manda al operador con el mismo formato que hoy
              copias y pegas. Sube el Excel de muestra (el «formatito») y Likida lee sus columnas, sus encabezados y los datos de arriba
              (operador, periodo, folio). Lo que no reconoce no se inventa: te lo dice. Likida no recalcula nada: imprime las cifras que mandas.
            </p>
            {puedeAdministrar ? (
              <form action={acciones.subirMuestra} encType="multipart/form-data" className="flex flex-wrap items-end gap-2">
                <Etiqueta t="Excel de muestra (.xlsx)">
                  <input type="file" name="archivo" accept=".xlsx,.xls,.ods,.csv" required className={CSS_INPUT} style={ESTILO_INPUT} />
                </Etiqueta>
                <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}><Upload width={13} height={13} strokeWidth={2} /> {f ? 'Reemplazar muestra' : 'Subir muestra'}</button>
              </form>
            ) : (
              <p className="text-[12px]" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota sube la muestra y cambia el formato.</p>
            )}
          </section>

          {!f && (
            <section className="card p-4">
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                Todavía no hay formato: las liquidaciones salen con el PDF genérico de Likida. No necesitas un Excel de muestra para
                designar a quién se le copia cada liquidación ni quién revisa las discrepancias: captúralos aquí abajo.
              </p>
            </section>
          )}

          {!f && acciones.guardarTelefonos && (
            <section className="card p-4">
              <h2 className="font-display text-[15px] font-semibold mb-1">2. A quién se le avisa (sin formato de Excel)</h2>
              <form action={acciones.guardarTelefonos} className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Etiqueta t="Copia al jefe de flota (WhatsApp, hasta 3)">
                    <textarea name="copia" rows={2} defaultValue={(telefonos?.copia ?? []).join('\n')} placeholder="5512345678" className={CSS_INPUT} style={ESTILO_INPUT} disabled={!puedeAdministrar} />
                    <span className="text-[11px]" style={{ color: 'var(--faint)' }}>Reciben el resumen y la liga del documento de cada liquidación entregada. La copia lleva cifras: solo los números que pongas aquí.</span>
                  </Etiqueta>
                  <Etiqueta t="Aviso cuando un operador responde «No coincide» (hasta 3)">
                    <textarea name="discrepancia" rows={2} defaultValue={(telefonos?.discrepancia ?? []).join('\n')} placeholder="5512345678" className={CSS_INPUT} style={ESTILO_INPUT} disabled={!puedeAdministrar} />
                    <span className="text-[11px]" style={{ color: 'var(--faint)' }}>La persona responsable de revisar discrepancias. Si lo dejas vacío, se avisa al jefe de la copia y, sin copia, a quien ve dinero.</span>
                  </Etiqueta>
                </div>
                {puedeAdministrar && (
                  <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}><Save width={13} height={13} strokeWidth={2} /> Guardar teléfonos</button>
                )}
              </form>
            </section>
          )}

          {f && config && (
            <>
              <section className="card p-4">
                <h2 className="font-display text-[15px] font-semibold mb-1">2. Cómo se imprime</h2>
                <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                  Muestra: {config.nombreMuestra ?? '—'}. Cada liquidación que llega genera el PDF y el Excel con estas columnas; por WhatsApp viaja el que elijas.
                </p>
                <form action={acciones.guardarAjustes} className="space-y-4">
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Etiqueta t="Título del documento">
                      <input name="titulo" defaultValue={f.titulo ?? ''} maxLength={120} placeholder="(el nombre de tu flota)" className={CSS_INPUT} style={ESTILO_INPUT} disabled={!puedeAdministrar} />
                    </Etiqueta>
                    <Etiqueta t="Documento que viaja por WhatsApp">
                      <select name="salida" defaultValue={f.salida} className={CSS_INPUT} style={ESTILO_INPUT} disabled={!puedeAdministrar}>
                        <option value="pdf">PDF</option>
                        <option value="xlsx">Excel</option>
                      </select>
                    </Etiqueta>
                    <Etiqueta t="Fechas">
                      <select name="fechas" defaultValue={f.fechas} className={CSS_INPUT} style={ESTILO_INPUT} disabled={!puedeAdministrar}>
                        <option value="dmy">DD/MM/AAAA</option>
                        <option value="iso">AAAA-MM-DD</option>
                      </select>
                    </Etiqueta>
                    <Etiqueta t="Fila de total">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" name="mostrarTotal" defaultChecked={f.total.mostrar} disabled={!puedeAdministrar} />
                        <input name="etiquetaTotal" defaultValue={f.total.etiqueta} maxLength={80} className={CSS_INPUT} style={ESTILO_INPUT} disabled={!puedeAdministrar} />
                      </span>
                    </Etiqueta>
                  </div>

                  <div>
                    <p className="etiqueta-mono text-[10px] uppercase mb-1" style={{ color: 'var(--faint)' }}>Datos de arriba</p>
                    {f.datos.length === 0 ? (
                      <p className="text-[12px]" style={{ color: 'var(--faint)' }}>La muestra no traía datos sobre la tabla (operador, periodo, folio…): el documento lleva solo la tabla.</p>
                    ) : (
                      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                        {f.datos.map((d, i) => (
                          <Etiqueta key={`${d.campo}-${i}`} t={`Se llena con: ${ETIQUETA_CAMPO_ENCABEZADO[d.campo]}`}>
                            <input name={`dato_${i}`} defaultValue={d.etiqueta} maxLength={80} className={CSS_INPUT} style={ESTILO_INPUT} disabled={!puedeAdministrar} />
                          </Etiqueta>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="etiqueta-mono text-[10px] uppercase mb-1" style={{ color: 'var(--faint)' }}>Columnas de la tabla, en orden</p>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                      {f.columnas.map((c, i) => (
                        <Etiqueta key={`${c.campo}-${i}`} t={`Se llena con: ${ETIQUETA_CAMPO_RENGLON[c.campo]}`}>
                          <input name={`col_${i}`} defaultValue={c.encabezado} maxLength={80} className={CSS_INPUT} style={ESTILO_INPUT} disabled={!puedeAdministrar} />
                        </Etiqueta>
                      ))}
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <Etiqueta t="Copia al jefe de flota (WhatsApp, hasta 3)">
                      <textarea name="copia" rows={2} defaultValue={config.copiaTelefonos.join('\n')} placeholder="5512345678" className={CSS_INPUT} style={ESTILO_INPUT} disabled={!puedeAdministrar} />
                      <span className="text-[11px]" style={{ color: 'var(--faint)' }}>Reciben el resumen y la liga del documento de cada liquidación entregada. La copia lleva cifras: solo los números que pongas aquí.</span>
                    </Etiqueta>
                    <Etiqueta t="Aviso cuando un operador responde «No coincide» (hasta 3)">
                      <textarea name="discrepancia" rows={2} defaultValue={config.discrepanciaTelefonos.join('\n')} placeholder="5512345678" className={CSS_INPUT} style={ESTILO_INPUT} disabled={!puedeAdministrar} />
                      <span className="text-[11px]" style={{ color: 'var(--faint)' }}>La persona responsable de revisar discrepancias. Si lo dejas vacío, se avisa al jefe de la copia y, sin copia, a quien ve dinero.</span>
                    </Etiqueta>
                  </div>

                  {puedeAdministrar && (
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}><Save width={13} height={13} strokeWidth={2} /> Guardar cambios</button>
                      <button type="submit" formAction={acciones.quitar} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}><Trash2 width={12} height={12} strokeWidth={2} className="inline mr-1" />Quitar el formato</button>
                    </div>
                  )}
                </form>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
