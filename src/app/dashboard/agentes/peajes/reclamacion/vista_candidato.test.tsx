import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaReclamacionPeajes } from './vista';
import { LEYENDAS_RECLAMACION, type ReporteReclamacion } from '@/lib/likida/peajes/reclamacion';
import { MOTIVOS_VISIBLES_CINCO_AGENTES, leyendasDePerfil, TEXTO_SIN_POSICIONES } from '@/lib/likida/peajes/reclamacion_perfil';

// T-A2-24: la pantalla bajo el perfil `cinco_agentes`: solo `gps_lejos_de_caseta` (+ doble cobro), todo rotulado «candidato»,
// sin descargas (la ruta de export es stand-by), con el margen por flota y el estado vacío claro. Fixtures sintéticos.
const ID = '11111111-1111-4111-8111-111111111111';
const reporte = (o: Partial<ReporteReclamacion> = {}): ReporteReclamacion => ({
  desgloseId: ID, proveedor: 'PASE', periodoDesde: '2026-08-05', periodoHasta: '2026-08-07', leyendas: leyendasDePerfil(),
  resumen: {
    lineas: 3, reclamables: 1, montoReclamable: 100, confirmadas: 1, sinDatos: 1, sinEvaluar: 0, sinCurso: 3,
    porMotivo: { gps_lejos_de_caseta: { n: 1, monto: 100 }, unidad_en_zona_no_autorizada: { n: 0, monto: 0 }, fuera_de_curso: { n: 0, monto: 0 }, doble_cobro: { n: 0, monto: 0 } },
  },
  cruces: [{
    indice: 1, fecha: '2026-08-05', hora: '11:30:00', caseta: 'Caseta Ejemplo Sur', casetaCatalogo: 'Caseta Ejemplo Sur', tag: 'IMDM10000002', unidad: 'C2-09', monto: 100,
    motivo: 'gps_lejos_de_caseta', confianza: 'alta', porQue: 'La unidad C2-09 no estaba en la caseta.', distanciaM: 22000, radioCasetaM: 300,
    evidencia: [], zona: null, duplicadoDeLinea: null, cursos: [],
  }],
  ...o,
});
const candidato = { motivos: MOTIVOS_VISIBLES_CINCO_AGENTES, margenLejosM: 500, guardarMargen: async () => {} };
const pintar = (r: ReporteReclamacion | null = reporte(), cand: typeof candidato | undefined = candidato) =>
  renderToStaticMarkup(<VistaReclamacionPeajes sufijo="?tenant=f-1" desglose={ID} estado="ok" reporte={r} candidato={cand} />);

describe('reclamación bajo cinco_agentes', () => {
  it('rotula todo como candidato y NO dice «para reclamar» como si fuera un hecho', () => {
    const html = pintar();
    expect(html).toContain('1 cruce candidato para pedir revisión');
    expect(html).toContain('GPS lejos de la caseta · candidato');
    expect(html).not.toContain('GPS lejos de la caseta · alta');
  });
  it('solo enseña las tarjetas de los motivos visibles: ni fuera de curso ni zona no autorizada', () => {
    const html = pintar();
    expect(html).toContain('GPS lejos de la caseta</span>');
    expect(html).toContain('Posible doble cobro</span>');
    expect(html).not.toContain('Cruce fuera de curso');
    expect(html).not.toContain('Unidad en zona no autorizada');
    expect(html).not.toContain('no tienen curso declarado');
    expect(html).not.toContain('sección Cursos');
  });
  it('no ofrece Excel ni PDF (la ruta de descarga es stand-by para este perfil)', () => {
    expect(pintar()).not.toContain('/api/export/peajes-reclamacion');
  });
  it('enseña el margen de la flota y un formulario para fijarlo; sin acción no pinta el formulario', () => {
    const html = pintar();
    expect(html).toContain('name="margen"');
    expect(html).toContain('value="500"');
    expect(pintar(reporte(), { ...candidato, guardarMargen: undefined as never })).not.toContain('name="margen"');
  });
  it('sin posiciones ni casetas con ubicación: estado vacío claro, no «sin cruces» como si todo estuviera bien', () => {
    const vacio = reporte({ cruces: [], resumen: { ...reporte().resumen, reclamables: 0, montoReclamable: 0, confirmadas: 0, sinDatos: 3, lineas: 3,
      porMotivo: { gps_lejos_de_caseta: { n: 0, monto: 0 }, unidad_en_zona_no_autorizada: { n: 0, monto: 0 }, fuera_de_curso: { n: 0, monto: 0 }, doble_cobro: { n: 0, monto: 0 } } } });
    const html = pintar(vacio);
    expect(html).toContain(TEXTO_SIN_POSICIONES);
    expect(html).not.toContain('<table');
  });
  it('con confirmadas por el GPS y cero cruces, dice «sin candidatos», no el estado de «faltan datos»', () => {
    const r = reporte({ cruces: [], resumen: { ...reporte().resumen, reclamables: 0, montoReclamable: 0, confirmadas: 2, sinDatos: 1,
      porMotivo: { gps_lejos_de_caseta: { n: 0, monto: 0 }, unidad_en_zona_no_autorizada: { n: 0, monto: 0 }, fuera_de_curso: { n: 0, monto: 0 }, doble_cobro: { n: 0, monto: 0 } } } });
    const html = pintar(r);
    expect(html).toContain('Sin cruces candidatos');
    expect(html).not.toContain(TEXTO_SIN_POSICIONES);
  });
});

describe('sin candidato (flota sin perfil): todo igual que hoy', () => {
  it('conserva las descargas, las cuatro tarjetas y la confianza', () => {
    const html = renderToStaticMarkup(<VistaReclamacionPeajes sufijo="?tenant=f-1" desglose={ID} estado="ok" reporte={reporte({ leyendas: LEYENDAS_RECLAMACION })} />);
    expect(html).toContain('/api/export/peajes-reclamacion');
    expect(html).toContain('Cruce fuera de curso</span>');
    expect(html).toContain('GPS lejos de la caseta · alta');
    expect(html).toContain('1 cruce para pedir revisión');
    expect(html).not.toContain('name="margen"');
  });
});

describe('cableado en la página', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/dashboard/agentes/peajes/reclamacion/page.tsx'), 'utf8');
  it('con superficie completa el reporte es el de siempre; con perfil se arma restringido y se pasa `candidato` a la vista', () => {
    expect(src).toMatch(/superficie\.gps\s*\?[\s\S]{0,120}reporteReclamacion\(tenantId, desgloseValido\)/);
    expect(src).toContain('perfilRestringido: true');
    expect(src).toContain('candidato=');
    expect(src).toContain('leerMargenLejosM');
    expect(src).toContain('guardarMargenLejosM');
  });
  it('la acción de fijar el margen repite su puerta adentro', () => {
    const i = src.indexOf('async function accionGuardarMargen(');
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 900)).toContain('puertaReclamos');
  });
});
