import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { Wrench, Plus } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAsignar } from '@/lib/auth/permisos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getUnidades, crearUnidad, cambiarEstadoUnidad, type UnidadRow } from '@/lib/cuadra/operacion';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { sufijoTenant } from '../sufijo';
import { CifrasUnidades, TablaUnidades, FormaUnidad } from './vista';

export const dynamic = 'force-dynamic';

/** Los cuatro valores que admite `unidad_estado_dominio` (0047). Se valida
 *  aquí ADEMÁS del constraint: un valor fuera del dominio lo rechaza la base
 *  con un 500 feo, y el encargado solo vería "algo falló". */
const ESTADOS = new Set(['disponible', 'en_ruta', 'taller', 'baja']);

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * UNIDADES — el expediente operativo del vehículo.
 *
 * Hasta la migración 0047 esta página era un `SeccionPendiente` que decía la
 * verdad: no existía registro de vehículos, ni `viaje` guardaba cuál lo hizo.
 * Ya existe, así que la página deja de anunciar el hueco y lo llena.
 *
 * Lo que sigue faltando se dice abajo, no se disfraza: el COSTO por unidad
 * (no hay dónde registrar el gasto de un servicio) y el DVIR con foto (la
 * tabla `mantenimiento` acepta el tipo 'dvir', pero no hay subida de imagen
 * ni pantalla para que el operador la haga desde WhatsApp).
 */
export default async function UnidadesPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/unidades', sp);
  const sufijo = sufijoTenant(sp);
  const puede = puedeAsignar(rol);

  const unidades = await safe<UnidadRow[]>(() => getUnidades(tenantId));

  async function tenantDelAction() {
    const s = await requireSessionTenant('/dashboard/unidades');
    if (!puedeAsignar(s.rol)) redirect(`/dashboard/unidades${sufijo}`);
    if (s.rol === 'superadmin' && sp?.tenant) {
      const { data } = await supabaseAdmin().from('tenant').select('id').eq('id', sp.tenant).maybeSingle();
      if (data) return data.id as string;
    }
    return s.tenantId;
  }

  async function accionEstado(formData: FormData) {
    'use server';
    const t = await tenantDelAction();
    const unidadId = String(formData.get('unidadId') ?? '');
    const estado = String(formData.get('estado') ?? '');
    if (!unidadId || !ESTADOS.has(estado)) redirect(`/dashboard/unidades${sufijo}`);
    await cambiarEstadoUnidad(t, unidadId, estado);
    revalidatePath('/dashboard/unidades');
    redirect(`/dashboard/unidades${sufijo ? `${sufijo}&` : '?'}ok=movida`);
  }

  async function accionAlta(formData: FormData) {
    'use server';
    const t = await tenantDelAction();
    const numeroEconomico = String(formData.get('numeroEconomico') ?? '').trim();
    // Es lo ÚNICO obligatorio: es como la flota llama a la unidad en la radio
    // y en el papel, y la 0047 lo hace único por tenant. Sin él, la fila no
    // se puede nombrar en ninguna pantalla.
    if (!numeroEconomico) redirect(`/dashboard/unidades${sufijo}`);
    const anioBruto = String(formData.get('anio') ?? '').trim();
    const anio = anioBruto === '' ? null : Number(anioBruto);
    if (anio !== null && !Number.isInteger(anio)) redirect(`/dashboard/unidades${sufijo}`);

    await crearUnidad(t, {
      numeroEconomico,
      placas: String(formData.get('placas') ?? '').trim() || null,
      marca: String(formData.get('marca') ?? '').trim() || null,
      modelo: String(formData.get('modelo') ?? '').trim() || null,
      anio,
    });
    revalidatePath('/dashboard/unidades');
    redirect(`/dashboard/unidades${sufijo ? `${sufijo}&` : '?'}ok=alta`);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Wrench width={16} height={16} strokeWidth={1.75} />
        <div className="flex-1">
          <span className="text-sm font-medium block">Unidades</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Dónde está cada unidad, qué papel se le vence y cuál trae orden de taller
          </span>
        </div>
        {sp.ok === 'movida' && <StatusPill estado="ok">Estado actualizado</StatusPill>}
        {sp.ok === 'alta' && <StatusPill estado="ok">Unidad dada de alta</StatusPill>}
      </header>

      {unidades === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudo leer el listado de unidades.
        </div>
      ) : (
        <>
          <CifrasUnidades unidades={unidades} />

          <section className="glass-panel overflow-hidden">
            <div className="px-5 pt-5 pb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Toda la flota
              </h2>
            </div>
            <TablaUnidades unidades={unidades} accionEstado={puede ? accionEstado : undefined} />
          </section>

          {puede && (
            <section className="glass-panel p-5">
              <div className="flex items-center gap-2 mb-3">
                <Plus width={15} height={15} strokeWidth={1.75} />
                <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                  Dar de alta una unidad
                </h2>
              </div>
              <FormaUnidad accion={accionAlta} />
            </section>
          )}
        </>
      )}

      <div className="px-1">
        <EstadoVacio>
          Las fechas de póliza, permiso SICT y verificación ya tienen dónde guardarse, pero todavía no se capturan
          desde aquí: hoy entran por base de datos. Lo que sí falta de raíz es el <strong>costo por unidad</strong>
          {' '}—no hay dónde registrar lo que costó un servicio— y el <strong>DVIR con foto</strong>: la tabla acepta
          ese tipo de orden, pero no hay subida de imagen ni forma de que el operador la haga desde WhatsApp. La
          calibración por placa (km/L y tanque esperado, que usa el motor de cuadre) sigue viviendo aparte, en{' '}
          <Link href={`/dashboard/configuracion${sufijo}`} className="underline">Configuración</Link>.
        </EstadoVacio>
      </div>
    </div>
  );
}
