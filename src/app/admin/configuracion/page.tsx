import { getResumenNegocio } from '@/lib/admin/negocio';
import { Settings } from 'lucide-react';
import { EstadoVacio } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';

export const dynamic = 'force-dynamic';

/**
 * Configuración / Planes & Continuidad — lo real es la etiqueta de plan de
 * cada flota, que ya vive en `tenant.plan` (`getResumenNegocio().flotas`,
 * el mismo dato que enseña la tabla de Flotas en Inicio, aquí enfocado
 * solo en el plan). No hay lógica de límites detrás: es texto, no un
 * sistema de billing.
 */
export default async function ConfiguracionPage() {
  const r = await getResumenNegocio();

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Settings width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Configuración — planes y continuidad"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <div className="card p-3">
            <TituloSeccion>Planes por flota</TituloSeccion>
            {r.flotas.length === 0 ? (
              <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>Sin flotas dadas de alta todavía.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {r.flotas.map((f) => (
                  <div key={f.id} className="hairline rounded-lg px-3 py-2.5 flex items-center justify-between gap-4" style={{ background: 'var(--surface)' }}>
                    <span className="text-[13px] font-medium">{f.nombre}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full hairline" style={{ background: 'var(--canvas)' }}>
                      {f.plan}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* ADM-5 (auditoría 24): esta tarjeta pintaba `tenant.plan` (una
                etiqueta de texto suelta) y afirmaba "sin lógica de límites
                detrás" — falso: `lib/saas/suscripcion.ts` (`getUso`) SÍ
                calcula uso vs. `limite_viajes_mes`/`limite_operadores` por
                suscripción, solo que esta pantalla no la lee todavía. */}
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              El plan de arriba es la etiqueta de texto en <code className="font-mono">tenant.plan</code>. La lógica
              de límites y uso REAL vive en <code className="font-mono">lib/saas/suscripcion.ts</code> (suscripción y
              plan por flota, con precio y tope de viajes/operadores) — esta pantalla todavía no la muestra por
              flota; editar precio/límites y upgrade/downgrade desde aquí no existen hoy.
            </p>
          </div>

          <EstadoVacio>
            Backups, disaster recovery, residencia de datos — gestionados por Supabase/Vercel a nivel de
            infraestructura, sin panel propio aquí; si hace falta detalle, se consulta directo en sus dashboards.
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
