import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

import { Ficha360, encabezadoFicha } from './ficha';
import type { FichaCliente } from '@/lib/admin/ficha-cliente';
import { armarPersonas } from '@/lib/admin/personas';
import { casillasDeArranque } from '@/lib/admin/arranque';

const FICHA: FichaCliente = {
  tenant: { id: 't-1', nombre: 'ACME', plan: 'demo', creadoEn: '2026-08-05T00:00:00Z' },
  origen: null, origenLegible: true,
  operacion: { viajesLiquidados: 3, montoComprobado: 1000, porRevisar: 1 } as FichaCliente['operacion'],
  pmf: null, consumoIa: null, suscripcion: null, suscripcionLegible: true, facturasSaas: [], tickets: [], corridas: [],
};

it('trae las seis secciones y el slot de plan reubicado en "Plan y cobro"', () => {
  const html = renderToStaticMarkup(<Ficha360 f={FICHA} gestionPlan={<span>SLOT-PLAN</span>} />);
  for (const s of ['Resumen', 'Equipo', 'Plan y cobro', 'Arranque y fiscal', 'Controles', 'Baja']) expect(html).toContain(s);
  expect(html).toContain('SLOT-PLAN');
});

it('el encabezado lleva el nombre de la flota, el volver y los dos accesos', () => {
  const e = encabezadoFicha(FICHA);
  const html = renderToStaticMarkup(<>{e.acciones}</>);
  expect(e.titulo).toBe('ACME');
  expect(e.apoyo).toContain('Plan demo');
  expect(html).toContain('/admin/flotas');
  expect(html).toContain('/dashboard?tenant=t-1&amp;rol=flota_admin');
});

it('lo que no se pudo leer dice "no disponible", no cero', () => {
  const html = renderToStaticMarkup(<Ficha360 f={{ ...FICHA, operacion: null, consumoIa: null, tickets: null, corridas: null }} personas={null} arranque={null} />);
  expect(html).toContain('No disponible ahora');
  expect(html).toContain('No se pudo leer el equipo');
  expect(html).toContain('No se pudo leer el arranque');
});

it('el equipo de la flota dice nunca entró / sin dato según se haya podido medir', () => {
  const personas = armarPersonas([{ id: 'a', email: 'a@x.mx', nombre: 'Ana', rol: 'flota_admin', tenant_id: 't-1', activo: true, desactivado_en: null, tenant: null }],
    new Map([['a', { lastSignInAt: null }]]));
  expect(renderToStaticMarkup(<Ficha360 f={FICHA} personas={personas} accesoLegible />)).toContain('Nunca entró');
  const ciego = armarPersonas([{ id: 'a', email: 'a@x.mx', nombre: 'Ana', rol: 'flota_admin', tenant_id: 't-1', activo: true, desactivado_en: null, tenant: null }], null);
  const html = renderToStaticMarkup(<Ficha360 f={FICHA} personas={ciego} accesoLegible={false} />);
  expect(html).toContain('Sin dato');
  expect(html).not.toContain('Nunca entró');
  expect(html).toContain('/admin/usuarios/nuevo?flota=t-1');
});

it('el arranque pinta las casillas con su enlace de resolución', () => {
  const casillas = casillasDeArranque({ id: 't-1', viajes: 0, politicaPropia: false, telefono: null, telefonosLegibles: true, onboarding: null });
  const html = renderToStaticMarkup(<Ficha360 f={FICHA} arranque={{ casillas }} />);
  expect(html).toContain('/dashboard/politicas?tenant=t-1');
  expect(html).toContain('Sin dato');
});
