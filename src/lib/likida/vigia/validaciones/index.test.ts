import { describe, expect, it } from 'vitest';
import {
  CATALOGO_VALIDACIONES, IDS_VALIDACION, validarCambio, validarFicha, validarPool, validarProgramaVersiones, validarSolicitudDatosOperador,
} from './index';
import type { Hallazgo, IdValidacion } from './index';
import { CONFIG_PRUEBA, clonar, contextoBase, fichaBase } from './validaciones.fixture';

const hay = (hs: Hallazgo[], id: string) => hs.some((h) => h.id === id);

describe('validarFicha', () => {
  it('una ficha coherente con contexto completo no genera hallazgos', () => {
    expect(validarFicha(fichaBase(), contextoBase(), CONFIG_PRUEBA)).toEqual([]);
  });
  it('ordena por severidad: bloqueos, avisos, informativos', () => {
    const f = clonar(fichaBase());
    f.caja!.placas = 'AAA999'; // bloqueo V01
    f.operador!.celular = '555'; // aviso V10
    delete f.sello; // info/aviso V09
    const c = clonar(contextoBase());
    delete c.prealerta;
    const hs = validarFicha(f, c, CONFIG_PRUEBA);
    const orden = { bloqueo: 0, aviso: 1, info: 2 };
    const sev = hs.map((h) => orden[h.severidad]);
    expect(sev).toEqual([...sev].sort((a, b) => a - b));
    expect(hs[0].severidad).toBe('bloqueo');
  });
  it('nunca lanza con entradas basura', () => {
    for (const basura of [undefined, null, 5, 'x', [], {}, { caja: 5 }, { operador: 'x' }, { eta: null }]) {
      expect(() => validarFicha(basura as never, basura as never)).not.toThrow();
      expect(() => validarFicha(fichaBase(), basura as never)).not.toThrow();
      expect(() => validarCambio(basura as never, basura as never, basura as never)).not.toThrow();
      expect(() => validarPool(basura as never, basura as never)).not.toThrow();
    }
  });
  it('sin ficha ni contexto reporta datos ausentes explícitos, no silencio', () => {
    const hs = validarFicha({}, { ahora: '2026-11-23T10:00' });
    expect(hs.length).toBeGreaterThan(5);
    expect(hs.filter((h) => h.datoAusente).length).toBeGreaterThan(5);
  });
  it('sin fecha de referencia: bloqueo explícito', () => {
    expect(validarFicha(fichaBase(), { ...contextoBase(), ahora: '' }, CONFIG_PRUEBA).some((h) => h.camposInvolucrados.includes('ahora') && h.severidad === 'bloqueo')).toBe(true);
  });
  it('reportarAusentes=todo informa cada validación no evaluada', () => {
    const f = fichaBase();
    const c = { ahora: '2026-11-23T10:00', cajaAsignada: 'XX-2150' };
    const poco = validarFicha(f, c);
    const todo = validarFicha(f, c, { reportarAusentes: 'todo' });
    expect(todo.length).toBeGreaterThan(poco.length);
    expect(todo.some((h) => h.mensaje.includes('no se evaluó'))).toBe(true);
  });
  it('la fecha de referencia es inyectada: la misma ficha cambia de resultado con otra fecha', () => {
    const f = clonar(fichaBase());
    f.operador!.vigenciaLicencia = '2026-12-01';
    expect(hay(validarFicha(f, { ...contextoBase(), ahora: '2026-11-23T10:00' }, CONFIG_PRUEBA), 'V04')).toBe(true);
    const f2 = clonar(fichaBase());
    f2.operador!.vigenciaLicencia = '2026-12-01';
    f2.cita = '2026-10-01T09:00';
    expect(validarFicha(f2, contextoBase(), CONFIG_PRUEBA).some((h) => h.id === 'V04' && h.severidad === 'bloqueo')).toBe(false);
  });
  it('no muta ficha ni contexto', () => {
    const f = fichaBase();
    const c = contextoBase();
    const [fc, cc] = [clonar(f), clonar(c)];
    validarFicha(f, c, CONFIG_PRUEBA);
    expect(f).toEqual(fc);
    expect(c).toEqual(cc);
  });
  it('los mensajes no repiten datos personales de la ficha', () => {
    const f = clonar(fichaBase());
    f.caja!.placas = 'ZZZ999';
    f.operador!.vigenciaLicencia = '2026-01-01';
    f.operador!.celular = '555';
    const c = clonar(contextoBase());
    c.destinatario = { id: 'otro', verificado: false };
    const texto = JSON.stringify(validarFicha(f, c, CONFIG_PRUEBA));
    for (const dato of ['ZZZ999', 'AAA123', 'BBB456', 'LIC-0001', 'Operador Uno', '2899900011', 'GAF-1']) expect(texto).not.toContain(dato);
  });
  it('destinatario no autorizado con datos del operador: P01', () => {
    const c = clonar(contextoBase());
    c.destinatario = { id: 'otro', verificado: true };
    expect(hay(validarFicha(fichaBase(), c, CONFIG_PRUEBA), 'P01')).toBe(true);
  });
});

describe('API de cambio, pool, programa y solicitud', () => {
  it('validarCambio devuelve V07 ordenado', () => {
    const d = clonar(fichaBase());
    d.unidad!.eco = 'T-99';
    expect(validarCambio(fichaBase(), d, contextoBase())[0].id).toBe('V07');
  });
  it('validarPool detecta duplicados', () => {
    const hs = validarPool([{ caja: 'XX-1', dia: '2026-11-24' }, { caja: 'XX-1', dia: '2026-11-24' }], { ahora: '2026-11-23T10:00' });
    expect(hs[0].id).toBe('V06');
  });
  it('validarProgramaVersiones devuelve V15', () => {
    expect(validarProgramaVersiones([{ hora: '08:00' }], [{ hora: '08:00' }, { hora: '09:00' }])[0].id).toBe('V15');
  });
  it('validarSolicitudDatosOperador falla cerrado', () => {
    expect(validarSolicitudDatosOperador({ id: 'x', verificado: true }, {})[0].id).toBe('P01');
    expect(validarSolicitudDatosOperador({ id: 'c', verificado: true }, { listaBlancaDatosOperador: ['c'] })).toEqual([]);
  });
});

// ── Cobertura V01-V21 ───────────────────────────────────────────────────────
type Caso = { positivo: () => Hallazgo[]; negativo: () => Hallazgo[] };
const base = () => ({ f: clonar(fichaBase()), c: clonar(contextoBase()) });
const ficha = (mut: (f: ReturnType<typeof fichaBase>, c: ReturnType<typeof contextoBase>) => void) => () => {
  const { f, c } = base();
  mut(f, c);
  return validarFicha(f, c, CONFIG_PRUEBA);
};
const limpio = () => validarFicha(fichaBase(), contextoBase(), CONFIG_PRUEBA);

const CASOS: Record<IdValidacion, Caso> = {
  V01: { positivo: ficha((f) => { f.caja!.placas = 'AAA999'; }), negativo: limpio },
  V02: { positivo: ficha((f) => { f.cajaCitada = 'XX-2140'; }), negativo: limpio },
  V03: { positivo: ficha((f) => { f.ref = 'REF-9999'; }), negativo: limpio },
  V04: { positivo: ficha((f) => { f.operador!.vigenciaLicencia = '2026-11-01'; }), negativo: limpio },
  V05: { positivo: ficha((f) => { f.fechas = [{ campo: 'cita', texto: '2026-11-01' }]; }), negativo: limpio },
  V06: {
    positivo: () => validarPool([{ caja: 'XX-1', dia: '2026-11-24' }, { caja: 'XX-1', dia: '2026-11-24' }], { ahora: '2026-11-23T10:00' }),
    negativo: () => validarPool([{ caja: 'XX-1', dia: '2026-11-24' }, { caja: 'XX-2', dia: '2026-11-24' }], { ahora: '2026-11-23T10:00' }),
  },
  V07: { positivo: ficha((f) => { f.unidad!.eco = 'T-99'; }), negativo: limpio },
  V08: { positivo: ficha((_f, c) => { c.documentos = [{ tipo: 'ccp', caja: 'XX-9000' }]; }), negativo: limpio },
  V09: { positivo: ficha((f) => { f.selloFoto = '49806'; }), negativo: limpio },
  V10: { positivo: ficha((f) => { delete f.unidad!.eco; }), negativo: limpio },
  V11: { positivo: ficha((f) => { f.planta = 'PLANTA-B'; }), negativo: limpio },
  V12: { positivo: ficha((f) => { f.operador!.estado = 'descanso'; }), negativo: limpio },
  V13: { positivo: ficha((f) => { f.ce!.venceEn = '2026-11-23T09:00'; }), negativo: limpio },
  V14: { positivo: ficha((f) => { f.eta!.valor = '2026-11-23T09:00'; }), negativo: limpio },
  V15: {
    positivo: () => validarProgramaVersiones([{ hora: '08:00' }], [{ hora: '08:00' }, { hora: '09:00' }]),
    negativo: () => validarProgramaVersiones([{ hora: '08:00' }], [{ hora: '08:00' }]),
  },
  V16: { positivo: ficha((_f, c) => { c.pod = { clasificacion: 'cp_sellada', recibidos: [] }; }), negativo: limpio },
  V17: { positivo: ficha((f) => { f.avc!.gafete = 'GAF-9'; }), negativo: limpio },
  V18: { positivo: ficha((_f, c) => { c.vigencias = [{ tipo: 'poliza', hasta: '2026-11-01' }]; }), negativo: limpio },
  V19: { positivo: ficha((f) => { f.movimiento = { tipo: 'cruce', fechaHora: '2026-11-29T10:00' }; }), negativo: limpio },
  V20: { positivo: ficha((_f, c) => { c.evidenciaSalida = { fotos: [] }; }), negativo: limpio },
  V21: { positivo: ficha((_f, c) => { c.correo = { de: 'a@flota.test', para: ['b@cliente.test'], cc: [] }; }), negativo: limpio },
};

describe('cobertura V01-V21', () => {
  it('el catálogo tiene exactamente V01-V21, sin repetir, con familia, ámbito y entradas', () => {
    expect(CATALOGO_VALIDACIONES.map((e) => e.id)).toEqual([...IDS_VALIDACION]);
    expect(IDS_VALIDACION).toHaveLength(21);
    for (const e of CATALOGO_VALIDACIONES) {
      expect(e.nombre.length).toBeGreaterThan(3);
      expect(e.entradas.length).toBeGreaterThan(0);
    }
  });
  it('hay un caso positivo y uno negativo para cada validación', () => {
    expect(Object.keys(CASOS).sort()).toEqual([...IDS_VALIDACION].sort());
  });
  it.each(IDS_VALIDACION.map((id) => [id]))('%s: el caso positivo la dispara y el limpio no', (id) => {
    const caso = CASOS[id as IdValidacion];
    expect(hay(caso.positivo(), id)).toBe(true);
    expect(hay(caso.negativo(), id)).toBe(false);
  });
  it('cada familia tiene al menos una validación', () => {
    const familias = new Set(CATALOGO_VALIDACIONES.map((e) => e.familia));
    expect([...familias].sort()).toEqual(['cambios_prealerta', 'documentos_sellos', 'fechas_horarios', 'personas_licencias', 'placas_cajas', 'privacidad_identidad']);
  });
});
