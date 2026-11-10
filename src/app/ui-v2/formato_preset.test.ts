import { describe, expect, it } from 'vitest';
import { resolverFormato, type FormatoPreset } from './formato-preset';
import { numero, mxn, usd } from '@/lib/formato';
import * as viejoPreset from '../admin/ui/formato-preset';
import * as viejoForma from '../admin/ui/forma';
import * as nuevoForma from './componentes/forma';
import * as viejoConfirmar from '../admin/ui/confirmar';
import * as nuevoConfirmar from './componentes/confirmar';
import * as viejoResultado from '../admin/ui/aviso-resultado';
import * as nuevoResultado from './componentes/aviso-resultado';
import * as viejoNotif from '../admin/ui/notificaciones';
import * as nuevoNotif from './componentes/notificaciones';

describe('ui-v2/formato-preset', () => {
  it('cada preset formatea con lib/formato (una cifra se lee igual en toda pantalla)', () => {
    expect(resolverFormato('mxn')(1234.5)).toBe(mxn(1234.5));
    expect(resolverFormato('usd')(1234.5)).toBe(usd(1234.5));
    expect(resolverFormato('entero')(42350.4)).toBe(numero(42350));
    expect(resolverFormato()(1234)).toBe(numero(1234));
    expect(resolverFormato('porcentaje')(12.4)).toBe('12%');
    expect(resolverFormato('porcentajeSigno')(22)).toBe('+22%');
    expect(resolverFormato('porcentajeSigno')(-8)).toBe('-8%');
  });
  it('un preset desconocido cae en `numero` en vez de romper', () => {
    expect(resolverFormato('zzz' as FormatoPreset)(1234)).toBe(numero(1234));
  });
});

describe('re-exportaciones delgadas de admin/ui (mismo API, misma identidad)', () => {
  const mismas = (viejo: Record<string, unknown>, nuevo: Record<string, unknown>) => {
    const claves = Object.keys(viejo);
    expect(claves.length).toBeGreaterThan(0);
    for (const k of claves) expect(viejo[k], k).toBe(nuevo[k]);
    // y nada del valor público se perdió en la mudanza
    for (const k of Object.keys(nuevo)) expect(claves, k).toContain(k);
  };
  it('formato-preset', () => mismas(viejoPreset, { resolverFormato }));
  it('forma', () => mismas(viejoForma, nuevoForma));
  it('confirmar', () => mismas(viejoConfirmar, nuevoConfirmar));
  it('aviso-resultado', () => mismas(viejoResultado, nuevoResultado));
  it('notificaciones', () => mismas(viejoNotif, nuevoNotif));
});
