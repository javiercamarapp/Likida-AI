import { describe, expect, it } from 'vitest';
import { actorSeudonimo, deduplicar, GUIA_EVENTOS, normalizarEvento } from './eventos';

describe('actorSeudonimo', () => {
  it('son 16 hex, estable por usuario y distinto entre usuarios o secretos', () => {
    const a = actorSeudonimo('secreto-1', 'user-a');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(actorSeudonimo('secreto-1', 'user-a')).toBe(a);
    expect(actorSeudonimo('secreto-1', 'user-b')).not.toBe(a);
    expect(actorSeudonimo('secreto-2', 'user-a')).not.toBe(a);
  });
  it('no contiene el id del usuario', () => {
    expect(actorSeudonimo('s', '5e0b0c1a-user')).not.toContain('5e0b');
  });
});

describe('normalizarEvento', () => {
  it('acepta un evento válido', () => {
    expect(normalizarEvento({ tipo: 'paso_hecho_senal', recorrido: 'dueno.corto', pasoId: 'PM2-03', valorMs: 4200.7, canal: 'movil', reducido: true })).toEqual({
      tipo: 'paso_hecho_senal', recorrido: 'dueno.corto', paso_id: 'PM2-03', valor_ms: 4201, valor_n: null, canal: 'movil', reducido: true,
    });
  });
  it('rechaza tipos fuera de la lista cerrada, canales raros y ids con texto libre', () => {
    expect(normalizarEvento({ tipo: 'texto_libre', canal: 'movil' })).toBeNull();
    expect(normalizarEvento({ tipo: 'guia_inicio', canal: 'tablet' })).toBeNull();
    expect(normalizarEvento({ tipo: 'paso_visto', canal: 'movil', pasoId: 'ana@empresa.mx' })).toBeNull();
    expect(normalizarEvento({ tipo: 'paso_visto', canal: 'movil', recorrido: '/dashboard/viajes/123' })).toBeNull();
    expect(normalizarEvento(null)).toBeNull();
    expect(normalizarEvento('x')).toBeNull();
  });
  it('los números negativos o no finitos se descartan, no se arreglan', () => {
    const e = normalizarEvento({ tipo: 'paso_visto', canal: 'escritorio', valorMs: -5, valorN: Number.NaN });
    expect(e?.valor_ms).toBeNull();
    expect(e?.valor_n).toBeNull();
  });
  it('el resultado solo tiene campos de la lista (sin PII posible)', () => {
    const e = normalizarEvento({ tipo: 'guia_inicio', canal: 'movil', correo: 'a@b.mx', nombre: 'Ana', ip: '1.2.3.4' });
    expect(Object.keys(e ?? {}).sort()).toEqual(['canal', 'paso_id', 'recorrido', 'reducido', 'tipo', 'valor_ms', 'valor_n']);
  });
});

describe('deduplicar', () => {
  it('un mismo (paso, tipo) cuenta una vez por sesión; los eventos sin paso siempre pasan', () => {
    const e = (paso: string | null, tipo: 'paso_visto' | 'guia_inicio') => ({ tipo, recorrido: null, paso_id: paso, valor_ms: null, valor_n: null, canal: 'movil' as const, reducido: false });
    const vistos = new Set<string>();
    expect(deduplicar([e('P1', 'paso_visto'), e('P1', 'paso_visto'), e('P2', 'paso_visto'), e(null, 'guia_inicio'), e(null, 'guia_inicio')], vistos)).toHaveLength(4);
    expect(deduplicar([e('P1', 'paso_visto')], vistos)).toHaveLength(0);
  });
});

describe('interruptor de eventos', () => {
  it('queda apagado hasta que el aviso de privacidad lo mencione (D-OB-8)', () => {
    expect(GUIA_EVENTOS).toBe(false);
  });
});
