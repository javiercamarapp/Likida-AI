import { describe, it, expect } from 'vitest';
import { armarMensajeAcercamiento, armarMensajeDespacho, piezaPlantilla, responderPerfil, seleccionar, temaDePregunta } from './mensajes';
import { leerFoto, type Instruccion } from './tipos';
import { textoRenderizado } from '@/lib/meta/plantillas_catalogo';

const I = (categoria: Instruccion['categoria'], texto: string, momento: Instruccion['momento'] = 'ambos', lugar: Instruccion['lugar'] = 'ambos', orden = 0): Instruccion =>
  ({ categoria, texto, momento, lugar, orden });

const FOTO: Instruccion[] = [
  I('puerta', 'Puerta 3, lado poniente', 'ambos', 'destino', 1),
  I('reportarse', 'Con el jefe de andén, Sr. Ramírez', 'acercamiento', 'destino', 2),
  I('documentos', 'Carta porte y orden de compra', 'despacho', 'ambos', 3),
  I('peculiaridad', 'Solo recibe de 6 a 14 h', 'ambos', 'origen', 0),
];
const CTX = { operadorNombre: 'Juan Pérez', folio: 'F-1042', origen: 'Planta Zapopan', destino: 'CEDIS Tlaquepaque' };

describe('seleccionar', () => {
  it('el despacho trae las de despacho y ambos, de las dos plantas, en orden', () => {
    expect(seleccionar(FOTO, 'despacho').map((i) => i.categoria)).toEqual(['peculiaridad', 'puerta', 'documentos']);
  });
  it('el acercamiento trae solo las de ESA planta y del momento', () => {
    expect(seleccionar(FOTO, 'acercamiento', 'destino').map((i) => i.categoria)).toEqual(['puerta', 'reportarse']);
    expect(seleccionar(FOTO, 'acercamiento', 'origen').map((i) => i.categoria)).toEqual(['peculiaridad']);
  });
});

describe('armarMensajeDespacho', () => {
  it('lleva el nombre de pila, el folio, la ruta y el lado de cada instrucción', () => {
    const m = armarMensajeDespacho(CTX, FOTO)!;
    expect(m.texto).toContain('Hola Juan,');
    expect(m.texto).toContain('F-1042');
    expect(m.texto).toContain('Planta Zapopan → CEDIS Tlaquepaque');
    expect(m.texto).toContain('Al descargar: Puerta 3, lado poniente');
    expect(m.texto).toContain('Al cargar: Solo recibe de 6 a 14 h');
    expect(m.texto).not.toContain('jefe de andén'); // esa es solo de acercamiento
  });
  it('la versión de plantilla va en UNA línea y cuadra con el catálogo (4 variables)', () => {
    const m = armarMensajeDespacho(CTX, FOTO)!;
    expect(m.plantilla.nombre).toBe('convenio_instrucciones_despacho_v1');
    expect(m.plantilla.parametros).toHaveLength(4);
    for (const p of m.plantilla.parametros ?? []) expect(p).not.toMatch(/[\n\t]|\s{4}/);
    expect(textoRenderizado('convenio_instrucciones_despacho_v1', m.plantilla.parametros as string[])).toContain('Por dónde entras');
  });
  it('sin instrucciones de despacho no manda nada', () => {
    expect(armarMensajeDespacho(CTX, [I('reportarse', 'x', 'acercamiento')])).toBeNull();
    expect(armarMensajeDespacho(CTX, [])).toBeNull();
  });
  it('un nombre ausente no se inventa: «chofer»', () => {
    expect(armarMensajeDespacho({ ...CTX, operadorNombre: null }, FOTO)!.texto).toContain('Hola chofer,');
  });
});

describe('armarMensajeAcercamiento', () => {
  it('nombra la planta a la que se acerca y solo trae sus instrucciones', () => {
    const m = armarMensajeAcercamiento(CTX, FOTO, 'destino')!;
    expect(m.texto).toContain('ya vas llegando a CEDIS Tlaquepaque');
    expect(m.texto).toContain('Puerta 3');
    expect(m.texto).toContain('Sr. Ramírez');
    expect(m.texto).not.toContain('6 a 14');
    expect(m.plantilla.nombre).toBe('convenio_instrucciones_acercamiento_v1');
  });
  it('sin nada para esa planta, null', () => {
    expect(armarMensajeAcercamiento(CTX, [I('documentos', 'x', 'despacho')], 'destino')).toBeNull();
  });
});

describe('piezaPlantilla', () => {
  it('se acota para no pasar el tope del parámetro de Meta', () => {
    const largas = Array.from({ length: 10 }, (_, n) => I('otro', `${'x'.repeat(390)}${n}`));
    expect(piezaPlantilla(largas, false).length).toBeLessThanOrEqual(700);
  });
});

describe('temaDePregunta', () => {
  it.each([
    ['¿Por dónde entro?', 'puerta'], ['por donde entro', 'puerta'], ['qué puerta es', 'puerta'], ['Por cuál puerta me meto?', 'puerta'],
    ['¿con quién me reporto?', 'reportarse'], ['a quién me presento', 'reportarse'],
    ['¿qué documentos llevo?', 'documentos'], ['que papeles piden', 'documentos'],
    ['¿qué horario tienen?', 'horario'], ['qué instrucciones tengo', 'todo'],
  ])('%s → %s', (texto, tema) => expect(temaDePregunta(texto)).toBe(tema));
  it.each(['ya llegué', 'listo', 'por donde voy a cobrar el flete de este viaje y que pasa con mi anticipo del mes pasado cuando me pagan', 'me ponché una llanta', ''])(
    'no reconoce «%s»', (texto) => expect(temaDePregunta(texto)).toBeNull(),
  );
});

describe('responderPerfil', () => {
  it('responde con lo que dice el perfil y nada más', () => {
    const r = responderPerfil(FOTO, 'puerta', 'destino');
    expect(r.sinDatos).toBe(false);
    expect(r.texto).toBe('• Por dónde entras: Puerta 3, lado poniente');
  });
  it('sin lado conocido muestra de qué planta es cada una', () => {
    expect(responderPerfil(FOTO, 'puerta', null).texto).toContain('Al descargar: Puerta 3');
  });
  it('sin datos del tema lo dice y remite al jefe de tráfico (no inventa)', () => {
    const r = responderPerfil(FOTO, 'seguridad', 'destino');
    expect(r.sinDatos).toBe(true);
    expect(r.texto).toMatch(/No tengo .*seguridad.*jefe de tráfico/);
    expect(responderPerfil([], 'todo', null).sinDatos).toBe(true);
  });
  it('«todo» junta todas las del lado', () => {
    expect(responderPerfil(FOTO, 'todo', 'destino').texto.split('\n')).toHaveLength(3);
  });
});

describe('leerFoto', () => {
  it('descarta filas raras en vez de tronar', () => {
    const f = leerFoto([{ categoria: 'puerta', texto: '  Puerta   3 ' }, { categoria: 'inventada', texto: 'x' }, null, 'x', { categoria: 'otro', texto: '   ' }]);
    expect(f).toEqual([{ categoria: 'puerta', texto: 'Puerta 3', momento: 'ambos', lugar: 'ambos', orden: 0 }]);
    expect(leerFoto('no es arreglo')).toEqual([]);
  });
});
