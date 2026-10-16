import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { armarConstancia } from '@/lib/likida/conductor/constancia';
import { hitoVacio } from '@/lib/likida/conductor/memoria.fixture';
import { ConstanciaReportes, TEXTO_CONSTANCIA_VACIA } from './constancia-vista';

const PERIODO = { desde: '2026-10-01T06:00:00.000Z', hasta: '2026-10-08T06:00:00.000Z' };
const viaje = { id: '1', folio: 'F-1', operadorId: 'a', operadorNombre: 'Operador A', estatus: 'liquidado', creadoEn: '2026-10-03T12:00:00.000Z' };

describe('<ConstanciaReportes /> (T-A5-67)', () => {
  it('periodo vacío -> estado vacío honesto y sin enlace de descarga', () => {
    const html = renderToStaticMarkup(<ConstanciaReportes constancia={armarConstancia({ tenantId: 't1', periodo: PERIODO, viajes: [], hitos: [] })} dias={7} hayMas={false} />);
    expect(html).toContain(TEXTO_CONSTANCIA_VACIA);
    expect(html).not.toContain('download=');
  });

  it('con datos: cifras por operador, faltantes en palabras y enlace al CSV; sin dinero ni veredicto', () => {
    const c = armarConstancia({
      tenantId: 't1', periodo: PERIODO, viajes: [viaje],
      hitos: [
        hitoVacio({ id: 'h1', viajeId: '1', tipo: 'llegada_carga', estado: 'recibido', fuente: 'boton', mensajeEn: '2026-10-03T15:30:00.000Z', recibidoEn: '2026-10-03T15:30:00.000Z' }),
        hitoVacio({ id: 'h2', viajeId: '1', tipo: 'salida_carga' }),
      ],
    });
    const html = renderToStaticMarkup(<ConstanciaReportes constancia={c} dias={7} hayMas={false} />);
    expect(html).toContain('Operador A');
    expect(html).toContain('1 de 2');
    expect(html).toContain('salida de carga');
    expect(html).toContain('download="constancia-de-reportes.csv"');
    expect(html).not.toMatch(/bono|\$/i);
  });

  it('avisa cuando el periodo trae más viajes de los leídos', () => {
    const c = armarConstancia({ tenantId: 't1', periodo: PERIODO, viajes: [viaje], hitos: [hitoVacio({ id: 'h1', viajeId: '1', tipo: 'regreso' })] });
    expect(renderToStaticMarkup(<ConstanciaReportes constancia={c} dias={7} hayMas />)).toContain('más viajes');
  });
});
