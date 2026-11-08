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
  for (const etiqueta of ['Apagar todas', 'Encender todas']) {
    const abre = html.lastIndexOf('<button', html.indexOf(`${etiqueta}</button>`));
    expect(html.slice(abre, abre + 40)).toContain('type="button"');
  }
});

it('R9: cabecera con KPIs reales, tarjetas de altura uniforme, imagen con marco fijo y Aprobar como acción primaria', () => {
  const conPiezas = {
    ...(bus as object), errores: [],
    piezasPendientes: [
      { id: 'a', titulo: 'Post con imagen', tipo: 'post', rutina: 'r1', mediaUrl: 'https://x/y.png', copyMd: null, creadoEn: '2026-11-01T00:00:00Z' },
      { id: 'b', titulo: 'Post sin imagen', tipo: 'post', rutina: 'r1', mediaUrl: null, copyMd: null, creadoEn: '2026-11-01T00:00:00Z' },
    ],
  } as never;
  const html = renderToStaticMarkup(
    <VistaTuTurno bus={conPiezas} escalaciones={vacio} envios={[]} prs={{ estado: 'sin_token' } as never} ahora={0}
      sesionNombre="x" accionPieza={async () => {}} accionOrden={async () => {}} />,
  );
  // KPIs: cifras reales de las fuentes legibles; PRs sin token es «—» (no un cero).
  expect(html).toContain('Piezas para tu tap');
  expect(html).toContain('Envíos por aprobar');
  expect(html).toContain('PRs esperando tu merge');
  expect(html).toContain('Falta el acceso a GitHub');
  // Las dos tarjetas tienen la misma caja de imagen (con o sin imagen) y estiran a la misma altura.
  expect((html.match(/aspect-ratio:16 \/ 9/g) ?? []).length).toBe(2);
  expect(html).toContain('Sin imagen');
  expect((html.match(/overflow-hidden flex flex-col h-full/g) ?? []).length).toBe(2);
  // Jerarquía: Aprobar sólido (primary), Descartar discreto (ghost), ambos submit.
  expect(html).toMatch(/rv-btn--primary[^>]*>[^<]*Aprobar/);
  expect(html).toMatch(/rv-btn--ghost[^>]*>[^<]*Descartar/);
});
