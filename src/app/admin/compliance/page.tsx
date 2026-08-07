import { ShieldCheck, FileWarning, CheckCircle2, CircleAlert } from 'lucide-react';
import { EstadoVacio, KpiTile } from '../ui/kit';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { requireSuperadmin } from '@/lib/auth/guard';
import { revalidatePath } from 'next/cache';
import { listarSolicitudesArco, resolverSolicitudArco } from '@/lib/likida/repo';
import { fechaMx } from '@/lib/formato';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { traerTodo, conteo } from '@/lib/likida/pg';
import { mensajeParaPantalla } from '@/lib/likida/administracion';

export const dynamic = 'force-dynamic';

const ETIQUETA_TIPO: Record<string, string> = {
  acceso: 'Acceso', rectificacion: 'Rectificación', cancelacion: 'Cancelación', oposicion: 'Oposición',
};
const ETIQUETA_ESTADO: Record<string, string> = {
  recibida: 'Recibida', en_proceso: 'En proceso', resuelta: 'Resuelta', improcedente: 'Improcedente',
};

/**
 * Compliance & Datos — la flota ve sus solicitudes ARCO (registradas cuando un
 * operador escribe PRIVACIDAD por WhatsApp) y responde la que le toca. AUDITORÍA
 * 14: las solicitudes se registraban pero nadie podía verlas; la responsable
 * obligada a contestar en 20 días hábiles (LFPDPPP art. 32) estaba ciega.
 */
export default async function CompliancePage() {
  async function accionResolver(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    await requireSuperadmin();
    const solicitudId = String(fd.get('solicitudId') ?? '');
    const resolucion = String(fd.get('resolucion') ?? '').trim();
    if (!solicitudId) return { error: 'Falta la solicitud.' };
    if (resolucion.length < 5) return { error: 'Escribe la resolución (a quién se respondió y qué).' };
    // El tenant: la solicitud se resuelve bajo la flota responsable. Se busca
    // el tenant de la solicitud para no depender del orden del listado.
    const { data: sol } = await supabaseAdmin().from('solicitud_arco').select('tenant_id').eq('id', solicitudId).maybeSingle();
    if (!sol?.tenant_id) return { error: 'La solicitud no existe.' };
    try {
      await resolverSolicitudArco(sol.tenant_id as string, solicitudId, resolucion);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'resolver la solicitud') };
    }
    revalidatePath('/admin/compliance');
    return { ok: 'Solicitud marcada como resuelta. La respuesta se intentó enviar al titular por WhatsApp (texto libre o plantilla); si no salió, entrégala por el canal que la flota defina.' };
  }

  const { solicitudes, pendientesVencen } = await datosDeCompliance();
  const pendientes = solicitudes.filter((s) => s.estado === 'recibida' || s.estado === 'en_proceso');
  // AUDITORÍA 15, CRÍTICO: la pantalla vive en /admin (superadmin), cuyo
  // tenant de sesión es null — filtrar por tenant dejaba la pantalla SIEMPRE
  // vacía. El superadmin ve TODAS las flotas, con una columna de flota. La
  // flota responsable tendrá su propia ruta en /dashboard (decisión de la 16).

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <ShieldCheck width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Compliance & Datos</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>ARCO, retención y manejo de datos fiscales/personales</span>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiTile icono={<CircleAlert width={15} height={15} strokeWidth={1.75} />} etiqueta="Solicitudes ARCO por responder" valor={pendientes.length} />
        <KpiTile icono={<CheckCircle2 width={15} height={15} strokeWidth={1.75} />} etiqueta="Vencen pronto (≤ 5 días hábiles)" valor={pendientesVencen} />
      </div>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
            Solicitudes ARCO del operador
          </h2>
          {solicitudes.length === 0 ? (
            <EstadoVacio>
              Ninguna solicitud ARCO registrada. Cuando un operador escribe *PRIVACIDAD* por WhatsApp, la solicitud
              queda registrada aquí y la flota —la responsable— tiene 20 días hábiles para responder.
            </EstadoVacio>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="px-3 py-2.5 font-medium">Recibida</th>
                    <th className="px-3 py-2.5 font-medium">Flota</th>
                    <th className="px-3 py-2.5 font-medium">Derecho</th>
                    <th className="px-3 py-2.5 font-medium">Titular</th>
                    <th className="px-3 py-2.5 font-medium">Vence</th>
                    <th className="px-3 py-2.5 font-medium">Estado</th>
                    <th className="px-3 py-2.5 font-medium">Resolución</th>
                  </tr>
                </thead>
                <tbody>
                  {solicitudes.map((s) => (
                    <tr key={s.id} className="border-t align-top" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-3 py-3">{fechaMx(s.recibidaEn)}</td>
                      <td className="px-3 py-3">{s.flotaNombre}</td>
                      <td className="px-3 py-3 font-medium">{ETIQUETA_TIPO[s.tipo] ?? s.tipo}</td>
                      <td className="px-3 py-3">
                        {s.operadorNombre ?? '—'}
                        <span className="block text-xs font-mono" style={{ color: 'var(--muted)' }}>{s.titularRef}</span>
                      </td>
                      <td className="px-3 py-3 tabular">{fechaMx(s.venceEn)}</td>
                      <td className="px-3 py-3">
                        <span className="text-xs font-semibold" style={{ color: s.estado === 'resuelta' ? 'var(--color-ok)' : 'var(--color-warn)' }}>
                          {ETIQUETA_ESTADO[s.estado] ?? s.estado}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {s.estado === 'resuelta' || s.estado === 'improcedente' ? (
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>{s.resolucion ?? '—'}</span>
                        ) : (
                          <FormaConAviso accion={accionResolver} boton="Responder" columnas="220px auto">
                            <input type="hidden" name="solicitudId" value={s.id} />
                            <input name="resolucion" placeholder="A quién se respondió y qué" style={{ width: 220 }} />
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

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio icono={<FileWarning width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            La retención de comprobantes (CFF 30: conservar 5 años) y el catálogo de avisos por versión siguen sin
            flujo construido — se documenta en lugar de inventarlo. Las solicitudes ARCO están operativas: las
            registra el webhook cuando un operador escribe PRIVACIDAD, se resuelven aquí, y la respuesta se intenta
            enviar al titular por WhatsApp (plantilla `respuesta_arco` en revisión de Meta).
          </EstadoVacio>
        </section>
      </div>
    </div>
  );
}

// ── Datos del server component (sin hooks de cliente) ───────────────────────
interface SolicitudArcoPanel {
  id: string; tipo: string; estado: string; titularRef: string; recibidaEn: string;
  venceEn: string; resueltaEn: string | null; resolucion: string | null;
  operadorNombre: string | null; flotaNombre: string;
}

async function datosDeCompliance(): Promise<{ solicitudes: SolicitudArcoPanel[]; pendientesVencen: number }> {
  const { getSessionTenant } = await import('@/lib/auth/session');
  const s = await getSessionTenant();
  if (!s) return { solicitudes: [], pendientesVencen: 0 };
  // El superadmin ve TODAS las flotas (su tenant es null por diseño). La
  // columna de flota viene del join con tenant.
  const [solicitudes, pendientes] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => supabaseAdmin().from('solicitud_arco').select(
        'id, tipo, canal, estado, titular_ref, recibida_en, vence_en, resuelta_en, resolucion, tenant_id, operador:operador_id(nombre), flota:tenant_id(nombre)', conteo(d),
      ).order('recibida_en', { ascending: false }).order('id', { ascending: false }).range(d, h),
      'compliance.todas',
    ),
    traerTodo<{ vence_en: unknown }>(
      (d, h) => supabaseAdmin().from('solicitud_arco').select('vence_en', conteo(d))
        .in('estado', ['recibida', 'en_proceso']).order('id').range(d, h),
      'compliance.pendientes',
    ),
  ]);
  const mapeadas = solicitudes.map((f) => ({
    id: f.id as string,
    tipo: f.tipo as string,
    canal: (f.canal as string | null) ?? 'whatsapp',
    estado: f.estado as string,
    titularRef: (f.titular_ref as string | null) ?? '',
    recibidaEn: f.recibida_en as string,
    venceEn: f.vence_en as string,
    resueltaEn: (f.resuelta_en as string | null) ?? null,
    resolucion: (f.resolucion as string | null) ?? null,
    operadorNombre: ((f.operador as { nombre?: string } | null)?.nombre) ?? null,
    flotaNombre: ((f.flota as { nombre?: string } | null)?.nombre) ?? '—',
  }));
  const vence = pendientes.filter((f) => (f.vence_en as string) <= new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)).length;
  return { solicitudes: mapeadas as SolicitudArcoPanel[], pendientesVencen: vence };
}
