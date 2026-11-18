import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { IdiomaProvider } from '@/lib/i18n/proveedor';
import { Cifra } from './graficas/cifra';
import { KindBadge } from './graficas/kind-badge';
import { Tarjeta } from './componentes/tarjeta';
import { Aviso, AvisoCompacto } from './componentes/aviso';
import { AvisoResultado } from './componentes/aviso-resultado';
import { textoUi } from './componentes/texto-ui';

// «Reintentar» pide los datos con `router.refresh()`: fuera del App Router `useRouter` revienta, así que se le da uno de mentiras.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const en = (n: ReactNode) => renderToStaticMarkup(<IdiomaProvider idioma="en">{n}</IdiomaProvider>);
const es = (n: ReactNode) => renderToStaticMarkup(<>{n}</>);

// Los componentes compartidos resuelven solos el idioma cuando no les llega la prop `idioma` (contexto del IdiomaProvider; sin
// proveedor, español). La prop explícita sigue ganando.
describe('ui-v2: el idioma se resuelve solo, sin la prop', () => {
  it('Cifra: textos fijos en inglés bajo un proveedor en inglés, sin prop', () => {
    const h = en(<Cifra etiqueta="Late" valor="3" tono="bad" />);
    expect(h).toContain('Critical');
    expect(h).not.toContain('Crítico');
    const err = en(<Cifra etiqueta="Late" valor={null} estado="error" />);
    expect(err).toContain('Not available right now. It is not zero.');
    expect(en(<Cifra etiqueta="Late" valor="—" />)).toContain('No data');
  });

  it('Cifra: español por omisión (sin proveedor) y la prop explícita gana', () => {
    expect(es(<Cifra etiqueta="Vencidos" valor="3" tono="bad" />)).toContain('Crítico');
    expect(en(<Cifra etiqueta="Vencidos" valor="3" tono="bad" idioma="es" />)).toContain('Crítico');
    expect(es(<Cifra etiqueta="Late" valor="3" tono="bad" idioma="en" />)).toContain('Critical');
  });

  it('KindBadge: rótulo en inglés con proveedor, en español sin él', () => {
    expect(en(<KindBadge tipo="calculado" />)).toContain('Calculated');
    expect(es(<KindBadge tipo="calculado" />)).toContain('Calculado');
    expect(en(<KindBadge tipo="calculado" idioma="es" />)).toContain('Calculado');
  });

  it('Tarjeta: estados vacío y error en inglés con proveedor, en español sin él', () => {
    expect(en(<Tarjeta titulo="T" estado="vacio" />)).toContain('No data in the period');
    expect(en(<Tarjeta titulo="T" estado="error" />)).toContain('Not available right now');
    expect(es(<Tarjeta titulo="T" estado="vacio" />)).toContain('Sin datos en el periodo');
    expect(es(<Tarjeta titulo="T" estado="error" />)).toContain('No disponible');
  });

  it('Aviso compacto y AvisoResultado: «Ver más» y acción fallida según el idioma del proveedor', () => {
    const compacto = <AvisoCompacto resumen="r" mas="detalle" />;
    expect(en(compacto)).toContain('Show more');
    expect(es(compacto)).toContain('Ver más');
    const resultado = <AvisoResultado estado={{ ok: false }} />;
    expect(en(resultado)).toContain('The action could not be completed.');
    expect(es(resultado)).toContain('No se pudo completar la acción.');
    // `Aviso` no trae textos fijos: no debe romper bajo ningún proveedor.
    expect(en(<Aviso tono="info">x</Aviso>)).toContain('x');
  });

  it('textoUi fuera de un render y sin prop devuelve español y nunca lanza', () => {
    expect(textoUi()('comun.ver_mas')).toBe('Ver más');
    expect(textoUi('en')('comun.ver_mas')).toBe('Show more');
  });
});
