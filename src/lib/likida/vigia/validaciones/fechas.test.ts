import { describe, expect, it } from 'vitest';
import { resolverConfig } from './base';
import { descomponerFecha, validarCuentaEspejo, validarEta, validarFechas, validarHoraVentana } from './fechas';
import { clonar, contextoBase, fichaBase } from './validaciones.fixture';

const cfg = resolverConfig();

describe('descomponerFecha', () => {
  it('lee ISO y dd/mm/aaaa y rechaza fechas de calendario inexistentes', () => {
    expect(descomponerFecha('2026-11-23')).toMatchObject({ y: 2026, m: 11, d: 23, ambigua: false });
    expect(descomponerFecha('23/11/26')).toMatchObject({ y: 2026, m: 11, d: 23, ambigua: false });
    expect(descomponerFecha('02/03/2026')?.ambigua).toBe(true);
    expect(descomponerFecha('31/02/2026')).toBeNull();
    expect(descomponerFecha('hola')).toBeNull();
    expect(descomponerFecha('23/11')?.sinAnio).toBe(true);
  });
});

describe('V05 fecha mal capturada', () => {
  const con = (fc: Array<{ campo: string; texto: string; diaSemana?: string; permitePasado?: boolean }>) => ({ ...fichaBase(), fechas: fc });
  it('fecha futura coherente con su día: sin hallazgos', () => {
    expect(validarFechas(con([{ campo: 'cita', texto: '2026-11-24', diaSemana: 'martes' }]), contextoBase(), cfg)).toEqual([]);
  });
  it('fecha pasada: bloqueo; permitePasado la deja', () => {
    expect(validarFechas(con([{ campo: 'cita', texto: '2026-11-20' }]), contextoBase(), cfg)[0].mensaje).toContain('ya pasó');
    expect(validarFechas(con([{ campo: 'entrega', texto: '2026-11-20', permitePasado: true }]), contextoBase(), cfg)).toEqual([]);
  });
  it('hoy no es pasado', () => {
    expect(validarFechas(con([{ campo: 'cita', texto: '2026-11-23' }]), contextoBase(), cfg)).toEqual([]);
  });
  it('año absurdo', () => {
    expect(validarFechas(con([{ campo: 'cita', texto: '2062-11-24' }]), contextoBase(), cfg)[0].mensaje).toContain('año fuera de rango');
    expect(validarFechas(con([{ campo: 'cita', texto: '2006-11-24' }]), contextoBase(), cfg)[0].mensaje).toContain('año fuera de rango');
  });
  it('día de la semana que no coincide', () => {
    const hs = validarFechas(con([{ campo: 'cita', texto: '2026-11-24', diaSemana: 'lunes' }]), contextoBase(), cfg);
    expect(hs[0].mensaje).toContain('día de la semana');
  });
  it('formato ambiguo dd/mm vs mm/dd', () => {
    const hs = validarFechas(con([{ campo: 'cita', texto: '05/12/2026' }]), contextoBase(), cfg);
    expect(hs.some((h) => h.mensaje.includes('ambiguo'))).toBe(true);
  });
  it('día mayor a 12 no es ambiguo', () => {
    expect(validarFechas(con([{ campo: 'cita', texto: '24/11/2026' }]), contextoBase(), cfg)).toEqual([]);
  });
  it('sin año y fecha imposible', () => {
    expect(validarFechas(con([{ campo: 'cita', texto: '24/11' }]), contextoBase(), cfg)[0].mensaje).toContain('no trae año');
    expect(validarFechas(con([{ campo: 'cita', texto: '30/02/2026' }]), contextoBase(), cfg)[0].severidad).toBe('bloqueo');
  });
  it('fecha del documento distinta a la de la cita', () => {
    const f = { ...fichaBase(), fechaDocumento: '2026-11-23' };
    const hs = validarFechas(f, contextoBase(), cfg);
    expect(hs[0].mensaje).toContain('distinta a la fecha de la cita');
    expect(validarFechas({ ...fichaBase(), fechaDocumento: '2026-11-24T00:00' }, contextoBase(), cfg)).toEqual([]);
  });
  it('hora sin zona (configurable)', () => {
    const f = clonar(fichaBase());
    delete f.eta!.zona;
    expect(validarFechas(f, contextoBase(), cfg)[0].mensaje).toContain('zona');
    expect(validarFechas(f, contextoBase(), resolverConfig({ exigirZonaHoraria: false }))).toEqual([]);
  });
  it('sin fecha de referencia: bloqueo de dato ausente; cita inválida', () => {
    const c = clonar(contextoBase());
    c.ahora = '';
    expect(validarFechas(fichaBase(), c, cfg)[0].datoAusente).toBe(true);
    expect(validarFechas({ ...fichaBase(), cita: 'mañana' }, contextoBase(), cfg)[0].camposInvolucrados).toEqual(['cita']);
  });
});

describe('V13 cuenta espejo', () => {
  it('vigente hasta después de la cita: sin hallazgos', () => {
    expect(validarCuentaEspejo(fichaBase(), contextoBase())).toEqual([]);
  });
  it('vencida: bloqueo', () => {
    const f = clonar(fichaBase());
    f.ce!.venceEn = '2026-11-23T09:00';
    expect(validarCuentaEspejo(f, contextoBase())[0].severidad).toBe('bloqueo');
  });
  it('vence antes de la cita: aviso', () => {
    const f = clonar(fichaBase());
    f.ce!.venceEn = '2026-11-24T06:00';
    expect(validarCuentaEspejo(f, contextoBase())[0].severidad).toBe('aviso');
  });
  it('sin CE: aviso; caja de terceros: informativo', () => {
    const f = clonar(fichaBase());
    delete f.ce;
    expect(validarCuentaEspejo(f, contextoBase())[0].severidad).toBe('aviso');
    f.cajaDeTerceros = true;
    expect(validarCuentaEspejo(f, contextoBase())[0].severidad).toBe('info');
  });
  it('sin vigencia declarada: dato ausente', () => {
    const f = clonar(fichaBase());
    delete f.ce!.venceEn;
    expect(validarCuentaEspejo(f, contextoBase())[0].datoAusente).toBe(true);
  });
});

describe('V14 ETA inconsistente', () => {
  it('ETA vigente antes de la cita: sin hallazgos', () => {
    expect(validarEta(fichaBase(), contextoBase(), cfg)).toEqual([]);
  });
  it('ETA vencido', () => {
    const f = clonar(fichaBase());
    f.eta!.valor = '2026-11-23T09:00';
    expect(validarEta(f, contextoBase(), cfg)[0].mensaje).toContain('venció');
  });
  it('sin punto planta/patio', () => {
    const f = clonar(fichaBase());
    delete f.eta!.punto;
    expect(validarEta(f, contextoBase(), cfg)[0].camposInvolucrados).toEqual(['eta.punto']);
  });
  it('ETA posterior a la cita: aviso; con más de 60 min, bloqueo para escalar', () => {
    const f = clonar(fichaBase());
    f.eta!.valor = '2026-11-24T09:30';
    expect(validarEta(f, contextoBase(), cfg)[0].severidad).toBe('aviso');
    f.eta!.valor = '2026-11-24T11:00';
    expect(validarEta(f, contextoBase(), cfg)[0].severidad).toBe('bloqueo');
  });
  it('cambio sin causa: bloqueo; con causa pasa', () => {
    const f = clonar(fichaBase());
    f.eta!.anterior = '2026-11-24T07:00';
    expect(validarEta(f, contextoBase(), cfg)[0].mensaje).toContain('sin causa');
    f.eta!.causaCambio = 'causa confirmada';
    expect(validarEta(f, contextoBase(), cfg)).toEqual([]);
  });
  it('ETA antiguo (más de la antigüedad máxima)', () => {
    const f = clonar(fichaBase());
    f.eta!.actualizadoEn = '2026-11-23T07:00';
    expect(validarEta(f, contextoBase(), cfg)[0].mensaje).toContain('antigüedad');
  });
  it('dos y tres cambios en 60 minutos', () => {
    const c = clonar(contextoBase());
    c.historialEta = [{ valor: 'a', registradoEn: '2026-11-23T09:30' }, { valor: 'b', registradoEn: '2026-11-23T09:50' }];
    expect(validarEta(fichaBase(), c, cfg)[0].severidad).toBe('aviso');
    c.historialEta.push({ valor: 'c', registradoEn: '2026-11-23T09:55' });
    expect(validarEta(fichaBase(), c, cfg)[0].severidad).toBe('bloqueo');
    c.historialEta = [{ valor: 'a', registradoEn: '2026-11-23T07:00' }];
    expect(validarEta(fichaBase(), c, cfg)).toEqual([]);
  });
  it('dos cajas contiguas con ETA distinto sin causa', () => {
    const c = clonar(contextoBase());
    c.otrasEtas = [{ caja: 'XX-2151', valor: '2026-11-24T07:00' }];
    expect(validarEta(fichaBase(), c, cfg)[0].mensaje).toContain('XX-2151');
  });
  it('sin ETA o ETA ilegible', () => {
    const f = clonar(fichaBase());
    delete f.eta;
    expect(validarEta(f, contextoBase(), cfg)[0].datoAusente).toBe(true);
    f.eta = { valor: 'pronto', punto: 'planta' };
    expect(validarEta(f, contextoBase(), cfg)[0].severidad).toBe('bloqueo');
  });
  it('sin hora de actualización', () => {
    const f = clonar(fichaBase());
    delete f.eta!.actualizadoEn;
    expect(validarEta(f, contextoBase(), cfg)[0].camposInvolucrados).toEqual(['eta.actualizadoEn']);
  });
});

describe('V19 hora fuera de ventana', () => {
  const mov = (tipo: 'colocacion' | 'cruce' | 'recoleccion', fechaHora: string) => ({ ...fichaBase(), movimiento: { tipo, fechaHora } });
  const c19 = resolverConfig({ ventanasPorMovimiento: { colocacion: { desde: '09:00', hasta: '17:00' } } });
  it('dentro de la ventana configurada: sin hallazgos', () => {
    expect(validarHoraVentana(mov('colocacion', '2026-11-24T10:00'), contextoBase(), c19)).toEqual([]);
  });
  it('fuera de la ventana: aviso', () => {
    expect(validarHoraVentana(mov('colocacion', '2026-11-24T18:30'), contextoBase(), c19)[0].severidad).toBe('aviso');
    expect(validarHoraVentana(mov('colocacion', '2026-11-24T08:59'), contextoBase(), c19)[0].severidad).toBe('aviso');
  });
  it('los extremos de la ventana son válidos', () => {
    expect(validarHoraVentana(mov('colocacion', '2026-11-24T17:00'), contextoBase(), c19)).toEqual([]);
  });
  it('domingo y festivo configurado: bloqueo (extraordinario)', () => {
    expect(validarHoraVentana(mov('colocacion', '2026-11-29T10:00'), contextoBase(), c19)[0].mensaje).toContain('extraordinario');
    const c = resolverConfig({ fechasExtraordinarias: ['2026-12-25'], ventanasPorMovimiento: c19.ventanasPorMovimiento });
    expect(validarHoraVentana(mov('colocacion', '2026-12-25T10:00'), contextoBase(), c)[0].severidad).toBe('bloqueo');
    expect(validarHoraVentana(mov('colocacion', '2026-11-29T10:00'), contextoBase(), resolverConfig({ domingoExtraordinario: false, ventanasPorMovimiento: c19.ventanasPorMovimiento }))).toEqual([]);
  });
  it('sin ventana configurada para el tipo: lo dice, no inventa una', () => {
    const hs = validarHoraVentana(mov('cruce', '2026-11-24T23:00'), contextoBase(), c19);
    expect(hs[0].datoAusente).toBe(true);
    expect(hs[0].severidad).toBe('info');
  });
  it('ventana mal configurada, sin fecha o sin movimiento', () => {
    expect(validarHoraVentana(mov('cruce', '2026-11-24T10:00'), contextoBase(), resolverConfig({ ventanasPorMovimiento: { cruce: { desde: '9', hasta: 'x' } } }))[0].severidad).toBe('aviso');
    expect(validarHoraVentana(mov('cruce', 'x'), contextoBase(), cfg)[0].datoAusente).toBe(true);
    expect(validarHoraVentana(fichaBase(), contextoBase(), cfg)[0].datoAusente).toBe(true);
  });
});
