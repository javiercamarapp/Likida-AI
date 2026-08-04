import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { verificarFirmaStripe, stripeConfigurado, webhookConfigurado, modoStripe } from './stripe';

// ═══════════════════════════════════════════════════════════════════════════
// LA FIRMA DEL WEBHOOK DE STRIPE — el candado del endpoint que reparte planes.
//
// `/api/stripe/webhook` es PÚBLICO y cambia quién tiene plan pagado. Si la
// firma se puede saltar, cualquiera con la URL se activa el plan Empresa gratis
// mandando un JSON. No hay una segunda capa detrás: la firma ES la autorización.
//
// LOS DOS ERRORES CLÁSICOS, LOS DOS FIJADOS AQUÍ:
//
//   1. Firmar el CUERPO A SECAS. Stripe firma `${timestamp}.${cuerpo}`. Quien
//      hace el HMAC del cuerpo solo nunca valida nada, y el "arreglo" que
//      aparece a las dos horas de pelearse con eso es saltarse la firma.
//   2. No mirar el TIMESTAMP. Sin eso, una petición legítima capturada hace un
//      año se puede repetir hoy tal cual: su firma sigue siendo válida para
//      siempre.
// ═══════════════════════════════════════════════════════════════════════════

const SECRETO = 'whsec_prueba_123';
const CUERPO = '{"id":"evt_1","type":"invoice.paid"}';

function firmar(cuerpo: string, t: number, secreto = SECRETO): string {
  const v1 = crypto.createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

const AHORA = 1_800_000_000;

describe('verificarFirmaStripe', () => {
  beforeEach(() => { process.env.STRIPE_WEBHOOK_SECRET = SECRETO; });
  afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET; });

  it('acepta una firma legítima', () => {
    expect(verificarFirmaStripe(CUERPO, firmar(CUERPO, AHORA), AHORA)).toBe(true);
  });

  it('RECHAZA el HMAC del cuerpo a secas (el error clásico)', () => {
    // Sin el `${t}.` delante. Si esto pasara, la implementación estaría firmando
    // otra cosa que la que Stripe firma.
    const soloCuerpo = crypto.createHmac('sha256', SECRETO).update(CUERPO).digest('hex');
    expect(verificarFirmaStripe(CUERPO, `t=${AHORA},v1=${soloCuerpo}`, AHORA)).toBe(false);
  });

  it('rechaza un cuerpo alterado aunque la firma sea de uno válido', () => {
    const firma = firmar(CUERPO, AHORA);
    const alterado = CUERPO.replace('invoice.paid', 'invoice.payment_failed');
    expect(verificarFirmaStripe(alterado, firma, AHORA)).toBe(false);
  });

  it('rechaza una firma vieja aunque sea auténtica (replay)', () => {
    const hace1h = AHORA - 3600;
    expect(verificarFirmaStripe(CUERPO, firmar(CUERPO, hace1h), AHORA)).toBe(false);
  });

  it('rechaza un timestamp del futuro fuera de tolerancia', () => {
    expect(verificarFirmaStripe(CUERPO, firmar(CUERPO, AHORA + 3600), AHORA)).toBe(false);
  });

  it('acepta dentro de la tolerancia (relojes que no cuadran al segundo)', () => {
    expect(verificarFirmaStripe(CUERPO, firmar(CUERPO, AHORA - 120), AHORA)).toBe(true);
  });

  it('acepta cuando el encabezado trae DOS v1 (rotación de secreto)', () => {
    const viejo = crypto.createHmac('sha256', 'whsec_otro').update(`${AHORA}.${CUERPO}`).digest('hex');
    const bueno = crypto.createHmac('sha256', SECRETO).update(`${AHORA}.${CUERPO}`).digest('hex');
    expect(verificarFirmaStripe(CUERPO, `t=${AHORA},v1=${viejo},v1=${bueno}`, AHORA)).toBe(true);
  });

  it('rechaza con firma de otro secreto', () => {
    expect(verificarFirmaStripe(CUERPO, firmar(CUERPO, AHORA, 'whsec_impostor'), AHORA)).toBe(false);
  });

  it('rechaza sin encabezado, y con basura', () => {
    expect(verificarFirmaStripe(CUERPO, null, AHORA)).toBe(false);
    expect(verificarFirmaStripe(CUERPO, '', AHORA)).toBe(false);
    expect(verificarFirmaStripe(CUERPO, 'v1=abc', AHORA)).toBe(false);       // sin t
    expect(verificarFirmaStripe(CUERPO, `t=${AHORA}`, AHORA)).toBe(false);   // sin v1
    expect(verificarFirmaStripe(CUERPO, 't=no-es-numero,v1=abc', AHORA)).toBe(false);
  });

  it('SIN SECRETO CONFIGURADO rechaza todo — nunca acepta "porque no está configurado"', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(verificarFirmaStripe(CUERPO, firmar(CUERPO, AHORA), AHORA)).toBe(false);
  });
});

describe('en qué modo está Stripe', () => {
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('sin llave, no configurado — la pantalla esconde el botón de pago', () => {
    expect(stripeConfigurado()).toBe(false);
    expect(modoStripe()).toBeNull();
    expect(webhookConfigurado()).toBe(false);
  });

  it('distingue prueba de producción por el prefijo de la llave', () => {
    // Cobrar de a de veras con una llave de test deja al cliente creyendo que
    // pagó y a Likida sin el dinero. El panel lo avisa arriba.
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    expect(modoStripe()).toBe('prueba');
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
    expect(modoStripe()).toBe('produccion');
  });
});
