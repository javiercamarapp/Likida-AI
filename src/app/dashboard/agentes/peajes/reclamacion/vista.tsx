import Link from 'next/link';
import { FileDown, ArrowLeft, ShieldAlert } from 'lucide-react';
import { BarraPagina } from '../../../resumen-visual';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { mxn, numero } from '@/lib/formato';
// El módulo `reclamacion` es puro (sin base): el bundle de la vista puede importarlo.
import { ETIQUETA_MOTIVO_RECLAMACION, type ReporteReclamacion } from '@/lib/likida/peajes/reclamacion';
import { textoEvidencia } from '@/lib/likida/peajes/reclamacion_archivos';

export type EstadoReclamacion = 'sin_desglose' | 'no_existe' | 'error' | 'ok';

const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;

export function VistaReclamacionPeajes({ sufijo, desglose, estado, reporte }: {
  sufijo: string; desglose: string | null; estado: EstadoReclamacion; reporte: ReporteReclamacion | null;
}) {
  const ctx = sufijo ? `&${sufijo.slice(1)}` : '';
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ShieldAlert width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Reporte de reclamación de peajes"
          derecha={
            <Link href={`/dashboard/agentes/peajes${sufijo}`} className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70" style={{ color: 'var(--marca)' }}>
              <ArrowLeft width={12} height={12} strokeWidth={2} /> Volver al agente
            </Link>
          }
        />
        <div className="px-5 py-5 flex-1 space-y-4">
          {estado === 'sin_desglose' && (
            <EstadoVacio icono={<ShieldAlert width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Elige un desglose en el agente de Peajes y abre «Reporte de reclamación».
            </EstadoVacio>
          )}
          {estado === 'no_existe' && <p role="alert" className="card p-3 text-[12.5px]" style={{ color: 'var(--bad)' }}>Ese desglose no existe en tu flota (o fue anulado).</p>}
          {estado === 'error' && <p role="alert" className="card p-3 text-[12.5px]" style={{ color: 'var(--bad)' }}>No se pudo armar el reporte ahora mismo. No es que no haya nada que reclamar: inténtalo de nuevo en un momento.</p>}

          {estado === 'ok' && reporte && desglose && (
            <>
              <section className="card p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="font-display text-[15px] font-semibold">
                      {reporte.resumen.reclamables === 0 ? 'Sin cruces para reclamar' : `${numero(reporte.resumen.reclamables)} ${reporte.resumen.reclamables === 1 ? 'cruce' : 'cruces'} para pedir revisión`}
                    </h2>
                    <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
                      {reporte.proveedor ? `Proveedor ${reporte.proveedor} · ` : ''}
                      {reporte.periodoDesde && reporte.periodoHasta ? `Periodo ${reporte.periodoDesde} a ${reporte.periodoHasta} · ` : ''}
                      {numero(reporte.resumen.lineas)} líneas en el desglose
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Monto reclamable</span>
                    <span className="text-[20px] font-semibold cifra-mono">{mxn(reporte.resumen.montoReclamable)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <a href={`/api/export/peajes-reclamacion?desglose=${desglose}&formato=xlsx${ctx}`} className={CSS_BOTON} style={ESTILO_PRIMARIO}>
                    <FileDown width={13} height={13} strokeWidth={2} /> Excel
                  </a>
                  <a href={`/api/export/peajes-reclamacion?desglose=${desglose}&formato=pdf${ctx}`} className={`${CSS_BOTON} hairline`} style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
                    <FileDown width={13} height={13} strokeWidth={2} /> PDF
                  </a>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
                  {(Object.keys(ETIQUETA_MOTIVO_RECLAMACION) as Array<keyof typeof ETIQUETA_MOTIVO_RECLAMACION>).map((m) => (
                    <div key={m} className="rounded-lg hairline p-2.5">
                      <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>{ETIQUETA_MOTIVO_RECLAMACION[m]}</span>
                      <span className="text-[15px] font-semibold cifra-mono">{numero(reporte.resumen.porMotivo[m].n)}</span>
                      <span className="text-[11px] ml-1.5" style={{ color: 'var(--muted)' }}>{mxn(reporte.resumen.porMotivo[m].monto)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] mt-3" style={{ color: 'var(--faint)' }}>
                  No se reclaman (sin evidencia en contra del cobro): {numero(reporte.resumen.confirmadas)} confirmadas por el GPS · {numero(reporte.resumen.sinDatos)} sin datos suficientes
                  {reporte.resumen.sinEvaluar > 0 ? ` · ${numero(reporte.resumen.sinEvaluar)} sin evaluar (vuelve a conciliar el desglose)` : ''}. Sin datos no es evidencia en contra de nadie.
                  {reporte.resumen.sinCurso > 0 ? ` ${numero(reporte.resumen.sinCurso)} de ${numero(reporte.resumen.lineas)} líneas no tienen curso declarado y no se evaluaron por curso: cárgalos en Configuración, sección Cursos.` : ''}
                </p>
              </section>

              {reporte.cruces.length > 0 && (
                <section className="card p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="text-left" style={{ color: 'var(--faint)' }}>
                          <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Fecha y hora</th>
                          <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Caseta</th>
                          <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">TAG / unidad</th>
                          <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right">Monto</th>
                          <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pl-3">Por qué se reclama</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reporte.cruces.map((c) => (
                          <tr key={c.indice} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                            <td className="py-2 whitespace-nowrap">{c.fecha}{c.hora && <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{c.hora.slice(0, 8)}</span>}</td>
                            <td className="py-2">{c.casetaCatalogo || c.caseta || '—'}</td>
                            <td className="py-2">{c.tag || '—'}{c.unidad && <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{c.unidad}</span>}</td>
                            <td className="py-2 text-right cifra-mono">{mxn(c.monto)}</td>
                            <td className="py-2 pl-3 max-w-[34rem]">
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium mr-1.5"
                                style={c.confianza === 'alta' ? { color: 'var(--bad)', background: 'var(--badbg)' } : { color: 'var(--warn)', background: 'var(--warnbg)' }}>
                                {ETIQUETA_MOTIVO_RECLAMACION[c.motivo]} · {c.confianza}
                              </span>
                              <span>{c.porQue}</span>
                              {c.evidencia.length > 0 && (
                                <ul className="mt-1 space-y-0.5 text-[11px]" style={{ color: 'var(--muted)' }}>
                                  {c.evidencia.map((e) => <li key={e.en}>{textoEvidencia(e)}</li>)}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="card p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>Qué significa y qué NO afirma</h3>
                <ul className="space-y-1.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  {reporte.leyendas.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
