// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS DE CAPTURAS · carril C (Fase 1). Renderiza el shell v2 REAL con las pantallas de C y fixtures SINTÉTICOS, compila
// el CSS completo de la capa v2 y captura con Playwright: pantallas (1440/1024/412 × claro/oscuro) y pasos del recorrido
// (foco, halo y globo calculados con las mismas funciones del motor sobre el rect MEDIDO del elemento real).
// Salida: $UI2_C_OUT (por omisión ~/likida-loop/frontend-plan/fase1/capturas-c). Nada de datos reales ni de nombres de clientes.
// Uso: npx vitest run --config scripts/ui2-captura/vitest.config.mts captura-c
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

let RUTA = '/dashboard';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => RUTA,
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
const SENALES_RESUMEN = { actuales: null as unknown };
vi.mock('@/lib/likida/asistente/senales', () => ({ leerSenalesAsistente: async () => SENALES_RESUMEN.actuales }));
vi.mock('@/lib/likida/agentes/corridas', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/agentes/corridas')>()),
  ultimasCorridas: async (_t: string, agente: string) => (agente === 'liquidacion'
    ? [{ inicio: '2026-10-27T15:10:00Z', estado: 'ok', duracionMs: 41000 }]
    : []),
}));

const { default: DashboardChromeV2 } = await import('@/app/dashboard/shell/chrome-v2');
const { VistaPuestaEnMarcha } = await import('@/app/dashboard/puesta-en-marcha/vista');
const { VistaConexiones } = await import('@/app/dashboard/conexiones/vista');
const { ResumenV2 } = await import('@/app/dashboard/resumen-v2');
const { TarjetaAgente, FICHAS_CINCO_AGENTES } = await import('@/app/dashboard/inicio-cinco-agentes');
const { GloboTour } = await import('@/app/ui-v2/movimiento/tour/globo');
const { colocarGlobo, rectFoco, trazoVelo } = await import('@/app/ui-v2/movimiento/tour/geometria');
const { RECORRIDO_DUENO } = await import('@/app/dashboard/recorridos/dueno');
import type { SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';
import type { Conector } from '@/lib/likida/conexiones';
import type { Instantanea, Rect, Tam } from '@/app/ui-v2/movimiento/tour/tipos';
import type { Insight } from '@/lib/likida/insights/tipos';

const raiz = path.resolve(__dirname, '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const OUT = process.env.UI2_C_OUT ?? path.join(homedir(), 'likida-loop/frontend-plan/fase1/capturas-c');
const TRABAJO = path.join(homedir(), 'likida-loop/frontend-plan/.arnes-c');
const F = path.join(homedir(), 'likida-loop/frontend-plan/fuentes-spike');

// ── Fixtures sintéticos ────────────────────────────────────────────────────
const VACIAS: SenalesAsistente = {
  tms: 'sin_credencial', archivosRecibidos: 0, correoPlataforma: true,
  correoDesglose: { activa: false, usaCorreo: false, remitenteCapturado: false },
  operadores: { activos: 0, conCorreo: 0 }, unidadesActivas: 0, patios: 0, coordinadores: 0, supervisores: 0, revisorCartaPorte: false,
};
const EN_CURSO: SenalesAsistente = {
  ...VACIAS, archivosRecibidos: 1, correoDesglose: { activa: true, usaCorreo: true, remitenteCapturado: true },
  operadores: { activos: 14, conCorreo: 9 }, unidadesActivas: 11, supervisores: 2, coordinadores: 2,
};
const ATENCION: SenalesAsistente = {
  ...VACIAS, tms: { activa: true, probadaEn: null, ultimoError: 'respondió 403 (probable lista de IP permitidas)' },
};
const CAIDAS: SenalesAsistente = {
  tms: null, archivosRecibidos: null, correoPlataforma: null, correoDesglose: null, operadores: null,
  unidadesActivas: null, patios: null, coordinadores: null, supervisores: null, revisorCartaPorte: null,
};

const CONECTORES: Conector[] = [
  { id: 'whatsapp', nombre: 'WhatsApp (choferes y oficina)', estado: 'incompleto', detalle: 'Variables del canal presentes en este entorno. Esto no prueba una entrega reciente de Meta ni una sesión por flota.', falta: [] },
  { id: 'correo', nombre: 'Correo de avisos', estado: 'incompleto', detalle: 'El envío está configurado; esta comprobación no verifica entrega, SPF ni DKIM. Sin buzón de facturas.', falta: [] },
  { id: 'rastreo', nombre: 'Rastreo GPS (credenciales del proveedor)', estado: 'sin_configurar', detalle: 'Sin conectar — la credencial de tu proveedor se captura aquí abajo.', falta: ['capturar el acceso de tu proveedor de rastreo y probar la conexión'] },
  { id: 'timbrado', nombre: 'Emisión de CFDI (timbrado)', estado: 'ensayo', detalle: 'En ensayo por candado legal — decisión de negocio.', falta: [] },
];

const insight = (agente: Insight['agente']): Insight => ({
  id: `i-${agente}`, agente, severidad: 'atencion', tipo: 'dato',
  quePaso: 'Dos desgloses de muestra salieron con diferencia contra el anticipo.',
  queSignifica: 'Lectura sintética: la diferencia viene de casetas sin comprobante.',
  queHacer: 'Revisar los dos desgloses y pedir el comprobante faltante.',
  fuente: { tabla: 'tabla_sintetica', periodo: 'semana de prueba', n: 2 },
}) as Insight;

async function fichas() {
  const insights = Object.fromEntries(FICHAS_CINCO_AGENTES.map((f) => [f.insight, f.insight === 'liquidacion' ? [insight('liquidacion')] : []]));
  return Promise.all(FICHAS_CINCO_AGENTES.map((f) => TarjetaAgente({ ficha: f, tenantId: 't', sufijo: '', insights: insights as never })));
}

const asistente = (s: SenalesAsistente, paso?: 'tms' | 'correo') => (
  <VistaPuestaEnMarcha senales={s} ambito="t:u" tenantId="t" sufijo="" soloLectura={false} pasoInicial={paso} />
);

interface VistaDef { ruta: string; cuerpo: () => Promise<ReactNode> | ReactNode; senales?: SenalesAsistente }
const VISTAS: Record<string, VistaDef> = {
  'c01-resumen-vacio': { ruta: '/dashboard', senales: VACIAS, cuerpo: async () => ResumenV2({ tenantId: 't', userId: 'u', tenantNombre: null, nombre: 'Ana', tenantExiste: true, sufijo: '', soloLectura: false, fichas: await fichas() }) },
  'c02-resumen-en-curso': { ruta: '/dashboard', senales: EN_CURSO, cuerpo: async () => ResumenV2({ tenantId: 't', userId: 'u', tenantNombre: null, nombre: 'Ana', tenantExiste: true, sufijo: '', soloLectura: false, fichas: await fichas() }) },
  'c03-resumen-sin-dato': { ruta: '/dashboard', senales: CAIDAS, cuerpo: async () => ResumenV2({ tenantId: 't', userId: 'u', tenantNombre: null, nombre: 'Ana', tenantExiste: true, sufijo: '', soloLectura: false, fichas: await fichas() }) },
  'c04-asistente-vacio': { ruta: '/dashboard/puesta-en-marcha', cuerpo: () => asistente(VACIAS) },
  'c05-asistente-tms': { ruta: '/dashboard/puesta-en-marcha', cuerpo: () => asistente(VACIAS, 'tms') },
  'c06-asistente-atencion': { ruta: '/dashboard/puesta-en-marcha', cuerpo: () => asistente(ATENCION, 'tms') },
  'c07-asistente-en-curso': { ruta: '/dashboard/puesta-en-marcha', cuerpo: () => asistente(EN_CURSO, 'correo') },
  'c08-asistente-sin-dato': { ruta: '/dashboard/puesta-en-marcha', cuerpo: () => asistente(CAIDAS) },
  'c09-conexiones': { ruta: '/dashboard/conexiones', cuerpo: () => <VistaConexiones conectores={CONECTORES} credenciales={<section className="card p-4"><h2 className="font-display text-[14px] font-semibold">Credenciales de tus sistemas</h2><p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>Fixture: aquí va el formulario de captura.</p></section>} /> },
};

// Pasos del recorrido a capturar: (id del paso, vista de fondo).
const PASOS_TOUR: Array<[string, string]> = [
  ['bienvenida', 'c04-asistente-vacio'], ['menu', 'c04-asistente-vacio'], ['avance', 'c04-asistente-vacio'], ['sistema', 'c04-asistente-vacio'],
  ['archivo', 'c05-asistente-tms'], ['conexiones', 'c09-conexiones'], ['liquidacion', 'c04-asistente-vacio'],
];

const FUENTES_CSS = [
  ...[400, 500, 600, 700].map((w) => `@font-face{font-family:'Hanken Grotesk UI';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/hankengrotesk-${w}.woff2') format('woff2')}`),
  ...[400, 500].map((w) => `@font-face{font-family:'IBM Plex Mono';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/plexmono-${w}.woff2') format('woff2')}`),
  `html{--font-mono:'IBM Plex Mono'}`,
  // Lo que declara ui-v2/fonts.css (en producción lo importa el layout; aquí las rutas son de archivo):
  `[data-ui="v2"]{--font-sans-ui:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif;--font-display:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif}`,
].join('\n');

const envolver = (cuerpo: ReactNode, ruta: string) => {
  RUTA = ruta;
  return renderToStaticMarkup(
    <DashboardChromeV2 nombre="Ana Prueba" rol="flota_admin" perfil="cinco_agentes" cerrarSesion={async () => {}}>{cuerpo}</DashboardChromeV2>,
  );
};

const doc = (cuerpo: string, extra = '') =>
  `<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="file://${TRABAJO}/v2full.css"><style>${FUENTES_CSS}</style><style>*,*::before,*::after{transition:none!important;animation:none!important}</style></head><body>${cuerpo}${extra}</body></html>`;

describe('captura de las pantallas del carril C', () => {
  it('renderiza, compila el CSS y captura', async () => {
    mkdirSync(path.join(TRABAJO, 'vistas'), { recursive: true });
    mkdirSync(OUT, { recursive: true });
    for (const [id, v] of Object.entries(VISTAS)) {
      SENALES_RESUMEN.actuales = v.senales ?? VACIAS;
      writeFileSync(path.join(TRABAJO, 'vistas', `${id}.html`), envolver(await v.cuerpo(), v.ruta));
    }
    execFileSync('node', [path.join(raiz, 'scripts/ui2-captura/compilar-css.mjs'), TRABAJO], { stdio: 'ignore' });

    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const ANCHOS: Array<[number, number]> = [[1440, 900], [1024, 768], [412, 915]];
    for (const [w, h] of ANCHOS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', locale: 'es-MX' });
      const page = await ctx.newPage();
      for (const id of Object.keys(VISTAS)) {
        const html = doc(readFileSync(path.join(TRABAJO, 'vistas', `${id}.html`), 'utf8'));
        const archivo = path.join(TRABAJO, 'vistas', `${id}.doc.html`);
        writeFileSync(archivo, html);
        for (const tema of ['claro', 'oscuro'] as const) {
          await page.goto('file://' + archivo);
          await page.evaluate(async (t: string) => { document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark'); await document.fonts.ready; }, tema);
          await page.waitForTimeout(40);
          await page.screenshot({ path: path.join(OUT, `${id}__${w}__${tema}.png`), fullPage: w === 412 });
        }
      }

      // Recorrido: se mide el elemento REAL, se calcula foco y globo con las funciones del motor y se superpone.
      if (w !== 1024) {
        const total = RECORRIDO_DUENO.pasos.length;
        for (const [pasoId, vista] of PASOS_TOUR) {
          const i = RECORRIDO_DUENO.pasos.findIndex((p) => p.id === pasoId);
          const paso = RECORRIDO_DUENO.pasos[i];
          const base = readFileSync(path.join(TRABAJO, 'vistas', `${vista}.html`), 'utf8');
          const vp: Tam = { w, h };
          for (const tema of ['claro', 'oscuro'] as const) {
            const archivo = path.join(TRABAJO, 'vistas', `tour-${pasoId}.doc.html`);
            writeFileSync(archivo, doc(base));
            await page.goto('file://' + archivo);
            await page.evaluate(async (t: string) => { document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark'); await document.fonts.ready; }, tema);
            const rect: Rect | null = paso.ancla
              ? await page.evaluate((a: string) => {
                const el = [...document.querySelectorAll(`[data-tour="${a}"]`)].find((e) => (e as HTMLElement).offsetParent !== null) as HTMLElement | undefined;
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: r.x, y: r.y, w: r.width, h: r.height };
              }, paso.ancla)
              : null;
            const foco = rect ? rectFoco(rect, vp) : null;
            const snap: Instantanea = {
              fase: 'activo', indice: i, total, paso, anclaLista: true, navegando: false, reducirMovimiento: true,
              esPrimero: i === 0, esUltimo: i === total - 1,
            };
            const armar = (tam: Tam) => {
              const col = colocarGlobo(foco, tam, vp, paso.lado ?? 'auto');
              return renderToStaticMarkup(
                <div className="rv-tour" data-ui="v2" data-reducido>
                  <svg className="rv-tour__velo" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={trazoVelo(vp, foco)} fillRule="evenodd" /></svg>
                  {foco ? <div className="rv-tour__halo" style={{ transform: `translate(${foco.x}px, ${foco.y}px)`, width: foco.w, height: foco.h }} aria-hidden="true" /> : null}
                  <GloboTour snap={snap} col={col} onSiguiente={() => {}} onAtras={() => {}} onSaltar={() => {}} onMasTarde={() => {}} />
                </div>,
              );
            };
            await page.evaluate((m: string) => document.body.insertAdjacentHTML('beforeend', m), armar({ w: 340, h: 260 }));
            const medido = await page.evaluate(() => { const g = document.querySelector('.rv-tour__globo')!.getBoundingClientRect(); return { w: g.width, h: g.height }; });
            await page.evaluate(() => document.querySelector('.rv-tour')!.remove());
            await page.evaluate((m: string) => document.body.insertAdjacentHTML('beforeend', m), armar(medido));
            await page.waitForTimeout(40);
            await page.screenshot({ path: path.join(OUT, `tour-${String(i + 1).padStart(2, '0')}-${pasoId}__${w}__${tema}.png`) });
          }
        }
      }
      await ctx.close();
    }
    await browser.close();
  }, 600_000);
});
