import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { INFO, type InfoTexto } from '../info-catalogo';
import { ContenidoInfo } from './info-contenido';

const base: InfoTexto = { titulo: 'Monto comprobado', estado: 'verificado', queEs: 'Dinero comprobado del periodo.', comoSeCalcula: 'Suma de las liquidaciones del periodo.', fuente: 'Liquidaciones de tu flota.' };
const titulos = (h: string) => [...h.matchAll(/<h3 class="rv-ov-bloque__tit">([^<]*)</g)].map((m) => m[1]);

describe('ContenidoInfo (cajón ⓘ)', () => {
  it('solo con los campos obligatorios: Qué es, Cómo se calcula (recuadro) y el par Fuente; nada opcional se pinta', () => {
    const h = renderToStaticMarkup(<ContenidoInfo texto={base} />);
    expect(titulos(h)).toEqual(['Qué es', 'Cómo se calcula']);
    expect(h).toContain('class="rv-ov-calculo"');
    expect(h).toContain('<dt>Fuente</dt><dd>Liquidaciones de tu flota.</dd>');
    for (const nada of ['Periodo', 'Cobertura', 'Lo que no sabemos', 'Qué hacer', 'Clase de dato', 'Estado', 'rv-kind']) expect(h, nada).not.toContain(nada);
  });
  it('campos vacíos o en blanco no se pintan', () => {
    const h = renderToStaticMarkup(<ContenidoInfo texto={{ ...base, periodo: '  ', cobertura: '', loQueNoSabemos: ['', '   '] }} />);
    expect(h).not.toContain('Periodo');
    expect(h).not.toContain('Cobertura');
    expect(h).not.toContain('Lo que no sabemos');
  });
  it('con todos los opcionales: pares Fuente/Periodo/Cobertura, lista, qué hacer y sello con KindBadge', () => {
    const h = renderToStaticMarkup(<ContenidoInfo texto={{ ...base, periodo: 'El de la barra de filtros', cobertura: 'Liquidaciones sin rechazadas', loQueNoSabemos: ['Gastos sin comprobante', 'Viajes sin cerrar'], queHacer: 'Revisa las diferencias.', clase: 'calculado' }} />);
    expect([...h.matchAll(/<dt>([^<]*)</g)].map((m) => m[1])).toEqual(['Fuente', 'Periodo', 'Cobertura']);
    expect(titulos(h)).toEqual(['Qué es', 'Cómo se calcula', 'Lo que no sabemos', 'Qué hacer con esto', 'Clase de dato']);
    expect(h.match(/<li>/g)).toHaveLength(2);
    expect(h).toContain('data-tipo="calculado"');
    expect(h).toContain('Calculado');
  });
  it('los tres sellos de clase usan KindBadge (texto, no solo color)', () => {
    for (const [c, txt] of [['observado', 'Observado'], ['calculado', 'Calculado'], ['estimado', 'Estimado']] as const) {
      const h = renderToStaticMarkup(<ContenidoInfo texto={{ ...base, clase: c }} />);
      expect(h).toContain(`data-tipo="${c}"`);
      expect(h).toContain(txt);
    }
  });
  it('por confirmar agrega el bloque Estado; y toda entrada real del catálogo se pinta sin error', () => {
    expect(titulos(renderToStaticMarkup(<ContenidoInfo texto={{ ...base, estado: 'por_confirmar' }} />))).toContain('Estado');
    for (const t of Object.values(INFO)) expect(renderToStaticMarkup(<ContenidoInfo texto={t} />)).toContain(t.queEs.replace(/&/g, '&amp;').slice(0, 5));
  });
});
