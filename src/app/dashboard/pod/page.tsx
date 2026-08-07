import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { PackageCheck, TriangleAlert } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAsignar } from '@/lib/auth/permisos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverTenantPedido } from '@/lib/auth/tenant-api';
import { sendTemplate, motivoDeFalloWhatsApp } from '@/lib/meta/client';
import { getPods, marcarPodPedido, rechazarPod, type PodRow } from '@/lib/likida/operacion';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { sufijoTenant } from '../sufijo';
import { CifrasPod, TablaPod } from './vista';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * POD — qué entrega falta y a quién pedírsela.
 *
 * LA FOTO NO SE ENSEÑA, y es la misma decisión que ya se tomó con los
 * comprobantes (auditoría 9, crítico legal): conservar un documento y
 * exhibírselo a un humano no son el mismo acto. Guardarlo tiene base —es la
 * prueba de la entrega—; enseñarlo en un clic desde el panel no la tiene si
 * la imagen trae por accidente un dato sensible sin consentimiento expreso
 * (LFPDPPP art. 8). Por eso aquí hay estado, fecha y nota, pero no un botón
 * "Ver foto".
 *
 * Tampoco hay botón de "pedir por WhatsApp" que mande el mensaje: fuera de la
 * ventana de 24 h eso necesita una plantilla aprobada, y la cuenta no tiene
 * ninguna propia. Un botón que falla en silencio es peor que no tenerlo, así
 * que lo que se registra es que YA SE PIDIÓ — que es la distinción que el
 * encargado necesita para saber a quién insistirle.
 */
export default async function PodPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; ok?: string; envio?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/pod', sp);
  const sufijo = sufijoTenant(sp);
  const puede = puedeAsignar(rol);

  const pods = await safe<PodRow[]>(() => getPods(tenantId));

  async function tenantDelAction() {
    const s = await requireSessionTenant('/dashboard/pod');
    if (!puedeAsignar(s.rol)) redirect(`/dashboard/pod${sufijo}`);
    if (s.rol === 'superadmin' && sp?.tenant) {
      return await resolverTenantPedido(supabaseAdmin(), s.tenantId, sp.tenant);
    }
    return s.tenantId;
  }

  /**
   * Pide el POD — y ahora SÍ le manda el mensaje al chofer.
   *
   * SE REGISTRA AUNQUE EL ENVÍO FALLE, y ese orden importa. Lo que el encargado
   * necesita saber es a quién ya le insistió; si el registro dependiera de que
   * WhatsApp acepte, un fallo de Meta borraría ese rastro y volvería a pedirlo
   * mañana como si nada.
   *
   * PERO EL FALLO SE DICE. Antes esta pantalla explicaba que no mandaba nada;
   * ahora que manda, callar un rechazo sería peor que la nota anterior: el
   * encargado creería que el chofer ya fue avisado. `?envio=` lleva el motivo
   * traducido — la plantilla sin aprobar y el número fuera de la lista de
   * pruebas se leen igual de crípticos en crudo y se arreglan distinto.
   */
  async function accionPedir(formData: FormData) {
    'use server';
    const t = await tenantDelAction();
    const viajeId = String(formData.get('viajeId') ?? '');
    if (!viajeId) redirect(`/dashboard/pod${sufijo}`);

    const operadorId = String(formData.get('operadorId') ?? '') || null;
    await marcarPodPedido(t, viajeId, operadorId);

    let envio = 'sin_telefono';
    const telefono = String(formData.get('telefono') ?? '').trim();
    const folio = String(formData.get('folio') ?? '').trim();
    if (telefono) {
      const r = await sendTemplate(telefono, 'pod_pendiente', { parametros: folio ? [folio] : [] });
      envio = r.ok ? 'ok' : `err:${motivoDeFalloWhatsApp(r.error, r.codigo)}`;
    }

    revalidatePath('/dashboard/pod');
    const sep = sufijo ? `${sufijo}&` : '?';
    redirect(`/dashboard/pod${sep}ok=pedido&envio=${encodeURIComponent(envio)}`);
  }

  async function accionRechazar(formData: FormData) {
    'use server';
    const t = await tenantDelAction();
    const podId = String(formData.get('podId') ?? '');
    if (!podId) redirect(`/dashboard/pod${sufijo}`);
    await rechazarPod(t, podId, String(formData.get('nota') ?? '').trim() || null);
    revalidatePath('/dashboard/pod');
    redirect(`/dashboard/pod${sufijo ? `${sufijo}&` : '?'}ok=rechazado`);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <PackageCheck width={16} height={16} strokeWidth={1.75} />
        <div className="flex-1">
          <span className="text-sm font-medium block">POD & Evidencias</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Qué entrega no ha llegado, de quién es, y cuál llegó pero no sirve
          </span>
        </div>
        {sp.ok === 'pedido' && sp.envio === 'ok' && <StatusPill estado="ok">Mensaje enviado al chofer</StatusPill>}
        {sp.ok === 'pedido' && sp.envio === 'sin_telefono' && <StatusPill estado="warn">Anotado — el chofer no tiene teléfono</StatusPill>}
        {sp.ok === 'pedido' && sp.envio?.startsWith('err:') && <StatusPill estado="bad">Anotado, pero no se envió</StatusPill>}
        {sp.ok === 'rechazado' && <StatusPill estado="ok">Evidencia rechazada</StatusPill>}
      </header>

      {/* EL MOTIVO, NO SOLO QUE FALLÓ. "No se envió" sin decir por qué deja al
          encargado sin nada que hacer; con el motivo sabe si es cosa de Meta
          (plantilla en revisión), de la cuenta (número fuera de la lista de
          pruebas) o suya (el chofer no tiene teléfono). */}
      {sp.envio?.startsWith('err:') && (
        <div className="glass-panel px-5 py-3 flex items-start gap-2.5 text-sm" style={{ color: 'var(--bad)' }}>
          <TriangleAlert width={16} height={16} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>
            Quedó anotado que se pidió, pero el mensaje NO salió: {sp.envio.slice(4)}
          </span>
        </div>
      )}
      {sp.envio === 'sin_telefono' && sp.ok === 'pedido' && (
        <div className="glass-panel px-5 py-3 flex items-start gap-2.5 text-sm" style={{ color: 'var(--warn)' }}>
          <TriangleAlert width={16} height={16} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>
            Quedó anotado, pero ese viaje no trae chofer con teléfono registrado, así que no había a quién
            escribirle. Se le registra el número en Operadores.
          </span>
        </div>
      )}

      {pods === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudo leer el estado de las evidencias.
        </div>
      ) : (
        <>
          <CifrasPod pods={pods} />
          <section className="glass-panel overflow-hidden">
            <div className="px-5 pt-5 pb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Viajes en curso
              </h2>
            </div>
            <TablaPod
              pods={pods}
              accionPedir={puede ? accionPedir : undefined}
              accionRechazar={puede ? accionRechazar : undefined}
            />
          </section>
        </>
      )}

      <div className="px-1">
        <EstadoVacio>
          La foto de la entrega se guarda pero no se muestra aquí: conservar un documento y exhibírselo a una
          persona no son el mismo acto, y es el mismo criterio que ya se aplicó a los comprobantes.
          <br /><br />
          Pedir el POD ahora SÍ le manda el mensaje al chofer, con la plantilla <code>pod_pendiente</code>. Si Meta
          lo rechaza —plantilla sin aprobar, o número fuera de la lista de pruebas mientras la cuenta siga en modo
          prueba— se dice arriba con el motivo: queda anotado que se pidió, pero no se finge que el chofer se enteró.
        </EstadoVacio>
      </div>
    </div>
  );
}
