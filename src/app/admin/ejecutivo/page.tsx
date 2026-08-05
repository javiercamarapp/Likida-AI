import { getResumenNegocio } from '@/lib/admin/negocio';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { DollarSign, Truck, CheckCircle2 } from 'lucide-react';
import ContadorRetro from '../contador-retro';
import { KpiTile } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Ejecutivo / Board — la vista para junta directiva. El MRR es el mismo $0
 * real de Inicio (no un número distinto vestido para el board: es el mismo
 * hecho verdadero visto desde otra perspectiva). Debajo, los únicos tres
 * KPIs que SÍ existen con datos reales: gasto en IA, flotas y viajes
 * procesados. Todo lo que un board típico esperaría — ARR, burn, runway,
 * magic number, LTV/CAC — requiere datos financieros que este panel no
 * captura hoy, así que se dice en tono neutral, sin inventar ni disculparse.
 */
export default async function EjecutivoPage() {
  const r = await getResumenNegocio();
  const chipsCosto = r.porDia.slice(-8).map((d) => d.costoUsd);
  // AUDITORÍA 10, ALTO — mismo texto fijo de `admin/page.tsx`: "solo el
  // demo" se comprueba contra el id real, no se asume porque el conteo dé 1.
  const esSoloDemo = r.tenants === 1 && r.flotas[0]?.id === tenantDemo();

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-panel overflow-hidden">
        <div className="px-6 py-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl tracking-tight" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600 }}>
              Ejecutivo / Board
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
              Cifras reales de Likida, sin proyección ni relleno.
            </p>
          </div>
          <ContadorRetro valor={0} digitos={7} prefijo="$" etiqueta="MRR — meta $1,000,000" tamaño="lg" />
        </div>

        <section className="p-6 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Lo que sí existe hoy
          </div>
          {/* KpiTile (design system v2, ui/kit.tsx) — mismo patrón de la
              grilla "Likida en números" de Inicio: count-up real,
              sparkline+tendencia del gasto de IA, sin inventar historia
              donde no la hay (flotas/viajes no traen sparkline: n=1 no es
              una serie). */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <KpiTile
              icono={<DollarSign width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Gasto en IA (no es burn total de la empresa)"
              valor={r.costoIaUsd} formato="usd"
              tendencia={r.tendenciaCosto} sparkline={chipsCosto}
            />
            <KpiTile
              icono={<Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta={r.tenants === 0 ? 'Flotas (ninguna dada de alta)' : esSoloDemo ? 'Flota (solo el demo)' : 'Flotas'}
              valor={r.tenants} formato="entero"
            />
            <KpiTile
              icono={<CheckCircle2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Viajes procesados" valor={r.viajesProcesados} formato="entero"
            />
          </div>
        </section>

        <section className="p-6 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Lo que este panel todavía no puede mostrar
          </div>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
            ARR, burn total, runway, magic number y LTV/CAC requieren datos financieros reales — ingresos,
            gastos operativos, cash en banco — que este panel no captura hoy. Mostrarlos aquí serían números
            inventados. Una vista histórica de 12–24 meses y un reporte de board exportable son Fase 3+ del
            roadmap.
          </p>
        </section>
      </div>
    </div>
  );
}
