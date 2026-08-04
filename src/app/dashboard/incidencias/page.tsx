import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { TriangleAlert, Plus } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAsignar } from '@/lib/auth/permisos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getViajes, type ViajeRow } from '@/lib/cuadra/analytics';
import {
  getIncidencias, getUnidades, crearIncidencia, cambiarEstadoIncidencia,
  type IncidenciaRow, type UnidadRow,
} from '@/lib/cuadra/operacion';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { sufijoTenant } from '../sufijo';
import { CifrasIncidencias, TablaIncidencias, FormaIncidencia, TIPOS, PRIORIDADES, ESTADOS } from './vista';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * INCIDENCIAS — lo que se salió de lo normal, con dueño y con reloj.
 *
 * La tabla nació en la 0047 con dos constraints que esta página respeta en
 * vez de pelear: los dominios de tipo/prioridad/estado (se validan aquí antes
 * de escribir, para dar un redirect y no un 500), y `incidencia_cierre_
 * coherente`, que exige que una resuelta tenga fecha de cierre — por eso el
 * cambio de estado pasa por `cambiarEstadoIncidencia`, que la pone, y no por
 * un update suelto que la olvidaría.
 */
export default async function IncidenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/incidencias', sp);
  const sufijo = sufijoTenant(sp);
  const puede = puedeAsignar(rol);

  const [incidencias, viajes, unidades] = await Promise.all([
    safe<IncidenciaRow[]>(() => getIncidencias(tenantId)),
    safe<ViajeRow[]>(() => getViajes(tenantId)),
    safe<UnidadRow[]>(() => getUnidades(tenantId)),
  ]);

  async function tenantDelAction() {
    const s = await requireSessionTenant('/dashboard/incidencias');
    if (!puedeAsignar(s.rol)) redirect(`/dashboard/incidencias${sufijo}`);
    if (s.rol === 'superadmin' && sp?.tenant) {
      const { data } = await supabaseAdmin().from('tenant').select('id').eq('id', sp.tenant).maybeSingle();
      if (data) return data.id as string;
    }
    return s.tenantId;
  }

  async function accionEstado(formData: FormData) {
    'use server';
    const t = await tenantDelAction();
    const incidenciaId = String(formData.get('incidenciaId') ?? '');
    const estado = String(formData.get('estado') ?? '');
    if (!incidenciaId || !(estado in ESTADOS)) redirect(`/dashboard/incidencias${sufijo}`);
    await cambiarEstadoIncidencia(t, incidenciaId, estado);
    revalidatePath('/dashboard/incidencias');
    redirect(`/dashboard/incidencias${sufijo ? `${sufijo}&` : '?'}ok=movida`);
  }

  async function accionCrear(formData: FormData) {
    'use server';
    const t = await tenantDelAction();
    const tipo = String(formData.get('tipo') ?? '');
    const prioridad = String(formData.get('prioridad') ?? 'media');
    if (!(tipo in TIPOS) || !(prioridad in PRIORIDADES)) redirect(`/dashboard/incidencias${sufijo}`);

    // El SLA es OPCIONAL y se guarda como null cuando viene vacío. Un 0 haría
    // que naciera vencida en el mismo instante en que se levanta.
    const slaBruto = String(formData.get('slaHoras') ?? '').trim();
    const slaHoras = slaBruto === '' ? null : Number(slaBruto);
    if (slaHoras !== null && (!Number.isInteger(slaHoras) || slaHoras < 1)) {
      redirect(`/dashboard/incidencias${sufijo}`);
    }

    await crearIncidencia(t, {
      tipo,
      prioridad,
      viajeId: String(formData.get('viajeId') ?? '') || null,
      unidadId: String(formData.get('unidadId') ?? '') || null,
      descripcion: String(formData.get('descripcion') ?? '').trim() || null,
      slaHoras,
    });
    revalidatePath('/dashboard/incidencias');
    redirect(`/dashboard/incidencias${sufijo ? `${sufijo}&` : '?'}ok=creada`);
  }

  // Solo se ofrecen viajes SIN LIQUIDAR: levantar una incidencia contra un
  // viaje ya cerrado no cambia nada operativo y ensucia el selector.
  const viajesAbiertos = (viajes ?? [])
    .filter((v) => v.estatus !== 'liquidado')
    .map((v) => ({ id: v.id, folio: v.folio }));
  const unidadesActivas = (unidades ?? [])
    .filter((u) => u.activo)
    .map((u) => ({ id: u.id, numeroEconomico: u.numeroEconomico }));

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <TriangleAlert width={16} height={16} strokeWidth={1.75} />
        <div className="flex-1">
          <span className="text-sm font-medium block">Incidencias</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Retrasos, averías, daños, faltantes y desvíos — con dueño y con reloj
          </span>
        </div>
        {sp.ok === 'movida' && <StatusPill estado="ok">Estado actualizado</StatusPill>}
        {sp.ok === 'creada' && <StatusPill estado="ok">Incidencia levantada</StatusPill>}
      </header>

      {incidencias === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudo leer la bandeja de incidencias.
        </div>
      ) : (
        <>
          <CifrasIncidencias incidencias={incidencias} />

          <section className="glass-panel overflow-hidden">
            <div className="px-5 pt-5 pb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Bandeja
              </h2>
            </div>
            <TablaIncidencias incidencias={incidencias} accionEstado={puede ? accionEstado : undefined} />
          </section>

          {puede && (
            <section className="glass-panel p-5">
              <div className="flex items-center gap-2 mb-3">
                <Plus width={15} height={15} strokeWidth={1.75} />
                <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                  Levantar una incidencia
                </h2>
              </div>
              <FormaIncidencia viajes={viajesAbiertos} unidades={unidadesActivas} accion={accionCrear} />
            </section>
          )}
        </>
      )}

      <div className="px-1">
        <EstadoVacio>
          El escalamiento automático y el aviso al chofer cuando se vence un SLA todavía no existen: hoy la bandeja
          marca el vencimiento pero no le avisa a nadie sola. El responsable tampoco se puede asignar desde aquí —la
          columna existe en la tabla, pero no hay selector de usuarios en este panel.
        </EstadoVacio>
      </div>
    </div>
  );
}
