import { PackageCheck, PackageX, Clock, CircleSlash } from 'lucide-react';
import { KpiTile, EstadoVacio, StatusPill, type Estado } from '../../admin/ui/kit';
import { fechaMx } from '../formato';
import type { PodRow } from '@/lib/cuadra/operacion';

// Bloques visuales de POD, fuera de la página para poder mirar el render.

const ICONO = { width: 15, height: 15, strokeWidth: 1.75, style: { color: 'var(--marca)' } } as const;

/** `null` NO es 'pendiente'. Nadie lo ha pedido todavía, que es distinto de
 *  haberlo pedido y estar esperando — y es justo la diferencia que decide si
 *  el encargado tiene que insistirle a alguien o no. */
function etiqueta(estado: string | null): { label: string; estado: Estado } {
  if (estado === null) return { label: 'Nadie lo ha pedido', estado: 'bad' };
  if (estado === 'pendiente') return { label: 'Pedido, sin llegar', estado: 'warn' };
  if (estado === 'rechazado') return { label: 'Rechazado', estado: 'bad' };
  if (estado === 'subido') return { label: 'Recibido', estado: 'ok' };
  return { label: estado, estado: 'neutral' };
}

export function CifrasPod({ pods }: { pods: PodRow[] }) {
  return (
    <section className="glass-panel p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Evidencia de entrega
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        <KpiTile icono={<CircleSlash {...ICONO} />} etiqueta="Sin pedir"
          valor={pods.filter((p) => p.estado === null).length} formato="entero"
          destacar={pods.some((p) => p.estado === null)} nota="Nadie ha solicitado el POD" />
        <KpiTile icono={<Clock {...ICONO} />} etiqueta="Pedidos, sin llegar"
          valor={pods.filter((p) => p.estado === 'pendiente').length} formato="entero" />
        <KpiTile icono={<PackageX {...ICONO} />} etiqueta="Rechazados"
          valor={pods.filter((p) => p.estado === 'rechazado').length} formato="entero"
          nota="Llegaron pero no sirven" />
        <KpiTile icono={<PackageCheck {...ICONO} />} etiqueta="Recibidos"
          valor={pods.filter((p) => p.estado === 'subido').length} formato="entero" />
      </div>
    </section>
  );
}

const CONTROL = { background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' } as const;

export function TablaPod({
  pods, accionPedir, accionRechazar,
}: {
  pods: PodRow[];
  accionPedir?: (fd: FormData) => Promise<void>;
  accionRechazar?: (fd: FormData) => Promise<void>;
}) {
  if (pods.length === 0) {
    return (
      <div className="px-5 pb-5">
        <EstadoVacio icono={<PackageCheck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          No hay viajes en curso, así que no hay entrega que perseguir. La evidencia se sigue mientras el viaje vive:
          una vez liquidado deja de aparecer aquí.
        </EstadoVacio>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: 'var(--muted)' }} className="text-left">
            <th className="px-5 py-2.5 font-medium">Viaje</th>
            <th className="px-5 py-2.5 font-medium">Operador</th>
            <th className="px-5 py-2.5 font-medium">Evidencia</th>
            <th className="px-5 py-2.5 font-medium">Capturada</th>
            <th className="px-5 py-2.5 font-medium">Nota</th>
            <th className="px-5 py-2.5 font-medium">Acción</th>
          </tr>
        </thead>
        <tbody>
          {pods.map((p) => {
            const e = etiqueta(p.estado);
            return (
              <tr key={p.viajeId} className="border-t" style={{ borderColor: 'var(--line)' }}>
                <td className="px-5 py-3 font-medium">{p.folio ?? '—'}</td>
                <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{p.operadorNombre ?? 'Sin asignar'}</td>
                <td className="px-5 py-3"><StatusPill estado={e.estado}>{e.label}</StatusPill></td>
                <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{fechaMx(p.capturadoEn)}</td>
                <td className="px-5 py-3 max-w-xs truncate" style={{ color: 'var(--muted)' }}>{p.nota ?? '—'}</td>
                <td className="px-5 py-3">
                  {p.estado === null && accionPedir ? (
                    <form action={accionPedir}>
                      <input type="hidden" name="viajeId" value={p.viajeId} />
                      <input type="hidden" name="operadorId" value={p.operadorId ?? ''} />
                      <button type="submit" className="text-sm rounded-lg px-2.5 py-1.5" style={CONTROL}>
                        Marcar como pedido
                      </button>
                    </form>
                  ) : p.estado === 'subido' && accionRechazar ? (
                    <form action={accionRechazar} className="flex items-center gap-2">
                      <input type="hidden" name="podId" value={p.podId ?? ''} />
                      <input name="nota" placeholder="Por qué no sirve"
                        className="text-sm rounded-lg px-2.5 py-1.5 w-44" style={CONTROL} />
                      <button type="submit" className="text-sm rounded-lg px-2.5 py-1.5" style={CONTROL}>
                        Rechazar
                      </button>
                    </form>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
