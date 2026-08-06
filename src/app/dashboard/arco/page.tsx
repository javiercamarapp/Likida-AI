import { ShieldCheck, CheckCircle2, CircleAlert } from 'lucide-react';
import { EstadoVacio, KpiTile } from '../../admin/ui/kit';
import { FormaConAviso, type ResultadoAccion } from '../../admin/ui/forma';
import { requireSessionTenant } from '@/lib/auth/guard';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { revalidatePath } from 'next/cache';
import { listarSolicitudesArco, resolverSolicitudArco } from '@/lib/cuadra/repo';
import { mensajeParaPantalla } from '@/lib/cuadra/administracion';
import { fechaMx } from '@/lib/formato';

export const dynamic = 'force-dynamic';

const ETIQUETA_TIPO: Record<string, string> = {
  acceso: 'Acceso', rectificacion: 'Rectificación', cancelacion: 'Cancelación', oposicion: 'Oposición',
};

type Params = { tenant?: string; vista?: string; rol?: string };
const RUTA = '/dashboard/arco';

/**
 * Solicitudes ARCO de ESTA flota — la responsable obligada a contestar en 20
 * días hábiles (LFPDPPP art. 32). AUDITORÍA 16: antes vivía solo en /admin
 * (superadmin), y la flota no tenía dónde ver sus solicitudes ni responderlas.
 */
export default async function ArcoPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo(RUTA, sp);

  async function accionResponder(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await requireSessionTenant(RUTA);
    const resolucion = String(fd.get('resolucion') ?? '').trim();
    const solicitudId = String(fd.get('solicitudId') ?? '');
    if (!solicitudId) return { error: 'Falta la solicitud.' };
    if (resolucion.length < 5) return { error: 'Escribe la respuesta que se entrega al titular (qué se resolvió y cómo).' };
    try {
      const r = await resolverSolicitudArco(s.tenantId, solicitudId, resolucion);
      revalidatePath(RUTA);
      return r.enviada
        ? { ok: 'Solicitud resuelta y la respuesta se envió al titular por WhatsApp.' }
        : { ok: `Solicitud resuelta. La respuesta NO se pudo enviar por WhatsApp${r.error ? ` (${r.error})` : ''} — entrégala al titular por otro canal.` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'resolver la solicitud') };
    }
  }

  const solicitudes = await listarSolicitudesArco(tenantId).catch(() => []);
  const pendientes = solicitudes.filter((s) => s.estado === 'recibida' || s.estado === 'en_proceso');
  const vencenPronto = solicitudes.filter((s) => (s.estado === 'recibida' || s.estado === 'en_proceso') && s.venceEn <= new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10));

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <ShieldCheck width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Privacidad (ARCO)</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Solicitudes de tus operadores y cómo responderlas a tiempo (LFPDPPP art. 32: 20 días hábiles)
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiTile icono={<CircleAlert width={15} height={15} strokeWidth={1.75} />} etiqueta="Por responder" valor={pendientes.length} />
        <KpiTile icono={<CheckCircle2 width={15} height={15} strokeWidth={1.75} />} etiqueta="Vencen pronto (≤ 5 días)" valor={vencenPronto.length} />
      </div>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
            Solicitudes de tus operadores
          </h2>
          {solicitudes.length === 0 ? (
            <EstadoVacio>
              Ninguna solicitud ARCO registrada. Cuando un operador escribe *PRIVACIDAD* por WhatsApp, la solicitud
              queda registrada aquí y tú —la responsable— tienes 20 días hábiles para responder.
            </EstadoVacio>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="px-3 py-2.5 font-medium">Recibida</th>
                    <th className="px-3 py-2.5 font-medium">Derecho</th>
                    <th className="px-3 py-2.5 font-medium">Titular</th>
                    <th className="px-3 py-2.5 font-medium">Vence</th>
                    <th className="px-3 py-2.5 font-medium">Estado</th>
                    <th className="px-3 py-2.5 font-medium">Respuesta</th>
                  </tr>
                </thead>
                <tbody>
                  {solicitudes.map((s) => (
                    <tr key={s.id} className="border-t align-top" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-3 py-3">{fechaMx(s.recibidaEn)}</td>
                      <td className="px-3 py-3 font-medium">{ETIQUETA_TIPO[s.tipo] ?? s.tipo}</td>
                      <td className="px-3 py-3">
                        {s.operadorNombre ?? '—'}
                        <span className="block text-xs font-mono" style={{ color: 'var(--muted)' }}>{s.titularRef}</span>
                      </td>
                      <td className="px-3 py-3 tabular">{fechaMx(s.venceEn)}</td>
                      <td className="px-3 py-3">
                        <span className="text-xs font-semibold" style={{ color: s.estado === 'resuelta' || s.estado === 'improcedente' ? 'var(--color-ok)' : 'var(--color-warn)' }}>
                          {s.estado === 'resuelta' ? 'Resuelta' : s.estado === 'en_proceso' ? 'En proceso' : s.estado === 'improcedente' ? 'Improcedente' : 'Recibida'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {s.estado === 'resuelta' || s.estado === 'improcedente' ? (
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>{s.resolucion ?? '—'}</span>
                        ) : (
                          <FormaConAviso accion={accionResponder} boton="Responder" columnas="260px auto">
                            <input type="hidden" name="solicitudId" value={s.id} />
                            <input name="resolucion" placeholder="Qué se resolvió y cómo se entrega al titular" style={{ width: 260 }} />
                          </FormaConAviso>
                        )}
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
  );
}
