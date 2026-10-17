import { describe, expect, it } from 'vitest';
import {
  contarConfirmacionesSinEditar, crearAutonomoPermitido, decidirEnvioAviso, type ConfigPolitica, type EntradaPoliticaAviso,
  type ResultadoConfirmacion,
} from './politica';
import { estadoSegunModo } from './generar';
import type { ConfigAviso } from './repo';

const AHORA = new Date('2026-10-20T12:00:00Z');
const dias = (n: number) => new Date(AHORA.getTime() - n * 86_400_000);
const cfg = (o: Partial<ConfigPolitica> = {}): ConfigPolitica => ({
  modo: 'autonomo', autonomoMinConfirmaciones: 5, habilitado: true, ...o,
});
const base = (o: Partial<EntradaPoliticaAviso> = {}): EntradaPoliticaAviso => ({
  config: cfg(), cliente: { autonomoDesde: dias(30) }, aprobacionesSinEditar: 5, riesgo: { completo: true }, ahora: AHORA, ...o,
});

describe('decidirEnvioAviso · tabla de decisiones', () => {
  const tabla: Array<[string, EntradaPoliticaAviso, string, string]> = [
    ['por defecto (confirmar) todo va a confirmación', base({ config: cfg({ modo: 'confirmar' }) }), 'confirmar', 'modo_confirmar'],
    ['confirmar aunque el cliente ya acumuló de sobra', base({ config: cfg({ modo: 'confirmar' }), aprobacionesSinEditar: 99 }), 'confirmar', 'modo_confirmar'],
    ['5 confirmaciones sin editar → autónomo', base(), 'autoaprobar', 'autonomo_validado'],
    ['4 confirmaciones → todavía confirma', base({ aprobacionesSinEditar: 4 }), 'confirmar', 'aun_no_validado'],
    ['0 confirmaciones → confirma', base({ aprobacionesSinEditar: 0 }), 'confirmar', 'aun_no_validado'],
    ['mínimo configurable (2)', base({ config: cfg({ autonomoMinConfirmaciones: 2 }), aprobacionesSinEditar: 2 }), 'autoaprobar', 'autonomo_validado'],
    ['mínimo 0 deja salir sin historial (decisión explícita de la flota)', base({ config: cfg({ autonomoMinConfirmaciones: 0 }), aprobacionesSinEditar: 0 }), 'autoaprobar', 'autonomo_validado'],
    ['mínimo inválido (NaN) falla cerrado', base({ config: cfg({ autonomoMinConfirmaciones: Number.NaN }), aprobacionesSinEditar: 999 }), 'confirmar', 'aun_no_validado'],
    ['aviso con campo pendiente nunca autónomo', base({ riesgo: { completo: false } }), 'confirmar', 'aviso_incompleto'],
    ['kill switch del cliente → confirma', base({ cliente: { autonomoApagado: true, autonomoDesde: dias(30) } }), 'confirmar', 'cliente_apagado'],
    ['flota apagada (habilitado=false) = nada', base({ config: cfg({ habilitado: false }) }), 'ninguna', 'flota_apagada'],
    ['kill switch de la flota = nada', base({ config: cfg({ killFlota: true }) }), 'ninguna', 'flota_apagada'],
    ['kill switch de la flota gana al modo confirmar', base({ config: cfg({ killFlota: true, modo: 'confirmar' }) }), 'ninguna', 'flota_apagada'],
  ];
  for (const [nombre, entrada, accion, motivo] of tabla) {
    it(nombre, () => expect(decidirEnvioAviso(entrada)).toEqual({ accion, motivo }));
  }
});

describe('decidirEnvioAviso · reenvío por cambio de operador', () => {
  const cambio = { completo: true, esReenvio: true, cambioOperador: true };
  it('exige confirmación en la primera semana de autonomía', () => {
    expect(decidirEnvioAviso(base({ riesgo: cambio, cliente: { autonomoDesde: dias(3) } })))
      .toEqual({ accion: 'confirmar', motivo: 'cambio_operador_primera_semana' });
  });
  it('sin fecha de inicio de autonomía asume la ventana abierta', () => {
    expect(decidirEnvioAviso(base({ riesgo: cambio, cliente: { autonomoDesde: null } })).accion).toBe('confirmar');
  });
  it('pasada la ventana puede salir solo', () => {
    expect(decidirEnvioAviso(base({ riesgo: cambio, cliente: { autonomoDesde: dias(8) } })).accion).toBe('autoaprobar');
  });
  it('la ventana es configurable', () => {
    const c = cfg({ diasCambioOperadorConfirma: 30 });
    expect(decidirEnvioAviso(base({ config: c, riesgo: cambio, cliente: { autonomoDesde: dias(20) } })).accion).toBe('confirmar');
    expect(decidirEnvioAviso(base({ config: c, riesgo: cambio, cliente: { autonomoDesde: dias(31) } })).accion).toBe('autoaprobar');
  });
  it('un reenvío que no toca al operador no cae en esa regla', () => {
    expect(decidirEnvioAviso(base({ riesgo: { completo: true, esReenvio: true, cambioOperador: false }, cliente: { autonomoDesde: dias(1) } })).accion)
      .toBe('autoaprobar');
  });
  it('un reenvío incompleto sigue sin salir solo aunque pase la ventana', () => {
    expect(decidirEnvioAviso(base({ riesgo: { ...cambio, completo: false }, cliente: { autonomoDesde: dias(60) } })).motivo).toBe('aviso_incompleto');
  });
});

describe('contarConfirmacionesSinEditar', () => {
  const ok: ResultadoConfirmacion = 'confirmado_sin_editar';
  it('cuenta las consecutivas más recientes', () => expect(contarConfirmacionesSinEditar([ok, ok, ok])).toBe(3));
  it('una edición reinicia el contador', () => {
    expect(contarConfirmacionesSinEditar([ok, ok, ok, ok, ok, 'editado'])).toBe(0);
    expect(contarConfirmacionesSinEditar([ok, ok, ok, ok, ok, 'editado', ok, ok])).toBe(2);
  });
  it('un fallo reinicia el contador', () => expect(contarConfirmacionesSinEditar([ok, ok, 'fallido', ok])).toBe(1));
  it('historial vacío = 0', () => expect(contarConfirmacionesSinEditar([])).toBe(0));
  it('5 sin editar → autónomo; luego una edición → vuelve a confirmar', () => {
    const h: ResultadoConfirmacion[] = [ok, ok, ok, ok, ok];
    expect(decidirEnvioAviso(base({ aprobacionesSinEditar: contarConfirmacionesSinEditar(h) })).accion).toBe('autoaprobar');
    h.push('editado');
    expect(decidirEnvioAviso(base({ aprobacionesSinEditar: contarConfirmacionesSinEditar(h) })).accion).toBe('confirmar');
  });
});

describe('crearAutonomoPermitido + estadoSegunModo', () => {
  const T = '00000000-0000-4000-8000-0000000000a1';
  const configAviso = (modo: ConfigAviso['modo']): ConfigAviso => ({
    habilitado: true, modo, canalDefault: 'ejecutivo_copia', ccpListos: [], exigirTransito: false, secciones: [], horasAntesCita: null,
    zona: 'America/Mexico_City',
  });
  const ok: ResultadoConfirmacion = 'confirmado_sin_editar';
  const fn = (historial: ResultadoConfirmacion[], c = cfg()) => crearAutonomoPermitido({
    config: c, ahora: () => AHORA, cliente: async () => ({ cliente: { autonomoDesde: dias(30) }, historial }),
  });

  it('con 5 confirmaciones sin editar el aviso nace aprobado', async () => {
    const e = await estadoSegunModo(T, configAviso('autonomo'), true, { autonomoPermitido: fn([ok, ok, ok, ok, ok]) }, { clienteId: 'c1', completo: true });
    expect(e).toBe('aprobado');
  });
  it('con una edición reciente vuelve a pendiente_confirmacion', async () => {
    const e = await estadoSegunModo(T, configAviso('autonomo'), true, { autonomoPermitido: fn([ok, ok, ok, ok, ok, 'editado']) }, { clienteId: 'c1', completo: true });
    expect(e).toBe('pendiente_confirmacion');
  });
  it('aviso con campo pendiente nunca se aprueba solo', async () => {
    const e = await estadoSegunModo(T, configAviso('autonomo'), true, { autonomoPermitido: fn([ok, ok, ok, ok, ok]) }, { clienteId: 'c1', completo: false });
    expect(e).toBe('pendiente_confirmacion');
  });
  it('sin contexto (quien llama no declara completitud) falla cerrado', async () => {
    const e = await estadoSegunModo(T, configAviso('autonomo'), true, { autonomoPermitido: fn([ok, ok, ok, ok, ok]) });
    expect(e).toBe('pendiente_confirmacion');
  });
  it('flota apagada por la política: no se aprueba nada', async () => {
    const e = await estadoSegunModo(T, configAviso('autonomo'), true, { autonomoPermitido: fn([ok, ok, ok, ok, ok], cfg({ killFlota: true })) }, { clienteId: 'c1', completo: true });
    expect(e).toBe('pendiente_confirmacion');
  });
  it('el modo confirmar de la config nunca aprueba, ni con historial perfecto', async () => {
    const e = await estadoSegunModo(T, configAviso('confirmar'), true, { autonomoPermitido: fn([ok, ok, ok, ok, ok]) }, { clienteId: 'c1', completo: true });
    expect(e).toBe('pendiente_confirmacion');
  });
  it('sin destinatario sigue siendo sin_destinatario', async () => {
    const e = await estadoSegunModo(T, configAviso('autonomo'), false, { autonomoPermitido: fn([ok, ok, ok, ok, ok]) }, { clienteId: null, completo: true });
    expect(e).toBe('sin_destinatario');
  });
});
