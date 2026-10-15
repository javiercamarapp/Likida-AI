import { describe, expect, it } from 'vitest';
import {
  CAMPOS_AVISO,
  CAMPOS_POR_DEFECTO,
  CAMPOS_SENSIBLES,
  camposVisibles,
  constanciaValida,
  filtrarOperador,
  type Habilitacion,
  type PoliticaPrivacidad,
} from './privacidad';
import type { OperadorResuelto } from './resolver';

const constancia = { por: 'duena-sintetica', rol: 'flota_admin', cuando: '2026-10-01T12:00:00Z' };
const todo: Habilitacion = { campos: ['licencia', 'vigencia', 'telefono_operador'], constancia };

// Datos sintéticos (prefijo ficticio).
const operador: OperadorResuelto = {
  nombre: 'Operador Prueba',
  licencia: 'LIC-000000',
  vence: '2027-01-31',
  telefono: '2899900001',
  fuente: 'sistema',
};

describe('camposVisibles: por defecto', () => {
  it.each([undefined, null, {}])('sin política (%j) salen solo los de por defecto', (p) => {
    const v = camposVisibles(p as PoliticaPrivacidad | null | undefined, 'c1');
    expect([...v].sort()).toEqual([...CAMPOS_POR_DEFECTO].sort());
    for (const s of CAMPOS_SENSIBLES) expect(v.has(s)).toBe(false);
  });

  it('licencia, vigencia y teléfono nunca aparecen aunque existan en la fuente', () => {
    const f = filtrarOperador(operador, camposVisibles(undefined, 'c1'))!;
    expect(f.nombre).toBe('Operador Prueba');
    expect(f.licencia).toBeNull();
    expect(f.vence).toBeNull();
    expect(f.telefono).toBeNull();
    expect(JSON.stringify(f)).not.toContain('2899900001');
    expect(JSON.stringify(f)).not.toContain('LIC-000000');
  });

  it('operador null → null', () => {
    expect(filtrarOperador(null, camposVisibles(undefined, 'c1'))).toBeNull();
  });
});

describe('camposVisibles: habilitación', () => {
  it('la general habilitada con constancia muestra los sensibles', () => {
    const v = camposVisibles({ general: todo }, 'c1');
    for (const s of CAMPOS_SENSIBLES) expect(v.has(s)).toBe(true);
    const f = filtrarOperador(operador, v)!;
    expect(f.licencia).toBe('LIC-000000');
    expect(f.telefono).toBe('2899900001');
  });

  it('habilitar solo la licencia no abre el teléfono', () => {
    const v = camposVisibles({ general: { campos: ['licencia'], constancia } }, 'c1');
    expect(v.has('licencia')).toBe(true);
    expect(v.has('telefono_operador')).toBe(false);
    expect(v.has('vigencia')).toBe(false);
  });

  it('la política por cliente gana a la general (también para revocar)', () => {
    const p: PoliticaPrivacidad = { general: todo, porCliente: { c2: { campos: [], constancia } } };
    expect(camposVisibles(p, 'c1').has('telefono_operador')).toBe(true);
    expect(camposVisibles(p, 'c2').has('telefono_operador')).toBe(false);
  });

  it('la política por cliente puede abrir lo que la general cierra', () => {
    const p: PoliticaPrivacidad = { general: null, porCliente: { c1: todo } };
    expect(camposVisibles(p, 'c1').has('licencia')).toBe(true);
    expect(camposVisibles(p, 'c2').has('licencia')).toBe(false);
  });

  it('cliente sin id usa la general', () => {
    expect(camposVisibles({ general: todo }, null).has('licencia')).toBe(true);
  });
});

describe('camposVisibles: falla cerrado', () => {
  it('campo desconocido se ignora (no se agrega)', () => {
    const v = camposVisibles({ general: { campos: ['pasaporte', 'licencia'], constancia } }, 'c1');
    expect(v.has('licencia')).toBe(true);
    expect([...v].every((c) => (CAMPOS_AVISO as readonly string[]).includes(c))).toBe(true);
    expect(v.size).toBe(CAMPOS_POR_DEFECTO.length + 1);
  });

  it.each([
    ['sin constancia', null],
    ['rol distinto', { ...constancia, rol: 'despachador' }],
    ['sin quién', { ...constancia, por: '  ' }],
    ['fecha inválida', { ...constancia, cuando: 'ayer' }],
  ])('habilitación %s no abre nada', (_n, c) => {
    const v = camposVisibles({ general: { campos: [...CAMPOS_SENSIBLES], constancia: c } }, 'c1');
    for (const s of CAMPOS_SENSIBLES) expect(v.has(s)).toBe(false);
  });

  it('entrada propia con constancia inválida no cae a la general', () => {
    const p: PoliticaPrivacidad = { general: todo, porCliente: { c1: { campos: ['licencia'], constancia: null } } };
    expect(camposVisibles(p, 'c1').has('licencia')).toBe(false);
  });

  it('campos que no es arreglo no abre nada', () => {
    const malo = { campos: 'licencia', constancia } as unknown as Habilitacion;
    expect(camposVisibles({ general: malo }, 'c1').has('licencia')).toBe(false);
  });

  it('clienteId tipo __proto__ no hereda nada', () => {
    expect(camposVisibles({ porCliente: {} }, '__proto__').has('licencia')).toBe(false);
  });

  it('constanciaValida acepta la buena', () => {
    expect(constanciaValida(constancia)).toBe(true);
  });
});
