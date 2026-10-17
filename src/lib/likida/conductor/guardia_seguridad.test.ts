import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

import { contieneDatoDeSeguridad, guardiaDatosSeguridad, TEXTO_CLAVE_NO_AQUI, TERMINOS_SEGURIDAD } from './guardia_seguridad';
import { atenderConductor, type DepsAtender } from './atender';
import { tipoEvidenciaDeCaption } from './evidencia';
import { logger } from '@/lib/logger';

describe('T-A5-58 · detección (lista configurable, sin falsos positivos)', () => {
  it.each([
    'mi clave de amago es 1234',
    'Clave de Amago: 8',
    'CLAVE DE AMAGO',
    'la clave amago es otra',
    'clave de ámago 55',
    'clave del mago para el viaje',
    'te paso mi botón de pánico',
    'pánico',
    'PANICO!!!',
    'oprimí el boton de panico',
    'clave de pánico 99',
  ])('detecta «%s»', (t) => expect(contieneDatoDeSeguridad(t)).toBe(true));

  it.each([
    'ya llegué',
    'sello',
    'foto del sello',
    'ya salí con el sello puesto',
    'ya llegué a la rampa 4',
    'panicoso el tráfico',
    'despanico',
    'hay amago de lluvia',
    'el mago de oz',
    'clave de la caja 4567',
    'sello de amagos',
    '',
  ])('deja pasar «%s»', (t) => expect(contieneDatoDeSeguridad(t)).toBe(false));

  it('la lista es configurable', () => {
    expect(contieneDatoDeSeguridad('palabra secreta xyz', ['palabra secreta'])).toBe(true);
    expect(contieneDatoDeSeguridad('clave de amago', ['palabra secreta'])).toBe(false);
  });

  it('la respuesta no repite el texto sensible', () => {
    const r = guardiaDatosSeguridad('mi clave de amago es 7788');
    expect(r?.texto).toBe(TEXTO_CLAVE_NO_AQUI);
    expect(r?.texto).not.toMatch(/7788|amago|p[aá]nico/i);
    expect(guardiaDatosSeguridad('ya llegué')).toBeNull();
    expect(guardiaDatosSeguridad(undefined)).toBeNull();
  });
});

describe('T-A5-58 · el texto sensible no llega a hito, evidencia ni log', () => {
  const espia = () => {
    const llamadas: unknown[] = [];
    const deps = new Proxy({} as DepsAtender, {
      get: (_o, prop) => (...args: unknown[]) => { llamadas.push([String(prop), args]); throw new Error(`no debía llamarse ${String(prop)}`); },
    });
    return { deps, llamadas };
  };

  it.each(['mi clave de amago es 1234', 'botón de pánico', 'CLAVE DE AMAGO 9'])('atenderConductor «%s» responde sin tocar deps ni logger', async (texto) => {
    const { deps, llamadas } = espia();
    const r = await atenderConductor({ tenantId: 't', operadorId: 'o', telefono: '28999', viajeAbiertoId: 'v1', texto }, deps);
    expect(r?.mensajes).toEqual([{ texto: TEXTO_CLAVE_NO_AQUI }]);
    expect(llamadas).toEqual([]);
    for (const nivel of ['info', 'warn', 'error', 'debug'] as const) expect(logger[nivel]).not.toHaveBeenCalled();
  });

  it('también sin viaje abierto', async () => {
    const { deps } = espia();
    const r = await atenderConductor({ tenantId: 't', operadorId: 'o', telefono: '28999', viajeAbiertoId: null, texto: 'clave de amago' }, deps);
    expect(r?.mensajes[0].texto).toBe(TEXTO_CLAVE_NO_AQUI);
  });

  it('un caption sensible no es evidencia de hito', () => {
    expect(tipoEvidenciaDeCaption('sello clave de amago 12')).toBeNull();
    expect(tipoEvidenciaDeCaption('clave de amago')).toBeNull();
    expect(tipoEvidenciaDeCaption('sello')).toBe('sello');
  });
});

describe('T-A5-58 · el texto saliente no pide ni cita la clave (ajuste 16b A12)', () => {
  const dir = __dirname;
  const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/(^|[^:'"`])\/\/ .*$/, '$1')).join('\n');
  const fuentes = readdirSync(dir).filter((f) => f.endsWith('.ts') && !/\.test\.ts$/.test(f) && f !== 'guardia_seguridad.ts');

  it('hay fuentes que recorrer', () => { expect(fuentes.length).toBeGreaterThan(20); expect(fuentes).toContain('mensajes.ts'); });

  it.each(fuentes)('%s: ninguna cadena menciona los términos de seguridad', (f) => {
    const t = sinComentarios(readFileSync(join(dir, f), 'utf8'));
    expect(contieneDatoDeSeguridad(t, TERMINOS_SEGURIDAD)).toBe(false);
  });
});
