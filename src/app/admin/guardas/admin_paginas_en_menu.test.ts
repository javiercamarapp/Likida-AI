import { describe, expect, it } from 'vitest';
import { direccionesEstaticas } from './medir';
import { BASE_PAGINAS_FUERA_DEL_MENU } from './base';
import { FUERA_DEL_MENU, entradaDeRuta } from '../rutas';

// Guarda `admin_paginas_en_menu` (Fase 0, K3; cerrada en la Fase 1): toda pantalla estática de /admin debe colgar de una entrada del menú
// o de una pestaña de `rutas.ts`, o estar en la lista cerrada FUERA_DEL_MENU (campana, avatar, «ver como») o ser el Resumen (`/admin`).
// Los stubs 308 no son pantallas (los vigila `redirecciones_308`). La base lista las que hoy no cuelgan de nada (ejecutivo y analitica,
// que la Fase 2 convierte en stubs) y solo disminuye.
describe('admin_paginas_en_menu', () => {
  const permitidas = new Set(['/admin', ...FUERA_DEL_MENU.map((f) => f.href)]);
  const fuera = direccionesEstaticas().filter((d) => entradaDeRuta(d) === null && !permitidas.has(d));
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
    expect(existentes.has('/admin/corridas')).toBe(true);
  });
  it('la lista fuera del menú es cerrada: notificaciones, mi-perfil y elegir-flota, y las tres existen', () => {
    expect(FUERA_DEL_MENU.map((f) => f.href).sort()).toEqual(['/admin/elegir-flota', '/admin/mi-perfil', '/admin/notificaciones']);
    const existentes = new Set(direccionesEstaticas());
    for (const f of FUERA_DEL_MENU) expect(existentes.has(f.href), f.href).toBe(true);
  });
});
