import { getResumenNegocio } from '@/lib/admin/negocio';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { DollarSign, Truck, CheckCircle2, Presentation } from 'lucide-react';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
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
 *
 * Anatomía FlowAI (14-ago): BarraPagina + tarjetas blancas sobre el lienzo
 * tenue (--g1), como consola.tsx — el contador Solari del MRR no cabe en la
 * barra de 44px, así que vive en la primera tarjeta, junto a la frase que
 * antes era el subtítulo del header.
 */
export default async function EjecutivoPage() {
  const r = await getResumenNegocio();
  const chipsCosto = r.porDia.slice(-8).map((d) => d.costoUsd);
  // AUDITORÍA 10, ALTO — mismo texto fijo de `admin/page.tsx`: "solo el
  // demo" se comprueba contra el id real, no se asume porque el conteo dé 1.
  const esSoloDemo = r.tenants === 1 && r.flotas[0]?.id === tenantDemo();

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Presentation width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Ejecutivo / Board"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <div className="card p-4 flex items-center justify-between gap-4">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Cifras reales de Likida, sin proyección ni relleno.
            </p>
            <ContadorRetro valor={0} digitos={7} prefijo="$" etiqueta="MRR — meta $1,000,000" tamaño="lg" />
          </div>

          <section>
            <TituloSeccion>Lo que sí existe hoy</TituloSeccion>
            {/* KpiTile (design system v2, ui/kit.tsx) — mismo patrón de la
                grilla "Likida en números" de Inicio: count-up real,
                sparkline+tendencia del gasto de IA, sin inventar historia
                donde no la hay (flotas/viajes no traen sparkline: n=1 no es
                una serie). */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mt-2">
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

          <div className="card p-4">
            <TituloSeccion>Lo que este panel todavía no puede mostrar</TituloSeccion>
            <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
              ARR, burn total, runway, magic number y LTV/CAC requieren datos financieros reales — ingresos,
              gastos operativos, cash en banco — que este panel no captura hoy. Mostrarlos aquí serían números
              inventados. Una vista histórica de 12–24 meses y un reporte de board exportable son Fase 3+ del
              roadmap.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
