import { describe, it, expect, vi, beforeEach } from 'vitest';
// A37-S05-01/S06-01: la página ahora llama su propia puerta; aquí la sesión es de superadmin.
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: vi.fn(async () => ({ rol: 'superadmin', tenantId: null, nombre: 'Prueba' })) }));
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// TABLEROS AL DÍA (28-ago-2026) — la pantalla que decía «no existe pipeline»
// mientras `evento_seguridad` (0133) llevaba semanas escribiéndose desde
// siete detectores. Estas pruebas defienden los tres contratos de la casa en
// la pantalla nueva: la lectura caída SE DICE (≠ cero eventos), el vacío de
// verdad se explica («el silencio aquí es bueno»), y la lista declara
// «mostrando N de M» con la M exacta contada en la base.
// ═══════════════════════════════════════════════════════════════════════════

// `EstadoError` usa router.refresh() — mismo router de mentiras que
// bloque.test.tsx: aquí se mira QUÉ se pinta, no a dónde navega.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const getEventosSeguridad = vi.fn();
const resumenEventosSeguridad = vi.fn();
vi.mock('@/lib/seguridad/eventos', () => ({
  getEventosSeguridad: (...a: unknown[]) => getEventosSeguridad(...a),
  resumenEventosSeguridad: (...a: unknown[]) => resumenEventosSeguridad(...a),
}));

const coberturaEventosSeguridad = vi.fn();
vi.mock('@/lib/seguridad/cobertura', () => ({ coberturaEventosSeguridad: (...a: unknown[]) => coberturaEventosSeguridad(...a) }));

import { readFileSync } from 'node:fs';
import TrustSafetyPage from './page';

const fuente = (sobre: Record<string, unknown> = {}) => ({
  id: 'login_fallido', titulo: 'Login fallido', par: { origen: 'auth', tipo: 'login_fallido' }, emite: true, donde: 'src/app/login/page.tsx', filas30d: 0, ...sobre,
});

function evento(sobre: Record<string, unknown> = {}) {
  return {
    id: 'ev-1', origen: 'wa_webhook', tipo: 'firma_invalida', severidad: 'alta',
    tenantId: null, actor: '5215550000001', detalle: null,
    creadoEn: '2026-08-28T12:00:00.000Z',
    ...sobre,
  };
}

beforeEach(() => {
  coberturaEventosSeguridad.mockReset();
  coberturaEventosSeguridad.mockResolvedValue([fuente()]);
});

describe('/admin/trust-safety — la pantalla dice lo medido', () => {
  it('base caída: lo DICE en las dos zonas, sin pintar ceros ni tabla vacía', async () => {
    getEventosSeguridad.mockRejectedValue(new Error('base caída'));
    resumenEventosSeguridad.mockRejectedValue(new Error('base caída'));
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('NO significa que haya cero eventos');
    expect(html).toContain('no es lo mismo que «no hay eventos»');
  });

  it('vacío: NO se afirma que el silencio sea bueno — solo cubre lo que las fuentes emiten (CT-SEG-11)', async () => {
    getEventosSeguridad.mockResolvedValue([]);
    resumenEventosSeguridad.mockResolvedValue({ total: 0, d30: { alta: 0, media: 0, info: 0 } });
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('NO prueba que no haya pasado nada');
    expect(html).not.toContain('el silencio aquí es bueno de verdad');
    expect(html).not.toContain('detectores están cableados');
  });

  it('una ráfaga agrupada (0681) se pinta con su conteo; una señal única, sin sufijo', async () => {
    getEventosSeguridad.mockResolvedValue([evento({ repeticiones: 412 }), evento({ id: 'ev-2', tipo: 'rate_limit', repeticiones: 1 })]);
    resumenEventosSeguridad.mockResolvedValue({ total: 2, d30: { alta: 1, media: 1, info: 0 } });
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('×412');
    expect(html).not.toContain('×1<');
  });

  it('con eventos: la lista declara «mostrando N de M» con la M contada en la base', async () => {
    getEventosSeguridad.mockResolvedValue([evento(), evento({ id: 'ev-2', severidad: 'media', tipo: 'rate_limit' })]);
    resumenEventosSeguridad.mockResolvedValue({ total: 137, d30: { alta: 3, media: 20, info: 40 } });
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('de 137 eventos históricos');
    expect(html).toContain('firma invalida');
    // Los conteos por severidad de 30 días llegan a sus tarjetas.
    expect(html).toContain('Severidad alta · 30 días');
  });

  it('resumen caído pero lista viva: la M ausente se declara, jamás se inventa', async () => {
    getEventosSeguridad.mockResolvedValue([evento()]);
    resumenEventosSeguridad.mockRejectedValue(new Error('timeout'));
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('el total histórico no se pudo contar ahora mismo');
  });

  it('lo que NO hay sigue dicho: mitigación no es detección', async () => {
    getEventosSeguridad.mockResolvedValue([]);
    resumenEventosSeguridad.mockResolvedValue({ total: 0, d30: { alta: 0, media: 0, info: 0 } });
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('eso es mitigación, no detección');
    expect(html).toContain('jailbreak');
  });
});

describe('/admin/trust-safety — la cobertura REAL, medida (CT-SEG-11)', () => {
  const vacios = () => {
    getEventosSeguridad.mockResolvedValue([]);
    resumenEventosSeguridad.mockResolvedValue({ total: 0, d30: { alta: 0, media: 0, info: 0 } });
  };

  it('lista cada fuente con su estado: las que emiten con su conteo de 30 días y las que NO emiten, rotuladas', async () => {
    vacios();
    coberturaEventosSeguridad.mockResolvedValue([
      fuente({ filas30d: 12 }),
      fuente({ id: 'rate_limit', titulo: 'Rate limits que bloquean', par: { origen: 'ratelimit', tipo: 'rate_limit' }, emite: false, donde: 'src/lib/ratelimit.ts bloquea y no registra', filas30d: 0 }),
      fuente({ id: 'mfa_fallido', titulo: 'Segundo factor fallido', par: null, emite: false, donde: 'mfa.ts decide pero no registra', filas30d: null }),
    ]);
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('Cobertura');
    expect(html).toContain('Login fallido');
    expect(html).toMatch(/Emite/);
    expect(html).toContain('12');
    expect(html).toContain('Rate limits que bloquean');
    expect(html).toMatch(/Pendiente/);
    expect(html).not.toMatch(/No emite/);
    expect(html).toContain('mfa.ts decide pero no registra');
    expect(html).toContain('1 de 3 fuentes emiten');
  });

  it('una fuente que emite y tiene 0 en 30 días NO se vende como «todo bien»: se dice que es silencio o fuente rota, no se distingue', async () => {
    vacios();
    coberturaEventosSeguridad.mockResolvedValue([fuente({ filas30d: 0 })]);
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('0 en 30 días');
    expect(html).toContain('no se distingue');
  });

  it('cobertura caída: se dice, sin pintar ceros ni la tabla', async () => {
    vacios();
    coberturaEventosSeguridad.mockRejectedValue(new Error('base caída'));
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('No se pudo medir la cobertura');
    expect(html).not.toContain('Login fallido');
  });
});

describe('/admin/trust-safety — la lista de pendientes sale de la cobertura medida, no de texto fijo (R4)', () => {
  const vacios = () => {
    getEventosSeguridad.mockResolvedValue([]);
    resumenEventosSeguridad.mockResolvedValue({ total: 0, d30: { alta: 0, media: 0, info: 0 } });
  };

  it('lo pendiente se rotula «Pendiente» y se lista con su título; lo que emite NO aparece como pendiente', async () => {
    vacios();
    coberturaEventosSeguridad.mockResolvedValue([
      fuente({ id: 'rate_limit', titulo: 'Rate limits que bloquean', emite: true, filas30d: 4 }),
      fuente({ id: 'inyeccion_prompt', titulo: 'Inyección de prompt detectada', emite: false, filas30d: 0 }),
    ]);
    const html = renderToStaticMarkup(await TrustSafetyPage());
    const bloque = html.slice(html.indexOf('Qué se registra y qué está pendiente'));
    expect(bloque).toContain('Pendiente, hoy no se registra');
    expect(bloque).toContain('Inyección de prompt detectada');
    expect(bloque).not.toContain('Rate limits que bloquean');
  });

  it('si toda fuente declarada emite, NO se vende como cobertura total', async () => {
    vacios();
    coberturaEventosSeguridad.mockResolvedValue([fuente()]);
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('Todas las fuentes declaradas emiten');
    expect(html).toContain('lo no listado arriba no está medido');
  });

  it('«Emite» se explica como «hay código que escribe la señal», no como detección completa', async () => {
    vacios();
    const html = renderToStaticMarkup(await TrustSafetyPage());
    expect(html).toContain('no significa que la detección sea completa');
  });

  it('el fuente de la pantalla no vuelve a afirmar cobertura que no se mide', () => {
    // Solo texto: comentarios fuera. Las frases son las que la auditoría marcó como falsas (CT-SEG-11) y sus variantes.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- lee el fuente de la propia pantalla
    const codigo = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const prohibida of [/est[aá]n cableados/i, /silencio (aqu[ií] )?es bueno/i, /cobertura (total|completa)(?! ni)/i, /protegid[oa]s? contra/i, /sin riesgo/i, /todo (est[aá] )?bajo control/i]) {
      expect(codigo, String(prohibida)).not.toMatch(prohibida);
    }
    // Y no lista a mano qué fuentes faltan: eso sale de la cobertura medida (si no, envejece como el texto de CT-SEG-11).
    expect(codigo).not.toMatch(/entre ellas rate limits/i);
  });
});
