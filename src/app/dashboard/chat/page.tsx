import { getKpis, getAcreditables, type DashboardKpis, type Acreditables } from '@/lib/cuadra/analytics';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { EstadoVacio } from '@/app/admin/ui/kit';
import ChatFlota from '../chat';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Chatea con tus datos (PASO 8) — la versión de página completa del mismo
 * chat que vive en el rail del Asistente.
 *
 * Responde por coincidencia de palabras clave contra cifras YA calculadas en
 * el servidor, NO traduciendo lenguaje natural a SQL. Esa diferencia es
 * deliberada: un cuadro de texto con línea directa a la base, corriendo con
 * permisos de servicio en una app multi-tenant, es el vector de inyección
 * que la propia auditoría de este repo persigue. Cuando haga falta contestar
 * algo que la lista no cubre, se agranda la lista.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/chat', sp);

  // ── EL GEMELO SIN PARCHAR ────────────────────────────────────────────────
  //
  // El rail del asistente (`/api/dashboard/asistente`) ya cierra esto: sin área
  // `dinero` no se leen KPIs. Esta página —la MISMA pregunta, en pantalla
  // completa— no lo hacía, y su ruta está clasificada como `operacion`, así que
  // el ENCARGADO entraba por el link de su propio sidebar.
  //
  // Lo que recibía: `getKpis` y `getAcreditables` corren con `supabaseAdmin()`,
  // que salta RLS. Escribiendo "iva" le contestaba el IVA acreditable de la
  // flota; escribiendo "cuánto llevo", el total comprobado. Y aunque no
  // escribiera nada, las dos cifras ya habían viajado en el payload.
  //
  // Son literalmente los mismos campos que la matriz de la 0044 le niega en
  // pantalla. Se comprueba ANTES de consultar, no después: un 403 que ya trajo
  // el dato no sirve de nada.
  if (!puedeVerArea(rol, 'dinero')) {
    return (
      <div className="h-full min-h-[560px] flex items-center">
        <EstadoVacio>
          Este chat responde sobre dinero. Tu rol ve la operación —viajes, choferes,
          unidades, entregas— pero no las cifras de dinero de la flota. Si necesitas
          una consulta fiscal, pídesela a quien lleva la contabilidad.
        </EstadoVacio>
      </div>
    );
  }

  const [kpis, acred] = await Promise.all([
    safe<DashboardKpis>(() => getKpis(tenantId)),
    safe<Acreditables>(() => getAcreditables(tenantId)),
  ]);

  // Un solo recuadro: el de escribir. El encabezado y la nota de límites
  // siguen ahí —son obligatorios, no decorativos— pero como texto sobre el
  // lienzo, no como dos tarjetas más. Los tres `glass-panel` apilados hacían
  // que la página se leyera como un formulario y no como una pregunta.
  return (
    <div className="h-full min-h-[560px]">
      <ChatFlota kpis={kpis} acred={acred} variante="hero" />
    </div>
  );
}
