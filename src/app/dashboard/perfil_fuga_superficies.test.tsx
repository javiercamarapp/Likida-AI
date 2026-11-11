import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup, renderToReadableStream } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// T-PER-02 · FUGAS bajo el perfil `cinco_agentes`: Resumen, Notificaciones,
// widget de uso de IA y enlaces de «Suscripción» / «Admin».
//
// Datos 100 % sintéticos. Los títulos «prohibidos» del Resumen son los de las
// tarjetas de dinero y fiscal del Resumen de una flota normal (el respaldo v1,
// `inicio-contenido.tsx`, de donde antes se leían, se retiró el 11-nov-2026).
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ refresh() {}, replace() {}, push() {} }),
  redirect: (d: string) => { throw new Error(`REDIRECT:${d}`); },
}));

const dobles = vi.hoisted(() => ({
  ultimasCorridas: vi.fn(),
  perfil: null as string | null,
  sesion: { tenantId: 't-1', rol: 'flota_admin' } as { tenantId: string; rol: string },
}));

vi.mock('@/lib/likida/agentes/corridas', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ultimasCorridas: dobles.ultimasCorridas,
}));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => dobles.sesion }));
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => dobles.perfil }));
vi.mock('@/lib/likida/analytics', () => ({
  getKpis: async () => ({ porRevisar: 2 }),
  detectarAnomalias: async () => [{ id: 'a-1' }, { id: 'a-2' }],
  contarEscalados: async () => 1,
}));
vi.mock('@/lib/likida/repo', () => ({ contarHuerfanosPendientes: async () => 3 }));
vi.mock('@/lib/likida/conexiones', () => ({
  getConexiones: async () => [{ id: 'gps', nombre: 'Rastreo', estado: 'incompleto', falta: ['la credencial'] }],
}));
vi.mock('@/lib/likida/orquestador/fuentes', () => ({
  fuentes: () => ({ escalacionesAbiertas: async () => [], entradaTablero: async () => ({}) }),
}));
vi.mock('@/lib/likida/orquestador/fuentes_reales', () => ({}));
vi.mock('@/lib/likida/orquestador/tablero_viajes', () => ({
  armarTableroViajes: () => ({ conteos: { conExcepcion: 2, sinSenal: 1 } }),
}));
vi.mock('@/lib/saludo', async (orig) => ({ ...(await orig<Record<string, unknown>>()), ahoraMs: () => Date.parse('2026-10-02T18:00:00.000Z') }));
vi.mock('@/app/ui-v2/avisos/pagina-avisos', () => ({ default: () => null }));
// El Resumen del perfil (v2) lee por estos tres lectores: se sustituyen por datos sintéticos (las corridas siguen saliendo de `dobles.ultimasCorridas`).
vi.mock('./sin-flota', () => ({ AvisoSinFlota: () => null }));
vi.mock('./inicio-cinco-lectores', () => ({
  leerPesosInicio: async () => null,
  leerUltimasCorridas: async () => {
    const vacias = { liquidacion: undefined, peajes: undefined, carta_porte: undefined, vigia: undefined, conductor: undefined };
    try { return { ...vacias, liquidacion: (await dobles.ultimasCorridas())[0] }; } catch { return { liquidacion: null, peajes: null, carta_porte: null, vigia: null, conductor: null }; }
  },
  leerViajesEnCurso: async () => 0,
}));
vi.mock('./resumen-datos', async () => ({ ...(await import('./resumen-modelo')), leerDatosResumen: async () => ({
  rango: '30', hoy: '2026-10-02', veDinero: false, peajes: null, porTipo: null, kpis: null, cartaPorte: null, cierres: [], hechos: [], escalados: null,
}) }));
vi.mock('@/lib/likida/asistente/senales', () => ({ leerSenalesAsistente: async () => null }));

const RAIZ = process.cwd();
const { InicioCincoAgentes, FICHAS_CINCO_AGENTES } = await import('./inicio-cinco-agentes');
const { default: PaginaNotificaciones } = await import('./notificaciones/page');
const { calcularAlertasFlota } = await import('./calcular-alertas-flota');
const { vaciarCacheAvisosFlota } = await import('@/app/ui-v2/avisos/fuente-flota');
const { default: DashboardChrome } = await import('./chrome');
const { SidebarAbajo } = await import('./sidebar-nav');
const { puedeVerRuta, RUTAS_PERFIL_CINCO_AGENTES, MODULOS_PROXIMAMENTE_PERFIL, moduloProximamenteDeRuta, rutaProximamente } = await import('@/lib/auth/visibilidad');

// «Próximamente» (fase 1): vigia y conductor se enlazan a su pantalla única, que gatea con /dashboard (siempre permitido).
const PANTALLAS_PROXIMAMENTE = MODULOS_PROXIMAMENTE_PERFIL.map((m) => rutaProximamente(m));
const PERMITIDAS = [...Object.keys(RUTAS_PERFIL_CINCO_AGENTES), ...PANTALLAS_PROXIMAMENTE];
/** A dónde apunta la tarjeta de una ficha bajo el perfil: su pantalla «Próximamente» si el módulo aún no se opera. */
const destinoDeFicha = (href: string) => {
  const m = moduloProximamenteDeRuta('cinco_agentes', href);
  return m ? rutaProximamente(m) : href;
};
const hrefsDe = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
/**
 * Texto visible de un HTML renderizado: quita las ETIQUETAS y, antes que nada, el contenido de `<script>` —
 * nunca es texto que una persona lee. Hace falta porque `renderToReadableStream` con `Suspense` (las tarjetas
 * `async` del Resumen) inyecta scripts de arranque de streaming (`$RC(...)`, `$RT=...`, `$RB=[]`) cuyos literales
 * con `$` y dígitos sueltos los regex de "nada de dinero"/"nunca un cero" de abajo atrapaban como falso positivo —
 * no es dinero filtrándose, es hidratación de React. Sin quitar el script, cualquier regex de texto visible
 * queda expuesto al mismo falso positivo.
 */
const texto = (html: string) => html.replace(/<script[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/** Lo que la página de Notificaciones le entrega a la pantalla de avisos (el elemento devuelto lleva la fuente de avisos en sus props). */
async function alertasDeLaPagina(): Promise<Array<{ id: string; href: string }>> {
  const el = (await PaginaNotificaciones({ searchParams: Promise.resolve({}) })) as { props: { children: { props: { fuente: { avisos: Array<{ clave: string; href: string | null }> } } } } };
  const avisos = el.props.children.props.fuente.avisos;
  expect(Array.isArray(avisos)).toBe(true);
  return avisos.map((a) => ({ id: a.clave.replace(/^flota:/, ''), href: a.href ?? '' }));
}

/** Renderiza un componente async (el Resumen trae tarjetas `async` dentro de Suspense) hasta que todo esté listo. */
async function aHtml(el: React.ReactElement): Promise<string> {
  const flujo = await renderToReadableStream(el);
  await flujo.allReady;
  return new Response(flujo).text();
}

beforeEach(() => {
  vaciarCacheAvisosFlota();
  dobles.perfil = null;
  dobles.sesion = { tenantId: 't-1', rol: 'flota_admin' };
  dobles.ultimasCorridas.mockReset();
  dobles.ultimasCorridas.mockResolvedValue([]);
});

// ── (c) Resumen ─────────────────────────────────────────────────────────────
describe('(c) Resumen: nada de dinero ni de fiscal bajo el perfil', () => {
  /** Títulos de las tarjetas de dinero y fiscal del Resumen de una flota normal: ninguno puede aparecer bajo el perfil. */
  const titulosDeDinero = ['Gasto total', 'Costo por viaje', 'Por recuperar', 'Diésel elegible para el estímulo', 'Tu motor fiscal', 'IVA acreditable'];

  it('los títulos vetados siguen siendo rótulos reales del producto (si no, la prueba no vigilaría nada)', () => {
    const dir = join(RAIZ, 'src/lib/i18n/es');
    const dic = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    for (const titulo of ['Costo por viaje', 'Diésel elegible para el estímulo', 'Tu motor fiscal']) expect(dic, titulo).toContain(titulo);
  });

  it('el Resumen del perfil no contiene ninguno de esos títulos, ni pesos, ni chat, ni suscripción', async () => {
    const html = await aHtml(<InicioCincoAgentes tenantId="t-1" tenantNombre={null} nombre="Ana" />);
    const t = texto(html);
    expect(t).toContain('Tus cinco agentes');
    for (const titulo of titulosDeDinero) expect(t, `«${titulo}»`).not.toContain(titulo);
    expect(t).not.toMatch(/\$|MXN|pesos|ahorro|estímulo|fiscal|gasto|costo|margen|cartera|cobranza|factur|suscripci|plan y|Pregunta a tus datos/i);
  });

  it('muestra los cinco agentes, cada uno con su enlace permitido, y ningún enlace fuera de la lista cerrada', async () => {
    const html = await aHtml(<InicioCincoAgentes tenantId="t-1" tenantNombre={null} nombre="Ana" rol="flota_admin" />);
    const hrefs = hrefsDe(html);
    for (const f of FICHAS_CINCO_AGENTES) expect(hrefs, f.nombre).toContain(destinoDeFicha(f.href));
    expect(FICHAS_CINCO_AGENTES.map((f) => f.clave)).toEqual(['liquidacion', 'peajes', 'carta_porte', 'vigia', 'conductor']);
    for (const h of hrefs) expect(PERMITIDAS, h).toContain(h.split('?')[0]);
  });

  it('con una corrida registrada solo enseña estado y hora, nunca una cifra de dinero; sin corrida lo dice', async () => {
    dobles.ultimasCorridas.mockResolvedValueOnce([{ id: 'c', inicio: '2026-10-02T12:00:00.000Z', fin: null, estado: 'ok', disparo: 'cron', tareasHechas: null, tareasTotal: null, resumen: null, error: null, duracionMs: 4000 }]);
    const html = await aHtml(<InicioCincoAgentes tenantId="t-1" tenantNombre={null} nombre="Ana" />);
    const t = texto(html);
    expect(t).toMatch(/Corrió hoy \d{2}:\d{2}/);
    expect(t).toContain('Sin corridas: abre su tablero');
    expect(t).not.toMatch(/\$/);
  });

  it('si la lectura de corridas falla, la tarjeta lo confiesa (no es un cero)', async () => {
    dobles.ultimasCorridas.mockRejectedValue(new Error('base caída'));
    const t = texto(await aHtml(<InicioCincoAgentes tenantId="t-1" tenantNombre={null} nombre="Ana" />));
    expect(t).toContain('No se pudo leer la última corrida');
    expect(t).not.toMatch(/\b0 (corridas|agentes)\b/);
  });

  it('texto() sigue atrapando un monto real (no es que el falso positivo se "arregló" debilitando la protección)', () => {
    expect(texto('<div>Total: $1,234.50 MXN</div>')).toMatch(/\$/);
    expect(texto('<div>Total: $1,234.50 MXN</div><script>$RC("B:1","S:1")</script>')).toMatch(/\$/);
  });

  it('la fuente del Resumen del perfil no importa nada de dinero, fiscal, analítica ni chat', () => {
    const src = readFileSync(join(RAIZ, 'src/app/dashboard/inicio-cinco-agentes.tsx'), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(3);
    for (const i of imports) expect(i, i).not.toMatch(/analytics|fiscal|kpi|rentabilidad|factur|cobranza|suscripcion|chat|motor/i);
  });
});

// ── (d) Notificaciones ──────────────────────────────────────────────────────
describe('(d) Notificaciones: filtra por área permitida', () => {
  /** Todas las señales encendidas a la vez, para que cada alerta posible aparezca si el filtro no la corta. */
  const TODAS = {
    porRevisar: 2, duplicados: 2, escalados: 1, huerfanos: 3,
    conectores: [{ id: 'gps', nombre: 'Rastreo', estado: 'incompleto' as const, falta: ['la credencial'] }],
    tareasAsistente: 1, excepcionesConductor: 2, sinSenalDeVida: 1,
  };

  it('pura: sin predicado salen las de dinero/oficina; con el predicado del perfil solo las de rutas permitidas', () => {
    const sin = calcularAlertasFlota(TODAS as never);
    const con = calcularAlertasFlota(TODAS as never, '', (href) => puedeVerRuta('flota_admin', href, 'cinco_agentes'));
    expect(sin.map((a) => a.href)).toContain('/dashboard/huerfanos');
    expect(con.length).toBeGreaterThan(0);
    expect(con.length).toBeLessThan(sin.length);
    for (const a of con) expect(PERMITIDAS, a.id).toContain(a.href);
    expect(con.map((a) => a.id).filter((id) => /huerfanos|duplicados/.test(id))).toEqual([]);
  });

  it('pura: lo que el perfil conserva es exactamente lo que ya veía el rol, menos lo de stand-by (el perfil solo quita)', () => {
    for (const rol of ['flota_admin', 'encargado', 'contador', 'superadmin']) {
      const sinPerfil = calcularAlertasFlota(TODAS as never, '', (h) => puedeVerRuta(rol, h)).map((a) => a.id);
      const conPerfil = calcularAlertasFlota(TODAS as never, '', (h) => puedeVerRuta(rol, h, 'cinco_agentes')).map((a) => a.id);
      for (const id of conPerfil) expect(sinPerfil, `${rol} ${id}`).toContain(id);
    }
  });

  it.each(['flota_admin', 'encargado', 'contador', 'superadmin'])('la PÁGINA con perfil entrega al listado solo alertas de rutas permitidas (rol %s)', async (rol) => {
    dobles.perfil = 'cinco_agentes';
    dobles.sesion = { tenantId: 't-1', rol };
    const alertas = await alertasDeLaPagina();
    for (const a of alertas) expect(PERMITIDAS, `${rol} ${a.id}`).toContain(a.href.split('?')[0]);
    expect(alertas.map((a) => a.id).filter((id) => /huerfanos|duplicados/.test(id))).toEqual([]);
  });

  it('par de control: SIN perfil la página entrega también huérfanos y duplicados, como hoy', async () => {
    dobles.perfil = null;
    const ids = (await alertasDeLaPagina()).map((a) => a.id);
    expect(ids.some((id) => id.startsWith('huerfanos:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('duplicados:'))).toBe(true);
  });

  it('con perfil el dueño SÍ conserva las alertas de los cinco agentes (viajes en vivo, escalados, conexiones)', async () => {
    dobles.perfil = 'cinco_agentes';
    const hrefs = (await alertasDeLaPagina()).map((a) => a.href);
    expect(hrefs).toContain('/dashboard/viajes-en-vivo');
    expect(hrefs).toContain('/dashboard/viajes');
    expect(hrefs).toContain('/dashboard/conexiones');
  });
});

// ── (e) Widget de uso de IA y enlaces «Suscripción» / «Admin» ───────────────
describe('(e) widget de uso de IA y enlaces de suscripción / admin', () => {
  const chrome = (rol: string, perfil: 'cinco_agentes' | null) => renderToStaticMarkup(
    <DashboardChrome nombre="Ana" rol={rol} cerrarSesion={async () => {}} usoIa={{ pct: 40 }} perfil={perfil}>
      <div />
    </DashboardChrome>,
  );

  it.each(['flota_admin', 'superadmin', 'encargado', 'contador'])('CON perfil (%s) el marco no pinta el widget de uso de IA', (rol) => {
    const html = chrome(rol, 'cinco_agentes');
    expect(texto(html)).not.toContain('Análisis con IA');
    expect(html).not.toContain('40%');
  });

  it.each(['flota_admin', 'superadmin', 'encargado'])('CON perfil (%s) no hay un solo enlace a Suscripción, Plan, Admin, llaves ni usuarios (el chat sí: se abrió el 11-nov)', (rol) => {
    const html = chrome(rol, 'cinco_agentes');
    const hrefs = hrefsDe(html);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const h of hrefs) {
      if (h.startsWith('#') || h === '/cuenta' || h.startsWith('/cuenta?')) continue; // ancla de accesibilidad y cerrar sesión/cuenta
      expect(PERMITIDAS, h).toContain(h.split('?')[0]);
      expect(h, h).not.toMatch(/^\/(?:dashboard\/)?(?:admin|suscripcion|llaves-api|usuarios|sesiones-mcp)(?:\/|$|\?)/);
    }
    expect(texto(html)).not.toMatch(/Plan y facturaci|Suscripci|Llaves de API|Sesiones MCP/);
  });

  it('SidebarAbajo con perfil no pinta «Plan y facturación» ni el widget aunque se le pase usoIa', () => {
    const html = renderToStaticMarkup(<SidebarAbajo rol="flota_admin" perfil="cinco_agentes" usoIa={{ pct: 10 }} />);
    expect(hrefsDe(html)).not.toContain('/dashboard/suscripcion');
    expect(texto(html)).not.toMatch(/Plan y facturaci|Análisis con IA/);
  });

  it('par de control SIN perfil: el dueño sigue viendo el widget y «Plan y facturación»', () => {
    const html = chrome('flota_admin', null);
    expect(texto(html)).toContain('Análisis con IA');
    expect(hrefsDe(html)).toContain('/dashboard/suscripcion');
    expect(hrefsDe(html)).toContain('/dashboard/configuracion');
  });

  it('el layout NO calcula el uso de IA bajo el perfil (la guarda `!perfil` está en el origen del dato, no solo en el render)', () => {
    const src = readFileSync(join(RAIZ, 'src/app/dashboard/layout.tsx'), 'utf8');
    expect(src).toMatch(/if \(!perfil && sesion\.rol !== 'superadmin'/);
    // Y `usoIa` solo se asigna dentro de ese bloque.
    const asignaciones = [...src.matchAll(/usoIa = /g)].length;
    expect(asignaciones).toBeGreaterThanOrEqual(1);
    expect(src.indexOf('usoIa = ')).toBeGreaterThan(src.indexOf('if (!perfil'));
  });
});
