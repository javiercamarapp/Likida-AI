import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Truck } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar } from '@/lib/auth/permisos';
import { crearViaje } from '@/lib/likida/operacion';
import { listOperadores } from '@/lib/likida/repo';
import { logger } from '@/lib/logger';
import { BarraPagina } from '../../resumen-visual';
import { FormaViaje } from '../../forma-viaje';

export const dynamic = 'force-dynamic';

/**
 * Nuevo viaje — la SEGUNDA página reconstruida (12-ago-2026, pedida en
 * vivo: "que el botón de nuevo viaje funcione"). La forma es una pieza
 * compartida (`forma-viaje.tsx`) porque Despacho — la siguiente página —
 * la va a embeber tal cual.
 */
export default async function PaginaNuevoViaje({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/viajes/nuevo', sp);
  if (!puedeVerRuta(rol, '/dashboard/viajes/nuevo')) redirect('/dashboard');

  // Mismo contrato de sufijo que el sidebar: los redirects y el regreso
  // conservan ?tenant=/?vista= del superadmin.
  const base = sp.tenant ? `?tenant=${sp.tenant}` : sp.vista ? `?vista=${sp.vista}` : '';
  const sufijo = sp.rol ? `${base}${base ? '&' : '?'}rol=${sp.rol}` : base;

  const operadores = await listOperadores(tenantId).catch(() => []);

  async function crear(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
    'use server';
    // EL CHEQUEO SE REPITE ADENTRO (patrón del repo, [id]/page.tsx): el
    // gateo del render solo decidió pintar el formulario — esta action es
    // alcanzable por POST directo y re-verifica sesión y permiso.
    const sesion = await requireSessionTenant('/dashboard/viajes/nuevo');
    if (!puedeAsignar(sesion.rol)) {
      return { error: 'Tu rol no puede crear viajes. Pídeselo al dueño o al encargado de la flota.' };
    }

    const texto = (n: string, max: number) => {
      const v = fd.get(n);
      return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
    };
    const anticipoCrudo = fd.get('anticipo');
    const anticipo = typeof anticipoCrudo === 'string' && anticipoCrudo.trim() !== '' ? Number(anticipoCrudo) : 0;
    if (!Number.isFinite(anticipo) || anticipo < 0) {
      return { error: 'El anticipo tiene que ser un monto válido (o dejarse vacío).' };
    }
    const fecha = texto('fechaInicio', 10);
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return { error: 'La fecha de inicio no tiene un formato válido.' };
    }

    try {
      // `crearViaje` re-valida en el servidor que el operador sea de ESTA
      // flota (el candado de la auditoría 10) — aquí no se confía en el
      // <select>.
      await crearViaje(tenantId, {
        folio: texto('folio', 40),
        origen: texto('origen', 120),
        destino: texto('destino', 120),
        fechaInicio: fecha,
        anticipo,
        operadorId: texto('operadorId', 64),
      });
    } catch (err) {
      logger.error('nuevo_viaje.fallo', { err: err instanceof Error ? err.message : String(err) });
      return { error: 'No se pudo crear el viaje. Revisa los datos e inténtalo de nuevo.' };
    }
    redirect(`/dashboard${sufijo}`);
  }

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Nuevo viaje"
          derecha={
            <Link href={`/dashboard${sufijo}`}
              className="hairline inline-flex items-center gap-1.5 text-[13px] font-medium px-3 h-8 rounded-lg transition-colors hover:bg-[var(--canvas)]"
              style={{ background: 'var(--surface)' }}>
              <ArrowLeft width={14} height={14} strokeWidth={1.75} />
              Volver al Resumen
            </Link>
          }
        />
        <div className="px-5 py-5 flex-1">
          <div className="card p-4 max-w-xl">
            <p className="text-[13px] mb-4" style={{ color: 'var(--muted)' }}>
              El viaje nace <span className="font-medium">abierto</span>: desde ese momento el operador
              puede mandar sus comprobantes por WhatsApp y el motor los va cuadrando contra este anticipo.
            </p>
            <FormaViaje action={crear} operadores={operadores} />
          </div>
        </div>
      </div>
    </main>
  );
}
