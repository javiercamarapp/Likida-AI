import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { PantallaQa } from './pantalla';
import { CorridaViva } from './[id]/corrida-viva';
import { MedicionCorrida } from './[id]/medicion-corrida';
import { BancoVerdad } from './banco-verdad';
import { resumenPrecision } from '@/lib/admin/qa-verdad';
import type { CorridaQA, FotoBanco, VerdadTerreno } from '@/lib/admin/qa-tipos';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/qa y /admin/qa/<id> — las pantallas ya usan las piezas del sistema (Tarjeta, TablaBase, Disclosure, StatusChip, Boton, Campo).
// Esta prueba las RENDERIZA con datos de muestra para fijar tres cosas que un rediseño no debe romper: (1) ninguna deja un <table> a
// mano, un <button> sin clase de Boton ni un style=; (2) un null se pinta «sin medir», jamás 0 %; (3) el veredicto, el costo REAL y los
// motivos de bloqueo siguen a la vista.
// ═══════════════════════════════════════════════════════════════════════════

const verdad: VerdadTerreno = {
  comercioClave: 'oxxo_gas', emisor: 'OXXO GAS', rfcEmisor: 'AAA010101AAA', folio: 'F-1', monto: 1250.5, fecha: '2026-10-01',
  sucursal: 'Centro', dominioFacturacion: 'oxxogas.com', ilegibles: ['sucursal'], noAplica: ['dominioFacturacion'], clase: 'ticket', notas: 'nota de prueba',
};
const foto = (id: string, conVerdad: boolean): FotoBanco & { url: string | null } => ({
  id, hash: 'h', path: `${id}.jpg`, mime: 'image/jpeg', etiqueta: `foto-${id}`, bytes: 10, subidoEn: '2026-10-01T00:00:00Z',
  ocrEsperado: conVerdad ? verdad : null, confirmadoEn: conVerdad ? '2026-10-02T00:00:00Z' : null, url: `https://firmada/${id}`,
});

const corrida = (extra: Partial<CorridaQA> = {}): CorridaQA => ({
  id: '11111111-2222-3333-4444-555555555555', escenario: 'demo_guion', carril: 'completo',
  parametros: { anticipo: 100, rfcEmpresa: null, ruta: { origen: 'A', destino: 'B' }, politica: [], fotoIds: ['a'], retencion: 'borrar_al_terminar' },
  estado: 'corriendo', motivo: null, tenantId: 't', tenantNombre: 'flota-qa', creadaEn: '2026-10-01T00:00:00Z', inicio: '2026-10-01T00:00:00Z', fin: null,
  latidoEn: '2026-10-01T00:00:00Z',
  pasos: [{ n: 1, nombre: 'Sembrar', estado: 'ok', costoUsd: 0.0123, detalle: 'listo' }],
  costoUsdTotal: 0.0456,
  veredicto: [{ invariante: '#1 anticipo', oraculo: 'cuadre (#1)', estado: 'fallo', severidad: 'ALTO', esperado: 1, real: 2, detalle: 'distinto' }],
  turnos: [{ rol: 'user', texto: 'hola' }, { rol: 'assistant', texto: 'recibido' }],
  pdfs: [], limpieza: null, fase: 'fotos', corte: 'reloj', pasadas: 2, pasadaEnVuelo: null,
  avance: { total: 3, ok: 1, bad: 0, interrumpidas: 0, enVuelo: 0, sinTurno: 2, sinTurnoIds: ['b', 'c'] },
  ...extra,
} as CorridaQA);

const sinCrudos = (html: string) => {
  // toda <table> vive dentro de una TablaBase (región `rv-tb__region`)
  expect((html.match(/<table\b/g) ?? []).length).toBe((html.match(/rv-tb__region/g) ?? []).length);
  expect(html).not.toMatch(/ style="/);
  for (const m of html.matchAll(/<button\b[^>]*>/g)) expect(m[0], 'un <button> sin clase del sistema').toMatch(/rv-btn|rv-seg__btn/);
};

describe('/admin/qa — pantallas con piezas del sistema', () => {
  it('PantallaQa: cifras, lanzador, banco e historial; sin crudos', () => {
    const html = renderToStaticMarkup(
      <PantallaQa fotos={[foto('a', true), foto('b', false)]} bancoError={null} corridas={[corrida()]} historialError={null}
        gastoHoy={1.5} gastoError={null} topeDiaUsd={20} topeCorridaUsd={2} lecturasIniciales={{}} lecturasError={null} />,
    );
    expect(html).toContain('foto-a');
    expect(html).toContain('rv-tb'); // el historial es una TablaBase
    expect(html).toContain('sin medir'); // exactitud sin lecturas: «sin medir», jamás 0 %
    expect(html).not.toContain('0 %');
    sinCrudos(html);
  });

  it('PantallaQa con el banco caído lo DICE y no lo pinta como vacío', () => {
    const html = renderToStaticMarkup(
      <PantallaQa fotos={[]} bancoError="storage caído" corridas={[]} historialError={null} gastoHoy={null} gastoError="sin gasto"
        topeDiaUsd={20} topeCorridaUsd={2} />,
    );
    expect(html).toContain('storage caído');
    sinCrudos(html);
  });

  it('CorridaViva: pasos, veredicto con esperado/real, avance, evidencia y costo real; sin crudos', () => {
    const html = renderToStaticMarkup(
      <CorridaViva corridaInicial={corrida()} fotosIniciales={[{ id: 'a', etiqueta: 'foto-a', url: 'https://f/a' }]} pdfsIniciales={[]} />,
    );
    expect(html).toContain('Sembrar');
    expect(html).toContain('#1 anticipo');
    expect(html).toContain('distinto');
    expect(html).toContain('foto-a');
    expect(html).toContain('<progress');
    sinCrudos(html);
  });

  it('CorridaViva con la lectura caída muestra el error, no una corrida vacía', () => {
    const html = renderToStaticMarkup(<CorridaViva errorLectura="boom" />);
    expect(html).toContain('boom');
  });

  it('MedicionCorrida: null se pinta «sin medir» y el peor campo se marca; sin crudos', () => {
    const medicion = resumenPrecision([{
      fotoId: 'a', etiqueta: 'foto-a', clase: 'ticket', modelo: 'm', motivo: null, costoUsd: 0.01,
      medicion: {
        campos: [
          { clave: 'monto', esperado: 10, leido: 12, veredicto: 'mal', motivo: 'distinto' },
          { clave: 'folio', esperado: 'F', leido: 'F', veredicto: 'ok', motivo: null },
          { clave: 'sucursal', esperado: null, leido: null, veredicto: 'no_medido', motivo: 'ilegible' },
        ],
        camposOk: 1, camposMal: 1, camposNoMedidos: 1,
      },
    }]);
    const html = renderToStaticMarkup(<MedicionCorrida medicion={medicion} error={null} fotos={[{ id: 'a', etiqueta: 'foto-a', url: null }]} viva={false} />);
    expect(html).toContain('rv-tb');
    sinCrudos(html);
    const vacio = renderToStaticMarkup(<MedicionCorrida medicion={null} error={null} fotos={[]} viva />);
    expect(vacio).not.toContain('rv-tb');
  });

  it('BancoVerdad: lista las fotos con su ficha esperado/leído en TablaBase; sin crudos', () => {
    const html = renderToStaticMarkup(<BancoVerdad fotos={[foto('a', true)]} bancoError={null} lecturasIniciales={{}} lecturasError={null} />);
    expect(html).toContain('foto-a');
    expect(html).toContain('ilegible en la foto');
    sinCrudos(html);
  });
});
