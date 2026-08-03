import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { LineChart, Smartphone } from 'lucide-react';
import { AreaChartSimple, Dona, BarChartSimple } from '../charts';
import ContadorRetro from '../contador-retro';

export const dynamic = 'force-dynamic';

const FASE_LABEL: Record<string, string> = {
  ocr: 'Agente OCR', cuadre: 'Agente de Cuadre', escalacion: 'Agente de Escalación',
  chat: 'Agente de Chat', router: 'Agente Router', whatsapp: 'Agente de WhatsApp',
};

/** Título de sección — mismo patrón que admin/page.tsx: SIEMPRE dentro de
 *  un `.glass-panel`, nunca suelto sobre el fondo difuminado (el gris de
 *  `--muted` solo pasa contraste sobre la superficie blanca del panel). */
function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  );
}

/** Ícono antes del nombre en "Costo por modelo" — copiado verbatim de
 *  admin/page.tsx (no está exportado ahí, así que se recrea aquí): el
 *  proveedor se lee del prefijo real `proveedor/modelo`, WhatsApp se
 *  detecta por nombre, insignia de letra en vez de logotipo de marca. */
function IconoProveedor({ modelo }: { modelo: string }) {
  if (modelo.toLowerCase().includes('whatsapp')) {
    return (
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <Smartphone width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
      </div>
    );
  }
  const proveedor = modelo.includes('/') ? modelo.split('/')[0] : modelo;
  const letra = proveedor.charAt(0).toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: 'var(--ink)', color: 'white' }}>
      {letra}
    </div>
  );
}

/**
 * Analítica & Stats — el explorador de BI de /admin: mismos datos que
 * Inicio, pero a mayor tamaño y sin comprimir a los últimos días, para
 * poder verlos y compararlos con más detalle. `requireSuperadmin()` ya lo
 * hizo el layout, esta página solo trae `getResumenNegocio()` (la única
 * fuente cross-tenant real) y renderiza.
 *
 * Con 1 tenant y `llm_costo`/`gasto` cubriendo apenas una semana, esta
 * página se queda a propósito en escala honesta: nada de histogramas,
 * mapas de calor ni comparativas por cliente inventados — esos necesitan
 * más historia y más de un tenant, así que la sección 4 lo dice tal cual
 * en vez de simular una gráfica vacía.
 */
export default async function AnaliticaPage() {
  const r = await getResumenNegocio();

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <LineChart width={16} height={16} strokeWidth={1.75} />
          <span className="text-sm font-medium">Analítica & Stats</span>
        </div>
        {/* Total histórico de facturas (filas de `gasto`, sin filtro de
            fecha) — no se muestra en ningún otro lado de /admin, es el
            número que de verdad resume "cuánto ha procesado Likida" y le
            queda natural a una página de analítica. Real, de
            `getResumenNegocio()`. */}
        <ContadorRetro valor={r.facturasTotal} etiqueta="Facturas procesadas — total histórico" tamaño="md" />
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <TituloSeccion>Costo de IA en el tiempo</TituloSeccion>
          <div className="card p-4 mt-3">
            {r.porDia.length > 1 ? (
              <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={usd} />
            ) : (
              <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                Sin historial suficiente todavía.
              </div>
            )}
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
                Costo por fase
              </h3>
              {r.porFase.length > 0 ? (
                <Dona segmentos={r.porFase.map((f) => ({ etiqueta: FASE_LABEL[f.fase] ?? f.fase, valor: f.costoUsd }))} />
              ) : (
                <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 60 }}>
                  Todavía no hay actividad de IA registrada.
                </div>
              )}
            </div>

            <div className="card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
                Costo por modelo
              </h3>
              {r.porModelo.length === 0 ? (
                <div className="text-sm" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
              ) : (
                <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                  {r.porModelo.map((m) => (
                    <div key={m.modelo} className="py-2.5 flex items-center gap-3">
                      <IconoProveedor modelo={m.modelo} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-mono truncate">{m.modelo}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{m.n} llamadas</div>
                      </div>
                      <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Facturas procesadas por día</TituloSeccion>
          <div className="card p-4 mt-3">
            {r.facturasPorDia.some((d) => d.n > 0) ? (
              <BarChartSimple datos={r.facturasPorDia.map((d) => ({ dia: d.dia, valor: d.n }))} alto={160} />
            ) : (
              <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                Aún sin datos suficientes.
              </div>
            )}
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Distribuciones y comparativas</TituloSeccion>
          <p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>
            Histogramas de mensajes por conversación, mapa de calor hora×día y comparativas por cliente
            necesitan más historia y más de un tenant para decir algo real — hoy Likida tiene 1 flota y
            pocos días de datos, así que estas vistas se muestran en cuanto haya suficiente para que no
            sean solo ruido.
          </p>
        </section>

        <section className="px-5 py-4 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Exportar CSV y reportes programados — Fase 2 del roadmap.
          </p>
        </section>
      </div>
    </div>
  );
}
