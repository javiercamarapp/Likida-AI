import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EncabezadoFiscal } from './periodo';
import type { Periodo } from '@/lib/likida/fiscal';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, BAJO (frontend) — "Inconsistencias de identidad entre los
// cuatro paneles": el rango de fechas del panel fiscal se imprimía crudo
// (`periodo.desde – periodo.hasta`, formato ISO "2026-01-01"), el único de
// los tres formatos de fecha del producto que NO pasa por `fechaMx()` — la
// única representación fiscal que CLAUDE.md exige para una cifra que el
// contralor cruza contra su papel. Ahora usa `fechaMx()`, la misma función
// que ya usan las 30 páginas de /dashboard.
// ═══════════════════════════════════════════════════════════════════════════

const PERIODO: Periodo = {
  clave: 'ejercicio', etiqueta: 'Ejercicio', desde: '2026-01-01', hasta: '2026-12-31',
};

describe('EncabezadoFiscal — el rango de fechas usa fechaMx(), no el ISO crudo', () => {
  it('imprime el rango con el mismo formato que el resto del producto', () => {
    const html = renderToStaticMarkup(
      <EncabezadoFiscal icono={<span />} titulo="t" subtitulo="s" base="/x" periodo={PERIODO} />,
    );
    expect(html).toContain('01 ene 2026');
    expect(html).toContain('31 dic 2026');
  });

  it('ya no deja el ISO crudo en pantalla', () => {
    const html = renderToStaticMarkup(
      <EncabezadoFiscal icono={<span />} titulo="t" subtitulo="s" base="/x" periodo={PERIODO} />,
    );
    expect(html).not.toContain('2026-01-01');
    expect(html).not.toContain('2026-12-31');
  });

  it('sin corte de fechas (periodo "todo"), sigue diciendo qué falta', () => {
    const sinCorte: Periodo = { clave: 'todo', etiqueta: 'Todo', desde: null, hasta: null };
    const html = renderToStaticMarkup(
      <EncabezadoFiscal icono={<span />} titulo="t" subtitulo="s" base="/x" periodo={sinCorte} />,
    );
    expect(html).toContain('Sin corte de fechas');
  });
});
