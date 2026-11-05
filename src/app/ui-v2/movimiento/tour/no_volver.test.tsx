/* eslint-disable security/detect-non-literal-fs-filename -- lee el fuente del propio proveedor; ruta fija relativa a esta prueba. */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { InvitacionRecorrido } from './invitacion';
import { PistaContextual } from './pista';
import {
  crearEstadoLocal, debeInvitar, debeMostrarPista, descarteDeInvitacion, descarteDePista, ESTADO_VACIO, type Almacen,
} from '@/app/ui-v2/onboarding/estado';

// R4 — «No volver a mostrar» del tour de onboarding (ef1d6f256: el de una PISTA descarta esa pista, no la invitación al recorrido).
// El repo no corre DOM, así que la prueba tiene dos mitades que sí se ejecutan: (1) los botones, llamando los componentes y
// pulsando el `onClick` del botón del árbol de elementos; (2) lo que cada decisión guarda, contra un almacén real en memoria.

const OPCIONES = { soloLectura: false, desactivado: false };
const almacen = (): Almacen => {
  const d = new Map<string, string>();
  return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => { d.set(k, v); }, removeItem: (k) => { d.delete(k); } };
};

/** Recorre el árbol de elementos devuelto por un componente (sin montarlo) y devuelve los que cumplen. */
function buscar(nodo: ReactNode, pred: (e: ReactElement<{ children?: ReactNode; onClick?: () => void }>) => boolean, acc: ReactElement<{ children?: ReactNode; onClick?: () => void }>[] = []) {
  if (Array.isArray(nodo)) { nodo.forEach((n) => buscar(n, pred, acc)); return acc; }
  if (!isValidElement(nodo)) return acc;
  const e = nodo as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (pred(e)) acc.push(e);
  buscar(e.props.children, pred, acc);
  return acc;
}
const texto = (n: ReactNode): string => (Array.isArray(n) ? n.map(texto).join('') : typeof n === 'string' ? n : isValidElement(n) ? texto((n as ReactElement<{ children?: ReactNode }>).props.children) : '');
const botonNoVolver = (arbol: ReactNode) => {
  const r = buscar(arbol, (e) => typeof e.props.onClick === 'function' && texto(e.props.children) === 'No volver a mostrar');
  expect(r, 'debe haber UN botón «No volver a mostrar»').toHaveLength(1);
  return r[0];
};

describe('los botones «No volver a mostrar» llaman a su propio manejador', () => {
  it('la pista: su «No volver» llama onNoVolver (no onEntendido ni nada de la invitación)', () => {
    const onNoVolver = vi.fn(); const onEntendido = vi.fn();
    botonNoVolver(PistaContextual({ titulo: 'T', texto: 'x', ilu: 'i', desde: 'Menú', onEntendido, onNoVolver })).props.onClick!();
    expect(onNoVolver).toHaveBeenCalledTimes(1);
    expect(onEntendido).not.toHaveBeenCalled();
  });
  it('la invitación: su «No volver» llama onNoVolver y no elige recorrido ni «ahora no»', () => {
    const onNoVolver = vi.fn(); const onElegir = vi.fn(); const onAhoraNo = vi.fn();
    botonNoVolver(InvitacionRecorrido({ titulo: 'T', asistente: null, onElegir, onAhoraNo, onNoVolver })).props.onClick!();
    expect(onNoVolver).toHaveBeenCalledTimes(1);
    expect(onElegir).not.toHaveBeenCalled();
    expect(onAhoraNo).not.toHaveBeenCalled();
  });
});

describe('qué guarda cada «No volver a mostrar»', () => {
  it('el de una PISTA descarta solo esa pista: la invitación al recorrido SIGUE; las demás pistas SIGUEN', () => {
    const e = crearEstadoLocal('t:u', almacen());
    const d = descarteDePista(e.leer().pistas, '/dashboard/viajes/importar');
    const despues = e.guardar(d.local);
    expect(despues.pistas).toEqual(['/dashboard/viajes/importar']);
    expect(despues.descartado).toBe(false);
    expect(despues.visto).toBe(false);
    expect(debeInvitar(despues, OPCIONES)).toBe(true); // la invitación no se apagó
    expect(debeMostrarPista(despues, '/dashboard/viajes/importar', OPCIONES)).toBe(false);
    expect(debeMostrarPista(despues, '/dashboard/otra', OPCIONES)).toBe(true);
    // Lo que va al servidor (todos los equipos): solo pistas, nunca `invitacion`.
    expect(d.remoto).toEqual({ pistas: ['/dashboard/viajes/importar'] });
    expect('invitacion' in d.remoto).toBe(false);
  });

  it('acumula pistas sin repetir una ruta ya descartada', () => {
    expect(descarteDePista(['/dashboard/a'], '/dashboard/b').remoto.pistas).toEqual(['/dashboard/a', '/dashboard/b']);
    expect(descarteDePista(['/dashboard/a'], '/dashboard/a').remoto.pistas).toEqual(['/dashboard/a']);
  });

  it('el de la INVITACIÓN apaga la invitación y las pistas, y avisa al servidor con invitacion «descartada»', () => {
    const e = crearEstadoLocal('t:u', almacen());
    const d = descarteDeInvitacion();
    const despues = e.guardar(d.local);
    expect(despues).toMatchObject({ descartado: true, visto: true });
    expect(debeInvitar(despues, OPCIONES)).toBe(false);
    expect(debeMostrarPista(despues, '/dashboard/cualquiera', OPCIONES)).toBe(false);
    expect(d.remoto).toEqual({ invitacion: 'descartada' });
  });

  it('control: el estado vacío invita y muestra pistas (la prueba distingue los dos efectos)', () => {
    expect(debeInvitar(ESTADO_VACIO, OPCIONES)).toBe(true);
    expect(debeMostrarPista(ESTADO_VACIO, '/dashboard/x', OPCIONES)).toBe(true);
  });
});

describe('el proveedor cablea cada botón a su decisión', () => {
  const fuente = readFileSync(new URL('./proveedor.tsx', import.meta.url), 'utf8');
  it('la PISTA usa descarteDePista en «Entendido» y en «No volver», y NUNCA apaga la invitación', () => {
    const bloque = fuente.slice(fuente.indexOf('<PistaContextual'), fuente.indexOf('/>', fuente.indexOf('onNoVolver={() => { const d = descarteDePista')));
    expect(bloque.match(/descarteDePista\(/g)).toHaveLength(2);
    expect(bloque).not.toMatch(/descarteDeInvitacion|descartado|invitacion:/);
  });
  it('la INVITACIÓN y el menú de la Guía usan descarteDeInvitacion', () => {
    expect(fuente.match(/descarteDeInvitacion\(\)/g)?.length).toBe(2);
  });
});
