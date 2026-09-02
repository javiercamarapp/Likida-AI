import { ShieldCheck, FileWarning, CheckCircle2, CircleAlert } from 'lucide-react';
import { EstadoVacio, StatCard, StatusPill, type Estado } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { requireSuperadmin } from '@/lib/auth/guard';
import { revalidatePath } from 'next/cache';
import { resolverSolicitudArco } from '@/lib/likida/repo';
import { fechaMx, hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { traerTodo, conteo } from '@/lib/likida/pg';
import { getSolicitudesArcoPendientes } from '@/lib/admin/escalaciones';
import { agregarDiasHabiles } from '@/lib/admin/dias-habiles';
import { mensajeParaPantalla } from '@/lib/likida/administracion';

export const dynamic = 'force-dynamic';

const ETIQUETA_TIPO: Record<string, string> = {
  acceso: 'Acceso', rectificacion: 'Rectificación', cancelacion: 'Cancelación', oposicion: 'Oposición',
};
/** `solicitud_arco.estado` como pill del kit — resuelta en verde, pendiente en
 *  ámbar, improcedente en neutro. Un estado fuera del catálogo se pinta crudo
 *  en neutro: visible, no roto. */
const PILL_ARCO: Record<string, { estado: Estado; etiqueta: string }> = {
  recibida: { estado: 'warn', etiqueta: 'Recibida' },
  en_proceso: { estado: 'warn', etiqueta: 'En proceso' },
  resuelta: { estado: 'ok', etiqueta: 'Resuelta' },
  improcedente: { estado: 'neutral', etiqueta: 'Improcedente' },
};

/**
 * Compliance & Datos — la flota ve sus solicitudes ARCO (registradas cuando un
 * operador escribe PRIVACIDAD por WhatsApp) y responde la que le toca. AUDITORÍA
 * 14: las solicitudes se registraban pero nadie podía verlas; la responsable
 * obligada a contestar en 20 días hábiles (LFPDPPP art. 31) estaba ciega.
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
    //
    // ADM-10 (auditoría 24, MEDIO): el `error` de esta lectura se descartaba
    // — una base caída y una solicitud inexistente se pintaban con el MISMO
    // mensaje ("La solicitud no existe."), que es "fallar cerrado" pero
    // mintiendo sobre el porqué: quien lo lee busca la solicitud a mano y no
    // la encuentra porque la lectura ni siquiera corrió.
    const { data: sol, error: errSol } = await supabaseAdmin().from('solicitud_arco').select('tenant_id').eq('id', solicitudId).maybeSingle();
    if (errSol) return { error: `No se pudo leer la solicitud — ${errSol.message}. Intenta de nuevo.` };
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

  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ShieldCheck {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo="Compliance & Datos"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <StatCard icono={<CircleAlert {...ICONO} />}
              etiqueta="Solicitudes ARCO por responder" valor={pendientes.length} formato="entero"
            />
            <StatCard icono={<CheckCircle2 {...ICONO} />}
              etiqueta="Vencen pronto (≤ 5 días hábiles)" valor={pendientesVencen} formato="entero"
            />
          </div>

          <div className="card p-3">
            <TituloSeccion>Solicitudes ARCO del operador</TituloSeccion>
            {solicitudes.length === 0 ? (
              <div className="mt-2">
                <EstadoVacio>
                  Ninguna solicitud ARCO registrada. Cuando un operador escribe *PRIVACIDAD* por WhatsApp, la solicitud
                  queda registrada aquí y la flota —la responsable— tiene 20 días hábiles para responder.
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-3 py-2 font-medium">Recibida</th>
                      <th className="px-3 py-2 font-medium">Flota</th>
                      <th className="px-3 py-2 font-medium">Derecho</th>
                      <th className="px-3 py-2 font-medium">Titular</th>
                      <th className="px-3 py-2 font-medium">Vence</th>
                      <th className="px-3 py-2 font-medium">Estado</th>
                      <th className="px-3 py-2 font-medium">Resolución</th>
                    </tr>
                  </thead>
                  <tbody>
                    {solicitudes.map((s) => {
                      const pill = PILL_ARCO[s.estado] ?? { estado: 'neutral' as Estado, etiqueta: s.estado };
                      return (
                        <tr key={s.id} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                          <td className="px-3 py-2.5">{fechaMx(s.recibidaEn)}</td>
                          <td className="px-3 py-2.5">{s.flotaNombre}</td>
                          <td className="px-3 py-2.5 font-medium">{ETIQUETA_TIPO[s.tipo] ?? s.tipo}</td>
                          <td className="px-3 py-2.5">
                            {s.operadorNombre ?? '—'}
                            <span className="block text-xs font-mono" style={{ color: 'var(--muted)' }}>{s.titularRef}</span>
                          </td>
                          <td className="px-3 py-2.5 tabular">{fechaMx(s.venceEn)}</td>
                          <td className="px-3 py-2.5"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></td>
                          <td className="px-3 py-2.5">
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
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <EstadoVacio icono={<FileWarning width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            La retención de comprobantes (CFF 30: conservar 5 años) y el catálogo de avisos por versión siguen sin
            flujo construido — se documenta en lugar de inventarlo. Las solicitudes ARCO están operativas: las
            registra el webhook cuando un operador escribe PRIVACIDAD, se resuelven aquí, y la respuesta se intenta
            enviar al titular por WhatsApp (plantilla `respuesta_arco` en revisión de Meta).
          </EstadoVacio>
        </div>
      </div>
    </main>
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
    // La MISMA lectura de pendientes que la bandeja de escalaciones —
    // extraída a lib/admin/escalaciones.ts para no contarlas dos veces con
    // dos consultas que puedan divergir.
    getSolicitudesArcoPendientes(),
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
  // DAT-08 (auditoría prod): el corte era el día UTC. De 18:00 a 24:00 hora de
  // México el "dentro de 5 días" era en realidad dentro de 6, y el plazo del
  // art. 31 de la LFPDPPP se cuenta en días de México.
  const corte = agregarDiasHabiles(hoyMx(new Date(ahoraMs())), 5);
  const vence = pendientes.filter((p) => p.venceEn <= corte).length;
  return { solicitudes: mapeadas as SolicitudArcoPanel[], pendientesVencen: vence };
}
