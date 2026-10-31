import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Cifra, TiraCifras, selloDe } from './index';

// «Reintentar» pide los datos de la página con `router.refresh()`: fuera del App Router `useRouter` revienta, así que se le da uno de mentiras.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

describe('Cifra: el indicador único', () => {
  it('el número NO lleva color: el tono va al filete (data-tono) y al chip de texto', () => {
    const h = renderToStaticMarkup(<TiraCifras><Cifra etiqueta="Vencidos" valor="3" tono="bad" /></TiraCifras>);
    expect(h).toContain('data-tono="bad"');
    expect(h).toContain('rv-kpi__atencion');
    expect(h).toContain('Crítico');
    expect(h).not.toMatch(/rv-kpi__valor[^>]*style=/);
    expect(h).not.toMatch(/style="[^"]*color/);
  });

  it('«—» y null son sin dato (nunca 0); un 0 medido se pinta 0', () => {
    const vacio = renderToStaticMarkup(<Cifra etiqueta="A" valor="—" />);
    expect(vacio).toContain('Sin dato');
    expect(vacio).toContain('data-estado="vacio"');
    const nulo = renderToStaticMarkup(<Cifra etiqueta="A" valor={null} mensaje="no se pudo leer" />);
    expect(nulo).toContain('no se pudo leer');
    expect(renderToStaticMarkup(<Cifra etiqueta="A" valor={0} />)).toContain('>0<');
  });

  it('error: «No disponible ahora. No es cero.» con alerta y la salida de Reintentar', () => {
    const h = renderToStaticMarkup(<Cifra etiqueta="Recuperable" valor={null} estado="error" reintentar />);
    expect(h).toContain('role="alert"');
    expect(h).toContain('No disponible ahora. No es cero.');
    expect(h).toContain('Reintentar');
    expect(h).toContain('data-estado="error"');
    expect(h).not.toContain('>0<');
  });

  it('formato y variación en porcentaje (chip, flecha + texto, el bueno/malo lo decide quien llama)', () => {
    const h = renderToStaticMarkup(<Cifra etiqueta="Gasto" valor={1500} formato="mxn" deltaPct={{ pct: 12, bueno: false }} />);
    expect(h).toContain('$1,500');
    expect(h).toContain('▲');
    expect(h).toContain('12 %');
    expect(h).toContain('data-tono="bad"');
  });

  it('nota de una línea bajo la cifra, y sello de procedencia en el pie', () => {
    const h = renderToStaticMarkup(<Cifra etiqueta="Viajes" valor={4} nota="histórico" sello="Registro de viajes · corte 31 oct 2026" />);
    expect(h).toContain('rv-kpi__nota');
    expect(h).toContain('histórico');
    expect(h).toContain('rv-kpi__sello');
    expect(h).toContain('Registro de viajes · corte 31 oct 2026');
  });
});

describe('TiraCifras', () => {
  it('UNA tarjeta con n celdas; el sello por omisión llega a las celdas que no traen el suyo', () => {
    const h = renderToStaticMarkup(
      <TiraCifras sello="Fuente · corte hoy">
        <Cifra etiqueta="A" valor={1} />
        <Cifra etiqueta="B" valor={2} sello="Otra fuente" />
      </TiraCifras>,
    );
    expect(h.split('rv-kpis').length - 1).toBe(1);
    expect(h.split('class="rv-kpi"').length - 1).toBe(2);
    expect(h).toContain('Fuente · corte hoy');
    expect(h).toContain('Otra fuente');
  });

  it('selloDe compone «Fuente · corte …» y sin corte devuelve la fuente', () => {
    expect(selloDe('TMS', '31 oct 2026')).toBe('TMS · corte 31 oct 2026');
    expect(selloDe('TMS')).toBe('TMS');
  });
});
