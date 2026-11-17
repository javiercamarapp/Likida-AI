import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { armarListaConv, type ViajeConv } from '@/lib/likida/conductor/conversaciones';
import { duracion, VistaConversaciones } from './vista';

const AHORA = new Date('2026-11-17T18:00:00.000Z');
const hace = (m: number) => new Date(AHORA.getTime() - m * 60_000).toISOString();
const viaje = (id: string, e: Partial<ViajeConv> = {}): ViajeConv => ({
  id, folio: `F-${id}`, origen: 'León', destino: 'CDMX', operadorId: 'o', operadorNombre: `Operador ${id}`, terminalId: null, terminalNombre: 'Patio Norte',
  avisadoEn: hace(125), aceptadoEn: null, aceptadoOrigen: null, escaladoEn: null, avisosEnviados: 1, citaOrigenEn: null, citaDestinoEn: null, operadorSinTelefono: false, ...e,
});
const base = { sufijo: '', filtros: { estado: '' as const, terminalId: '', operadorId: '' }, catalogos: { terminales: [], clientes: [], operadores: [] }, hayMas: false, error: null, seleccion: '', hilo: null, hiloError: false, ocultos: {} };

describe('vista de conversaciones', () => {
  it('formatea duraciones', () => {
    expect(duracion(45)).toBe('45 min');
    expect(duracion(125)).toBe('2 h 5 min');
    expect(duracion(1500)).toBe('1 d 1 h');
  });
  it('lista con el estado, el tiempo sin respuesta y el elige-una-conversación', () => {
    const filas = armarListaConv([viaje('1'), viaje('2', { aceptadoEn: hace(5) })], [], AHORA);
    const html = renderToStaticMarkup(<VistaConversaciones {...base} filas={filas} />);
    expect(html).toContain('Operador 1');
    expect(html).toContain('No ha respondido');
    expect(html).toContain('Sin respuesta hace 2 h 5 min');
    expect(html).toContain('Elige una conversación');
  });
  it('estado vacío claro sin viajes y con filtro sin resultados', () => {
    expect(renderToStaticMarkup(<VistaConversaciones {...base} filas={[]} />)).toContain('Sin conversaciones');
    const filas = armarListaConv([viaje('1')], [], AHORA);
    expect(renderToStaticMarkup(<VistaConversaciones {...base} filtros={{ ...base.filtros, estado: 'acepto' }} filas={filas} />)).toContain('Ninguna conversación en este estado');
  });
  it('falla cerrado: el error no se pinta como lista vacía', () => {
    const html = renderToStaticMarkup(<VistaConversaciones {...base} filas={[]} error="No se pudieron leer las conversaciones." />);
    expect(html).toContain('No se pudieron leer');
    expect(html).not.toContain('Sin conversaciones');
  });
  it('el hilo trae el campo de respuesta deshabilitado', () => {
    const v1 = viaje('1', { aceptadoEn: hace(60) });
    const hilo = { viaje: v1, hitos: [], avisos: [], validaciones: [], eventos: [], escalaciones: [], atencion: [] };
    const html = renderToStaticMarkup(<VistaConversaciones {...base} filas={armarListaConv([v1], [], AHORA)} seleccion="1" hilo={hilo} />);
    expect(html).toContain('Aceptó el viaje');
    expect(html).toContain('disabled');
    expect(html).toContain('Se envía por tu línea de WhatsApp cuando esté conectada');
  });
});
