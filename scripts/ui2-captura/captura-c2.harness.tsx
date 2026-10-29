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

const raiz = path.resolve(__dirname, '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const MODO = (process.env.UI2_C2_MODO ?? 'v2') as 'v1' | 'v2';
const CSS = process.env.UI2_C2_CSS ?? (MODO === 'v2' ? 'v2full' : 'v1');
const OUT = process.env.UI2_C2_OUT ?? path.join(homedir(), 'likida-loop/frontend-plan/fase1/capturas-c2', `${MODO}-${CSS}`);
const TRABAJO = path.join(homedir(), 'likida-loop/frontend-plan/.arnes-c');
const F = path.join(homedir(), 'likida-loop/frontend-plan/fuentes-spike');

// ── Fixtures sintéticos ────────────────────────────────────────────────────
const accion = async () => null;
const sufijo = '';

const liquidacion = () => (
  <VistaAgenteLiquidacion
    sufijo={sufijo}
    kpis={Promise.resolve({ viajesLiquidados: 128, montoComprobado: 4_825_000, diferenciaDetectada: 18_400, conDiferencias: 7, porRevisar: 3, tasaCuadre: 94 })}
    liquidaciones={Promise.resolve([
      { id: 'l1', folio: 'V-1042', creadoEn: '2026-10-27T15:10:00Z', comprobado: 8450, diferencia: 0, estatus: 'cuadrada' },
      { id: 'l2', folio: 'V-1041', creadoEn: '2026-10-27T11:02:00Z', comprobado: 6120.5, diferencia: -320, estatus: 'con_diferencias' },
      { id: 'l3', folio: 'V-1039', creadoEn: '2026-10-26T18:40:00Z', comprobado: 9980, diferencia: 1250, estatus: 'revisar' },
    ])}
    cola={{
      cola: Promise.resolve({
        filas: [
          { id: 'c1', viajeId: 'v1', folio: 'V-1041', creadoEn: '2026-10-27T11:02:00Z', comprobado: 6120.5, anticipo: 6440.5, diferencia: -320, estatus: 'con_diferencias', revision: 'pendiente', operadorNombre: 'Operador de prueba 1', unidadEco: 'U-12', terminalNombre: 'Terminal Norte' },
          { id: 'c2', viajeId: 'v2', folio: 'V-1039', creadoEn: '2026-10-26T18:40:00Z', comprobado: 9980, anticipo: 8730, diferencia: 1250, estatus: 'revisar', revision: 'pendiente', operadorNombre: 'Operador de prueba 2', unidadEco: 'U-07', terminalNombre: 'Terminal Sur' },
        ],
        total: 2, hayMas: false, siguiente: null,
      }),
      filtros: { revision: 'pendiente', estado: null, operadorId: null, unidadId: null, terminalId: null, desde: null, hasta: null },
      terminales: Promise.resolve({ opciones: [{ id: 't1', nombre: 'Terminal Norte' }], recortadas: false }),
      buscar: (async () => []) as never,
      contexto: [],
      sufijo,
    }}
    extra={{
      puedeVerReglas: true,
      ciclo: Promise.resolve({ abiertos: 14, enCuadre: 5, porRevisar: 3, liquidados: 128 }),
      cierresPorDia: Promise.resolve(Array.from({ length: 84 }, (_, i) => ({ fecha: new Date(Date.UTC(2026, 6, 6 + i)).toISOString().slice(0, 10), valor: (i * 7) % 5 }))),
      hizoSolo: Promise.resolve({ hechos: [], huerfanos: { resueltos: 4, totales: 5 }, docsProcesados: 12, actividadIa: 30 }),
      porTipo: Promise.resolve([{ tipo: 'casetas', monto: 9200, n: 4 }] as never),
      operadores: Promise.resolve([{ etiqueta: 'Operador de prueba 1', valor: 4200 }, { etiqueta: 'Operador de prueba 2', valor: 2100 }]),
      politica: Promise.resolve(null),
    }}
  />
);

const DESGLOSE: ResumenDesglose = {
  desgloseId: 'd1', proveedor: 'PROVEEDOR DE PRUEBA', archivoNombre: 'corte-muestra.csv', periodoDesde: '2026-10-01', periodoHasta: '2026-10-15',
  creadoEn: '2026-10-16T00:00:00Z', total: 48, cuadra: 40, noCuadra: 3, sinContraparte: 5, pctCuadra: 83,
};
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
    buzon={{ direccion: 'cp-muestra@correo.ejemplo.test', activo: true, remitentes: ['cliente.ejemplo.test'], dominioConfigurado: true }}
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
        <p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>Fixture: formulario de captura.</p>
        <form className="mt-3 grid gap-2 max-w-md">
          <label className="text-[12px]" htmlFor="u">Usuario del proveedor</label>
          <input id="u" className="rounded-lg px-3 py-2 text-[13px] border" defaultValue="usuario-muestra" />
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
  const arbol = <Chrome nombre="Ana Prueba" rol="flota_admin" perfil="cinco_agentes" cerrarSesion={async () => {}}>{cuerpo}</Chrome>;
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
      writeFileSync(path.join(TRABAJO, 'vistas-c2', `${id}.html`), await envolver(v.cuerpo(), v.ruta));
      // Tailwind escanea esta carpeta: una copia por clase de envoltura basta (las clases son las mismas).
      writeFileSync(path.join(TRABAJO, 'vistas', `c2-${MODO}-${id}.html`), readFileSync(path.join(TRABAJO, 'vistas-c2', `${id}.html`), 'utf8'));
    }
    execFileSync('node', [path.join(raiz, 'scripts/ui2-captura/compilar-css.mjs'), TRABAJO], { stdio: 'ignore' });

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
          await page.screenshot({ path: path.join(OUT, `${id}__${w}__${tema}.png`), fullPage: true });
        }
      }
      await ctx.close();
    }
    await browser.close();
  }, 600_000);
});
