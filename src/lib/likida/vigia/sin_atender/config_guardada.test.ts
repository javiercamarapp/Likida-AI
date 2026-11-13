import { describe, it, expect } from 'vitest';
import { CONFIG_SIN_ATENDER_POR_OMISION as D, normalizarConfigSinAtender } from './config';
import { CONFIG_GUARDADA_POR_OMISION, aParcialDelMotor, copiaConfigGuardadaPorOmision, normalizarFilaConfig, validarConfigGuardada } from './config_guardada';
import { detectarSinAtender } from './detectar';
import { chat, cli, eq, T0_MS, ZONA } from './fixtures';

const valido = {
  horarioAtencion: { desdeHora: 8, hastaHora: 18, diasHabiles: [5, 1, 1, 3] },
  palabrasClave: [' Embarque ', 'embarque', 'Retraso'], palabrasUrgentes: ['URGENTE'], equipoNombres: ['Operador 1', 'operador 1', 'Operador 2'],
  insistenciaMin: 3, umbralUrgenteMin: 15, resumenCorreoHabilitado: true,
};

describe('defaults: sin fila todo apagado (falla cerrado)', () => {
  it('el resumen por correo, el horario y el equipo nacen apagados', () => {
    expect(CONFIG_GUARDADA_POR_OMISION).toMatchObject({ horarioAtencion: null, resumenCorreoHabilitado: false, equipoNombres: [], palabrasClave: [], palabrasUrgentes: [] });
    expect(Object.isFrozen(CONFIG_GUARDADA_POR_OMISION)).toBe(true);
  });
  it('la copia es mutable e independiente del original', () => {
    const c = copiaConfigGuardadaPorOmision();
    c.equipoNombres.push('x');
    expect(CONFIG_GUARDADA_POR_OMISION.equipoNombres).toEqual([]);
  });
  it('como parcial del motor no pisa las palabras de arranque ni inventa horario', () => {
    const p = aParcialDelMotor(copiaConfigGuardadaPorOmision());
    expect(p).not.toHaveProperty('palabrasClave');
    expect(p).not.toHaveProperty('horarioAtencion');
    expect(p).toMatchObject({ insistenciaMin: 2, umbralUrgenteMin: 10, palabrasUrgentes: [] });
  });
});

describe('validación estricta: rangos', () => {
  it('acepta y normaliza (sin repetidos, minúsculas en palabras, días ordenados)', () => {
    const r = validarConfigGuardada(valido);
    expect(r.ok && r.valor).toEqual({
      horarioAtencion: { desdeHora: 8, hastaHora: 18, diasHabiles: [1, 3, 5] },
      palabrasClave: ['embarque', 'retraso'], palabrasUrgentes: ['urgente'], equipoNombres: ['Operador 1', 'Operador 2'],
      insistenciaMin: 3, umbralUrgenteMin: 15, resumenCorreoHabilitado: true,
      umbralMin: null, umbralCriticoMin: null, nocheDesdeHora: null, nocheHastaHora: null,
    });
  });
  it.each([
    ['insistencia -1', { insistenciaMin: -1 }], ['insistencia 51', { insistenciaMin: 51 }], ['insistencia decimal', { insistenciaMin: 1.5 }], ['insistencia texto', { insistenciaMin: '2' }],
    ['umbral 0', { umbralUrgenteMin: 0 }], ['umbral 1441', { umbralUrgenteMin: 1441 }], ['umbral NaN', { umbralUrgenteMin: Number.NaN }],
  ])('rechaza %s con mensaje llano', (_n, parche) => {
    const r = validarConfigGuardada({ ...valido, ...parche });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/número entero/);
  });
  it('los extremos válidos pasan', () => {
    expect(validarConfigGuardada({ ...valido, insistenciaMin: 0, umbralUrgenteMin: 1 }).ok).toBe(true);
    expect(validarConfigGuardada({ ...valido, insistenciaMin: 50, umbralUrgenteMin: 1440 }).ok).toBe(true);
  });
  it('listas: máximo 30 palabras de 40 caracteres y 100 nombres de 80', () => {
    const n = (k: number, largo = 3) => Array.from({ length: k }, (_, i) => `${'x'.repeat(largo)}${i}`);
    expect(validarConfigGuardada({ ...valido, palabrasClave: n(30) }).ok).toBe(true);
    expect(validarConfigGuardada({ ...valido, palabrasClave: n(31) }).ok).toBe(false);
    expect(validarConfigGuardada({ ...valido, palabrasUrgentes: ['y'.repeat(41)] }).ok).toBe(false);
    expect(validarConfigGuardada({ ...valido, equipoNombres: n(100) }).ok).toBe(true);
    expect(validarConfigGuardada({ ...valido, equipoNombres: n(101) }).ok).toBe(false);
    expect(validarConfigGuardada({ ...valido, equipoNombres: ['z'.repeat(81)] }).ok).toBe(false);
    expect(validarConfigGuardada({ ...valido, equipoNombres: 'Operador 1' }).ok).toBe(false);
    expect(validarConfigGuardada({ ...valido, palabrasClave: [1] }).ok).toBe(false);
  });
  it('horario: apertura 0-23, cierre 1-24 mayor, días 0-6; null o ausente = sin horario', () => {
    expect(validarConfigGuardada({ ...valido, horarioAtencion: null }).ok).toBe(true);
    const sin = { ...valido } as Record<string, unknown>; delete sin.horarioAtencion;
    expect(validarConfigGuardada(sin)).toMatchObject({ ok: true, valor: { horarioAtencion: null } });
    expect(validarConfigGuardada({ ...valido, horarioAtencion: { desdeHora: 0, hastaHora: 24 } }).ok).toBe(true);
    for (const malo of [{ desdeHora: 18, hastaHora: 8 }, { desdeHora: 8, hastaHora: 8 }, { desdeHora: 24, hastaHora: 24 }, { desdeHora: -1, hastaHora: 5 }, { desdeHora: 8, hastaHora: 25 }, { desdeHora: 8, hastaHora: 18, diasHabiles: [7] }, { desdeHora: 8, hastaHora: 18, diasHabiles: [] }, { desdeHora: '8', hastaHora: 18 }]) {
      expect(validarConfigGuardada({ ...valido, horarioAtencion: malo }).ok).toBe(false);
    }
  });
  it('el interruptor del correo debe ser booleano: nada de «truthy»', () => {
    for (const malo of ['true', 1, null, undefined]) expect(validarConfigGuardada({ ...valido, resumenCorreoHabilitado: malo }).ok).toBe(false);
  });
  it('lo que no es un objeto se rechaza', () => {
    for (const malo of [null, 'x', 3, [1]]) expect(validarConfigGuardada(malo).ok).toBe(false);
  });
});

describe('lectura de una fila de la base: nunca lanza, lo dudoso vuelve a apagado', () => {
  it('fila completa y correcta', () => {
    const c = normalizarFilaConfig({
      horario_atencion: { desdeHora: 9, hastaHora: 19 }, palabras_clave: ['embarque'], palabras_urgentes: [], equipo_nombres: ['Operador 1'], insistencia_min: 4, umbral_urgente_min: 20, resumen_correo_habilitado: true,
    });
    expect(c).toMatchObject({ horarioAtencion: { desdeHora: 9, hastaHora: 19 }, equipoNombres: ['Operador 1'], insistenciaMin: 4, umbralUrgenteMin: 20, resumenCorreoHabilitado: true });
  });
  it('basura, null o filas parciales dan los valores apagados', () => {
    for (const x of [null, undefined, 'x', 5, {}, { resumen_correo_habilitado: 'true', horario_atencion: { desdeHora: 30, hastaHora: 2 }, insistencia_min: 99, umbral_urgente_min: 0, palabras_clave: 'a', equipo_nombres: [1, 2] }]) {
      expect(normalizarFilaConfig(x)).toEqual(copiaConfigGuardadaPorOmision());
    }
  });
  it('solo un true literal enciende el resumen de la flota', () => {
    expect(normalizarFilaConfig({ resumen_correo_habilitado: true }).resumenCorreoHabilitado).toBe(true);
    for (const v of [1, 'si', 'true', null]) expect(normalizarFilaConfig({ resumen_correo_habilitado: v }).resumenCorreoHabilitado).toBe(false);
  });
});

describe('el motor recibe lo guardado', () => {
  it('con horario, la espera fuera de horario no cuenta; sin horario cuenta minutos corridos', () => {
    // T0 = miércoles 10:00 MX. El cliente escribe martes 23:00 (-660) y la foto es T0: 660 min corridos, 120 dentro de 8-18.
    const c = chat([cli(-660, 'necesito el embarque de hoy por favor'), eq(-700, 'listo')]);
    const base = { ...D, umbralMin: 60, umbralCriticoMin: 60, zona: ZONA };
    const sinHorario = normalizarConfigSinAtender({ ...base, ...aParcialDelMotor(copiaConfigGuardadaPorOmision()) }).config;
    const g = validarConfigGuardada({ ...valido, horarioAtencion: { desdeHora: 8, hastaHora: 18 } });
    if (!g.ok) throw new Error('inválido');
    const conHorario = normalizarConfigSinAtender({ ...base, ...aParcialDelMotor(g.valor) }).config;
    const a = detectarSinAtender([c], sinHorario, T0_MS).alertas[0];
    const b = detectarSinAtender([c], conHorario, T0_MS).alertas[0];
    expect(a?.antiguedadMin).toBe(660);
    expect(b?.antiguedadMin).toBe(120);
  });
});

describe('1005: plazos propios y noche', () => {
  it('por omisión son null y NO cambian el motor: ni plazos ni noche en el parcial', () => {
    const base = copiaConfigGuardadaPorOmision();
    expect(base).toMatchObject({ umbralMin: null, umbralCriticoMin: null, nocheDesdeHora: null, nocheHastaHora: null });
    const p = aParcialDelMotor(base);
    for (const k of ['umbralMin', 'umbralCriticoMin', 'noche']) expect(p).not.toHaveProperty(k);
  });
  it('fijados, pasan al motor (plazos y noche)', () => {
    const p = aParcialDelMotor({ ...copiaConfigGuardadaPorOmision(), umbralMin: 45, umbralCriticoMin: 15, nocheDesdeHora: 21, nocheHastaHora: 6 });
    expect(p).toMatchObject({ umbralMin: 45, umbralCriticoMin: 15, noche: { desdeHora: 21, hastaHora: 6 } });
  });
  it('una noche a medias no se pasa al motor', () => {
    expect(aParcialDelMotor({ ...copiaConfigGuardadaPorOmision(), nocheDesdeHora: 21 })).not.toHaveProperty('noche');
  });
  it('validación: acepta bordes, normaliza ausentes a null y acepta noche que cruza medianoche o iguales', () => {
    expect(validarConfigGuardada({ ...valido, umbralMin: 1440, umbralCriticoMin: 1, nocheDesdeHora: 0, nocheHastaHora: 23 })).toMatchObject({ ok: true, valor: { umbralMin: 1440, umbralCriticoMin: 1, nocheDesdeHora: 0, nocheHastaHora: 23 } });
    expect(validarConfigGuardada({ ...valido, umbralMin: 30, umbralCriticoMin: 30 }).ok).toBe(true);
    expect(validarConfigGuardada({ ...valido, nocheDesdeHora: 22, nocheHastaHora: 6 }).ok).toBe(true);
    expect(validarConfigGuardada(valido)).toMatchObject({ ok: true, valor: { umbralMin: null, umbralCriticoMin: null, nocheDesdeHora: null, nocheHastaHora: null } });
  });
  it.each([
    [{ umbralMin: 0 }], [{ umbralMin: 1441 }], [{ umbralMin: 1.5 }], [{ umbralMin: '30' }],
    [{ umbralCriticoMin: 0 }], [{ umbralCriticoMin: 1441 }],
    [{ umbralMin: 30, umbralCriticoMin: 31 }],
    [{ nocheDesdeHora: 24, nocheHastaHora: 6 }], [{ nocheDesdeHora: -1, nocheHastaHora: 6 }], [{ nocheDesdeHora: 20, nocheHastaHora: 7.5 }],
    [{ nocheDesdeHora: 20 }], [{ nocheHastaHora: 7 }],
  ])('rechaza %j con mensaje llano', (extra) => {
    const r = validarConfigGuardada({ ...valido, ...extra });
    expect(r.ok).toBe(false);
  });
  it('el crítico mayor que el normal se rechaza solo si existen los dos', () => {
    expect(validarConfigGuardada({ ...valido, umbralCriticoMin: 500 }).ok).toBe(true);
    expect(validarConfigGuardada({ ...valido, umbralMin: 5 }).ok).toBe(true);
  });
  it('normalizarFilaConfig: lee las columnas nuevas y ante valores malos o columnas ausentes vuelve a null', () => {
    expect(normalizarFilaConfig({ umbral_min: 45, umbral_critico_min: 15, noche_desde_hora: 21, noche_hasta_hora: 6 })).toMatchObject({ umbralMin: 45, umbralCriticoMin: 15, nocheDesdeHora: 21, nocheHastaHora: 6 });
    expect(normalizarFilaConfig({})).toMatchObject({ umbralMin: null, umbralCriticoMin: null, nocheDesdeHora: null, nocheHastaHora: null });
    expect(normalizarFilaConfig({ umbral_min: 0, umbral_critico_min: 5000, noche_desde_hora: 25, noche_hasta_hora: 3 })).toMatchObject({ umbralMin: null, umbralCriticoMin: null, nocheDesdeHora: null, nocheHastaHora: null });
    expect(normalizarFilaConfig({ umbral_min: 20, umbral_critico_min: 30 }).umbralCriticoMin).toBeNull();
    expect(normalizarFilaConfig({ noche_desde_hora: 20 })).toMatchObject({ nocheDesdeHora: null, nocheHastaHora: null });
  });
  it('de extremo a extremo: la noche guardada llega a la config efectiva del motor y los plazos guardados ganan a vigia_config', () => {
    const g = { ...copiaConfigGuardadaPorOmision(), umbralMin: 45, umbralCriticoMin: 15, nocheDesdeHora: 21, nocheHastaHora: 6 };
    const n = normalizarConfigSinAtender({ umbralMin: 99, umbralCriticoMin: 98, ...aParcialDelMotor(g) });
    expect(n.config).toMatchObject({ umbralMin: 45, umbralCriticoMin: 15, noche: { desdeHora: 21, hastaHora: 6 } });
  });
});
