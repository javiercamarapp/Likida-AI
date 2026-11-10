import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// A37-S05-01/S06-01: la página ahora llama su propia puerta; aquí la sesión es de superadmin.
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: vi.fn(async () => ({ rol: 'superadmin', tenantId: null, nombre: 'Prueba' })) }));

// ═══════════════════════════════════════════════════════════════════════════
// /admin/salud-sistema — CERO cobertura de la PÁGINA (sentryActivo,
// correoConfigurado, cofreConfigurado, redisConfigurado, envHealth ya tienen
// prueba propia en sus módulos). Sin server actions. Lo real que se vigila:
// esta pantalla existió antes con semáforos FIJOS en verde (auditoría 4, D3)
// — "un semáforo que no puede ponerse en rojo es decoración". Se prueba que
// SÍ se pone en rojo/ámbar cuando falta cada pieza, y el caso más peligroso:
// QStash con token PERO SIN llaves de firma es `bad`, no `warn` como "sin
// configurar" — es peor tener el token a medias que no tenerlo.
// ═══════════════════════════════════════════════════════════════════════════

const dobles = vi.hoisted(() => ({
  sentryActivo: vi.fn(),
  alertaConfigurada: vi.fn(),
  correoConfigurado: vi.fn(),
  cofreConfigurado: vi.fn(),
  envHealth: vi.fn(),
  faltantes: vi.fn(),
  redisConfigurado: vi.fn(),
  acotada: vi.fn(),
  detalleLatidos: vi.fn(),
  getSLOs: vi.fn(),
  obtenerPanoramaAccion: vi.fn(),
}));

vi.mock('@/lib/observability/sentry', () => ({ sentryActivo: dobles.sentryActivo }));
vi.mock('@/lib/observability/alerta', () => ({ alertaConfigurada: dobles.alertaConfigurada }));
vi.mock('@/lib/correo/enviar', () => ({ correoConfigurado: dobles.correoConfigurado }));
vi.mock('@/lib/likida/conectores/cofre', () => ({ cofreConfigurado: dobles.cofreConfigurado }));
vi.mock('@/lib/env', () => ({ envHealth: dobles.envHealth, faltantes: dobles.faltantes }));
vi.mock('@/lib/ratelimit', () => ({ redisConfigurado: dobles.redisConfigurado }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: dobles.acotada }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/salud-sistema', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/admin/salud', async (importar) => ({ ...(await importar<typeof import('@/lib/admin/salud')>()), detalleLatidos: dobles.detalleLatidos }));
vi.mock('@/lib/admin/slo', () => ({ getSLOs: dobles.getSLOs }));
vi.mock('../requiere-accion', () => ({ obtenerPanoramaAccion: dobles.obtenerPanoramaAccion }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({ select: () => 'query-fantasma' }) }) }));

import { CRONS } from '@/lib/admin/salud';
import SaludSistemaPage from './page';

async function renderizar() { return renderToStaticMarkup(await SaludSistemaPage()); }

const ENV_ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ENV_ORIGINAL };
  delete process.env.CRON_SECRET;
  delete process.env.UPSTASH_QSTASH_TOKEN;
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;
  delete process.env.ALERTA_EMAIL;

  dobles.sentryActivo.mockReturnValue(true);
  dobles.alertaConfigurada.mockReturnValue(false);
  dobles.correoConfigurado.mockReturnValue(true);
  dobles.cofreConfigurado.mockReturnValue(true);
  dobles.redisConfigurado.mockReturnValue(true);
  dobles.envHealth.mockReturnValue({ llm: true, whatsapp: true, supabase: true });
  dobles.faltantes.mockReturnValue({});
  dobles.acotada.mockResolvedValue({ error: null });
  dobles.detalleLatidos.mockResolvedValue(Object.fromEntries(CRONS.map((c) => [c, { estado: 'ok', haceMin: 1, ultimoEstado: 'ok', ultimoLatido: '2026-11-09T12:00:00Z', cadenciaMs: 60_000, detalle: {}, motivoSalto: null }])));
  dobles.getSLOs.mockResolvedValue([{ clave: 'a', nombre: 'Corridas de agentes exitosas', objetivo: '≥ 95%', medido: '99%', cumple: true, ventana: '30 días' }]);
  dobles.obtenerPanoramaAccion.mockResolvedValue({ resumen: { pendientes: 2, hayUrgente: false }, bandeja: null, cola: null });
});

afterEach(() => { process.env = ENV_ORIGINAL; });

it('Sentry sin DSN se marca "ciego", nunca un verde fijo (auditoría 4, D3)', async () => {
  dobles.sentryActivo.mockReturnValue(false);
  const html = await renderizar();
  expect(html).toContain('Sin DSN — ciego');
  expect(html).not.toContain('Destino de errores puesto');
});

it('una base de Supabase caída se DICE — la consulta real comprueba el error por valor', async () => {
  dobles.acotada.mockResolvedValue({ error: { message: 'la base no respondió' } });
  const html = await renderizar();
  expect(html).toContain('No respondió');
  expect(html).toContain('la base no respondió');
});

it('si supabaseAdmin() lanza (faltan sus variables), también se lee como "no respondió"', async () => {
  dobles.acotada.mockRejectedValueOnce(new Error('faltan variables de Supabase'));
  const html = await renderizar();
  expect(html).toContain('No respondió');
});

it('sin CRON_SECRET, dice que NINGÚN cron corre — la cuenta sale de CRONS, no de un número escrito a mano', async () => {
  const html = await renderizar();
  expect(html).toContain('Sin clave: los relojes no corren');
  expect(html).toContain(`Los ${CRONS.length} relojes devuelven error sin ella`);
});

it('con CRON_SECRET, dice que los crons SÍ lo exigen', async () => {
  process.env.CRON_SECRET = 'un-secreto';
  const html = await renderizar();
  const idx = html.indexOf('Clave de los relojes');
  expect(html.slice(idx, idx + 400)).toContain('Configurada');
});

it('QStash con token PERO sin llaves de firma es BAD (peor que sin configurar), no warn', async () => {
  process.env.UPSTASH_QSTASH_TOKEN = 'tok_123';
  const html = await renderizar();
  expect(html).toContain('Token SIN llaves de firma');
  expect(html).toContain('la vuelta lo rechaza (error 503)');
});

it('QStash sin nada es "sin configurar" (warn) — distinto del caso token-sin-llaves', async () => {
  const html = await renderizar();
  expect(html).toContain('Cola de facturación (QStash)');
  const idx = html.indexOf('Cola de facturación');
  expect(html.slice(idx, idx + 300)).toContain('Sin configurar');
});

it('QStash con token Y las dos llaves es OK', async () => {
  process.env.UPSTASH_QSTASH_TOKEN = 'tok_123';
  process.env.QSTASH_CURRENT_SIGNING_KEY = 'k1';
  process.env.QSTASH_NEXT_SIGNING_KEY = 'k2';
  const html = await renderizar();
  const idx = html.indexOf('Cola de facturación');
  expect(html.slice(idx, idx + 300)).toContain('Token y llaves de firma presentes');
});

it('sin Redis distribuido, el límite de tasa se marca BAD (no protege entre instancias) — mismo peso que Sentry', async () => {
  dobles.redisConfigurado.mockReturnValue(false);
  const html = await renderizar();
  expect(html).toContain('Sin configurar — límite solo por instancia');
});

it('sin cofre (LIKIDA_COFRE_LLAVE ausente o corta), lo dice: no se puede guardar credenciales de conectores', async () => {
  dobles.cofreConfigurado.mockReturnValue(false);
  const html = await renderizar();
  expect(html).toContain('Ausente o demasiado corta');
});

it('un correo de alerta configurado se muestra OFUSCADO (j***@dominio), no completo', async () => {
  process.env.ALERTA_EMAIL = 'javier@likida.ai';
  dobles.alertaConfigurada.mockReturnValue(true);
  const html = await renderizar();
  expect(html).toContain('j***@likida.ai');
  expect(html).not.toContain('javier@likida.ai');
});

it('ALERTA_EMAIL puesto pero Resend sin configurar: dice que la alerta no puede salir, no que ya está lista', async () => {
  process.env.ALERTA_EMAIL = 'javier@likida.ai';
  dobles.alertaConfigurada.mockReturnValue(false);
  const html = await renderizar();
  expect(html).toContain('Correo sin configurar');
  expect(html).toContain('la alerta no puede salir');
});

it('un grupo de variables (llm/whatsapp/supabase) incompleto lista EXACTAMENTE las que faltan', async () => {
  dobles.envHealth.mockReturnValue({ llm: false, whatsapp: true, supabase: true });
  dobles.faltantes.mockReturnValue({ llm: ['OPENROUTER_API_KEY'] });
  const html = await renderizar();
  expect(html).toContain('Faltan: OPENROUTER_API_KEY');
});

it('Vercel siempre se marca "No medido" — nunca un verde de adorno que sólo prueba que la página renderizó', async () => {
  const html = await renderizar();
  const idx = html.indexOf('Disponibilidad y despliegues (Vercel)');
  expect(html.slice(idx, idx + 500)).toContain('No medido');
});

// ── F7: la portada con el resumen de relojes y objetivos ─────────────────────

it('la portada cuenta los relojes a tiempo con la constante CRONS, y un reloj en fallo o sin latir lo baja', async () => {
  const sano = (extra = {}) => ({ estado: 'ok', haceMin: 1, ultimoEstado: 'ok', ultimoLatido: '2026-11-09T12:00:00Z', cadenciaMs: 60_000, detalle: {}, motivoSalto: null, ...extra });
  dobles.detalleLatidos.mockResolvedValue(Object.fromEntries(CRONS.map((c, i) => [c, i === 0 ? sano({ estado: 'vencido' }) : i === 1 ? sano({ ultimoEstado: 'fallo' }) : sano()])));
  const html = await renderizar();
  expect(html).toContain('Relojes a tiempo');
  expect(html).toContain(`2 de ${CRONS.length} no laten o fallaron.`);
});

it('relojes ilegibles: la cifra dice «No disponible ahora. No es cero.», no un 20 de adorno', async () => {
  dobles.detalleLatidos.mockRejectedValue(new Error('caída'));
  const html = await renderizar();
  expect(html).toContain('No se pudo leer el pulso de los relojes.');
  expect(html).not.toContain('latieron en su cadencia');
});

it('un objetivo medido que NO se cumple se lista con lo medido; sin muestra no se pinta como cumplido', async () => {
  dobles.getSLOs.mockResolvedValue([
    { clave: 'a', nombre: 'Corridas de agentes exitosas', objetivo: '≥ 95%', medido: '80% de 40 corridas', cumple: false, ventana: '30 días' },
    { clave: 'b', nombre: 'Tiempo de respuesta', objetivo: '≤ 120 s', medido: '2 corridas: muestra insuficiente', cumple: null, ventana: '30 días' },
  ]);
  const html = await renderizar();
  expect(html).toContain('Objetivos que no se cumplen');
  expect(html).toContain('80% de 40 corridas');
  expect(html).not.toContain('muestra insuficiente (objetivo');
  expect(html).toContain('De 1 medidos; 1 sin muestra.');
});

it('sin objetivos medibles (todos sin muestra) dice «sin muestra suficiente», no un cero', async () => {
  dobles.getSLOs.mockResolvedValue([{ clave: 'a', nombre: 'x', objetivo: '≥ 95%', medido: '2 corridas', cumple: null, ventana: '30 días' }]);
  const html = await renderizar();
  expect(html).toContain('Sin muestra suficiente para medirlos todavía.');
});

it('lo pendiente de la consola sale del mismo panorama que la campana; si no se pudo leer, se dice', async () => {
  expect((await renderizar())).toContain('Lo mismo que cuenta la campana.');
  dobles.obtenerPanoramaAccion.mockResolvedValue({ resumen: { pendientes: null, hayUrgente: false }, bandeja: null, cola: null });
  expect((await renderizar())).toContain('No se pudo leer lo que espera a una persona.');
});

it('los nombres de variables solo van en «Cómo arreglarlo», plegado; el cuerpo de cada pieza habla en palabras', async () => {
  dobles.envHealth.mockReturnValue({ llm: false, whatsapp: true, supabase: true });
  dobles.faltantes.mockReturnValue({ llm: ['OPENROUTER_API_KEY'] });
  const html = await renderizar();
  expect(html).toContain('Cómo arreglarlo');
  const cuerpo = html.replace(/<details[\s\S]*?<\/details>/g, '');
  expect(cuerpo).not.toMatch(/OPENROUTER_API_KEY|CRON_SECRET|QSTASH|UPSTASH|LIKIDA_/);
});
