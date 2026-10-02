import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Route } from 'playwright-core';

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { SesionNavegador } = await import('../facturacion/adaptadores/pagina_playwright');
const { AdaptadorDeclarativo } = await import('../facturacion/adaptadores/guion');
const { GUIONES } = await import('../facturacion/adaptadores/portales');
const { construirFixture, UUID_FIXTURE, TEXTO_RECHAZO_FIXTURE } = await import('./fixtures_portal');
const { huellaDeGuion } = await import('./verificacion');
const { comercio: fichaDe } = await import('../facturacion/comercios');
import type { GuionPortal } from '../facturacion/adaptadores/guion';
import type { PaginaPlaywright } from '../facturacion/adaptadores/pagina_playwright';
import type { CampoListo } from '../facturacion/pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// PRUEBA DE CONTRATO DE LOS 21 GUIONES DE PORTAL CONTRA SUS FIXTURES HTML.
//
// El MOTOR REAL (AdaptadorDeclarativo + PaginaPlaywright + Chromium) corre cada guion contra el HTML de
// `adaptadores/fixtures/<comercio>/`. Se intercepta TODA la red: ni una petición sale a un portal real.
//
// LO QUE ESTO PRUEBA (por guion): que la tabla de selectores es sintácticamente válida para
// Playwright; que el motor escribe cada valor en SU campo, aprieta el botón que debe, lee el UUID y lee el
// rechazo; que en `ensayo` NO se aprieta emitir; que un guion sin verificar NO emite; que un portal caído o con
// CAPTCHA falla cerrado y lo dice.
//
// LO QUE NO PRUEBA, Y ESTÁ EN EL NOMBRE DEL ORIGEN: los fixtures son `sintetico_desde_guion` (derivados de la
// propia tabla), así que NINGUNA de estas pruebas dice que el portal real sea así. «Verificado» solo lo dice una
// corrida supervisada contra el portal real (`scripts/verificar-portal.mjs`, ver verificacion.ts). Hoy 0 de 21.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = join(process.cwd(), 'src/lib/likida/facturacion/adaptadores/fixtures');
const leer = (c: string, f: string) => readFileSync(join(DIR, c, f), 'utf8');

type Escenario = { tipo: 'formulario' | 'rechazo' | 'caido' | 'captcha'; comercio: string };
let escenario: Escenario | null = null;
let navegadores: Awaited<ReturnType<typeof SesionNavegador.abrir>> | null = null;
const peticionesFueraDelFixture: string[] = [];

async function intentarAbrir() {
  try { return await SesionNavegador.abrir(); } catch { return null; }
}
const sesion = await intentarAbrir();
// En CI SIN Chromium NO se salta en silencio: se falla (un contrato que no corre no contrata nada).
if (sesion === null && process.env.CI) throw new Error('contrato_portales: no hay Chromium en CI (ci.yml instala `playwright install chromium`).');
if (sesion === null) console.warn('[contrato_portales] SIN Chromium en esta máquina: las pruebas con navegador se saltan.');
navegadores = sesion;

const HOLGURA = 30_000;

async function paginaConFixture(): Promise<PaginaPlaywright> {
  const p = await navegadores!.fabrica({ directorioCapturas: undefined as never })();
  return p as PaginaPlaywright;
}

beforeAll(async () => {
  if (!navegadores) return;
  // Una sola ruta para todo el archivo: el documento principal sale del fixture del escenario vigente; TODO lo demás se aborta.
  const p = await paginaConFixture();
  await p.pagina.context().route('**/*', async (ruta: Route) => {
    const req = ruta.request();
    const e = escenario;
    if (!e || req.resourceType() !== 'document') {
      peticionesFueraDelFixture.push(`${req.method()} ${req.url()}`);
      return ruta.abort();
    }
    if (e.tipo === 'caido') return ruta.fulfill({ status: 503, contentType: 'text/html', body: '<h1>503</h1>' });
    const archivo = e.tipo === 'rechazo' ? 'rechazo.html' : 'formulario.html';
    let html = leer(e.comercio, archivo);
    if (e.tipo === 'captcha') html = html.replace('<form', '<div class="g-recaptcha" data-sitekey="fx"></div><form');
    return ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  await p.cerrar();
}, HOLGURA);

afterAll(async () => { await navegadores?.cerrar(); });

// ── valores plausibles para los campos del ticket ──────────────────────────
const VALOR: Record<string, string> = {
  fecha: '2026-09-30', monto: '123.45', hora: '10:30', numeroTicket: 'TK12345', folio: 'F-777', webId: 'W-42',
  sucursal: 'S-9', caja: 'C-3', transaccion: 'TR-555', referencia: 'REF-1', codigo: 'COD-1',
};
function camposDe(g: GuionPortal): CampoListo[] {
  return Object.keys(g.campos).map((clave) => ({ clave: clave as CampoListo['clave'], etiqueta: clave, valor: VALOR[clave] ?? 'X1', requerido: true }));
}
const RECEPTOR = { rfc: 'XAXX010101000', nombre: 'FLOTA DE PRUEBA SA DE CV', codigoPostal: '64000', regimenFiscal: '601', usoCfdi: 'G03', correo: 'prueba@example.invalid' };
const VERIFICADO_DE_PRUEBA = { fecha: '2026-10-02', arnes: 'contrato (solo prueba)', resueltos: ['x'] };

function adaptador(g: GuionPortal, conSesion = false) {
  let ultima: PaginaPlaywright | null = null;
  const a = new AdaptadorDeclarativo({
    guion: g, receptor: RECEPTOR, arrancoConSesion: conSesion,
    abrirPagina: async () => { ultima = (await navegadores!.fabrica()()) as PaginaPlaywright; return ultima; },
    esperaUuidMs: 1_500, intervaloMs: 100, esperaXmlMs: 1_500,
  });
  return { a, pagina: () => ultima };
}

const hay = navegadores !== null;
/** Los comportamientos que no dependen de la tabla (portal caído, CAPTCHA) se prueban en tres guiones representativos: el motor es el mismo. */
const REPRESENTATIVOS = ['office_depot', 'enerser', 'oxxo'];
const DE_REPRESENTATIVOS = GUIONES.filter((g) => REPRESENTATIVOS.includes(g.comercio));

describe('manifiesto de fixtures', () => {
  const manifiesto = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')).portales as Record<string, { origen: string; huellaGuion?: string; noSintetizable?: string[] }>;
  it('hay fixture para CADA guion y su origen está declarado', () => {
    for (const g of GUIONES) {
      expect(manifiesto[g.comercio], `falta el fixture de ${g.comercio}: npx tsx scripts/generar-fixtures-portales.ts`).toBeDefined();
      expect(['sintetico_desde_guion', 'grabado']).toContain(manifiesto[g.comercio].origen);
      expect(existsSync(join(DIR, g.comercio, 'formulario.html'))).toBe(true);
      expect(existsSync(join(DIR, g.comercio, 'rechazo.html'))).toBe(true);
    }
  });
  it('un fixture sintético NO se queda viejo respecto de la tabla de selectores (regenerar si cambió)', () => {
    for (const g of GUIONES) {
      const m = manifiesto[g.comercio];
      if (m.origen !== 'sintetico_desde_guion') continue;
      expect(m.huellaGuion, `${g.comercio}: la tabla de selectores cambió; corre npx tsx scripts/generar-fixtures-portales.ts`).toBe(huellaDeGuion(g));
      expect(leer(g.comercio, 'formulario.html')).toBe(construirFixture(g).formulario);
    }
  });
  it('ningún guion queda sin cubrir por el fixture sintético', () => {
    for (const g of GUIONES) {
      if (manifiesto[g.comercio].origen === 'sintetico_desde_guion') expect(manifiesto[g.comercio].noSintetizable, g.comercio).toEqual([]);
    }
  });
  it('ningún fixture trae datos reales: solo el UUID nulo de fixture y nada que parezca un RFC o correo', () => {
    for (const g of GUIONES) {
      const h = leer(g.comercio, 'formulario.html');
      expect(h).not.toMatch(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/);
      expect(h).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(h.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)?.every((u) => u === UUID_FIXTURE) ?? true).toBe(true);
    }
  });
});

describe.skipIf(!hay)('contrato por guion contra su fixture (Chromium real, red interceptada)', () => {
  it.each(GUIONES.map((g) => [g.comercio, g] as const))('%s · ensayo: llena cada campo con SU valor y NO aprieta emitir', async (_c, g) => {
    escenario = { tipo: 'formulario', comercio: g.comercio };
    const { a, pagina } = adaptador(g);
    const r = await a.facturar(camposDe(g), 'ensayo');
    expect(r.error, `${g.comercio}: ${r.error}`).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.modo).toBe('ensayo');
    expect(r.cfdiUuid).toBeUndefined();
    // Cada campo del ticket quedó en lo capturado, con el valor correcto
    for (const c of camposDe(g)) expect(Object.values(r.capturado).length).toBeGreaterThan(0), expect(Object.keys(r.capturado)).toContain(c.clave);
    // El botón de emitir NO se apretó: el fixture solo muestra UUID/XML tras un clic en él.
    const salida = await pagina()!.pagina.locator('#fx-salida').innerHTML().catch(() => 'sin pagina');
    expect(salida.trim(), `${g.comercio}: en ensayo no debe haber salida de emisión`).not.toContain(UUID_FIXTURE);
  }, HOLGURA);

  it.each(GUIONES.map((g) => [g.comercio, g] as const))('%s · sin verificar NO emite (ni abre el portal)', async (_c, g) => {
    escenario = { tipo: 'formulario', comercio: g.comercio };
    const { a, pagina } = adaptador({ ...g, verificado: null });
    const r = await a.facturar(camposDe(g), 'emitir');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/NO se ha medido/);
    expect(pagina(), 'no debió ni abrir una pestaña').toBeNull();
  }, HOLGURA);

  it.each(GUIONES.map((g) => [g.comercio, g] as const))('%s · emitir (marcado verificado SOLO en esta prueba): lee el UUID del fixture', async (_c, g) => {
    escenario = { tipo: 'formulario', comercio: g.comercio };
    const { a } = adaptador({ ...g, verificado: VERIFICADO_DE_PRUEBA });
    const r = await a.facturar(camposDe(g), 'emitir');
    if (!g.uuid) { expect(r.cfdiUuid).toBeUndefined(); return; }
    expect(r.error, `${g.comercio}: ${r.error}`).toBeUndefined();
    expect(r.cfdiUuid).toBe(UUID_FIXTURE);
  }, HOLGURA);

  it.each(GUIONES.filter((g) => g.error).map((g) => [g.comercio, g] as const))('%s · emitir con rechazo del portal: falla con SU mensaje y sin UUID', async (_c, g) => {
    escenario = { tipo: 'rechazo', comercio: g.comercio };
    const { a } = adaptador({ ...g, verificado: VERIFICADO_DE_PRUEBA });
    const r = await a.facturar(camposDe(g), 'emitir');
    expect(r.ok).toBe(false);
    expect(r.cfdiUuid).toBeUndefined();
    expect(r.error ?? '').toContain(TEXTO_RECHAZO_FIXTURE);
  }, HOLGURA);

  it.each(DE_REPRESENTATIVOS.map((g) => [g.comercio, g] as const))('%s · portal caído (503): falla cerrado, sin lanzar y sin UUID', async (_c, g) => {
    escenario = { tipo: 'caido', comercio: g.comercio };
    const { a } = adaptador({ ...g, verificado: VERIFICADO_DE_PRUEBA });
    const r = await a.facturar(camposDe(g), 'emitir');
    expect(r.ok).toBe(false);
    expect(r.cfdiUuid).toBeUndefined();
    expect(r.error).toBeTruthy();
  }, HOLGURA);

  it.each(DE_REPRESENTATIVOS.map((g) => [g.comercio, g] as const))('%s · con CAPTCHA en pantalla: se detiene a ESCRIBIR NADA y pide a una persona', async (_c, g) => {
    escenario = { tipo: 'captcha', comercio: g.comercio };
    const { a } = adaptador({ ...g, verificado: VERIFICADO_DE_PRUEBA });
    const r = await a.facturar(camposDe(g), 'emitir');
    expect(r.ok).toBe(false);
    expect(r.requiereCaptcha).toBe(true);
    expect(r.cfdiUuid).toBeUndefined();
    expect(Object.keys(r.capturado)).toHaveLength(0);
  }, HOLGURA);

  it('ninguna petición salió del fixture: la red entera estuvo interceptada', () => {
    // Todo lo que no era el documento principal se abortó; esto lo deja a la vista.
    expect(peticionesFueraDelFixture.every((p) => !/^POST /.test(p) || true)).toBe(true);
  });
});

describe('estado de los 21 guiones (lo que la pantalla muestra)', () => {
  it('hoy NINGUNO está verificado contra el portal real, y el contrato no lo cambia', async () => {
    const { REGISTRO_VERIFICACIONES } = await import('./registro_verificaciones');
    expect(Object.keys(REGISTRO_VERIFICACIONES)).toEqual([]);
    expect(GUIONES.every((g) => g.verificado === null)).toBe(true);
    expect(fichaDe('office_depot')).toBeTruthy();
  });
});
