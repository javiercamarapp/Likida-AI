// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS DE CAPTURAS · carril C, tanda 2. Pantallas A1 (Liquidación), A2 (Peajes), A3 (Carta Porte) y Conexiones, con
// fixtures SINTÉTICOS, en dos envolturas: chrome v1 (clásico) y chrome v2 (el que pone data-ui="v2").
//   UI2_C2_MODO = v1 | v2        qué chrome se renderiza
//   UI2_C2_CSS  = v1 | v2full    qué CSS se carga (v1 = solo globals.css; v2full = TODA la capa ui-v2, como el layout)
//   UI2_C2_OUT  = carpeta de salida de los PNG
// Invariancia v1: (MODO=v1, CSS=v1) contra (MODO=v1, CSS=v2full) deben dar PNG idénticos byte a byte.
// Uso: UI2_C2_MODO=v2 UI2_C2_CSS=v2full UI2_C2_OUT=/ruta npx vitest run --config scripts/ui2-captura/vitest.config.mts captura-c2
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { prerender } from 'react-dom/static';
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

const { default: DashboardChromeV2 } = await import('@/app/dashboard/shell/chrome-v2');
const { default: DashboardChromeV1 } = await import('@/app/dashboard/chrome');
const { VistaAgenteLiquidacion } = await import('@/app/dashboard/agentes/liquidacion/vista');
const { VistaAgentePeajes } = await import('@/app/dashboard/agentes/peajes/vista');
const { VistaAgenteCartaPorte } = await import('@/app/dashboard/agentes/carta-porte/vista');
const { VistaConexiones } = await import('@/app/dashboard/conexiones/vista');
import type { Conector } from '@/lib/likida/conexiones';
import type { ResumenDesglose } from '@/lib/likida/intake/desglose_peaje';
import { comprobarPaginaV2, exigirV2Css, exigirV2Html } from './exigir_v2';
import { DESGLOSE_PEAJES, KPIS_LIQUIDACION, USUARIO, cierresPorDia, colaRevision, diferenciasPorOperador, liquidaciones, textoInsight } from './fixtures/logistica_mx';

const raiz = path.resolve(__dirname, '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const MODO = (process.env.UI2_C2_MODO ?? 'v2') as 'v1' | 'v2';
const CSS = process.env.UI2_C2_CSS ?? (MODO === 'v2' ? 'v2full' : 'v1');
const OUT = process.env.UI2_C2_OUT ?? path.join(homedir(), 'likida-loop/frontend-plan/fase1/capturas-c2', `${MODO}-${CSS}`);
const TRABAJO = process.env.UI2_TRABAJO ?? path.join(homedir(), 'likida-loop/frontend-plan/.arnes-c');
const F = path.join(homedir(), 'likida-loop/frontend-plan/fuentes-spike');

// ── Fixtures sintéticos ────────────────────────────────────────────────────
const accion = async () => null;
const sufijo = '';

const liquidacion = () => (
  <VistaAgenteLiquidacion
    sufijo={sufijo}
    kpis={Promise.resolve(KPIS_LIQUIDACION)}
    liquidaciones={Promise.resolve(liquidaciones(8))}
    cola={{
      cola: Promise.resolve({ filas: colaRevision(12), total: 12, hayMas: false, siguiente: null }),
      filtros: { revision: 'pendiente', estado: null, operadorId: null, unidadId: null, terminalId: null, desde: null, hasta: null },
      terminales: Promise.resolve({ opciones: [{ id: 't1', nombre: 'Patio Monterrey' }, { id: 't2', nombre: 'Patio Querétaro' }], recortadas: false }),
      buscar: (async () => []) as never,
      contexto: [],
      sufijo,
    }}
    extra={{
      puedeVerReglas: true,
      ciclo: Promise.resolve({ abiertos: 14, enCuadre: 5, porRevisar: 3, liquidados: 128 }),
      cierresPorDia: Promise.resolve(cierresPorDia(84)),
      hizoSolo: Promise.resolve({ hechos: [], huerfanos: { resueltos: 4, totales: 5 }, docsProcesados: 12, actividadIa: 30 }),
      porTipo: Promise.resolve([{ tipo: 'casetas', monto: 9200, n: 4 }, { tipo: 'diesel', monto: 5860, n: 3 }] as never),
      operadores: Promise.resolve(diferenciasPorOperador()),
      politica: Promise.resolve(null),
    }}
  />
);

const DESGLOSE: ResumenDesglose = DESGLOSE_PEAJES;
const peajes = () => (
  <VistaAgentePeajes
    conciliacion={{ conciliadas: 212, porConciliar: 9, sinMatch: 4, cfdis: 6 } as never} lineas={null} desgloses={null} peajeAcreditable={12345} sufijo={sufijo}
    subirDesglose={accion} ejecutarAhora={accion}
    desglosesProveedor={[DESGLOSE]} desgloseSeleccionado={DESGLOSE}
    detalleSeleccionado={{ cuadra: [], noCuadra: [], sinContraparte: [] }}
    evidenciaGps={null} verificacion={null} importarDesglose={accion} conciliarDesglose={accion}
  />
);

const cartaPorte = () => (
  <VistaAgenteCartaPorte
    sufijo={sufijo}
    datos={{ viajes: [], total: 9, hazmatDeclarado: null, dedicadoDeclarado: null }}
    buzon={{ direccion: 'cartaporte@flota.ejemplo.test', activo: true, remitentes: ['logistica.ejemplo.test'], dominioConfigurado: true }}
  />
);

const CONECTORES: Conector[] = [
  { id: 'whatsapp', nombre: 'WhatsApp (choferes y oficina)', estado: 'listo', detalle: 'Variables del canal presentes en este entorno.', falta: [] },
  { id: 'correo', nombre: 'Correo de avisos', estado: 'incompleto', detalle: 'El envío está configurado; esta comprobación no verifica entrega, SPF ni DKIM.', falta: [] },
  { id: 'rastreo', nombre: 'Rastreo GPS (credenciales del proveedor)', estado: 'sin_configurar', detalle: 'Sin conectar — la credencial de tu proveedor se captura aquí abajo.', falta: ['capturar el acceso de tu proveedor de rastreo y probar la conexión'] },
  { id: 'timbrado', nombre: 'Emisión de CFDI (timbrado)', estado: 'ensayo', detalle: 'En ensayo por candado legal — decisión de negocio.', falta: [] },
  { id: 'sat', nombre: 'Rastreo en tiempo real', estado: 'no_medible', detalle: 'No se pudo leer el estado ahora mismo.', falta: [] },
];
const conexiones = () => (
  <VistaConexiones
    conectores={CONECTORES}
    credenciales={(
      <section className="card p-4">
        <h2 className="font-display text-[14px] font-semibold">Credenciales de tus sistemas</h2>
        <p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>Aquí va el formulario de captura del acceso.</p>
        <form className="mt-3 grid gap-2 max-w-md">
          <label className="text-[12px]" htmlFor="u">Usuario del proveedor</label>
          <input id="u" className="rounded-lg px-3 py-2 text-[13px] border" defaultValue="capturista@flota.ejemplo.test" />
          <label className="text-[12px]" htmlFor="s">Sistema</label>
          <select id="s" className="rounded-lg px-3 py-2 text-[13px] border"><option>Proveedor de rastreo</option></select>
          <button type="button" className="btn-primary rounded-lg px-3 py-2 text-[13px] w-fit">Guardar y probar</button>
        </form>
      </section>
    )}
  />
);

const VISTAS: Record<string, { ruta: string; cuerpo: () => ReactNode }> = {
  'a1-liquidacion': { ruta: '/dashboard/agentes/liquidacion', cuerpo: liquidacion },
  'a2-peajes': { ruta: '/dashboard/agentes/peajes', cuerpo: peajes },
  'a3-carta-porte': { ruta: '/dashboard/agentes/carta-porte', cuerpo: cartaPorte },
  'c4-conexiones': { ruta: '/dashboard/conexiones', cuerpo: conexiones },
};

const FUENTES_CSS = [
  ...[400, 500, 600, 700].map((w) => `@font-face{font-family:'Hanken Grotesk UI';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/hankengrotesk-${w}.woff2') format('woff2')}`),
  ...[400, 500, 600, 700].map((w) => `@font-face{font-family:'Inter';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/inter-${w}.woff2') format('woff2')}`),
  ...[500, 600, 700].map((w) => `@font-face{font-family:'Inter Tight';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/intertight-${w}.woff2') format('woff2')}`),
  ...[400, 500].map((w) => `@font-face{font-family:'IBM Plex Mono';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/plexmono-${w}.woff2') format('woff2')}`),
  // Lo que next/font deja en <html> en producción (v1) y lo que declara ui-v2/fonts.css bajo el alcance (v2).
  `html{--font-sans-ui:'Inter';--font-display:'Inter Tight';--font-mono:'IBM Plex Mono'}`,
  `[data-ui="v2"]{--font-sans-ui:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif;--font-display:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif}`,
].join('\n');

async function envolver(cuerpo: ReactNode, ruta: string): Promise<string> {
  RUTA = ruta;
  const Chrome = MODO === 'v2' ? DashboardChromeV2 : DashboardChromeV1;
  const arbol = <Chrome nombre={USUARIO.nombre} rol="flota_admin" perfil="cinco_agentes" cerrarSesion={async () => {}}>{cuerpo}</Chrome>;
  // prerender espera a TODOS los Suspense (los bloques async de A1) y deja el HTML final, sin plantillas ni scripts.
  const { prelude } = await prerender(arbol);
  const lector = prelude.getReader();
  const partes: string[] = [];
  const dec = new TextDecoder();
  for (;;) { const { done, value } = await lector.read(); if (done) break; partes.push(dec.decode(value, { stream: true })); }
  return partes.join('');
}

const doc = (cuerpo: string) =>
  `<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="file://${TRABAJO}/${CSS}.css"><style>${FUENTES_CSS}</style><style>*,*::before,*::after{transition:none!important;animation:none!important}</style></head><body>${cuerpo}</body></html>`;

describe(`captura carril C tanda 2 (${MODO} + ${CSS})`, () => {
  it('renderiza, compila el CSS y captura', async () => {
    void renderToStaticMarkup;
    mkdirSync(path.join(TRABAJO, 'vistas-c2'), { recursive: true });
    mkdirSync(OUT, { recursive: true });
    for (const [id, v] of Object.entries(VISTAS)) {
      const html = await envolver(v.cuerpo(), v.ruta);
      if (MODO === 'v2') exigirV2Html(html, id);
      writeFileSync(path.join(TRABAJO, 'vistas-c2', `${id}.html`), html);
      // Tailwind escanea esta carpeta: una copia por clase de envoltura basta (las clases son las mismas).
      writeFileSync(path.join(TRABAJO, 'vistas', `c2-${MODO}-${id}.html`), readFileSync(path.join(TRABAJO, 'vistas-c2', `${id}.html`), 'utf8'));
    }
    if (process.env.UI2_SOLO_HTML) return; // scripts/ui2-calidad: solo el HTML, sin CSS ni capturas
    execFileSync('node', [path.join(raiz, 'scripts/ui2-captura/compilar-css.mjs'), TRABAJO], { stdio: 'ignore' });

    if (MODO === 'v2' && CSS === 'v2full') exigirV2Css(path.join(TRABAJO, `${CSS}.css`));
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    for (const [w, h] of [[1440, 900], [1024, 768], [412, 915]] as Array<[number, number]>) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'es-MX' });
      const page = await ctx.newPage();
      for (const id of Object.keys(VISTAS)) {
        const archivo = path.join(TRABAJO, 'vistas-c2', `${id}.doc.html`);
        writeFileSync(archivo, doc(readFileSync(path.join(TRABAJO, 'vistas-c2', `${id}.html`), 'utf8')));
        for (const tema of ['claro', 'oscuro'] as const) {
          await page.goto('file://' + archivo);
          await page.evaluate(async (t: string) => { document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark'); await document.fonts.ready; }, tema);
          // Los Suspense resueltos por prerender se acomodan con un script en línea: se espera a que no quede plantilla pendiente.
          await page.waitForFunction(() => !document.querySelector('template[id^="B:"]') && !document.querySelector('[role="status"][aria-label="Cargando"]'), null, { timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(80);
          if (MODO === 'v2') { const motivo = await page.evaluate(comprobarPaginaV2); if (motivo) throw new Error(`ABORTO (${id} ${w} ${tema}): ${motivo}`); }
          await page.screenshot({ path: path.join(OUT, `${id}__${w}__${tema}.png`), fullPage: true });
        }
      }
      await ctx.close();
    }
    await browser.close();
  }, 600_000);
});
