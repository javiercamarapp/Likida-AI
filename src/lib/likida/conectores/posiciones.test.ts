// ═══════════════════════════════════════════════════════════════════════════
// El lector de posiciones: que traiga las buenas y DESCARTE las que mienten.
//
// Un GPS que todavía no fija señal devuelve (0,0) —el Golfo de Guinea— y un
// proveedor puede contestar 200 con basura. Guardar esas lecturas es peor que
// no tener GPS: el mapa dibuja un camión en el Atlántico y la serie de
// kilómetros deja de significar nada.
//
// Y el que más importa: Samsara reporta en MILLAS por hora. Guardar el número
// tal cual pone a un camión "a 60" cuando va a 97.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { leerPosicionesSamsara, lectorDe } from './posiciones';
import type { Http } from './tipos';

const httpQueDevuelve = (estado: number, cuerpo: string): Http => async () => ({ estado, cuerpo });

const CUERPO_BUENO = JSON.stringify({
  data: [
    { id: '1234', gps: { latitude: 20.9674, longitude: -89.5926, time: '2026-08-23T18:00:00Z', speedMilesPerHour: 60, headingDegrees: 90 } },
    { id: '5678', gps: { latitude: 21.1619, longitude: -86.8515, time: '2026-08-23T18:01:00Z' } },
  ],
});

describe('el lector de Samsara trae lo que sirve', () => {
  it('normaliza cada lectura con su dispositivo, coordenadas y hora', async () => {
    const r = await leerPosicionesSamsara({ token: 't' }, httpQueDevuelve(200, CUERPO_BUENO));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posiciones).toHaveLength(2);
    expect(r.posiciones[0]).toMatchObject({ deviceId: '1234', lat: 20.9674, lng: -89.5926 });
  });

  it('CONVIERTE millas por hora a km/h — 60 mph son 96.6 km/h, no 60', async () => {
    const r = await leerPosicionesSamsara({ token: 't' }, httpQueDevuelve(200, CUERPO_BUENO));
    if (!r.ok) throw new Error('debería leer');
    expect(r.posiciones[0].velocidad).toBeCloseTo(96.6, 1);
  });

  it('sin velocidad declarada devuelve null, no 0: no es lo mismo', async () => {
    const r = await leerPosicionesSamsara({ token: 't' }, httpQueDevuelve(200, CUERPO_BUENO));
    if (!r.ok) throw new Error('debería leer');
    expect(r.posiciones[1].velocidad).toBeNull();
    expect(r.posiciones[1].rumbo).toBeNull();
  });
});

describe('las lecturas que mienten se descartan', () => {
  it('(0,0) NO se guarda: es el dispositivo sin señal, no el Golfo de Guinea', async () => {
    const cuerpo = JSON.stringify({ data: [{ id: 'x', gps: { latitude: 0, longitude: 0, time: '2026-08-23T18:00:00Z' } }] });
    const r = await leerPosicionesSamsara({ token: 't' }, httpQueDevuelve(200, cuerpo));
    if (!r.ok) throw new Error('debería leer');
    expect(r.posiciones).toHaveLength(0);
  });

  it('coordenadas fuera de rango se descartan', async () => {
    const cuerpo = JSON.stringify({ data: [{ id: 'x', gps: { latitude: 999, longitude: -89, time: '2026-08-23T18:00:00Z' } }] });
    const r = await leerPosicionesSamsara({ token: 't' }, httpQueDevuelve(200, cuerpo));
    if (!r.ok) throw new Error('debería leer');
    expect(r.posiciones).toHaveLength(0);
  });

  it('una lectura SIN hora se descarta: sin `medida_en` no se puede ordenar ni deduplicar', async () => {
    const cuerpo = JSON.stringify({ data: [{ id: 'x', gps: { latitude: 20.9, longitude: -89.5 } }] });
    const r = await leerPosicionesSamsara({ token: 't' }, httpQueDevuelve(200, cuerpo));
    if (!r.ok) throw new Error('debería leer');
    expect(r.posiciones).toHaveLength(0);
  });

  it('un vehículo sin bloque gps no rompe la lectura de los demás', async () => {
    const cuerpo = JSON.stringify({ data: [{ id: 'sin' }, { id: 'con', gps: { latitude: 20.9, longitude: -89.5, time: '2026-08-23T18:00:00Z' } }] });
    const r = await leerPosicionesSamsara({ token: 't' }, httpQueDevuelve(200, cuerpo));
    if (!r.ok) throw new Error('debería leer');
    expect(r.posiciones.map((p) => p.deviceId)).toEqual(['con']);
  });
});

describe('los fallos se dicen, no se tragan', () => {
  it('401: el token hay que regenerarlo, y lo dice', async () => {
    const r = await leerPosicionesSamsara({ token: 't' }, httpQueDevuelve(401, ''));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('401');
  });

  it('403: faltan scopes — distinto de un token inválido', async () => {
    const r = await leerPosicionesSamsara({ token: 't' }, httpQueDevuelve(403, ''));
    if (r.ok) throw new Error('no debería');
    expect(r.motivo).toContain('scopes');
  });

  it('200 con cuerpo que no es JSON no revienta: se reporta', async () => {
    const r = await leerPosicionesSamsara({ token: 't' }, httpQueDevuelve(200, 'no soy json'));
    if (r.ok) throw new Error('no debería');
    expect(r.motivo).toContain('no es JSON');
  });

  it('sin token ni se llama a la red', async () => {
    let llamado = false;
    const http: Http = async () => { llamado = true; return { estado: 200, cuerpo: '{}' }; };
    const r = await leerPosicionesSamsara({ token: '  ' }, http);
    expect(r.ok).toBe(false);
    expect(llamado).toBe(false);
  });
});

describe('un proveedor sin lector se dice, no se finge', () => {
  it('Samsara tiene lector', () => { expect(lectorDe('samsara')).toBeTypeOf('function'); });

  it('Wialon, Geotab y Navixy todavía NO — devuelven null en vez de un método vacío', () => {
    // Los tres abren sesión antes de leer, y su lector se escribe cuando haya
    // una cuenta de piloto contra la cual verificarlo. Escribirlo a ciegas es
    // cómo se consigue un adaptador que parece funcionar y no funciona.
    expect(lectorDe('wialon')).toBeNull();
    expect(lectorDe('geotab')).toBeNull();
    expect(lectorDe('navixy')).toBeNull();
  });
});
