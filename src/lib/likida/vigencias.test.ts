import { describe, it, expect } from 'vitest';
import {
  clasificarVigencia, contarVigencias, avisoVigencias, DIAS_AVISO,
} from './vigencias';

describe('clasificarVigencia — sin dato NO es vigente', () => {
  it('una unidad sin papeles capturados NO se pinta verde', () => {
    // Es la mentira que este producto no puede permitirse: el gerente la vería
    // en "todo al día" y se enteraría cuando lo pare un inspector.
    const v = clasificarVigencia(null, null);
    expect(v.estado).toBe('sin_dato');
    expect(v.estado).not.toBe('vigente');
    expect(v.rotulo).toContain('Sin papeles');
  });

  it('sin dato no dispara alerta roja: pide capturar, no correr al taller', () => {
    expect(clasificarVigencia(null, null).pide).toBe(false);
  });
});

describe('clasificarVigencia — los tres estados con dato', () => {
  it('días negativos es VENCIDO y pide a una persona', () => {
    const v = clasificarVigencia(-8, 'Verificación');
    expect(v.estado).toBe('vencido');
    expect(v.rotulo).toBe('Verificación: vencida hace 8 días');
    expect(v.pide).toBe(true);
  });

  it('vencida AYER se dice ayer, no "hace 1 días"', () => {
    expect(clasificarVigencia(-1, 'Póliza').rotulo).toBe('Póliza: vencida ayer');
  });

  it('cero días es HOY, y todavía cuenta como por vencer, no como vencido', () => {
    const v = clasificarVigencia(0, 'Permiso SICT');
    expect(v.estado).toBe('por_vencer');
    expect(v.rotulo).toContain('vence HOY');
    expect(v.pide).toBe(true);
  });

  it('mañana se dice mañana', () => {
    expect(clasificarVigencia(1, 'Póliza').rotulo).toBe('Póliza: vence mañana');
  });

  it('el borde del aviso: 30 días avisa, 31 ya no', () => {
    expect(clasificarVigencia(DIAS_AVISO, 'Póliza').estado).toBe('por_vencer');
    expect(clasificarVigencia(DIAS_AVISO + 1, 'Póliza').estado).toBe('vigente');
  });

  it('lejos del vencimiento es vigente y NO pide nada', () => {
    const v = clasificarVigencia(147, 'Permiso SICT');
    expect(v.estado).toBe('vigente');
    expect(v.pide).toBe(false);
    expect(v.rotulo).toContain('147 días más');
  });

  it('si el motor no dijo QUÉ vence, el rótulo no queda cojo', () => {
    expect(clasificarVigencia(-3, null).rotulo).toBe('Un documento: vencida hace 3 días');
  });
});

describe('contarVigencias', () => {
  const u = (dias: number | null) => ({ diasAlVencimiento: dias, queVence: 'Póliza' });

  it('reparte cada unidad en su cubeta', () => {
    expect(contarVigencias([u(-5), u(-1), u(10), u(200), u(null)])).toEqual({
      vencidos: 2, porVencer: 1, vigentes: 1, sinDato: 1,
    });
  });

  it('una flota vacía cuenta cero, no truena', () => {
    expect(contarVigencias([])).toEqual({ vencidos: 0, porVencer: 0, vigentes: 0, sinDato: 0 });
  });

  it('las unidades sin dato NO engordan el conteo de vigentes', () => {
    const c = contarVigencias([u(null), u(null), u(null)]);
    expect(c.vigentes).toBe(0);
    expect(c.sinDato).toBe(3);
  });
});

describe('avisoVigencias — el banner se calla cuando no hay nada', () => {
  it('sin vencidos ni por vencer, no hay banner', () => {
    // Un banner permanente deja de leerse a la semana.
    expect(avisoVigencias({ vencidos: 0, porVencer: 0, vigentes: 12, sinDato: 3 })).toBeNull();
  });

  it('junta las dos noticias en una línea', () => {
    const t = avisoVigencias({ vencidos: 2, porVencer: 4, vigentes: 9, sinDato: 0 })!;
    expect(t).toBe('2 unidades con papeles vencidos · 4 vencen en los próximos 30 días');
  });

  it('el singular está escrito, no armado con "(s)"', () => {
    expect(avisoVigencias({ vencidos: 1, porVencer: 1, vigentes: 0, sinDato: 0 }))
      .toBe('1 unidad con un papel vencido · 1 vence en los próximos 30 días');
  });

  it('solo vencidos, o solo por vencer, tampoco cojea', () => {
    expect(avisoVigencias({ vencidos: 3, porVencer: 0, vigentes: 0, sinDato: 0 }))
      .toBe('3 unidades con papeles vencidos');
    expect(avisoVigencias({ vencidos: 0, porVencer: 2, vigentes: 0, sinDato: 0 }))
      .toBe('2 vencen en los próximos 30 días');
  });

  it('las unidades SIN DATO no inventan un banner', () => {
    // Capturar papeles es trabajo de alta, no una urgencia de carretera.
    expect(avisoVigencias({ vencidos: 0, porVencer: 0, vigentes: 0, sinDato: 40 })).toBeNull();
  });
});
