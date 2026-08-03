import { Sparkles } from 'lucide-react';
import { getKpis, getAcreditables, type DashboardKpis, type Acreditables } from '@/lib/cuadra/analytics';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { EstadoVacio } from '../../admin/ui/kit';
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
  const { tenantId } = await resolverTenantEfectivo('/dashboard/chat', sp);

  const [kpis, acred] = await Promise.all([
    safe<DashboardKpis>(() => getKpis(tenantId)),
    safe<Acreditables>(() => getAcreditables(tenantId)),
  ]);

  return (
    <div className="flex flex-col gap-4 h-full">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4 shrink-0">
        <Sparkles width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Chatea con tus Datos</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Pregunta en español sobre lo que tu flota ya comprobó
          </span>
        </div>
      </header>

      <div className="flex-1 min-h-[420px]">
        <ChatFlota kpis={kpis} acred={acred} />
      </div>

      <div className="glass-panel p-5 shrink-0">
        <EstadoVacio>
          Contesta sobre lo comprobado, diferencias, diésel, IVA, peaje y tu tasa de cuadre — que es lo que hay
          medido. No traduce preguntas libres a consultas de base de datos a propósito: eso abriría una línea
          directa desde un cuadro de texto hasta tus datos y los de otras flotas. Generar una gráfica o una tabla
          como respuesta todavía no existe.
        </EstadoVacio>
      </div>
    </div>
  );
}
