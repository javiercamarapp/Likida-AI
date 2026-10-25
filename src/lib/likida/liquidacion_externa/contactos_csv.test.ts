import { describe, it, expect } from 'vitest';
import {
  interpretarContactos, aplicarContactos, resumenContactos,
  type PuertoContactos, type OperadorContacto,
} from './contactos_csv';

// Todo sintético: dominio reservado .invalid, números de empleado inventados. grep-limpio:ok
const ENC = ['numero_empleado', 'correo', 'coordinador_nombre', 'coordinador_correo'];

/** Cinco filas: 1 ok, 1 sin operador, 1 correo inválido, 1 coordinador nuevo, 1 coordinador existente. */
const MATRIZ: unknown[][] = [
  ENC,
  ['E-001', 'op1@flota.invalid', '', ''], // grep-limpio:ok
  ['E-404', 'op404@flota.invalid', '', ''], // grep-limpio:ok
  ['E-003', 'esto-no-es-correo', '', ''],
  ['E-004', 'op4@flota.invalid', 'Coordinadora Nueva', 'nueva@coord.invalid'], // grep-limpio:ok
  ['E-005', 'op5@flota.invalid', 'Coordinador Viejo', 'VIEJO@coord.invalid'], // grep-limpio:ok
];

interface Mundo {
  operadores: Map<string, OperadorContacto & { telefono: string }>; // por número de empleado
  coordinadores: Map<string, { id: string; nombre: string | null }>; // por correo
  escrituras: Array<{ operadorId: string; cambios: Record<string, unknown> }>;
  bitacoraLlamadas: string[];
}

function mundoInicial(): Mundo {
  const op = (id: string) => ({ id, correo: null, coordinadorId: null, telefono: `tel-${id}` });
  return {
    operadores: new Map([
      ['E-001', op('op-1')], ['E-003', op('op-3')], ['E-004', op('op-4')], ['E-005', op('op-5')],
    ]),
    coordinadores: new Map([['viejo@coord.invalid', { id: 'coord-viejo', nombre: 'Coordinador Viejo' }]]), // grep-limpio:ok
    escrituras: [], bitacoraLlamadas: [],
  };
}

function puertoDe(m: Mundo): PuertoContactos {
  return {
    async buscarOperadores(numeros) {
      const out = new Map<string, OperadorContacto[]>();
      for (const n of numeros) {
        const o = m.operadores.get(n);
        if (o) out.set(n, [{ id: o.id, correo: o.correo, coordinadorId: o.coordinadorId }]);
      }
      return out;
    },
    async asegurarCoordinador({ correo, nombre }) {
      m.bitacoraLlamadas.push('asegurarCoordinador');
      const ya = m.coordinadores.get(correo);
      if (ya) return { id: ya.id, creado: false };
      const id = `coord-${m.coordinadores.size + 1}`;
      m.coordinadores.set(correo, { id, nombre });
      return { id, creado: true };
    },
    async guardarContacto(operadorId, cambios) {
      m.escrituras.push({ operadorId, cambios });
      const o = [...m.operadores.values()].find((x) => x.id === operadorId)!;
      if (cambios.correo !== undefined) o.correo = cambios.correo;
      if (cambios.coordinadorId !== undefined) o.coordinadorId = cambios.coordinadorId;
    },
  };
}

describe('interpretarContactos (pura)', () => {
  it('lee las 5 filas: 4 válidas y 1 con correo sin forma, con su número de fila', () => {
    const l = interpretarContactos(MATRIZ);
    expect(l.error).toBeUndefined();
    expect(l.filas.map((f) => f.numeroEmpleado)).toEqual(['E-001', 'E-404', 'E-004', 'E-005']);
    expect(l.invalidas).toHaveLength(1);
    expect(l.invalidas[0].fila).toBe(4);
    expect(l.invalidas[0].motivo).toMatch(/correo del operador/);
  });

  it('normaliza el correo (minúsculas, sin espacios) y acepta encabezados con acentos y mayúsculas', () => {
    const l = interpretarContactos([
      ['Número de Empleado', 'Correo Electrónico', 'Coordinador', 'Correo Coordinador'],
      ['E-9', '  OP9@Flota.Invalid ', 'Alguien', ' JEFE@Coord.Invalid '], // grep-limpio:ok
    ]);
    expect(l.error).toBeUndefined();
    expect(l.filas[0].correo).toBe('op9@flota.invalid');
    expect(l.filas[0].coordinadorCorreo).toBe('jefe@coord.invalid');
    expect(l.filas[0].coordinadorNombre).toBe('Alguien');
  });

  it('número de empleado numérico de Excel se lee como texto', () => {
    const l = interpretarContactos([ENC, [1042, 'a@b.invalid', '', '']]); // grep-limpio:ok
    expect(l.filas[0].numeroEmpleado).toBe('1042');
  });

  it('fila sin número de empleado, nombre de coordinador sin correo, fila sin datos y número repetido son inválidas', () => {
    const l = interpretarContactos([
      ENC,
      ['', 'a@b.invalid', '', ''], // grep-limpio:ok
      ['E-1', 'a@b.invalid', 'Sin Correo', ''], // grep-limpio:ok
      ['E-2', '', '', ''],
      ['E-3', 'c@d.invalid', '', ''], // grep-limpio:ok
      ['e-3', 'e@f.invalid', '', ''], // grep-limpio:ok
    ]);
    expect(l.filas.map((f) => f.numeroEmpleado)).toEqual(['E-3']);
    expect(l.invalidas.map((i) => i.fila)).toEqual([2, 3, 4, 6]);
    expect(l.invalidas[0].motivo).toMatch(/número de empleado/);
    expect(l.invalidas[1].motivo).toMatch(/nombre del coordinador/);
    expect(l.invalidas[2].motivo).toMatch(/nada que actualizar/);
    expect(l.invalidas[3].motivo).toMatch(/repetido en el archivo/);
  });

  it('A37-S48-06: dos operadores con el mismo correo ⇒ ninguna de las dos filas se aplica, sin mostrar el correo', () => {
    const l = interpretarContactos([ENC, ['E-1', 'x@buzon.invalid', '', ''], ['E-2', 'X@buzon.invalid', '', ''], ['E-3', 'y@buzon.invalid', '', '']]); // grep-limpio:ok
    expect(l.filas.map((f) => f.numeroEmpleado)).toEqual(['E-3']);
    expect(l.invalidas.map((i) => i.fila).sort()).toEqual([2, 3]);
    expect(l.invalidas[0].motivo).toMatch(/comparte el correo/);
    expect(JSON.stringify(l.invalidas)).not.toMatch(/\.invalid/);
  });

  it('archivo vacío, sin llave o sin columnas de correo ⇒ error en lenguaje llano', () => {
    expect(interpretarContactos([]).error).toMatch(/vacío/);
    expect(interpretarContactos([['nombre', 'correo'], ['x', 'y']]).error).toMatch(/número de empleado/);
    expect(interpretarContactos([['numero_empleado', 'nombre']]).error).toMatch(/nada que actualizar/);
  });

  it('una celda de correo vacía junto a un coordinador válido es una fila válida (solo coordinador)', () => {
    const l = interpretarContactos([ENC, ['E-1', '', 'Jefa', 'jefa@coord.invalid']]); // grep-limpio:ok
    expect(l.invalidas).toHaveLength(0);
    expect(l.filas[0].correo).toBeNull();
  });
});

describe('aplicarContactos', () => {
  it('5 filas ⇒ conteos exactos: 3 actualizados, 1 sin operador, 1 inválido, 1 coordinador nuevo', async () => {
    const m = mundoInicial();
    const inf = await aplicarContactos(interpretarContactos(MATRIZ), puertoDe(m));
    expect(inf.actualizados).toBe(3);
    expect(inf.sinOperador).toHaveLength(1);
    expect(inf.sinOperador[0].fila).toBe(3);
    expect(inf.invalidas).toHaveLength(1);
    expect(inf.ambiguos).toHaveLength(0);
    expect(inf.coordinadoresNuevos).toBe(1);
    expect(resumenContactos(inf)).toBe('3 actualizados / 1 sin operador / 1 inválidos / 1 coordinadores nuevos');
    // el operador inexistente NO se crea
    expect(m.operadores.has('E-404')).toBe(false);
    // coordinador existente reutilizado (mismo id, sin duplicar), nuevo asignado
    expect(m.operadores.get('E-005')!.coordinadorId).toBe('coord-viejo');
    expect(m.operadores.get('E-004')!.coordinadorId).toBe('coord-2');
    expect(m.coordinadores.size).toBe(2);
    expect(m.operadores.get('E-001')!.correo).toBe('op1@flota.invalid');
    // la fila inválida no tocó a su operador
    expect(m.operadores.get('E-003')!.correo).toBeNull();
  });

  it('es idempotente: re-subir el mismo archivo no escribe nada y todo cae en «sin cambios»', async () => {
    const m = mundoInicial();
    await aplicarContactos(interpretarContactos(MATRIZ), puertoDe(m));
    const escriturasTrasPrimera = m.escrituras.length;
    const inf2 = await aplicarContactos(interpretarContactos(MATRIZ), puertoDe(m));
    expect(m.escrituras.length).toBe(escriturasTrasPrimera);
    expect(inf2.actualizados).toBe(0);
    expect(inf2.sinCambios).toBe(3);
    expect(inf2.coordinadoresNuevos).toBe(0);
    expect(m.coordinadores.size).toBe(2);
  });

  it('no toca el teléfono ni escribe otra cosa que correo/coordinadorId', async () => {
    const m = mundoInicial();
    await aplicarContactos(interpretarContactos(MATRIZ), puertoDe(m));
    for (const e of m.escrituras) expect(Object.keys(e.cambios).every((k) => k === 'correo' || k === 'coordinadorId')).toBe(true);
    expect(m.operadores.get('E-001')!.telefono).toBe('tel-op-1');
  });

  it('un coordinador compartido por varias filas se pide una sola vez al puerto', async () => {
    const m = mundoInicial();
    const l = interpretarContactos([
      ENC,
      ['E-001', 'a@x.invalid', 'Jefa', 'jefa@coord.invalid'], // grep-limpio:ok
      ['E-003', 'b@x.invalid', 'Jefa', 'jefa@coord.invalid'], // grep-limpio:ok
      ['E-004', 'c@x.invalid', '', 'jefa@coord.invalid'], // grep-limpio:ok
    ]);
    const inf = await aplicarContactos(l, puertoDe(m));
    expect(m.bitacoraLlamadas).toEqual(['asegurarCoordinador']);
    expect(inf.coordinadoresNuevos).toBe(1);
    expect(inf.actualizados).toBe(3);
  });

  it('un número de empleado repetido en la flota se reporta como ambiguo y no se adivina', async () => {
    const m = mundoInicial();
    const puerto = puertoDe(m);
    puerto.buscarOperadores = async () => new Map([['E-001', [
      { id: 'a', correo: null, coordinadorId: null }, { id: 'b', correo: null, coordinadorId: null },
    ]]]);
    const inf = await aplicarContactos(interpretarContactos([ENC, ['E-001', 'a@x.invalid', '', '']]), puerto); // grep-limpio:ok
    expect(inf.ambiguos).toHaveLength(1);
    expect(inf.actualizados).toBe(0);
    expect(m.escrituras).toHaveLength(0);
    expect(resumenContactos(inf)).toMatch(/1 con número repetido/);
  });

  it('un correo vacío no borra el que el operador ya tenía', async () => {
    const m = mundoInicial();
    m.operadores.get('E-001')!.correo = 'previo@flota.invalid'; // grep-limpio:ok
    await aplicarContactos(interpretarContactos([ENC, ['E-001', '', 'Jefa', 'jefa@coord.invalid']]), puertoDe(m)); // grep-limpio:ok
    expect(m.operadores.get('E-001')!.correo).toBe('previo@flota.invalid');
    expect(m.operadores.get('E-001')!.coordinadorId).toBe('coord-2');
  });

  it('A37-S48-06: el correo que ya usa otro operador de la flota NO se escribe (se calcula antes de guardar)', async () => {
    const m = mundoInicial();
    const puerto = puertoDe(m);
    puerto.correosEnUsoPorOtros = async (correos) => new Set(correos.filter((c) => c === 'op4@flota.invalid')); // grep-limpio:ok
    const inf = await aplicarContactos(interpretarContactos(MATRIZ), puerto);
    // E-004 (fila 5) no se tocó: ni su correo ni su coordinador.
    expect(m.escrituras.some((e) => e.operadorId === 'op-4')).toBe(false);
    const inv = inf.invalidas.find((i) => i.fila === 5);
    expect(inv?.motivo).toMatch(/ya lo usa otro operador/);
    expect(JSON.stringify(inf)).not.toMatch(/\.invalid/);
    // El resto sí se aplicó.
    expect(m.escrituras.some((e) => e.operadorId === 'op-1')).toBe(true);
  });

  it('A37-S48-06: si la consulta de choques falla, no se escribe nada (fail-closed)', async () => {
    const m = mundoInicial();
    const puerto = puertoDe(m);
    puerto.correosEnUsoPorOtros = async () => { throw new Error('base caída'); };
    await expect(aplicarContactos(interpretarContactos(MATRIZ), puerto)).rejects.toThrow('base caída');
    expect(m.escrituras).toHaveLength(0);
  });

  it('el informe y los avisos jamás incluyen un correo', async () => {
    const m = mundoInicial();
    const inf = await aplicarContactos(interpretarContactos(MATRIZ), puertoDe(m));
    const todo = JSON.stringify([inf.invalidas, inf.sinOperador, inf.ambiguos, inf.advertencias, resumenContactos(inf)]);
    expect(todo).not.toMatch(/\.invalid/);
  });

  it('estado vacío: sin filas utilizables dice por qué, sin llamar al puerto', async () => {
    const m = mundoInicial();
    let llamado = false;
    const puerto = { ...puertoDe(m), buscarOperadores: async () => { llamado = true; return new Map(); } };
    const inf = await aplicarContactos(interpretarContactos([]), puerto);
    expect(llamado).toBe(false);
    expect(resumenContactos(inf)).toMatch(/vacío/);
  });

  it('un fallo del puerto al guardar se propaga: no se finge haber guardado', async () => {
    const m = mundoInicial();
    const puerto = { ...puertoDe(m), guardarContacto: async () => { throw new Error('base caída'); } };
    await expect(aplicarContactos(interpretarContactos(MATRIZ), puerto)).rejects.toThrow('base caída');
  });
});
