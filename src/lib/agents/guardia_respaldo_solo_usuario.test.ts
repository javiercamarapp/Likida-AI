/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes del propio repo */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cifrasRespaldadas, construirRespaldo, DOCUMENTO_ADJUNTO_RESPALDA_CIFRAS, extraerCifrasUsadas, type Bloque } from './analista';

// ═══════════════════════════════════════════════════════════════════════════
// F16: la guardia de cifras. El historial de la conversación llega del NAVEGADOR,
// así que ni sus turnos `asistente` (fabricables) ni el eco de lo que el usuario
// escribió pueden respaldar una cifra: solo lo que el sistema produjo en el turno
// (resultados de herramientas) y el calendario. Se prueba el comportamiento sobre
// `construirRespaldo`/`cifrasRespaldadas` (puras, sin LLM) y que ambos agentes
// armen su respaldo SOLO por esa función.
// ═══════════════════════════════════════════════════════════════════════════

const texto = (t: string): Bloque[] => [{ tipo: 'texto', texto: t }];
const respaldoTools = (...r: unknown[]) => construirRespaldo({ resultadosTools: r, calendario: ['2026-11-10'] });

describe('construirRespaldo + cifrasRespaldadas', () => {
  it('un turno asistente fabricado con $184,290 no respalda (el historial ni siquiera entra al conjunto)', () => {
    // El historial del navegador no es parámetro de construirRespaldo: no hay forma de colarlo.
    expect(cifrasRespaldadas(texto('Gastaste $184,290 este mes.'), respaldoTools({ gasto: 1200 }))).toBe(false);
  });
  it('el usuario pregunta «¿gasté 99,000?» y el modelo contesta 99,000 sin herramienta: no respalda', () => {
    expect(cifrasRespaldadas(texto('Sí, gastaste 99,000.'), respaldoTools({ otro: 5000 }))).toBe(false);
  });
  it('la misma cifra devuelta por una herramienta sí respalda', () => {
    expect(cifrasRespaldadas(texto('Sí, gastaste 99,000.'), respaldoTools({ gasto: 99000 }))).toBe(true);
  });
  it('«99k» no empata con un 99 de una herramienta', () => {
    expect(cifrasRespaldadas(texto('Gastaste 99k.'), respaldoTools({ viajes: 99 }))).toBe(false);
  });
  it('«99k» sí empata con 99,000 devuelto por una herramienta', () => {
    expect(cifrasRespaldadas(texto('Gastaste 99k.'), respaldoTools({ gasto: 99000 }))).toBe(true);
  });
  it('«7 mil» exige respaldo de 7,000 (el 7 suelto es un blanco y no basta)', () => {
    expect(cifrasRespaldadas(texto('Te sobran 7 mil pesos.'), respaldoTools({ viajes: 7 }))).toBe(false);
    expect(cifrasRespaldadas(texto('Te sobran 7 mil pesos.'), respaldoTools({ saldo: 7000 }))).toBe(true);
  });
  it('«1.5 millones» exige respaldo de 1,500,000', () => {
    expect(cifrasRespaldadas(texto('Facturaste 1.5 millones.'), respaldoTools({ x: 1.5 }))).toBe(false);
    expect(cifrasRespaldadas(texto('Facturaste 1.5 millones.'), respaldoTools({ facturado: 1_500_000 }))).toBe(true);
  });
  it('los multiplicadores se leen también dentro de tablas y notas', () => {
    const t: Bloque[] = [{ tipo: 'tabla', filas: [['Gasto', '$99k']] }];
    expect(cifrasRespaldadas(t, respaldoTools({ viajes: 99 }))).toBe(false);
    const u = new Set<number>();
    extraerCifrasUsadas('un total de 2 millón y 40 mil, a 500 m y 10 mm', u);
    expect(u.has(2_000_000)).toBe(true);
    expect(u.has(500_000_000)).toBe(false);
    expect(u.has(40_000)).toBe(true);
  });
  it('el calendario de hoy respalda (año, día)', () => {
    expect(cifrasRespaldadas(texto('Hoy es 10 de noviembre de 2026.'), respaldoTools())).toBe(true);
  });
  it('el documento adjunto respalda mientras F16-D1 siga en su valor actual', () => {
    expect(DOCUMENTO_ADJUNTO_RESPALDA_CIFRAS).toBe(true);
    const r = construirRespaldo({ resultadosTools: [], calendario: [], documento: { extracto: 'Total del archivo: 48,250.00' } });
    expect(cifrasRespaldadas(texto('Según tu archivo, el total es 48,250.'), r)).toBe(true);
  });
});

const fuente = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe.each(['analista.ts', 'copiloto.ts'])('%s: el respaldo se arma solo con construirRespaldo', (archivo) => {
  const s = fuente(archivo);
  it('usa construirRespaldo y nunca toma opts.mensajes para el conjunto de respaldo', () => {
    expect(s).toContain('construirRespaldo({');
    expect(s).not.toMatch(/extraerNumeros\(opts\.mensajes/);
    expect(s).not.toMatch(/extraerNumeros\([^)]*mensajes/);
  });
});
