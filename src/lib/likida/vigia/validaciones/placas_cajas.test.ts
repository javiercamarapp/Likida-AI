import { describe, expect, it } from 'vitest';
import { validarCajaUnDigito, validarPlacas, validarPoolCajas, validarRefVsCaja } from './placas_cajas';
import { resolverConfig } from './base';
import { clonar, contextoBase, fichaBase } from './validaciones.fixture';

const cfg = resolverConfig();
const ids = (hs: Array<{ id: string }>) => hs.map((h) => h.id);

describe('V01 placas', () => {
  it('la ficha coherente no genera hallazgos', () => {
    expect(validarPlacas(fichaBase(), contextoBase(), cfg)).toEqual([]);
  });
  it('normaliza mayúsculas, espacios y guiones al comparar con el catálogo', () => {
    const f = fichaBase();
    f.caja!.placas = 'aaa-123 ';
    expect(validarPlacas(f, contextoBase(), cfg)).toEqual([]);
  });
  it('placa distinta al catálogo: bloqueo, nunca autocorrige', () => {
    const f = fichaBase();
    f.caja!.placas = 'AAA999';
    const hs = validarPlacas(f, contextoBase(), cfg);
    expect(hs.some((h) => h.severidad === 'bloqueo' && h.camposInvolucrados.includes('caja.placas'))).toBe(true);
    expect(JSON.stringify(hs)).not.toContain('AAA999');
  });
  it('sin estado de la placa de la caja: bloqueo; con exigirEstadoCaja=false no', () => {
    const f = fichaBase();
    delete f.caja!.estado;
    expect(validarPlacas(f, contextoBase(), cfg).some((h) => h.camposInvolucrados.includes('caja.estado') && h.severidad === 'bloqueo')).toBe(true);
    expect(validarPlacas(f, contextoBase(), resolverConfig({ exigirEstadoCaja: false })).some((h) => h.camposInvolucrados.includes('caja.estado'))).toBe(false);
  });
  it('placa ausente o «pendiente»: dato ausente, no se asume', () => {
    const f = fichaBase();
    f.caja!.placas = 'PENDIENTE';
    delete f.unidad!.placa;
    const hs = validarPlacas(f, contextoBase(), cfg);
    expect(hs.filter((h) => h.datoAusente).length).toBeGreaterThanOrEqual(2);
  });
  it('formato configurable por estado', () => {
    const f = fichaBase();
    const c = resolverConfig({ formatoPlacaPorEstado: { ZZ: '^[A-Z]{3}[0-9]{4}$' } });
    expect(validarPlacas(f, contextoBase(), c).some((h) => h.severidad === 'aviso' && h.mensaje.includes('formato'))).toBe(true);
  });
  it('regex de configuración inválida: aviso, no lanza', () => {
    expect(() => validarPlacas(fichaBase(), contextoBase(), resolverConfig({ formatoPlacaGenerico: '(' }))).not.toThrow();
  });
  it('misma placa en dos unidades del catálogo: conflicto', () => {
    const c = contextoBase();
    c.catalogoUnidades!.push({ eco: 'T-12', placa: 'bbb-456' });
    expect(validarPlacas(fichaBase(), c, cfg).some((h) => h.mensaje.includes('más de una unidad'))).toBe(true);
  });
  it('misma placa en dos cajas del catálogo: conflicto', () => {
    const c = contextoBase();
    c.catalogoCajas![1].placas = 'AAA123';
    expect(validarPlacas(fichaBase(), c, cfg).some((h) => h.mensaje.includes('más de una caja'))).toBe(true);
  });
  it('placa en CCP/QR distinta a la de la ficha: bloqueo', () => {
    const f = fichaBase();
    f.placasEnDocumentos = [{ origen: 'qr', placaCaja: 'AAA000', placaTracto: 'BBB456' }];
    const hs = validarPlacas(f, contextoBase(), cfg);
    expect(hs).toHaveLength(1);
    expect(hs[0].severidad).toBe('bloqueo');
  });
  it('placa de tracto distinta al catálogo por eco', () => {
    const f = fichaBase();
    f.unidad!.placa = 'BBB000';
    expect(validarPlacas(f, contextoBase(), cfg).some((h) => h.camposInvolucrados.includes('unidad.placa') && h.severidad === 'bloqueo')).toBe(true);
  });
});

describe('V02 caja a un dígito', () => {
  it('la caja asignada igual: sin hallazgos', () => {
    expect(validarCajaUnDigito(fichaBase(), contextoBase(), cfg)).toEqual([]);
  });
  it('un dígito distinto: «posible captura errónea»', () => {
    const f = fichaBase();
    f.cajaCitada = 'XX-2140';
    const hs = validarCajaUnDigito(f, contextoBase(), cfg);
    expect(hs[0].severidad).toBe('bloqueo');
    expect(hs[0].mensaje).toContain('Posible captura errónea');
  });
  it('transposición adyacente cuenta como un cambio (2150 vs 2510)', () => {
    const f = fichaBase();
    f.cajaCitada = 'XX-2510';
    expect(validarCajaUnDigito(f, contextoBase(), cfg)[0].mensaje).toContain('Posible captura errónea');
  });
  it('dígito de menos: también distancia 1', () => {
    const f = fichaBase();
    f.cajaCitada = 'XX-215';
    expect(validarCajaUnDigito(f, contextoBase(), cfg)[0].mensaje).toContain('Posible captura errónea');
  });
  it('caja muy distinta: bloqueo sin la leyenda de captura errónea', () => {
    const f = fichaBase();
    f.cajaCitada = 'XX-9999';
    const hs = validarCajaUnDigito(f, contextoBase(), cfg);
    expect(hs[0].severidad).toBe('bloqueo');
    expect(hs[0].mensaje).not.toContain('captura errónea');
  });
  it('mayúsculas, espacios y guiones no cuentan como diferencia', () => {
    const f = fichaBase();
    f.cajaCitada = 'xx 2150';
    expect(validarCajaUnDigito(f, contextoBase(), cfg)).toEqual([]);
  });
  it('ceros a la izquierda no cuentan como diferencia', () => {
    const c = contextoBase();
    c.cajaAsignada = '002150';
    c.catalogoCajas = [{ numero: '2150', ubicacion: 'PATIO-1' }];
    const f = fichaBase();
    f.caja!.numero = '2150';
    expect(validarCajaUnDigito(f, c, cfg)).toEqual([]);
  });
  it('caja inexistente en inventario y ubicación distinta', () => {
    const c = contextoBase();
    c.cajaAsignada = 'XX-7777';
    const f = fichaBase();
    f.caja!.numero = 'XX-7777';
    expect(validarCajaUnDigito(f, c, cfg).some((h) => h.mensaje.includes('no existe en el inventario'))).toBe(true);
    const c2 = contextoBase();
    c2.ubicacionEsperada = 'OTRO';
    expect(validarCajaUnDigito(fichaBase(), c2, cfg).some((h) => h.mensaje.includes('ubicación distinta'))).toBe(true);
  });
  it('sin caja asignada: dato ausente', () => {
    const c = contextoBase();
    delete c.cajaAsignada;
    const hs = validarCajaUnDigito(fichaBase(), c, cfg);
    expect(hs[0].datoAusente).toBe(true);
  });
  it('prefijosCaja configurables se quitan al comparar', () => {
    const f = fichaBase();
    f.cajaCitada = 'LINXX2150';
    expect(validarCajaUnDigito(f, contextoBase(), resolverConfig({ prefijosCaja: ['LIN'] }))).toEqual([]);
  });
});

describe('V03 referencia vs caja', () => {
  it('ref y caja que empatan: sin hallazgos', () => {
    expect(validarRefVsCaja(fichaBase(), contextoBase(), cfg)).toEqual([]);
  });
  it('ref con otra caja: bloqueo', () => {
    const f = fichaBase();
    f.caja!.numero = 'XX-2151';
    expect(validarRefVsCaja(f, contextoBase(), cfg)[0].severidad).toBe('bloqueo');
  });
  it('ref que no está en la tabla: bloqueo (no se infiere)', () => {
    const f = fichaBase();
    f.ref = 'REF-9999';
    expect(validarRefVsCaja(f, contextoBase(), cfg)[0].mensaje).toContain('no está en la tabla');
  });
  it('sin tabla de equivalencias: dato ausente', () => {
    const c = contextoBase();
    c.equivalencias = [];
    expect(validarRefVsCaja(fichaBase(), c, cfg)[0].datoAusente).toBe(true);
  });
  it('varias refs con una sola caja: servicios mezclados', () => {
    const f = fichaBase();
    f.refsCitadas = ['REF-0001', 'REF-0002'];
    expect(validarRefVsCaja(f, contextoBase(), cfg).some((h) => h.mensaje.includes('mezcla'))).toBe(true);
  });
  it('una ref con varias cajas en la tabla acepta cualquiera de ellas', () => {
    const c = contextoBase();
    c.equivalencias!.push({ ref: 'REF-0001', caja: 'XX-2151' });
    const f = fichaBase();
    f.caja!.numero = 'XX-2151';
    expect(validarRefVsCaja(f, c, cfg)).toEqual([]);
  });
  it('sin ref en la ficha: dato ausente', () => {
    const f = fichaBase();
    delete f.ref;
    expect(validarRefVsCaja(f, contextoBase(), cfg).some((h) => h.datoAusente)).toBe(true);
  });
});

describe('V06 caja duplicada en pool/programa', () => {
  const fila = (caja: string, extra: Record<string, unknown> = {}) => ({ caja, ubicacion: 'PATIO-1', dia: '2026-11-24', linea: 'LIN', ...extra });
  const ctx = { ahora: '2026-11-23T10:00', lineaEsperada: 'LIN' };
  it('pool limpio: sin hallazgos', () => {
    expect(validarPoolCajas([fila('XX-1'), fila('XX-2')], ctx, cfg)).toEqual([]);
  });
  it('caja repetida el mismo día: bloqueo', () => {
    const hs = validarPoolCajas([fila('XX-1'), fila('xx 1')], ctx, cfg);
    expect(hs[0].severidad).toBe('bloqueo');
  });
  it('repetida con ubicaciones contradictorias lo dice', () => {
    const hs = validarPoolCajas([fila('XX-1'), fila('XX-1', { ubicacion: 'OTRA' })], ctx, cfg);
    expect(hs[0].mensaje).toContain('contradictorias');
  });
  it('mismo número en días distintos NO es duplicado', () => {
    expect(validarPoolCajas([fila('XX-1'), fila('XX-1', { dia: '2026-11-25' })], ctx, cfg)).toEqual([]);
  });
  it('asignada a dos servicios el mismo día', () => {
    const hs = validarPoolCajas([fila('XX-1', { servicio: 'S1' }), fila('XX-1', { servicio: 'S2' })], ctx, cfg);
    expect(hs.some((h) => h.mensaje.includes('más de un servicio'))).toBe(true);
  });
  it('caja de otra línea, tipo van y en taller', () => {
    const hs = validarPoolCajas([fila('XX-1', { linea: 'OTRA' }), fila('XX-2', { tipo: 'van' }), fila('XX-3', { estado: 'taller' })], ctx, cfg);
    expect(hs).toHaveLength(3);
  });
  it('suspensión de aire solo se exige si la config lo pide; sin dato es ausente', () => {
    expect(validarPoolCajas([fila('XX-1', { suspensionAire: false })], ctx, cfg)).toEqual([]);
    const c = resolverConfig({ exigirSuspensionAire: true });
    expect(validarPoolCajas([fila('XX-1', { suspensionAire: false })], ctx, c)).toHaveLength(1);
    expect(validarPoolCajas([fila('XX-1')], ctx, c)[0].datoAusente).toBe(true);
  });
  it('caja ausente del inventario', () => {
    const hs = validarPoolCajas([fila('XX-9')], { ...ctx, catalogoCajas: contextoBase().catalogoCajas }, cfg);
    expect(hs[0].mensaje).toContain('no existe en el inventario');
  });
  it('pool vacío o fila sin caja: dato ausente', () => {
    expect(validarPoolCajas([], ctx, cfg)[0].datoAusente).toBe(true);
    expect(validarPoolCajas([fila('')], ctx, cfg)[0].datoAusente).toBe(true);
  });
  it('no muta la entrada', () => {
    const filas = [fila('XX-1'), fila('XX-1')];
    const copia = clonar(filas);
    validarPoolCajas(filas, ctx, cfg);
    expect(filas).toEqual(copia);
    expect(ids([])).toEqual([]);
  });
});
