import { describe, expect, it } from 'vitest';
import { resolverConfig } from './base';
import { camposCambiados, huellaFicha, validarCambio, validarContraCi, validarPostPrealerta, validarPrograma } from './cambios';
import { clonar, contextoBase, fichaBase } from './validaciones.fixture';

const cfg = resolverConfig();

describe('huella y campos cambiados', () => {
  it('es determinista y no revela los datos', () => {
    const h = huellaFicha(fichaBase());
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(huellaFicha(fichaBase())).toBe(h);
  });
  it('cambia con cualquier campo clave y no con campos no clave', () => {
    const h = huellaFicha(fichaBase());
    const f = clonar(fichaBase());
    f.operador!.nombre = 'Otro Operador Distinto Mas';
    expect(huellaFicha(f)).not.toBe(h);
    const g = clonar(fichaBase());
    g.eta!.valor = '2026-11-24T07:00';
    expect(huellaFicha(g)).toBe(h);
  });
  it('normaliza mayúsculas y guiones', () => {
    const f = clonar(fichaBase());
    f.caja!.placas = 'aaa-123';
    expect(huellaFicha(f)).toBe(huellaFicha(fichaBase()));
  });
  it('lista los campos que cambiaron', () => {
    const f = clonar(fichaBase());
    f.unidad!.eco = 'T-99';
    f.caja!.numero = 'XX-1';
    expect(camposCambiados(fichaBase(), f)).toEqual(['caja.numero', 'unidad.eco']);
  });
});

describe('V07 cambio tras prealerta', () => {
  it('sin cambios: sin hallazgos', () => {
    expect(validarCambio(fichaBase(), fichaBase(), contextoBase(), cfg)).toEqual([]);
  });
  it('cambio de unidad con prealerta enviada: bloqueo y rehacer', () => {
    const d = clonar(fichaBase());
    d.unidad!.eco = 'T-99';
    const hs = validarCambio(fichaBase(), d, contextoBase(), cfg);
    expect(hs[0].severidad).toBe('bloqueo');
    expect(hs[0].sugerencia).toContain('rehacer prealerta');
  });
  it('cambio de caja implica nueva CCP', () => {
    const d = clonar(fichaBase());
    d.caja!.numero = 'XX-2151';
    expect(validarCambio(fichaBase(), d, contextoBase(), cfg)[0].sugerencia).toContain('CCP');
  });
  it('sin prealerta es solo aviso con «Actualización»', () => {
    const c = clonar(contextoBase());
    delete c.prealerta;
    const d = clonar(fichaBase());
    d.operador!.nombre = 'Otro Operador Distinto Mas';
    const hs = validarCambio(fichaBase(), d, c, cfg);
    expect(hs[0].severidad).toBe('aviso');
    expect(hs[0].sugerencia).toContain('Actualización');
  });
  it('segundo cambio en 60 minutos: inestable y escala', () => {
    const c = clonar(contextoBase());
    c.cambiosRecientes = ['2026-11-23T09:30'];
    const d = clonar(fichaBase());
    d.unidad!.eco = 'T-99';
    const hs = validarCambio(fichaBase(), d, c, cfg);
    expect(hs.some((h) => h.mensaje.includes('inestable'))).toBe(true);
    c.cambiosRecientes = ['2026-11-23T07:00'];
    expect(validarCambio(fichaBase(), d, c, cfg).some((h) => h.mensaje.includes('inestable'))).toBe(false);
  });
  it('entradas ausentes: dato ausente sin lanzar', () => {
    expect(validarCambio(undefined as never, fichaBase(), contextoBase(), cfg)[0].datoAusente).toBe(true);
  });
  it('en validarFicha: huella distinta a la prealertada', () => {
    const f = clonar(fichaBase());
    f.operador!.nombre = 'Otro Operador Distinto Mas';
    expect(validarPostPrealerta(f, contextoBase(), cfg)[0].severidad).toBe('bloqueo');
    expect(validarPostPrealerta(fichaBase(), contextoBase(), cfg)).toEqual([]);
    const c = clonar(contextoBase());
    delete c.prealerta!.huella;
    expect(validarPostPrealerta(fichaBase(), c, cfg)[0].datoAusente).toBe(true);
    const c2 = clonar(contextoBase());
    c2.cambiosRecientes = ['2026-11-23T09:30', '2026-11-23T09:45'];
    expect(validarPostPrealerta(fichaBase(), c2, cfg).some((h) => h.mensaje.includes('inestable'))).toBe(true);
  });
});

describe('V11 tipo de caja/tracto y planta vs CI', () => {
  it('coincide con la CI: sin hallazgos', () => {
    expect(validarContraCi(fichaBase(), contextoBase())).toEqual([]);
  });
  it('seca vs thermo, regular vs blindado, planta equivocada', () => {
    const f = clonar(fichaBase());
    f.caja!.tipo = 'thermo';
    f.tipoTracto = 'blindado';
    f.planta = 'PLANTA-B';
    const hs = validarContraCi(f, contextoBase());
    expect(hs.map((h) => h.camposInvolucrados[0]).sort()).toEqual(['caja.tipo', 'planta', 'tipoTracto']);
  });
  it('origen de la CCP distinto a la planta de la CI', () => {
    const f = clonar(fichaBase());
    f.origenCcp = 'PLANTA-C';
    expect(validarContraCi(f, contextoBase())[0].camposInvolucrados).toEqual(['origenCcp']);
  });
  it('gatas distintas: aviso', () => {
    const f = clonar(fichaBase());
    f.accesorios = { gatas: 6 };
    const c = clonar(contextoBase());
    c.ci!.gatas = 8;
    expect(validarContraCi(f, c)[0].severidad).toBe('aviso');
  });
  it('campos pendientes no comparan; sin CI es dato ausente', () => {
    const f = clonar(fichaBase());
    f.planta = 'PENDIENTE';
    expect(validarContraCi(f, contextoBase()).some((h) => h.camposInvolucrados[0] === 'planta')).toBe(false);
    const c = clonar(contextoBase());
    delete c.ci;
    expect(validarContraCi(fichaBase(), c)[0].datoAusente).toBe(true);
  });
});

describe('V15 programa que cambia', () => {
  const s = (hora: string, extra: Record<string, unknown> = {}) => ({ hora, planta: 'P-A', modalidad: 'vivo', ...extra });
  it('igual: sin hallazgos', () => {
    expect(validarPrograma([s('08:00'), s('10:00')], [s('10:00'), s('08:00')])).toEqual([]);
  });
  it('total distinto (3 vs 4)', () => {
    const hs = validarPrograma([s('08:00'), s('09:00'), s('10:00')], [s('08:00'), s('09:00'), s('10:00'), s('11:00')]);
    expect(hs[0].mensaje).toContain('de 3 a 4');
  });
  it('mismo total con hora distinta', () => {
    expect(validarPrograma([s('08:00')], [s('09:00')])[0].mensaje).toContain('hora, planta o modalidad');
  });
  it('cancelación y drop nuevo', () => {
    const hs = validarPrograma([s('08:00'), s('10:00')], [s('08:00'), s('10:00', { cancelado: true })]);
    expect(hs.some((h) => h.mensaje.includes('cancelados'))).toBe(true);
    const hs2 = validarPrograma([s('08:00')], [s('08:00', { modalidad: 'drop' })]);
    expect(hs2.some((h) => h.mensaje.includes('drop'))).toBe(true);
  });
  it('versiones ausentes: dato ausente', () => {
    expect(validarPrograma(undefined, [s('08:00')])[0].datoAusente).toBe(true);
  });
});
