import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TableroProspectos } from './tablero';

const base = {
  orden: ['nuevo', 'contactado'], transiciones: {}, rotulos: { nuevo: 'Nuevo', contactado: 'Contactado' }, vendedores: [],
  mover: async () => null,
};
const col = (estado: string, rotulo: string, n: number) => ({
  estado, rotulo, total: n,
  tarjetas: Array.from({ length: n }, (_, i) => ({ id: `${estado}${i}`, empresa: `Empresa ${i}`, vacante: null, ciudad: null, notas: null, estado, vendedorId: null, vendedorNombre: null })),
});

it('R9: con todas las etapas vacías hay UNA pista honesta, no una tarjeta «Sin datos por ahora» por columna', () => {
  const h = renderToStaticMarkup(<TableroProspectos {...(base as never)} columnas={[col('nuevo', 'Nuevo', 0), col('contactado', 'Contactado', 0)] as never} hayFiltro />);
  expect(h).not.toContain('Sin datos por ahora');
  expect((h.match(/Ningún prospecto coincide/g) ?? []).length).toBe(1);
});

it('R9: con alguna etapa llena, las vacías son una línea sobria (sin tarjeta repetida)', () => {
  const h = renderToStaticMarkup(<TableroProspectos {...(base as never)} columnas={[col('nuevo', 'Nuevo', 1), col('contactado', 'Contactado', 0)] as never} />);
  expect(h).not.toContain('Sin datos por ahora');
  expect(h).toContain('Sin prospectos en esta etapa.');
});
