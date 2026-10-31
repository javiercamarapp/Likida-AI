// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS DE CAPTURAS · Fase 0.2 del rediseño (UI v2). Sin rutas.
//
// Renderiza COMPONENTES REALES del panel (nunca copias) con FIXTURES
// SINTÉTICOS dentro del DashboardChrome real, con `renderToStaticMarkup`, y
// escribe un .html por vista en $UI2_OUT/vistas. Después `compilar-css.mjs`
// compila el CSS (Tailwind 4 sobre globals.css + ui-v2/tokens.css) y
// `capturar.mjs` abre cada vista con Playwright (setContent).
//
// Corre con:  npx vitest run --config scripts/ui2-captura/vitest.config.ts
// No es una prueba del repo (su nombre no matchea *.test.*): `npm test` no lo ve.
// Datos: 100 % sintéticos. Ningún nombre, cifra ni logo real.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

// UI2_CHROME=v2 renderiza el vistas con el chrome v2 REAL (lo usa scripts/ui2-calidad); por omisión, el de siempre.
const { default: DashboardChrome } = process.env.UI2_CHROME === 'v2'
  ? await import('@/app/dashboard/shell/chrome-v2')
  : await import('@/app/dashboard/chrome');
const { BarraPagina, HeroSaludo, ChipFecha, TablaViajes } = await import('@/app/dashboard/resumen-visual');
const { InsightDeAgente, FICHAS_CINCO_AGENTES } = await import('@/app/dashboard/inicio-cinco-agentes');
const kit = await import('@/app/admin/ui/kit');
const { TiraKpi, Sparkline, Columnas } = await import('@/app/ui-v2/graficas');
const forma = await import('@/app/admin/ui/forma');
const gr = await import('@/app/admin/ui/graficas');
const { TarjetaInsight } = await import('@/app/dashboard/agentes/insights/tarjeta-insight');
const { EsqTabla, EsqCifras, EsqGrafica } = await import('@/app/dashboard/bloque');
const { BTN_PRIMARIO, BTN_SECUNDARIO, ESTILO_PRIMARIO, ESTILO_SECUNDARIO } = await import('@/app/dashboard/[id]/vista');
import { CalendarDays, Route, Truck, Wallet, Gauge as Medidor } from 'lucide-react';
import type { Insight } from '@/lib/likida/insights/tipos';
import { exigirV2Html } from './exigir_v2';
import { USUARIO, viajes as viajesFx, textoInsight } from './fixtures/logistica_mx';

const OUT = process.env.UI2_OUT ?? path.join(homedir(), 'likida-loop/frontend-plan/.arnes');

const insight = (id: string, severidad: Insight['severidad'], tipo: Insight['tipo'], agente: Insight['agente'] = 'liquidacion'): Insight => {
  const t = textoInsight(agente);
  return {
    id, agente, severidad, tipo,
    ...(tipo === 'ejemplo' || tipo === 'simulado' ? { rotulo: tipo === 'ejemplo' ? 'Ejemplo' : 'Simulado' } : {}),
    quePaso: t.quePaso, queSignifica: t.queSignifica, queHacer: t.queHacer,
    fuente: { tabla: t.tabla, periodo: t.periodo, n: t.n },
  } as Insight;
};

// 12 viajes con folios ÚNICOS, rutas entre ciudades mexicanas y nulos reales (ver fixtures/logistica_mx.ts).
const VIAJES = viajesFx(12);

function Pagina({ titulo, icono, children }: { titulo: string; icono?: ReactNode; children: ReactNode }) {
  return (
    <>
      <BarraPagina icono={icono} titulo={titulo} derecha={<ChipFecha icono={<CalendarDays width={14} height={14} />}>28 de octubre de 2026</ChipFecha>} />
      <div className="p-5 space-y-4">{children}</div>
    </>
  );
}

const VISTAS: Record<string, () => ReactNode> = {
  '01-resumen': () => (
    <Pagina titulo="Resumen" icono={<Route width={15} height={15} />}>
      <HeroSaludo saludo="Buenas tardes" nombre={USUARIO.saludo} tagline="Así van tus cinco agentes hoy." />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {FICHAS_CINCO_AGENTES.map((f, i) => (
          <div key={f.clave} className="card p-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                <f.Icono width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold">{f.nombre}</div>
                <div className="text-[12px]" style={{ color: 'var(--muted)' }}>{f.descripcion}</div>
              </div>
            </div>
            <InsightDeAgente
              href={f.href} nombre={f.nombre}
              proximamente={i === 3}
              insights={i === 0 ? [insight('a', 'urgente', 'dato')] : i === 1 ? [insight('b', 'atencion', 'candidato', 'peajes')] : i === 2 ? [] : null}
            />
          </div>
        ))}
      </div>
    </Pagina>
  ),
  '02-kpis': () => (
    <Pagina titulo="Indicadores" icono={<Wallet width={15} height={15} />}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <kit.StatCard icono={<Truck width={16} height={16} />} etiqueta="Viajes del periodo" valor={128} delta={{ pct: 12.5, bueno: true }} />
        <kit.StatCard icono={<Wallet width={16} height={16} />} etiqueta="Gasto total" valor={482310.5} formato="mxn" delta={{ pct: -4.2, bueno: true }} />
        <kit.StatCard icono={<Medidor width={16} height={16} />} etiqueta="Costo por viaje" valor={null} sinDato="sin viajes en el periodo" />
        <kit.StatCard icono={<Route width={16} height={16} />} etiqueta="Liquidado" valor={310450} formato="mxn" delta={{ pct: 3.1, bueno: false }} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <kit.KpiTile icono={<Truck width={15} height={15} />} etiqueta="Unidades activas" valor={42} sparkline={[3, 5, 4, 7, 6, 9, 8]} tendencia={8} />
        <kit.KpiTile icono={<Wallet width={15} height={15} />} etiqueta="Anticipos abiertos" valor={17} destacar nota="Corte al 27 de oct" />
        <kit.KpiTile icono={<Route width={15} height={15} />} etiqueta="Sin dato" valor={null} vacio="Sin captura" />
      </div>
      <kit.BannerInsight etiqueta="Peajes" deltaPct={-6.4} href="/dashboard/agentes/peajes">El gasto en casetas bajó contra la semana anterior (semana 43 contra semana 42).</kit.BannerInsight>
    </Pagina>
  ),
  '03-tabla-viajes': () => (
    <Pagina titulo="Viajes" icono={<Truck width={15} height={15} />}>
      <div className="card p-3"><TablaViajes viajes={VIAJES} /></div>
    </Pagina>
  ),
  '04-formulario': () => (
    <Pagina titulo="Configuración" icono={<Wallet width={15} height={15} />}>
      <div className="card p-4 max-w-2xl space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <forma.Campo nombre="nombre" etiqueta="Nombre del patio" placeholder="Patio Norte" requerido />
          <forma.Campo nombre="tope" etiqueta="Tope de anticipo" tipo="number" valorInicial="2500" ayuda="En pesos mexicanos." />
          <forma.Selector nombre="rol" etiqueta="Rol" opciones={[{ valor: 'a', texto: 'Dueño' }, { valor: 'b', texto: 'Encargado' }, { valor: 'c', texto: 'Contador' }]} valorInicial="b" />
          <forma.Campo nombre="correo" etiqueta="Correo" tipo="email" valorInicial="persona@ejemplo.test" />
        </div>
        <forma.CampoTexto nombre="notas" etiqueta="Notas" placeholder="Escribe una nota" />
        <forma.Casilla nombre="activo" etiqueta="Notificar por correo" />
        <div className="flex gap-2 pt-1">
          <button type="button" className={BTN_PRIMARIO} style={ESTILO_PRIMARIO}>Guardar cambios</button>
          <button type="button" className={BTN_SECUNDARIO} style={ESTILO_SECUNDARIO}>Cancelar</button>
          <button type="button" disabled className={BTN_SECUNDARIO} style={ESTILO_SECUNDARIO}>Deshabilitado</button>
        </div>
      </div>
    </Pagina>
  ),
  '05-graficas-a': () => (
    <Pagina titulo="Gráficas" icono={<Wallet width={15} height={15} />}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <kit.ChartCard titulo="Avance de cierre" subtitulo="Semana 43 de 2026"><gr.Gauge valor={72} etiqueta="Cerrado" /></kit.ChartCard>
        <kit.ChartCard titulo="Gasto por rubro"><gr.HBars datos={[{ etiqueta: 'Casetas', valor: 48200 }, { etiqueta: 'Diésel', valor: 91000 }, { etiqueta: 'Maniobras', valor: 12900 }, { etiqueta: 'Viáticos', valor: 22100 }]} formato="mxn" /></kit.ChartCard>
        <kit.ChartCard titulo="Tendencia semanal"><gr.MultiLine categorias={['S1', 'S2', 'S3', 'S4', 'S5', 'S6']} series={[{ nombre: 'Viajes', valores: [10, 14, 12, 18, 16, 21] }, { nombre: 'Liquidados', valores: [8, 11, 12, 15, 14, 19] }]} /></kit.ChartCard>
        <kit.ChartCard titulo="Barras apiladas"><gr.StackedBars categorias={['Lun', 'Mar', 'Mié', 'Jue', 'Vie']} series={[{ nombre: 'A', valores: [4, 6, 5, 7, 6] }, { nombre: 'B', valores: [2, 3, 4, 2, 5] }, { nombre: 'C', valores: [1, 2, 1, 3, 2] }]} /></kit.ChartCard>
      </div>
    </Pagina>
  ),
  '06-graficas-b': () => (
    <Pagina titulo="Gráficas II" icono={<Wallet width={15} height={15} />}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <kit.ChartCard titulo="Embudo"><gr.Funnel pasos={[{ etiqueta: 'Recibidos', valor: 120 }, { etiqueta: 'Procesados', valor: 96 }, { etiqueta: 'Enviados', valor: 90 }, { etiqueta: 'Entregados', valor: 84 }]} /></kit.ChartCard>
        <kit.ChartCard titulo="Cascada"><gr.Waterfall pasos={[{ etiqueta: 'Anticipo', delta: 5000, esTotal: true }, { etiqueta: 'Casetas', delta: -1800 }, { etiqueta: 'Diésel', delta: -2400 }, { etiqueta: 'Saldo', delta: 800, esTotal: true }]} formato="mxn" /></kit.ChartCard>
        <kit.ChartCard titulo="Mapa de calor"><gr.Heatmap filas={['Lun', 'Mar', 'Mié']} columnas={['06h', '10h', '14h', '18h']} valores={[[1, 4, 7, 2], [3, 6, 9, 5], [0, 2, 4, 8]]} /></kit.ChartCard>
        <kit.ChartCard titulo="Histograma"><gr.Histogram buckets={[{ rango: '0-1k', conteo: 4 }, { rango: '1-2k', conteo: 11 }, { rango: '2-3k', conteo: 17 }, { rango: '3-4k', conteo: 8 }]} /></kit.ChartCard>
      </div>
    </Pagina>
  ),
  '07-estados': () => (
    <Pagina titulo="Estados" icono={<Route width={15} height={15} />}>
      <kit.EstadoVacio accion={{ href: '/dashboard/conexiones', texto: 'Ir a Conexiones' }}>Todavía no hay desgloses. Cuando llegue el primer archivo, aparecen aquí.</kit.EstadoVacio>
      <kit.EstadoError mensaje="No pudimos leer los desgloses. Vuelve a intentarlo en un momento." />
      <kit.EstadoCargando filas={3} />
      <div className="flex flex-wrap gap-2 items-center">
        <kit.StatusPill estado="ok">Entregado</kit.StatusPill>
        <kit.StatusPill estado="warn">En cuadre</kit.StatusPill>
        <kit.StatusPill estado="bad">Rebotado</kit.StatusPill>
        <kit.StatusPill estado="neutral">Abierto</kit.StatusPill>
        <kit.Semaphore estado="ok" etiqueta="Conectado" />
        <kit.Semaphore estado="bad" etiqueta="Sin acceso" />
      </div>
      <EsqCifras n={3} />
      <EsqTabla filas={4} />
      <EsqGrafica alto={120} />
    </Pagina>
  ),
  '08-insights': () => (
    <Pagina titulo="Interpretación" icono={<Route width={15} height={15} />}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TarjetaInsight insight={insight('1', 'urgente', 'dato')} />
        <TarjetaInsight insight={insight('2', 'atencion', 'candidato', 'peajes')} />
        <TarjetaInsight insight={insight('3', 'info', 'ejemplo', 'carta-porte')} />
        <TarjetaInsight insight={insight('4', 'info', 'simulado', 'vigia')} />
      </div>
    </Pagina>
  ),
  '09-botones-chips': () => (
    <Pagina titulo="Botones y etiquetas" icono={<Route width={15} height={15} />}>
      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN_PRIMARIO} style={ESTILO_PRIMARIO}>Descargar PDF</button>
          <button type="button" className={BTN_SECUNDARIO} style={ESTILO_SECUNDARIO}>Ver detalle</button>
          <button type="button" className="inline-flex items-center h-8 px-3 rounded-lg text-[12.5px] font-medium" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>Anular</button>
          <button type="button" className="inline-flex items-center h-7 px-2.5 rounded-lg text-[12px] font-medium hairline" style={{ background: 'var(--surface)' }}>Chico</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-[10px] etiqueta-mono uppercase px-2 py-0.5 rounded-md" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>Rótulo 10 px</span>
          <span className="text-[10.5px] px-2 py-0.5 rounded-md" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>Observado</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>Estimado</span>
          <span className="text-[12px] px-2 py-0.5 rounded-full hairline">Sin dato</span>
        </div>
        <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Texto de cuerpo 13 px con <b style={{ color: 'var(--ink)' }}>énfasis</b>, cifras <span className="tabular">1,234,567.89</span> y <span className="cifra-mono">V-4102</span>.</p>
        <h2 className="font-display text-[22px] font-semibold">Titular en fuente de display</h2>
      </div>
    </Pagina>
  ),
  '10-aviso-widget': () => (
    <Pagina titulo="Avisos y uso" icono={<Wallet width={15} height={15} />}>
      <forma.Aviso estado={{ ok: true, mensaje: 'Guardado. Se aplica a los próximos desgloses.' } as never} />
      <forma.Aviso estado={{ ok: false, error: 'No se pudo guardar. Revisa el tope de anticipo.' } as never} />
      <kit.WidgetUso etiqueta="Análisis con IA hoy" valor="38 %" detalle="Se renueva a medianoche" tope={{ usado: 38, limite: 100 }} href="/dashboard/chat" />
      <kit.VerMas href="/dashboard/agentes/peajes">Ver conciliación</kit.VerMas>
    </Pagina>
  ),
  '11-tabla-grande': () => (
    <Pagina titulo="Candidatos" icono={<Truck width={15} height={15} />}>
      <div className="card overflow-x-auto">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr style={{ background: 'var(--canvas)', borderBottom: '1px solid var(--line)' }}>
              {['Folio', 'Operador', 'Origen', 'Destino', 'Casetas', 'Diésel', 'Diferencia', 'Estado'].map((h) => (
                <th key={h} className="text-left px-3 py-2 text-[10px] etiqueta-mono uppercase font-medium" style={{ color: 'var(--muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {viajesFx(24, 31).map((v, i) => {
              const dif = i % 5 === 3 ? null : i % 4 === 0 ? -(120 + i * 37.5) : i % 3 === 0 ? 85 + i * 11.25 : 0;
              const estado = dif === null ? 'Pendiente' : dif === 0 ? 'Cuadra' : 'Revisar';
              return (
                <tr key={v.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td className="px-3 py-2 cifra-mono">{v.folio}</td>
                  <td className="px-3 py-2">{v.operadorNombre ?? '—'}</td>
                  <td className="px-3 py-2">{v.origen ?? '—'}</td>
                  <td className="px-3 py-2">{v.destino ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular">${(v.anticipo * 0.31).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular">${(v.anticipo * 0.52).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular" style={{ color: dif ? 'var(--bad)' : 'var(--ink)' }}>{dif === null ? '—' : `${dif < 0 ? '−' : ''}$${Math.abs(dif).toFixed(2)}`}</td>
                  <td className="px-3 py-2"><kit.StatusPill estado={estado === 'Revisar' ? 'bad' : estado === 'Pendiente' ? 'warn' : 'ok'}>{estado}</kit.StatusPill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Pagina>
  ),
  // Prueba visual de que el COLOR DE DATOS llega a donde debe: los 8 matices (data-matiz 1..8) en el filete de 3 px de cada KPI, en su
  // sparkline y en la serie de columnas; el cromo (sidebar, topbar, botones) sigue en negro/gris. Fixture 100 % sintético.
  '13-matices': () => (
    <Pagina titulo="Matices de datos" icono={<Wallet width={15} height={15} />}>
      <TiraKpi etiqueta="Matices 1 a 4" items={[
        { etiqueta: 'Dinero liquidado', valor: '$482,310', matiz: 1, serie: [3, 5, 4, 7, 6, 9, 8], sello: 'TMS · hace 5 min' },
        { etiqueta: 'Gasto de ruta', valor: '$96,820', matiz: 2, serie: [8, 6, 7, 5, 6, 4, 5], sello: 'TMS · hace 5 min' },
        { etiqueta: 'Cumplimiento', valor: '94 %', matiz: 3, serie: [5, 6, 6, 7, 8, 8, 9], sello: 'SAT · ayer' },
        { etiqueta: 'Pendiente', valor: '$38,400', matiz: 4, serie: [2, 3, 5, 4, 6, 7, 7], sello: 'TMS · hace 5 min' },
      ]} />
      <TiraKpi etiqueta="Matices 5 a 8" items={[
        { etiqueta: 'A tiempo', valor: '91 %', matiz: 5, serie: [6, 7, 6, 8, 8, 9, 9], sello: 'TMS · hace 5 min' },
        { etiqueta: 'Requiere acción', valor: '7', matiz: 6, serie: [2, 4, 3, 5, 4, 6, 7], sello: 'Panel · ahora' },
        { etiqueta: 'Incidencias', valor: '12', matiz: 7, serie: [5, 4, 6, 3, 4, 5, 3], sello: 'WhatsApp · hoy' },
        { etiqueta: 'Viajes', valor: '128', matiz: 8, serie: [4, 5, 5, 6, 7, 7, 8], sello: 'TMS · hace 5 min' },
      ]} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((m) => (
          <div key={m} className="card p-3 flex items-center gap-3">
            <span className="text-[12px]" style={{ color: 'var(--muted)', width: 64 }}>Matiz {m}</span>
            <Sparkline valores={[3, 5, 4, 7, 6, 9, 8]} matiz={m as 1} ancho={120} alto={28} />
            <Columnas etiqueta={`Matiz ${m}`} matiz={m as 1} datos={[{ etiqueta: 'L', valor: 4 }, { etiqueta: 'M', valor: 7 }, { etiqueta: 'X', valor: 5 }, { etiqueta: 'J', valor: 9 }]} />
          </div>
        ))}
      </div>
    </Pagina>
  ),
  '12-vacio-total': () => (
    <Pagina titulo="Conexiones" icono={<Route width={15} height={15} />}>
      <kit.EstadoVacio>Aún no hay nada conectado. Empieza por entregar el primer archivo del proveedor.</kit.EstadoVacio>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {['Sistema de transporte', 'Correo emisor', 'Catálogos'].map((n, i) => (
          <div key={n} className="card p-4">
            <div className="flex items-center justify-between"><span className="text-[13px] font-semibold">{n}</span><kit.StatusPill estado={i === 0 ? 'warn' : i === 1 ? 'ok' : 'neutral'}>{i === 0 ? 'En espera' : i === 1 ? 'Listo' : 'Pendiente'}</kit.StatusPill></div>
            <p className="text-[12px] mt-2" style={{ color: 'var(--muted)' }}>Falta la credencial del proveedor; la captura quien administra la cuenta.</p>
            <button type="button" className={`${BTN_SECUNDARIO} mt-3`} style={ESTILO_SECUNDARIO}>Configurar</button>
          </div>
        ))}
      </div>
    </Pagina>
  ),
};

describe('arnés de capturas UI v2', () => {
  it('renderiza todas las vistas con componentes reales y fixtures sintéticos', () => {
    mkdirSync(path.join(OUT, 'vistas'), { recursive: true });
    for (const [id, vista] of Object.entries(VISTAS)) {
      const html = renderToStaticMarkup(
        <DashboardChrome nombre={USUARIO.nombre} rol="flota_admin" perfil="cinco_agentes" cerrarSesion={async () => {}}>
          {vista()}
        </DashboardChrome>,
      );
      if (process.env.UI2_CHROME === 'v2') exigirV2Html(html, id);
      writeFileSync(path.join(OUT, 'vistas', `${id}.html`), html);
    }
  });
});
