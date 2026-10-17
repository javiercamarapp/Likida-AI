import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { BloqueServicio, type AccionesVigia } from './vista';
import type { DatosTablero } from '@/lib/likida/vigia/repo';
import { configApagada } from '@/lib/likida/vigia/tipos';

// T-A4-26: el bloque «A quién avisa cuando no hay dato». El dueño edita; quien solo mira ve el teléfono enmascarado y ningún correo.

const noop = (async () => null) as AccionesVigia['decidir'];
const acciones: AccionesVigia = { decidir: noop, conversacion: noop, config: noop, alta: noop, contacto: noop, director: noop, servicio: noop };
const base = (extra: Partial<DatosTablero> = {}): DatosTablero => ({
  config: { ...configApagada('t1'), habilitado: true },
  conversaciones: [], pendientes: [], fallidos: [], contactos: [], eventos: [],
  respuesta: { muestra: 0, promedioMin: null, medianaMin: null }, clientes: [{ id: 'c1', nombre: 'Compras Acme' }], gerentes: [], ...extra,
});
const servicio: NonNullable<DatosTablero['servicio']> = [
  { id: '77777777-7777-4777-8777-777777777771', nombre: 'Servicio Uno', telefono: '522899900001', correo: 'uno@flota.example', clienteId: null, activo: true },
  { id: '77777777-7777-4777-8777-777777777772', nombre: 'Servicio Dos', telefono: null, correo: 'dos@flota.example', clienteId: 'c1', activo: false },
];
const pintar = async (el: Promise<ReactElement>) => renderToStaticMarkup(await el);

describe('T-A4-26 · bloque de servicio al cliente', () => {
  it('el dueño ve a cada persona con sus campos, quitar, y la forma de agregar', async () => {
    const html = await pintar(BloqueServicio({ datos: Promise.resolve(base({ servicio })), puedeAdministrar: true, acciones }));
    expect(html).toContain('A quién avisa cuando no hay dato');
    expect(html).toContain('value="Servicio Uno"');
    expect(html).toContain('value="2899900001"');
    expect(html).toContain('Todos los clientes');
    expect(html).toContain('Compras Acme');
    expect(html).toContain('Quitar');
    expect(html).toContain('Agregar a servicio al cliente');
  });
  it('quien solo mira: teléfono enmascarado, sin correo, sin campos ni botones', async () => {
    const html = await pintar(BloqueServicio({ datos: Promise.resolve(base({ servicio })), puedeAdministrar: false, acciones }));
    expect(html).toContain('Servicio Uno');
    expect(html).toContain('…0001');
    expect(html).not.toContain('522899900001');
    expect(html).not.toContain('uno@flota.example');
    expect(html).not.toContain('dos@flota.example');
    expect(html).not.toContain('Quitar');
    expect(html).not.toContain('Agregar a servicio al cliente');
    expect(html).toContain('Pausado');
    expect(html).toContain('Solo el dueño de la flota cambia esta lista');
  });
  it('sin lista dice que se avisa como siempre; sin acción disponible tampoco muestra formas', async () => {
    const vacio = await pintar(BloqueServicio({ datos: Promise.resolve(base()), puedeAdministrar: true, acciones }));
    expect(vacio).toContain('Nadie en la lista: se avisa como siempre');
    const sinAccion = await pintar(BloqueServicio({ datos: Promise.resolve(base({ servicio })), puedeAdministrar: true, acciones: { ...acciones, servicio: undefined } }));
    expect(sinAccion).not.toContain('Quitar');
    expect(sinAccion).not.toContain('522899900001');
  });
});
