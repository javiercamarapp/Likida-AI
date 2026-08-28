import { describe, it, expect } from 'vitest';
import { INTERRUPTORES } from '@/lib/likida/interruptores';
import { ETIQUETA_INTERRUPTOR, etiquetaInterruptor } from './etiquetas';

// ═══════════════════════════════════════════════════════════════════════════
// EL MAPA DE RÓTULOS NO PUEDE QUEDARSE ATRÁS DEL CATÁLOGO DE PALANCAS.
//
// `etiquetas.ts` tenía 18 de las 58 palancas: las 40 altas de las migraciones
// 0215-0235 entraron a `INTERRUPTORES` y nadie volvió a este archivo, así que
// 39 palancas se pintaban con su id técnico en Observabilidad, en el ⌘K y en
// la columna Agente de /admin/corridas.
//
// El fallback a id crudo se conserva A PROPÓSITO (`etiquetaInterruptor` nunca
// revienta: una palanca sin rótulo se pinta visible, no rota) — pero el
// fallback es una red de seguridad para producción, no una excusa para
// mergear una palanca sin nombre. Esa parte la decide esta prueba.
// ═══════════════════════════════════════════════════════════════════════════

describe('ETIQUETA_INTERRUPTOR cubre el catálogo', () => {
  it('toda palanca de INTERRUPTORES tiene rótulo humano', () => {
    const sinRotulo = INTERRUPTORES.filter((id) => ETIQUETA_INTERRUPTOR[id] === undefined);
    expect(sinRotulo, `estas palancas se pintarían con su id crudo: ${sinRotulo.join(', ')}`).toEqual([]);
  });

  it('no sobra ningún rótulo de una palanca que ya no existe', () => {
    // La dirección contraria importa igual: un rótulo huérfano es una palanca
    // que alguien retiró del catálogo y que este mapa sigue prometiendo.
    const vivas = new Set<string>(INTERRUPTORES);
    const huerfanos = Object.keys(ETIQUETA_INTERRUPTOR).filter((id) => !vivas.has(id as never));
    expect(huerfanos, `rótulos de palancas inexistentes: ${huerfanos.join(', ')}`).toEqual([]);
  });

  it('ningún rótulo es el propio id — eso sería fingir que está traducido', () => {
    const perezosos = Object.entries(ETIQUETA_INTERRUPTOR).filter(([id, r]) => r === id);
    expect(perezosos.map(([id]) => id)).toEqual([]);
  });

  it('etiquetaInterruptor cae al id crudo ante una palanca desconocida', () => {
    // La red de seguridad sigue viva: visible, no rota.
    expect(etiquetaInterruptor('agente:inventado')).toBe('agente:inventado');
  });
});
