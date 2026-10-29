import { describe, it, expect } from 'vitest';
import { bloqueaElClic } from './bloqueo';
import { RECORRIDO_DUENO } from '@/app/dashboard/recorridos/dueno';

describe('bloqueo de clics del velo del recorrido', () => {
  it('un paso informativo bloquea; uno que pide una acción no', () => {
    expect(bloqueaElClic({})).toBe(true);
    expect(bloqueaElClic({ accion: { verbo: 'Aprieta', objetivo: 'X' } })).toBe(false);
    expect(bloqueaElClic({ avance: { tipo: 'accion', evento: 'click' } })).toBe(false);
  });

  it('ningún paso del recorrido del dueño que dice «Aprieta» deja el elemento bloqueado', () => {
    const pidenApretar = RECORRIDO_DUENO.pasos.filter((p) => p.accion?.verbo === 'Aprieta');
    expect(pidenApretar.length).toBeGreaterThanOrEqual(4);
    for (const p of pidenApretar) expect(bloqueaElClic(p), p.id).toBe(false);
  });
});
