import { describe, it, expect } from 'vitest';
import {
  validarConfigCobranza, dentroDeVentana, tierPendiente, armarMensajeCobranza,
  CONFIG_COBRANZA_DEFAULT,
} from './cobranza';

// Solo el motor PURO: claims, envíos y bitácora se prueban con la
// verificación 64 de la base y el arnés manual — un mock de Supabase
// probaría el mock.

describe('validarConfigCobranza', () => {
  it('sin nada, devuelve la conducta del 0087 (defaults)', () => {
    const v = validarConfigCobranza({});
    expect('ok' in v && v.ok).toEqual(CONFIG_COBRANZA_DEFAULT);
  });

  it('ordena los tiers y tira los inválidos', () => {
    const v = validarConfigCobranza({ tiers: [14, 3, 7] });
    expect('ok' in v && v.ok.tiers).toEqual([3, 7, 14]);
  });

  it('rechaza tiers repetidos, vacíos o fuera de rango — en palabras de pantalla', () => {
    expect(validarConfigCobranza({ tiers: [3, 3] })).toHaveProperty('error');
    expect(validarConfigCobranza({ tiers: [0, 90] })).toHaveProperty('error');
    expect(validarConfigCobranza({ tiers: [1, 2, 3, 4, 5, 6] })).toHaveProperty('error');
  });

  it('la ventana imposible rebota (fin <= inicio) — igual que el CHECK de la base', () => {
    expect(validarConfigCobranza({ horaInicio: 18, horaFin: 9 })).toHaveProperty('error');
  });

  it('recorta instrucciones y firma a sus topes', () => {
    const v = validarConfigCobranza({ instrucciones: 'x'.repeat(500), firma: 'y'.repeat(200) });
    expect('ok' in v && v.ok.instrucciones.length).toBe(300);
    expect('ok' in v && v.ok.firma.length).toBe(80);
  });

  it('sin días permitidos no hay agente que corra', () => {
    expect(validarConfigCobranza({ diasSemana: [] })).toHaveProperty('error');
  });
});

describe('dentroDeVentana — la hora del CHOFER (México), no la del servidor', () => {
  const config = { ...CONFIG_COBRANZA_DEFAULT, horaInicio: 9, horaFin: 18, diasSemana: [1, 2, 3, 4, 5] };

  it('las 10am de un miércoles en CDMX está adentro', () => {
    // 2026-08-12 fue miércoles; 16:00Z = 10:00 CDMX (UTC-6).
    expect(dentroDeVentana(config, new Date('2026-08-12T16:00:00Z'))).toBe(true);
  });

  it('las 8am queda AFUERA aunque el servidor (UTC) ya vaya en la tarde', () => {
    expect(dentroDeVentana(config, new Date('2026-08-12T14:00:00Z'))).toBe(false);
  });

  it('la hora de fin es EXCLUSIVA: a las 18:00 ya no se contacta', () => {
    expect(dentroDeVentana(config, new Date('2026-08-13T00:00:00Z'))).toBe(false); // 18:00 CDMX del 12
  });

  it('el domingo no corre si no está permitido', () => {
    // 2026-08-16 es domingo; 17:00Z = 11:00 CDMX.
    expect(dentroDeVentana(config, new Date('2026-08-16T17:00:00Z'))).toBe(false);
  });
});

describe('tierPendiente — a quién le toca insistir', () => {
  const TIERS = [3, 7, 14];

  it('antes del primer tier no toca nada', () => {
    expect(tierPendiente(2, TIERS, [], false)).toBeNull();
  });

  it('al cruzar el primer tier, toca el 3', () => {
    expect(tierPendiente(4, TIERS, [], false)).toBe(3);
  });

  it('toca el MAYOR tier alcanzado sin contacto — no se mandan tres mensajes juntos a un viaje viejo', () => {
    expect(tierPendiente(20, TIERS, [], false)).toBe(14);
  });

  it('un tier ya contactado no se repite', () => {
    expect(tierPendiente(8, TIERS, [3], false)).toBe(7);
    expect(tierPendiente(8, TIERS, [3, 7], false)).toBeNull();
  });

  it('el sello viejo (0087) consume el primer tier: al estrenar tiers nadie recibe doble el recordatorio que ya recibió', () => {
    expect(tierPendiente(4, TIERS, [], true)).toBeNull();
    expect(tierPendiente(8, TIERS, [], true)).toBe(7);
  });
});

describe('armarMensajeCobranza', () => {
  it('el texto base es el del 0087, con folio y días reales', () => {
    const m = armarMensajeCobranza('V-2031', 5, CONFIG_COBRANZA_DEFAULT);
    expect(m).toContain('Llevas 5 días con tu viaje *V-2031*');
    expect(m).toContain('diésel, casetas');
  });

  it('las instrucciones del cliente y la firma viajan al final', () => {
    const m = armarMensajeCobranza(null, 8, {
      ...CONFIG_COBRANZA_DEFAULT,
      instrucciones: 'Si ya entregaste, mándame también la carta porte.',
      firma: 'Transportes Rivera',
    });
    expect(m).toContain('tu viaje abierto');
    expect(m).toContain('carta porte');
    expect(m.trim().endsWith('— Transportes Rivera')).toBe(true);
  });
});
