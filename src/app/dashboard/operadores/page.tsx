import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getOperadoresDetalle } from '@/lib/likida/analytics';
import { ahoraMs } from '@/lib/saludo';
import { TZ_MX } from '@/lib/formato';
import { VistaOperadores, type FilaOperador } from './vista';

export const dynamic = 'force-dynamic';

/**
 * Registro de Operadores (F2 del plan). Área `operacion` y por eso el mapeo
 * de abajo DEJA EN EL SERVIDOR el dinero que `getOperadoresDetalle` trae
 * (anticipoTotal, comprobadoTotal, pctComprobado): fue exactamente la fuga
 * del 4-ago-2026 — "anticipo entregado, comprobado y % por chofer" a la
 * vista del encargado. El dinero por operador vive en el Agente de
 * Liquidación, que sí es pantalla de `dinero`.
 *
 * Lo que SÍ enseña es lo que en la referencia se llama "vigencias que anclan": la
 * licencia (0053) contra el día de México — y "sin registrar" cuando es
 * null, que no es lo mismo que vencida.
 */
export default async function PaginaOperadores({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/operadores', sp);
  if (!puedeVerRuta(rol, '/dashboard/operadores')) redirect('/dashboard');

  const detalle = await getOperadoresDetalle(tenantId);

  const filas: FilaOperador[] = detalle.map((o) => ({
    operadorId: o.operadorId,
    nombre: o.nombre,
    telefono: o.telefono,
    numeroEmpleado: o.numeroEmpleado,
    activo: o.activo,
    viajes: o.viajes,
    licenciaTipo: o.licenciaTipo,
    licenciaVence: o.licenciaVence,
  }));

  // El día del CHOFER (México), no el UTC del servidor — a las 6pm de CDMX
  // una licencia que vence "hoy" ya se marcaba vencida con el día UTC.
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: TZ_MX }).format(new Date(ahoraMs()));

  return <VistaOperadores filas={filas} hoy={hoy} />;
}
