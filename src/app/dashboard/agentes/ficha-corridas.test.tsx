import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { FichaCorridas } from './ficha-corridas';

const base = { id: 'c1', inicio: '2026-11-01T15:00:00Z', estado: 'ok', error: null, tareasHechas: 3, tareasTotal: 4, duracionMs: 2500, disparo: 'programado' } as unknown as CorridaRegistrada;

it('una consulta caída se dice; NO se pinta «sin corridas»', () => {
  const h = renderToStaticMarkup(<FichaCorridas corridas={null} />);
  expect(h).toContain('No se pudo leer el historial');
  expect(h).not.toContain('Sin corridas registradas');
});

it('sin corridas dice desde cuándo se anota', () => {
  expect(renderToStaticMarkup(<FichaCorridas corridas={[]} />)).toContain('14 de agosto de 2026');
});

it('una corrida sin medida de tareas ni duración pinta guion, no 0/0; el estado lleva texto', () => {
  const h = renderToStaticMarkup(<FichaCorridas corridas={[{ ...base, estado: 'fallo', error: 'sin red', tareasHechas: null, tareasTotal: null, duracionMs: null, disparo: 'correo' }]} />);
  expect(h).toContain('Falló');
  expect(h).toContain('sin red');
  expect(h).toContain('Llegó un correo');
  expect(h).not.toContain('0/0');
  expect(h).not.toContain('style=');
  expect(h).toContain('—');
});

it('una corrida medida muestra tareas hechas/total', () => {
  expect(renderToStaticMarkup(<FichaCorridas corridas={[base]} />)).toContain('3/4');
});
