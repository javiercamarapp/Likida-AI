import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// TABLEROS AL DÍA (28-ago-2026) — la precisión llega a la pantalla con el
// nombre correcto. El medidor existe (0239/0246) y vive en /admin/qa, pero
// quien pregunta «¿qué tan bien lee el OCR?» llega a /admin/agente-ocr y solo
// veía dólares. Lo que estas pruebas fijan: la lectura caída se dice (≠ «no
// hay medición»), el banco sin medir NO es un 0%, y el agregado que se pinta
// sale de las MISMAS funciones que el panel de QA.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const getResumenNegocio = vi.fn();
const getCostoPorFaseModelo = vi.fn();
vi.mock('@/lib/admin/negocio', () => ({
  getResumenNegocio: () => getResumenNegocio(),
  getCostoPorFaseModelo: () => getCostoPorFaseModelo(),
}));
const leerUltimasLecturas = vi.fn();
vi.mock('@/lib/admin/qa-storage', () => ({
  leerUltimasLecturas: () => leerUltimasLecturas(),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

import AgenteOcrPage from './page';

function medicion(campos: Array<{ clave: string; veredicto: 'ok' | 'mal' | 'sin_dato' }>) {
  return {
    campos: campos.map((c) => ({ clave: c.clave, esperado: 'x', leido: 'x', veredicto: c.veredicto })),
    camposOk: campos.filter((c) => c.veredicto === 'ok').length,
    camposMal: campos.filter((c) => c.veredicto === 'mal').length,
    camposNoMedidos: campos.filter((c) => c.veredicto !== 'ok' && c.veredicto !== 'mal').length,
  };
}

beforeEach(() => {
  getResumenNegocio.mockResolvedValue({ porFase: [], porModelo: [], facturasTotal: 0, facturasPorDia: [] });
  getCostoPorFaseModelo.mockResolvedValue([]);
});

describe('/admin/agente-ocr — la precisión en la pantalla con el nombre correcto', () => {
  it('lectura caída: se dice, y no se confunde con «no hay medición»', async () => {
    leerUltimasLecturas.mockRejectedValue(new Error('base caída'));
    const html = renderToStaticMarkup(await AgenteOcrPage());
    expect(html).toContain('no es lo mismo que «no hay medición»');
  });

  it('banco sin medir: sin exactitud que reportar, y NO es un 0%', async () => {
    leerUltimasLecturas.mockResolvedValue({ ok: true, datos: new Map() });
    const html = renderToStaticMarkup(await AgenteOcrPage());
    expect(html).toContain('esto NO es un 0%');
    expect(html).not.toContain('0% de exactitud');
  });

  it('con mediciones: el global, el denominador de verdad y lo que peor se lee', async () => {
    const lecturas = new Map([
      ['f-1', { medicion: medicion([
        { clave: 'monto', veredicto: 'ok' }, { clave: 'folio', veredicto: 'mal' },
        { clave: 'fecha', veredicto: 'ok' },
      ]) }],
      ['f-2', { medicion: medicion([
        { clave: 'monto', veredicto: 'ok' }, { clave: 'folio', veredicto: 'mal' },
        { clave: 'fecha', veredicto: 'sin_dato' },
      ]) }],
    ]);
    leerUltimasLecturas.mockResolvedValue({ ok: true, datos: lecturas });
    const html = renderToStaticMarkup(await AgenteOcrPage());
    // 3 ok de 5 medidos = 60% global; el folio (0 de 2) es lo que peor se lee.
    expect(html).toContain('60%');
    expect(html).toContain('de exactitud global');
    expect(html).toContain('folio');
    expect(html).toContain('/admin/qa');
  });
});
