import { describe, it, expect } from 'vitest';
import { resolverDestinatarios, type EntradaDestinatarios } from './correo_destinatarios';

const base = (): EntradaDestinatarios => ({
  operador: { correo: 'op@ejemplo.test', rebotadoEn: null },
  coordinador: { correo: 'coord@ejemplo.test', activo: true },
  config: { rhCorreos: ['rh@ejemplo.test'], archivoCorreo: 'archivo@ejemplo.test', enviaCoordinador: true, enviaRh: true },
});
const con = (f: (e: EntradaDestinatarios) => void) => { const e = base(); f(e); return e; };

describe('resolverDestinatarios', () => {
  it('todo presente: 4 destinos, uno por rol, sin faltantes', () => {
    const r = resolverDestinatarios(base());
    expect(r.destinos.map((d) => d.rol)).toEqual(['operador', 'coordinador', 'rh', 'archivo']);
    expect(r.faltantes).toEqual([]);
  });

  it('operador sin correo: no se le envía, pero sí a coordinador/RH/archivo, y se reporta', () => {
    const r = resolverDestinatarios(con((e) => { e.operador.correo = null; }));
    expect(r.destinos.map((d) => d.rol)).toEqual(['coordinador', 'rh', 'archivo']);
    expect(r.faltantes).toEqual([{ rol: 'operador', motivo: 'operador_sin_correo' }]);
    expect(resolverDestinatarios(con((e) => { e.operador.correo = '   '; })).faltantes[0].motivo).toBe('operador_sin_correo');
  });

  it('coordinador igual a RH: un solo envío, con el rol más específico (coordinador)', () => {
    const r = resolverDestinatarios(con((e) => { e.config.rhCorreos = ['coord@ejemplo.test']; }));
    expect(r.destinos.filter((d) => d.correo === 'coord@ejemplo.test')).toEqual([{ rol: 'coordinador', correo: 'coord@ejemplo.test' }]);
    expect(r.destinos).toHaveLength(3);
  });

  it('correo en mayúsculas/espacios se normaliza y deduplica', () => {
    const r = resolverDestinatarios(con((e) => { e.operador.correo = '  OP@Ejemplo.TEST '; e.config.archivoCorreo = 'op@ejemplo.test'; }));
    expect(r.destinos[0]).toEqual({ rol: 'operador', correo: 'op@ejemplo.test' });
    expect(r.destinos.filter((d) => d.correo === 'op@ejemplo.test')).toHaveLength(1);
    expect(r.destinos.map((d) => d.rol)).not.toContain('archivo');
  });

  it('correo del operador rebotado: no se envía y se reporta correo_rebotado', () => {
    const r = resolverDestinatarios(con((e) => { e.operador.rebotadoEn = '2026-10-10T12:00:00Z'; }));
    expect(r.destinos.map((d) => d.rol)).toEqual(['coordinador', 'rh', 'archivo']);
    expect(r.faltantes).toEqual([{ rol: 'operador', motivo: 'correo_rebotado' }]);
  });

  it('config sin RH (lista vacía o envia_rh=false): no hay destino rh; coordinador omitido si envia_coordinador=false', () => {
    expect(resolverDestinatarios(con((e) => { e.config.rhCorreos = []; })).destinos.map((d) => d.rol)).not.toContain('rh');
    const r = resolverDestinatarios(con((e) => { e.config.enviaRh = false; e.config.enviaCoordinador = false; }));
    expect(r.destinos.map((d) => d.rol)).toEqual(['operador', 'archivo']);
    expect(r.faltantes).toEqual([]);
  });

  it('archivo: solo si hay archivo_correo; varios RH (hasta 3) son destinos separados', () => {
    expect(resolverDestinatarios(con((e) => { e.config.archivoCorreo = null; })).destinos.map((d) => d.rol)).not.toContain('archivo');
    const r = resolverDestinatarios(con((e) => { e.config.rhCorreos = ['a@e.test', 'B@e.test', 'a@e.test']; }));
    expect(r.destinos.filter((d) => d.rol === 'rh').map((d) => d.correo)).toEqual(['a@e.test', 'b@e.test']);
  });

  it('coordinador sin asignar o inactivo: faltante coordinador_sin_asignar, el resto sigue', () => {
    for (const co of [null, { correo: 'coord@ejemplo.test', activo: false }, { correo: null, activo: true }]) {
      const r = resolverDestinatarios(con((e) => { e.coordinador = co; }));
      expect(r.faltantes).toEqual([{ rol: 'coordinador', motivo: 'coordinador_sin_asignar' }]);
      expect(r.destinos.map((d) => d.rol)).toEqual(['operador', 'rh', 'archivo']);
    }
  });

  it('nada presente: 0 destinos y motivos explícitos', () => {
    const r = resolverDestinatarios({
      operador: { correo: null, rebotadoEn: null }, coordinador: null,
      config: { rhCorreos: [], archivoCorreo: null, enviaCoordinador: true, enviaRh: true },
    });
    expect(r.destinos).toEqual([]);
    expect(r.faltantes).toEqual([
      { rol: 'operador', motivo: 'operador_sin_correo' }, { rol: 'coordinador', motivo: 'coordinador_sin_asignar' },
    ]);
  });

  it('cada destino lleva un único correo (nunca lista) y no hay duplicados', () => {
    const r = resolverDestinatarios(base());
    for (const d of r.destinos) expect(d.correo).not.toMatch(/[,;\s]/);
    expect(new Set(r.destinos.map((d) => d.correo)).size).toBe(r.destinos.length);
  });
});
