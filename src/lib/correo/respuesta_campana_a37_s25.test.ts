import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/likida/agentes/enviador', () => ({ suprimirCorreo: vi.fn() }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { esBaja } from './respuesta_campana';

const PIE = 'Si prefieres no recibir estos correos, responde con la palabra BAJA y no volveremos a escribirte.';

// A37-S25-01 (ALTO): la respuesta de un prospecto interesado que cita el pie de la
// campaña se trataba como BAJA y se borraba a quien contestó.
describe('A37-S25-01 — la BAJA se detecta solo en el texto NUEVO', () => {
  it('«Sí, llámame» con el pie citado NO es baja (cita con «>»)', () => {
    const cuerpo = `Sí, llámame el lunes.\n\n> ${PIE}\n> Likida`;
    expect(esBaja('Re: Liquidación de viajes', cuerpo)).toBe(false);
  });

  it('con encabezado «El … escribió:» y sin signos de cita', () => {
    const cuerpo = `Me interesa, ¿tienes una demo?\n\nEl lun, 5 oct 2026 10:00, Likida <avisos@x.mx> escribió:\nHola\n${PIE}`;
    expect(esBaja('Re: Hola', cuerpo)).toBe(false);
  });

  it('con «On … wrote:» y con «-----Original Message-----»', () => {
    expect(esBaja('Re: Hola', `Cuéntame más.\nOn Mon, Oct 5, 2026 at 10:00 AM Likida wrote:\n${PIE}`)).toBe(false);
    expect(esBaja('Re: Hola', `Cuéntame más.\n-----Original Message-----\n${PIE}`)).toBe(false);
  });

  it('con el pie pegado sin marcas de cita en el mismo texto', () => {
    expect(esBaja('Re: Hola', `Gracias, platiquemos. ${PIE}`)).toBe(false);
  });

  it('autorespondedor «estoy de baja» (incapacidad) no es baja', () => {
    expect(esBaja('Respuesta automática', 'Estoy de baja médica hasta el 20 de octubre.')).toBe(false);
    expect(esBaja('Auto: Re: Hola', 'Actualmente me encuentro de baja por maternidad.')).toBe(false);
  });

  it('un cuerpo largo que habla de dar de baja unidades de flota no es baja', () => {
    const largo = 'Hola, tenemos 40 unidades y estamos dando de baja algunas por antigüedad. '.repeat(6) + 'Me interesa la demo.';
    expect(esBaja('Re: Hola', largo)).toBe(false);
  });

  it('CONTROLES: la baja real sigue detectándose', () => {
    expect(esBaja('BAJA', null)).toBe(true);
    expect(esBaja('Re: Hola', 'BAJA')).toBe(true);
    expect(esBaja('Re: Hola', 'Por favor, darme de baja de esta lista')).toBe(true);
    expect(esBaja('Re: Hola', `baja\n\n> ${PIE}`)).toBe(true);
    expect(esBaja('Re: Hola', 'unsubscribe')).toBe(true);
    expect(esBaja('Re: Hola', 'Quiero que me den de baja y no me escriban más. '.repeat(1) + 'x'.repeat(400))).toBe(true);
  });
});

import { textoPlano } from './respuesta_campana';
describe('A37-S25-01 — correo solo HTML', () => {
  it('lo que va dentro de blockquote / gmail_quote no cuenta', () => {
    const html = `<div>Sí, me interesa</div><div class="gmail_quote"><blockquote>${PIE}</blockquote></div>`;
    expect(esBaja('Re: Hola', textoPlano(undefined, html))).toBe(false);
    expect(esBaja('Re: Hola', textoPlano(undefined, `<p>Sí</p><blockquote><p>${PIE}</p></blockquote>`))).toBe(false);
  });
});
