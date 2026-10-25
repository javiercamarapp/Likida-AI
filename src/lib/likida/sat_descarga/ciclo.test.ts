import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));

import { rangoPendiente, correrDescargaSat, VENTANA_MAX_DIAS, VENTANA_INICIAL_DIAS, TRASLAPE_DIAS } from './ciclo';

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

  it('A37-S57-05: retrocede TRASLAPE_DIAS (3) sobre el último descargado — un CFDI que el PAC reporta al SAT tarde no se pierde', () => {
    // Último descargado = 10; el rango pedido arranca el 9: cubre 9, 10 (ya vistos; el sello de dedup los
    // responde «repetido») y todo lo nuevo hasta hoy. Antes arrancaba el 11 y lo que el SAT registraba con
    // retraso sobre el 8-10 nunca se pedía.
    expect(TRASLAPE_DIAS).toBe(3);
    const r = rangoPendiente('2026-08-10', '2026-08-27');
    expect(r).toEqual({ desde: '2026-08-08', hasta: '2026-08-27' });
  });

  it('A37-S57-05: el rango de un día NUNCA se repite con los mismos parámetros (el SAT rechaza solicitudes idénticas)', () => {
    // Dos días seguidos con el calendario al día producen rangos distintos…
    expect(rangoPendiente('2026-10-22', '2026-10-23')).toEqual({ desde: '2026-10-20', hasta: '2026-10-23' });
    expect(rangoPendiente('2026-10-23', '2026-10-24')).toEqual({ desde: '2026-10-21', hasta: '2026-10-24' });
    // …y, ya descargado el día de hoy, las 4 corridas diarias no vuelven a pedir.
    expect(rangoPendiente('2026-10-23', '2026-10-23')).toBeNull();
  });

  it('corta en la ventana máxima cuando el pendiente es largo', () => {
    const r = rangoPendiente('2026-01-01', '2026-08-27');
    expect(r).toEqual({ desde: '2025-12-30', hasta: '2026-01-29' }); // 31 días
  });

  it('ya al día devuelve null: no se pide un rango vacío', () => {
    expect(rangoPendiente('2026-08-27', '2026-08-27')).toBeNull();
    // Y un `ultima_hasta` en el futuro (reloj torcido) tampoco pide nada.
    expect(rangoPendiente('2026-09-30', '2026-08-27')).toBeNull();
  });

  it('los pedazos se TRASLAPAN: encadenados cubren el rango sin hueco', () => {
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
      '2025-12-30→2026-01-29', '2026-01-27→2026-02-26',
      '2026-02-24→2026-03-26', '2026-03-24→2026-04-23',
    ]);
  });

  it('cruza el fin de año sin inventar fechas', () => {
    expect(rangoPendiente('2025-12-31', '2026-01-15')).toEqual({ desde: '2025-12-29', hasta: '2026-01-15' });
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
    // AUDITORÍA 21 (29-ago-2026): la señal estructurada que viaja hasta el
    // latido para que `esHuecoDeConfiguracion` no dependa de la prosa de
    // `motivo`.
    expect(r.configurado).toBe(false);
    expect(r.flotas).toBe(0);
    expect(r.resumenes).toEqual([]);
    expect(r.motivo).toMatch(/no está configurada/i);
    // Y dice QUIÉN lo destraba: "no configurado" a secas no sirve de nada.
    expect(r.motivo).toMatch(/Javier/);
  });
});
