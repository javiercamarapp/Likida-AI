// ═══════════════════════════════════════════════════════════════════════════
// COBERTURA (ronda 16): stripe.ts estaba a 22% — la verificación de firma del
// webhook (la puerta que convierte un pago en plan activo) y el modo de la llave.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';

const ORIGINAL = { ...process.env };

function firmaPara(secreto: string, t: number, cuerpo: string): string {
  const h = crypto.createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex');
  return `t=${t},v1=${h}`;
}

const { verificarFirmaStripe, modoStripe, stripeConfigurado, webhookConfigurado, exigirLlaveCoherente, eventoEnModoDeLaLlave } = await import('./stripe');

afterEach(() => { process.env = { ...ORIGINAL }; });

describe('verificarFirmaStripe — la puerta del webhook de pago', () => {
  const SECRETO = 'whsec_test_secreto';
  const CUERPO = '{"id":"evt-1"}';
  const AHORA = 1786000000;

  it('acepta una firma válida con HMAC correcto y timestamp fresco', () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRETO;
    expect(verificarFirmaStripe(CUERPO, firmaPara(SECRETO, AHORA, CUERPO), AHORA)).toBe(true);
  });

  it('rechaza si el timestamp se salió de la tolerancia (replay de un mensaje viejo)', () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRETO;
    const firmaVieja = firmaPara(SECRETO, AHORA - 400, CUERPO);
    expect(verificarFirmaStripe(CUERPO, firmaVieja, AHORA)).toBe(false);
  });

  it('rechaza una firma con el cuerpo ALTERADO (la firma no miente)', () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRETO;
    const firma = firmaPara(SECRETO, AHORA, CUERPO);
    expect(verificarFirmaStripe('{"id":"otro"}', firma, AHORA)).toBe(false);
  });

  it('rechaza sin secreto configurado (no "acepta porque no hay")', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(verificarFirmaStripe(CUERPO, firmaPara(SECRETO, AHORA, CUERPO), AHORA)).toBe(false);
  });

  it('rechaza un encabezado sin el formato esperado', () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRETO;
    expect(verificarFirmaStripe(CUERPO, 'basura', AHORA)).toBe(false);
    expect(verificarFirmaStripe(CUERPO, null, AHORA)).toBe(false);
  });

  it('soporta MÚLTIPLES firmas (la rotación de claves de Stripe)', () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRETO;
    const vieja = firmaPara('whsec_vieja', AHORA, CUERPO);
    const nueva = firmaPara(SECRETO, AHORA, CUERPO);
    expect(verificarFirmaStripe(CUERPO, `${vieja},${nueva}`, AHORA)).toBe(true);
  });
});

describe('modoStripe — enseñar el modo de la llave importa', () => {
  it('sk_live → produccion; sk_test → prueba; sin llave → null', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
    expect(modoStripe()).toBe('produccion');
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    expect(modoStripe()).toBe('prueba');
    delete process.env.STRIPE_SECRET_KEY;
    expect(modoStripe()).toBeNull();
  });

  it('stripeConfigurado / webhookConfigurado son honestos', () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(stripeConfigurado()).toBe(false);
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    expect(stripeConfigurado()).toBe(true);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(webhookConfigurado()).toBe(false);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    expect(webhookConfigurado()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · DAT-32 — EL CANDADO test/live QUE NO EXISTÍA.
//
// `modoStripe()` ya sabía distinguir la llave de prueba de la real, y lo único
// que hacía con eso era pintar un aviso amarillo en una pantalla. Un aviso se
// lee una vez y se cierra. Con `sk_test` en producción NADA falla: se crean
// customers, se crean suscripciones, se devuelven URLs de factura idénticas a
// las reales — y no entra un peso. La flota cree que ya contrató.
// ═══════════════════════════════════════════════════════════════════════════

describe('exigirLlaveCoherente — producción con llave de prueba no opera', () => {
  it('lanza en producción con sk_test', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    expect(() => exigirLlaveCoherente()).toThrow(/PRUEBA/);
  });

  it('no lanza en producción con sk_live', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
    expect(() => exigirLlaveCoherente()).not.toThrow();
  });

  it('no lanza fuera de producción: ensayar con sk_test es justo lo correcto', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    expect(() => exigirLlaveCoherente()).not.toThrow();
  });
});

describe('eventoEnModoDeLaLlave — la firma no dice de qué modo viene el evento', () => {
  it('acepta el evento live con llave live, y el de prueba con llave de prueba', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
    expect(eventoEnModoDeLaLlave(true)).toBe(true);
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    expect(eventoEnModoDeLaLlave(false)).toBe(true);
  });

  it('RECHAZA el cruzado: un evento de sandbox contra una llave real activaría un plan sin cobrar', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
    expect(eventoEnModoDeLaLlave(false)).toBe(false);
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    expect(eventoEnModoDeLaLlave(true)).toBe(false);
  });

  it('rechaza un evento SIN livemode (no es un evento de Stripe) y sin llave configurada', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
    expect(eventoEnModoDeLaLlave(undefined)).toBe(false);
    expect(eventoEnModoDeLaLlave('true')).toBe(false);
    delete process.env.STRIPE_SECRET_KEY;
    expect(eventoEnModoDeLaLlave(true)).toBe(false);
  });
});
