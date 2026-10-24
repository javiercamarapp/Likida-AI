import { describe, it, expect } from 'vitest';
import { decidirPausa } from './pausa';

describe('A37-S12-04 · decidirPausa aplica el estado deseado, no invierte', () => {
  it('pausar un agente ya pausado (página vieja) no lo reactiva', () => {
    expect(decidirPausa(false, 'pausado')).toEqual({ accion: 'nada' });
  });
  it('reanudar un agente ya activo no hace nada', () => {
    expect(decidirPausa(true, 'activo')).toEqual({ accion: 'nada' });
  });
  it('cambia solo cuando el deseado difiere del actual', () => {
    expect(decidirPausa(true, 'pausado')).toEqual({ accion: 'cambiar', activo: false });
    expect(decidirPausa(false, 'activo')).toEqual({ accion: 'cambiar', activo: true });
  });
  it('sin estado deseado (formulario viejo) no se adivina: pide recargar', () => {
    expect(decidirPausa(true, null)).toEqual({ accion: 'recargar' });
    expect(decidirPausa(true, 'x')).toEqual({ accion: 'recargar' });
  });
});
