import { describe, it, expect } from 'vitest';
import { vieneDeNuestroSitio, escribe } from './csrf';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · SEG-9 — las escrituras por cookie no miraban
// de dónde venían.
//
// `/api/admin/palette` APAGA INTERRUPTORES (el kill switch global incluido) y
// `/v1/*` da de alta viajes y unidades; las dos aceptan la cookie de sesión.
// `sameSite: 'lax'` lo mitiga, pero es una decisión del navegador, no nuestra:
// se apaga sola el día que alguien necesite `sameSite: 'none'`, y ninguna
// prueba se pondría roja.
// ═══════════════════════════════════════════════════════════════════════════

const pedir = (cabeceras: Record<string, string>) =>
  new Request('https://app.likida.ai/api/admin/palette', { method: 'POST', headers: cabeceras });

describe('vieneDeNuestroSitio', () => {
  it('Sec-Fetch-Site manda: same-origin y none pasan', () => {
    expect(vieneDeNuestroSitio(pedir({ 'sec-fetch-site': 'same-origin', host: 'app.likida.ai' }))).toBe(true);
    expect(vieneDeNuestroSitio(pedir({ 'sec-fetch-site': 'none' }))).toBe(true);
  });

  it('cross-site NO pasa, ni aunque el Origin diga lo que sea', () => {
    expect(vieneDeNuestroSitio(pedir({
      'sec-fetch-site': 'cross-site', origin: 'https://app.likida.ai', host: 'app.likida.ai',
    }))).toBe(false);
  });

  it('same-site tampoco: likida.ai y app.likida.ai son orígenes distintos', () => {
    expect(vieneDeNuestroSitio(pedir({ 'sec-fetch-site': 'same-site', host: 'app.likida.ai' }))).toBe(false);
  });

  it('sin Sec-Fetch-Site se compara el Origin contra el host de la petición', () => {
    expect(vieneDeNuestroSitio(pedir({ origin: 'https://app.likida.ai', host: 'app.likida.ai' }))).toBe(true);
    expect(vieneDeNuestroSitio(pedir({ origin: 'https://evil.example', host: 'app.likida.ai' }))).toBe(false);
    // Iframe aislado: el Origin literal "null" no coincide con nada.
    expect(vieneDeNuestroSitio(pedir({ origin: 'null', host: 'app.likida.ai' }))).toBe(false);
  });

  it('x-forwarded-host gana cuando hay un proxy delante', () => {
    expect(vieneDeNuestroSitio(pedir({
      origin: 'https://app.likida.ai', 'x-forwarded-host': 'app.likida.ai', host: 'interno.vercel.app',
    }))).toBe(true);
  });

  it('sin NINGUNA de las dos cabeceras pasa: eso no es un navegador', () => {
    // Un CSRF es, por definición, un navegador — y un navegador siempre manda
    // Origin en un POST cross-site. Aquí quien llama es curl, un TMS o un
    // cron: rechazarlo rompería integraciones sin cerrarle la puerta a nadie.
    expect(vieneDeNuestroSitio(pedir({ host: 'app.likida.ai' }))).toBe(true);
  });
});

describe('escribe', () => {
  it('solo los métodos que cambian algo', () => {
    expect(['POST', 'PUT', 'PATCH', 'DELETE'].every(escribe)).toBe(true);
    expect(['GET', 'HEAD', 'OPTIONS'].some(escribe)).toBe(false);
  });
});
