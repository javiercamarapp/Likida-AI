import { describe, it, expect } from 'vitest';
import { validarRecorrido } from '@/app/ui-v2/movimiento/tour';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { RECORRIDO_DUENO, rutasDeRecorridos } from './dueno';

describe('recorrido del dueño', () => {
  it('pasa la validación del motor (títulos y textos breves, anclas estables, acción con su frase)', () => {
    expect(validarRecorrido(RECORRIDO_DUENO)).toEqual([]);
  });

  it('cada ruta que visita es del perfil y la ve un administrador; el contador no recibe pantallas que no ve', () => {
    for (const r of rutasDeRecorridos()) expect(puedeVerRuta('flota_admin', r, 'cinco_agentes'), r).toBe(true);
    // Conexiones y Puesta en marcha son de administración: un encargado no las ve, y el motor quita esos pasos.
    expect(puedeVerRuta('encargado', '/dashboard/puesta-en-marcha', 'cinco_agentes')).toBe(false);
  });

  it('no nombra a ningún cliente ni promete cifras', () => {
    const todo = JSON.stringify(RECORRIDO_DUENO);
    expect(/innovativ/i.test(todo)).toBe(false);
    expect(/\d+\s?%|\$\s?\d/.test(todo)).toBe(false);
  });

  it('el primer paso es centrado (sin ancla) y el recorrido nunca exige hacer algo para poder avanzar salvo la acción pedida', () => {
    expect(RECORRIDO_DUENO.pasos[0].ancla).toBeUndefined();
    expect(RECORRIDO_DUENO.pasos.filter((p) => p.avance?.tipo === 'accion').map((p) => p.id)).toEqual(['sistema']);
  });
});
