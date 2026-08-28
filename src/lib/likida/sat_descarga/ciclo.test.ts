import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));

import { rangoPendiente, correrDescargaSat, VENTANA_MAX_DIAS, VENTANA_INICIAL_DIAS } from './ciclo';

afterEach(() => vi.unstubAllEnvs());

describe('rangoPendiente — el calendario que no puede saltarse un día', () => {
  it('NULL no es «desde el principio»: abre una ventana inicial acotada', () => {
    // Es la diferencia entre "nunca se ha descargado" y "todo el histórico".
    const r = rangoPendiente(null, '2026-08-27');
    expect(r).not.toBeNull();
    expect(r!.desde).toBe('2026-05-29'); // 90 días atrás
    // …y aun así se corta en la ventana máxima por solicitud.
    expect(r!.hasta).toBe('2026-06-28');
    expect(VENTANA_INICIAL_DIAS).toBe(90);
    expect(VENTANA_MAX_DIAS).toBe(31);
  });

  it('arranca EL DÍA SIGUIENTE al último descargado — ni lo repite ni lo salta', () => {
    const r = rangoPendiente('2026-08-10', '2026-08-27');
    expect(r).toEqual({ desde: '2026-08-11', hasta: '2026-08-27' });
  });

  it('corta en la ventana máxima cuando el pendiente es largo', () => {
    const r = rangoPendiente('2026-01-01', '2026-08-27');
    expect(r).toEqual({ desde: '2026-01-02', hasta: '2026-02-01' }); // 31 días
  });

  it('ya al día devuelve null: no se pide un rango vacío', () => {
    expect(rangoPendiente('2026-08-27', '2026-08-27')).toBeNull();
    // Y un `ultima_hasta` en el futuro (reloj torcido) tampoco pide nada.
    expect(rangoPendiente('2026-09-30', '2026-08-27')).toBeNull();
  });

  it('los pedazos son CONTIGUOS: encadenados cubren el rango sin hueco', () => {
    // La prueba de que el avance no pierde días en el camino largo.
    let ultima: string | null = '2026-01-01';
    const dias: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = rangoPendiente(ultima, '2026-08-27');
      expect(r).not.toBeNull();
      dias.push(`${r!.desde}→${r!.hasta}`);
      ultima = r!.hasta;
    }
    expect(dias).toEqual([
      '2026-01-02→2026-02-01', '2026-02-02→2026-03-04',
      '2026-03-05→2026-04-04', '2026-04-05→2026-05-05',
    ]);
  });

  it('cruza el fin de año sin inventar fechas', () => {
    expect(rangoPendiente('2025-12-31', '2026-01-15')).toEqual({ desde: '2026-01-01', hasta: '2026-01-15' });
  });
});

describe('correrDescargaSat sin configuración', () => {
  beforeEach(() => {
    vi.stubEnv('LIKIDA_SAT_PROVEEDOR', '');
    vi.stubEnv('LIKIDA_SAT_URL', '');
    vi.stubEnv('LIKIDA_SAT_USUARIO', '');
    vi.stubEnv('LIKIDA_SAT_PASSWORD', '');
    vi.stubEnv('LIKIDA_PAC_USUARIO', '');
    vi.stubEnv('LIKIDA_PAC_PASSWORD', '');
  });

  it('NO simula nada y devuelve el motivo en cristiano', async () => {
    const r = await correrDescargaSat(new Date('2026-08-27T12:00:00Z'));
    expect(r.corrio).toBe(false);
    expect(r.flotas).toBe(0);
    expect(r.resumenes).toEqual([]);
    expect(r.motivo).toMatch(/no está configurada/i);
    // Y dice QUIÉN lo destraba: "no configurado" a secas no sirve de nada.
    expect(r.motivo).toMatch(/Javier/);
  });
});
