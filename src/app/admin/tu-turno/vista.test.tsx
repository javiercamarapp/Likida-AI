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
  expect(html).toContain('Cambios por aprobar');
  expect(html).toContain('Falta conectar GitHub');
  // Las dos tarjetas tienen la misma caja de imagen (con o sin imagen; el 16:9 vive en bandeja.css, no en style=).
  expect((html.match(/class="bj-pieza__marco"/g) ?? []).length).toBe(2);
  expect(html).toContain('Sin imagen');
  expect((html.match(/class="bj-pieza"/g) ?? []).length).toBe(2);
  expect(html).not.toContain('style=');
  // Jerarquía: Aprobar sólido (primary), Descartar discreto (ghost), ambos submit.
  expect(html).toMatch(/rv-btn--primary[^>]*>[^<]*Aprobar/);
  expect(html).toMatch(/rv-btn--ghost[^>]*>[^<]*Descartar/);
});

const parados = (n: number) => ({
  parados: Array.from({ length: n }, (_, i) => ({ agente: `a${i}`, nombre: null, ultimaCorrida: null, horasSinCorrer: null, causa: 'contrapresion_bandeja', motivo: 'bandeja sin atender' })),
  habilitados: 49, umbralHoras: 72, latidoDelRunner: null,
});
const render = (extra: Record<string, unknown>) => renderToStaticMarkup(
  <VistaTuTurno bus={bus} escalaciones={vacio} envios={[]} prs={{ estado: 'sin_token' } as never} ahora={0}
    sesionNombre="x" accionPieza={async () => {}} accionOrden={async () => {}} {...extra} />,
);

it('un solo h1, 0 style=, 0 .card suelto', () => {
  const html = render({});
  expect((html.match(/<h1/g) ?? []).length).toBe(1);
  expect(html).not.toContain('style=');
});

it('Escalaciones con TODAS las fuentes ilegibles es «sin dato», no 0', () => {
  const html = render({});
  expect(html).toContain('No se pudo leer ninguna fuente');
  expect(html).toContain('Escalaciones (—)');
  expect(html).not.toContain('Escalaciones (0)');
});

it('Agentes que no corrieron: resumen con conteo y causa, y enlace al detalle; con la bandeja frenando, lleva a Aprobaciones', () => {
  const html = render({
    parados: parados(42),
    cola: { pendientes: 100, urgentes: 0, masViejaCreadaEn: null, diasMasVieja: 70, frenaAlRunner: true, motivoFreno: 'x', topeBandeja: 40, diasVencimiento: 7 },
  });
  expect(html).toContain('42 de 49 agentes habilitados llevan más de 72 h sin correr');
  expect(html).toContain('Frenado por la bandeja de aprobación');
  expect(html).toContain('/admin/escalaciones#agentes-parados');
  expect(html).toContain('/admin/aprobaciones');
  expect(html).toContain('100 piezas pendientes');
});

it('Agentes que no corrieron: lectura caída se dice y NO se pinta como «ninguno parado»', () => {
  const html = render({ parados: null });
  expect(html).toContain('No es que no haya agentes parados');
  expect(html).not.toContain('Ningún agente parado');
});
