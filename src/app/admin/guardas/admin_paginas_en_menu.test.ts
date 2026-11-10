import { describe, expect, it } from 'vitest';
import { direccionesEstaticas } from './medir';
import { BASE_PAGINAS_FUERA_DEL_MENU } from './base';
import { entradaDeRuta } from '../rutas';

// Guarda `admin_paginas_en_menu` (Fase 0, K3): toda pantalla estática de /admin debe colgar de una entrada del menú o de una pestaña de
// `rutas.ts` (si no, solo se llega a ella por ⌘K o por un enlace suelto). La base lista las que hoy no cuelgan y solo disminuye.
describe('admin_paginas_en_menu', () => {
  const fuera = direccionesEstaticas().filter((d) => entradaDeRuta(d) === null);
  it('no aparece ninguna pantalla nueva fuera del menú', () => {
    const base = new Set(BASE_PAGINAS_FUERA_DEL_MENU);
    expect(fuera.filter((d) => !base.has(d)), 'cuélgala de rutas.ts (entrada o pestaña)').toEqual([]);
  });
  it('lo que ya quedó dentro del menú sale de la base', () => {
    const ahora = new Set(fuera);
    expect(BASE_PAGINAS_FUERA_DEL_MENU.filter((d) => !ahora.has(d)), 'ya está en el menú: bórrala de la base').toEqual([]);
  });
  it('las direcciones del menú existen como pantallas (nada apunta al vacío)', () => {
    const existentes = new Set(direccionesEstaticas());
    expect(existentes.has('/admin/escalaciones')).toBe(true);
    expect(existentes.has('/admin/agentes')).toBe(true);
  });
});
