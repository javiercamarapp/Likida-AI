import { describe, expect, it } from 'vitest';
import { resolverConfig } from './base';
import { validarAvc, validarCorreo, validarDestinatarioFicha, validarSolicitanteDatosOperador } from './privacidad';
import { CONFIG_PRUEBA, clonar, contextoBase, fichaBase } from './validaciones.fixture';

const cfg = resolverConfig(CONFIG_PRUEBA);

describe('V17 AVC/gafete/TAG vs operador presente', () => {
  it('coinciden: sin hallazgos', () => {
    expect(validarAvc(fichaBase(), contextoBase())).toEqual([]);
  });
  it('operador distinto al asignado a último momento: bloqueo', () => {
    const f = clonar(fichaBase());
    f.avc!.operador = 'Otra Persona Distinta Aqui';
    const hs = validarAvc(f, contextoBase());
    expect(hs[0].severidad).toBe('bloqueo');
    expect(JSON.stringify(hs)).not.toContain('Otra Persona');
  });
  it('gafete y TAG distintos', () => {
    const f = clonar(fichaBase());
    f.avc!.gafete = 'GAF-9';
    f.avc!.tag = 'TAG-9';
    expect(validarAvc(f, contextoBase())).toHaveLength(2);
  });
  it('sin AVC o AVC vacío: dato ausente', () => {
    const f = clonar(fichaBase());
    delete f.avc;
    expect(validarAvc(f, contextoBase())[0].datoAusente).toBe(true);
    f.avc = {};
    expect(validarAvc(f, contextoBase())[0].datoAusente).toBe(true);
  });
});

describe('V21 correo sin buzón compartido', () => {
  it('con el buzón en copia: sin hallazgos (sin importar mayúsculas)', () => {
    expect(validarCorreo(fichaBase(), contextoBase(), cfg)).toEqual([]);
    const c = clonar(contextoBase());
    c.correo!.cc = ['CRUCES@flota.test'];
    expect(validarCorreo(fichaBase(), c, cfg)).toEqual([]);
  });
  it('sin el buzón: aviso', () => {
    const c = clonar(contextoBase());
    c.correo!.cc = [];
    expect(validarCorreo(fichaBase(), c, cfg)[0].severidad).toBe('aviso');
  });
  it('buzón no configurado: lo dice, no lo adivina', () => {
    expect(validarCorreo(fichaBase(), contextoBase(), resolverConfig())[0].datoAusente).toBe(true);
  });
  it('sin cabeceras o sin destinatarios: dato ausente', () => {
    const c = clonar(contextoBase());
    delete c.correo;
    expect(validarCorreo(fichaBase(), c, cfg)[0].datoAusente).toBe(true);
    c.correo = { de: 'x@flota.test' };
    expect(validarCorreo(fichaBase(), c, cfg)[0].datoAusente).toBe(true);
  });
});

describe('P01 datos del operador a solicitante no verificado', () => {
  const lb = { listaBlancaDatosOperador: ['contacto-1'] };
  it('verificado y en la lista blanca: permitido', () => {
    expect(validarSolicitanteDatosOperador({ id: 'contacto-1', verificado: true }, lb)).toEqual([]);
  });
  it('no verificado o fuera de la lista: bloqueo', () => {
    expect(validarSolicitanteDatosOperador({ id: 'contacto-1', verificado: false }, lb)[0].severidad).toBe('bloqueo');
    expect(validarSolicitanteDatosOperador({ id: 'desconocido', verificado: true }, lb)[0].severidad).toBe('bloqueo');
  });
  it('falla cerrado: sin solicitante o sin lista blanca', () => {
    expect(validarSolicitanteDatosOperador(undefined, lb)[0].datoAusente).toBe(true);
    expect(validarSolicitanteDatosOperador({ id: 'contacto-1', verificado: true }, { listaBlancaDatosOperador: [] })[0].severidad).toBe('bloqueo');
    expect(validarSolicitanteDatosOperador({ id: 'contacto-1', verificado: true }, {})[0].severidad).toBe('bloqueo');
  });
  it('la ficha con datos personales exige destinatario autorizado', () => {
    expect(validarDestinatarioFicha(fichaBase(), contextoBase())).toEqual([]);
    const c = clonar(contextoBase());
    c.destinatario = { id: 'otro', verificado: true };
    expect(validarDestinatarioFicha(fichaBase(), c)[0].severidad).toBe('bloqueo');
    delete c.destinatario;
    expect(validarDestinatarioFicha(fichaBase(), c)[0].datoAusente).toBe(true);
  });
  it('una ficha sin datos personales no necesita destinatario', () => {
    const f = clonar(fichaBase());
    f.operador = {};
    const c = clonar(contextoBase());
    delete c.destinatario;
    expect(validarDestinatarioFicha(f, c)).toEqual([]);
  });
});
