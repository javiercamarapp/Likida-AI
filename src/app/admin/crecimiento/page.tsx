import Link from 'next/link';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { listarProspectos, ESTADOS_PROSPECTO, conteosVacios } from '@/lib/likida/vendedores';
import { usd } from '@/lib/utils';
import { numero } from '@/lib/formato';
import { TrendingUp, CheckCircle2, DollarSign, Filter } from 'lucide-react';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { AreaChartSimple } from '../charts';
import { HBars } from '../ui/graficas';
import { KpiTile, ChartCard } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Crecimiento — con 1 solo tenant y sin instrumentación de producto (no hay
 * tabla de eventos, ni funnel, ni cohortes), casi todo lo que un board
 * esperaría ver aquí (DAU/WAU/MAU, NPS, embudo, retención) es honestamente
 * inexistente. Lo único real y relevante: el gasto de IA por día
 * (`resumen.porDia`) como proxy de "cuánto se está usando la plataforma" —
 * etiquetado así a propósito, nunca como "crecimiento de usuarios", porque
 * no hay una sola métrica de usuario real detrás.
 *
 * Anatomía FlowAI (14-ago): BarraPagina + tarjetas sobre el lienzo tenue
 * (--g1), como consola.tsx. El H1 honesto y su párrafo se quedan — son la
 * tesis de la página — solo cambian de glass-panel a tarjeta.
 */
export default async function CrecimientoPage() {
  const r = await getResumenNegocio();
  // El embudo de ADQUISICIÓN sí es real desde la 0105: los prospectos del
  // censo por estado del kanban. Cae por su lado a null y se DICE — un
  // embudo vacío por base caída afirmaría que no hay pipeline.
  const prospectos = await listarProspectos().catch(() => null);
  const datosCosto = r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }));
  const chipsTokens = r.porDia.slice(-8).map((d) => d.tokens);
  // AUDITORÍA 10, ALTO — el H1 y el párrafo de abajo decían "Con 1 flota
  // dada de alta" y "solo existe el tenant demo" como texto fijo: con la
  // base en 0 tenants (5-ago-2026) seguían afirmando que había una.
  const esSoloDemo = r.tenants === 1 && r.flotas[0]?.id === tenantDemo();

  const sinInstrumentacion = [
    'DAU / WAU / MAU',
    'NPS',
    // El embudo de LEADS ya existe arriba (0105); lo que sigue sin existir
    // es la mitad de producto: activados → de pago.
    'Embudo activados → de pago (la mitad de producto del funnel)',
    'Retención por cohortes',
    'Adopción por feature',
  ];

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<TrendingUp width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Crecimiento"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <div className="card p-4">
            <h1 className="text-base font-semibold tracking-tight">
              {r.tenants === 0
                ? 'Sin flotas dadas de alta, todavía no hay "crecimiento" que medir'
                : `Con ${r.tenants} flota${r.tenants === 1 ? '' : 's'} dada${r.tenants === 1 ? '' : 's'} de alta, todavía no hay "crecimiento" que medir`}
            </h1>
            <p className="text-sm mt-1.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
              {r.tenants === 0
                ? 'No hay ninguna flota dada de alta para graficar su historial de altas'
                : esSoloDemo
                  ? 'No hay historial de altas de flota que graficar (solo existe el tenant demo)'
                  : 'No hay historial de altas de flota que graficar todavía'}, y Likida no
              tiene instrumentación de producto — ningún conteo de usuarios activos ni embudo de registro.
              Con {r.tenants === 0 ? 'cero flotas' : `n=${r.tenants}`} cualquier tendencia de crecimiento sería un número inventado, no una señal real.
            </p>
          </div>

          {/* ── El embudo de ADQUISICIÓN — real desde la 0105 (Fase 2) ─────
              Los prospectos del censo por estado del kanban. Es pipeline de
              PROSPECTOS, no de usuarios: la conversión que se muestra es
              cerrados/total, y con cero cerrados se dice "sin cierres
              todavía" — jamás un 0% con cara de medición. */}
          {prospectos === null ? (
            <div className="card p-4">
              <TituloSeccion>Embudo de adquisición</TituloSeccion>
              <p className="text-sm mt-2" style={{ color: 'var(--bad)' }}>
                No se pudo leer el pipeline — esto NO significa que no haya prospectos.
              </p>
            </div>
          ) : prospectos.length > 0 && (() => {
            const porEstado = conteosVacios();
            for (const p of prospectos) porEstado[p.estado]++;
            const embudo = ESTADOS_PROSPECTO
              .filter((e) => e.valor !== 'perdido')
              .map((e) => ({ etiqueta: e.rotulo, valor: porEstado[e.valor] }));
            return (
              <div className="card p-4">
                <div className="flex items-center gap-2">
                  <Filter width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                  <TituloSeccion>Embudo de adquisición — {numero(prospectos.length)} prospectos del censo</TituloSeccion>
                </div>
                <div className="mt-3">
                  <HBars datos={embudo} formato="entero" />
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                  {porEstado.cerrado > 0
                    ? `Conversión a cierre: ${porEstado.cerrado} de ${numero(prospectos.length)}.`
                    : 'Sin cierres todavía — la conversión no se inventa con cero cerrados.'}
                  {porEstado.perdido > 0 && ` ${numero(porEstado.perdido)} perdidos.`}
                  {' '}El detalle por vendedor vive en <Link href="/admin/vendedores" className="underline">Vendedores</Link>;
                  lo que espera tu aprobación, en <Link href="/admin/aprobaciones" className="underline">Aprobaciones</Link>.
                </p>
              </div>
            );
          })()}

          {/* ChartCard (design system v2, ui/kit.tsx) — mismo AreaChartSimple
              de siempre (charts.tsx sigue vigente para esta forma de dato:
              una sola serie continua en el tiempo); `tamano="L"` porque es
              la única gráfica real de la página, la pieza dominante. */}
          <ChartCard
            titulo="Uso de la plataforma en el tiempo"
            subtitulo="No es una métrica de usuarios — es el gasto real de IA por día, el proxy más honesto que existe hoy de cuánto se está usando Likida."
            tamano="L"
          >
            {datosCosto.length > 1 ? (
              <AreaChartSimple datos={datosCosto} etiquetaValor={usd} />
            ) : (
              <div className="text-sm py-10 text-center" style={{ color: 'var(--muted)' }}>
                Sin historial suficiente todavía.
              </div>
            )}
          </ChartCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <KpiTile
              icono={<CheckCircle2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Viajes procesados" valor={r.viajesProcesados} formato="entero"
            />
            <KpiTile
              icono={<DollarSign width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Tokens usados" valor={r.tokensIn + r.tokensOut} formato="numero"
              tendencia={r.tendenciaTokens} sparkline={chipsTokens}
            />
          </div>

          <div className="card p-4">
            <TituloSeccion>Lo que esta página todavía no puede mostrar</TituloSeccion>
            <ul className="space-y-2 text-sm mt-3">
              {sinInstrumentacion.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="w-1 h-1 rounded-full mt-2 shrink-0" style={{ background: 'var(--muted)' }} />
                  <span style={{ color: 'var(--muted)' }}>{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              Necesitan instrumentación de producto que no existe hoy, y más de 1 cliente para decir algo real.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
