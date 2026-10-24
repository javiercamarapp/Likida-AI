import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { VistaTuTurno } from './vista';

// A37-S08-03: los dos kill switch piden confirmación (el disparador es un
// type="button" que abre el diálogo; el submit vive DENTRO del diálogo) y
// "Correr ahora" se deshabilita mientras corre.
const bus = {
  rutinas: [{ nombre: 'dof-diario', horario: '21:30', descripcion: '', ultimaCorrida: null }],
  piezasPendientes: [], ordenesRecientes: [], killSwitchPendiente: false, errores: [],
} as never;
const vacio = { cola: [], fuentes: {}, conteos: {} } as never;

it('Apagar/Encender todas no son submit directo: abren un diálogo que dice qué pasa', () => {
  const html = renderToStaticMarkup(
    <VistaTuTurno bus={bus} escalaciones={vacio} envios={[]} prs={{ estado: 'sin_token' } as never} ahora={0}
      sesionNombre="x" accionPieza={async () => {}} accionOrden={async () => {}} />,
  );
  expect(html).toContain('Sí, apagar todas');
  expect(html).toContain('Sí, encender todas');
  expect(html).toMatch(/<button type="button"[^>]*>(<svg[\s\S]*?<\/svg>)?Apagar todas/);
  expect(html).toMatch(/<button type="button"[^>]*>(<svg[\s\S]*?<\/svg>)?Encender todas/);
});
