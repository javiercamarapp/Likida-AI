import { FileQuestion, Inbox } from 'lucide-react';
import type { HuerfanoDeFlota, MotivoHuerfano } from '@/lib/likida/repo';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { BarraPagina } from '../resumen-visual';
import { FilaAcciones, type AccionHuerfano, type ViajeVivo } from './acciones';

/** Por qué quedó suelto, en palabras de oficina. Un motivo nuevo cae al
 *  crudo en gris — visible, no roto. */
const MOTIVO: Record<MotivoHuerfano, string> = {
  sin_viaje: 'Llegó sin viaje abierto',
  tras_liquidar: 'Llegó después de liquidar',
  fallo_ocr: 'La foto no se pudo leer completa',
};

/**
 * La bandeja de comprobantes sin viaje (F2). Cada fila trae lo que el humano
 * necesita para decidir — fecha del papel, operador, concepto y monto — y
 * las dos salidas reales: adjuntar a un viaje VIVO o descartar. La foto no
 * se enseña (candado del 2-ago); el dato extraído sí.
 */
export function VistaHuerfanos({ pendientes, viajesVivos, cargados, acciones }: {
  pendientes: HuerfanoDeFlota[];
  viajesVivos: ViajeVivo[];
  /** Cuántos viajes recientes cargó la page — el alcance real del selector. */
  cargados: number;
  acciones: { adjuntar: AccionHuerfano; descartar: AccionHuerfano };
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<FileQuestion width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Comprobantes sin viaje"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <section className="card p-4">
            <div className="mb-3">
              <h2 className="font-display text-[15px] font-semibold">
                Esperan que alguien los acomode{pendientes.length > 0 && <> · <span className="cifra-mono">{numero(pendientes.length)}</span></>}
              </h2>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>
                Una foto nunca se rechaza: lo que llega sin viaje se guarda aquí. Al chofer también
                se le ofrece adjuntarlos por WhatsApp — quien llegue primero.
              </p>
            </div>

            {pendientes.length === 0 ? (
              <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                No hay comprobantes en el limbo — todo lo que ha llegado tiene su viaje.
              </EstadoVacio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--faint)' }}>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Recibido</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Operador</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Comprobante</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pr-6 text-right">Monto</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Por qué está aquí</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right pr-1">Resolver</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendientes.map((h) => (
                      <tr key={h.id} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                        <td className="py-2.5" style={{ color: 'var(--muted)' }}>{fechaCorta(h.creadoEn)}</td>
                        <td className="py-2.5" style={{ color: 'var(--muted)' }}>{h.operadorNombre ?? 'Sin nombre'}</td>
                        <td className="py-2.5">
                          <span className="font-medium block">{etiquetaConcepto(h.concepto)}</span>
                          {h.fecha && (
                            <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>
                              del {fechaCorta(h.fecha)}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-6 text-right">
                          {/* Un $0.00 aquí sería una cifra que nadie midió (el
                              OCR no pudo leerla) — se dice, no se pinta. */}
                          {h.monto > 0
                            ? <span className="cifra-mono">{mxn(h.monto)}</span>
                            : <span className="text-[11px]" style={{ color: 'var(--faint)' }}>sin monto legible</span>}
                        </td>
                        <td className="py-2.5 text-[12px]" style={{ color: 'var(--muted)' }}>
                          {MOTIVO[h.motivo] ?? h.motivo}
                        </td>
                        <td className="py-2.5 pl-4">
                          <FilaAcciones huerfanoId={h.id} viajesVivos={viajesVivos}
                            sinMonto={h.monto <= 0} cargados={cargados}
                            adjuntar={acciones.adjuntar} descartar={acciones.descartar} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
