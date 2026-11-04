import { describe, expect, it } from 'vitest';
import { ControladorTour } from './controlador';
import { AnfitrionFalso, ElementoFalso } from './anfitrion_falso';
import { AVANCE_TRAS_HECHO_MS, resolverBase, resolverSondeo, retardoDeSondeo } from './espera';
import { validarRecorrido } from './validar';
import type { EventoControlador, Recorrido } from './tipos';

const R: Recorrido = {
  id: 'hacer', version: 1, titulo: 'Con acción real',
  pasos: [
    { id: 'h1', ancla: 'demo.conectar', ruta: '/dashboard', titulo: 'Conecta tu sistema', texto: 'Conecta y prueba.', tipo: 'hacer',
      accion: { verbo: 'Aprieta', objetivo: 'Probar conexión' }, deteccion: { via: 'senal', senal: 'tms_probada', modo: 'cambia' }, tiempoLimiteMs: 30_000 },
    { id: 'h2', titulo: 'Sigue', texto: 'Otro paso.' },
    { id: 'h3', titulo: 'Fin', texto: 'Listo.', tipo: 'cierre' },
  ],
};
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function montar(recorrido = R, op: { soloLectura?: boolean } = {}) {
  const host = new AnfitrionFalso();
  host.anclas.set('demo.conectar', new ElementoFalso());
  const eventos: EventoControlador[] = [];
  const c = new ControladorTour(recorrido, host, { ambito: 'u1', alEvento: (e) => eventos.push(e), ...op });
  return { host, c, eventos };
}

describe('reglas puras', () => {
  it('línea base: verdadera = ya hecho; falsa = espera; ilegible = sin dato', () => {
    expect(resolverBase({ estado: 'si' })).toBe('ya_hecho');
    expect(resolverBase({ estado: 'no' })).toBe('esperando');
    expect(resolverBase({ estado: 'sin_dato' })).toBe('sin_dato');
  });
  it('sondeo: un bache (sin_dato) no cuenta; «cambia» exige pasar de no a sí o que el conteo suba', () => {
    expect(resolverSondeo({ estado: 'no' }, { estado: 'sin_dato' }, 'cambia')).toBe('esperando');
    expect(resolverSondeo({ estado: 'no' }, { estado: 'si' }, 'cambia')).toBe('hecho');
    expect(resolverSondeo({ estado: 'si', n: 2 }, { estado: 'si', n: 2 }, 'cambia')).toBe('esperando');
    expect(resolverSondeo({ estado: 'si', n: 2 }, { estado: 'si', n: 3 }, 'cambia')).toBe('hecho');
    expect(resolverSondeo({ estado: 'si', n: 2 }, { estado: 'si', n: 2 }, 'existe')).toBe('hecho');
  });
  it('retardos 3, 6 y 10 s y luego cada 15 s', () => {
    expect([0, 1, 2, 3, 4, 9].map(retardoDeSondeo)).toEqual([3000, 6000, 10_000, 15_000, 15_000, 15_000]);
  });
});

describe('paso «hacer» por señal', () => {
  it('con la señal ya verdadera queda «ya hecho», no avanza solo y no se hace esperar', async () => {
    const { host, c, eventos } = montar();
    host.senales.set('tms_probada', { estado: 'si' });
    c.iniciar();
    await flush();
    expect(c.instantanea().espera).toEqual({ estado: 'ya_hecho', evidencia: 'medido', declarable: false });
    host.tic(60_000);
    await flush();
    expect(c.instantanea().paso?.id).toBe('h1');
    expect(eventos.map((e) => e.tipo)).toEqual(['paso_visto', 'paso_ya_hecho']);
    c.siguiente();
    expect(c.resultados().hechos).toEqual(['h1']);
    expect(c.resultados().omitidos).toEqual([]);
  });

  it('espera, sondea a los 3 s y avanza 600 ms después de que la señal cambia, con evidencia medida', async () => {
    const { host, c, eventos } = montar();
    let hecha = false;
    host.senales.set('tms_probada', () => ({ estado: hecha ? 'si' : 'no' }));
    c.iniciar();
    await flush();
    expect(c.instantanea().espera?.estado).toBe('esperando');
    expect(host.lecturas).toHaveLength(1);
    hecha = true;
    host.tic(3000);
    await flush();
    expect(c.instantanea().espera).toEqual({ estado: 'hecho', evidencia: 'medido', declarable: false });
    expect(c.instantanea().paso?.id).toBe('h1'); // aún no avanza: la etiqueta dice «Hecho»
    host.tic(AVANCE_TRAS_HECHO_MS);
    await flush();
    expect(c.instantanea().paso?.id).toBe('h2');
    expect(eventos.map((e) => e.tipo)).toEqual(['paso_visto', 'paso_hecho_senal', 'paso_visto']);
    expect(c.resultados()).toEqual({ hechos: ['h1'], confirmados: [], omitidos: [] });
  });

  it('el sondeo no es un intervalo perpetuo: tras el hecho no hay más lecturas', async () => {
    const { host, c } = montar();
    let hecha = false;
    host.senales.set('tms_probada', () => ({ estado: hecha ? 'si' : 'no' }));
    c.iniciar();
    await flush();
    hecha = true;
    host.tic(3000);
    await flush();
    const n = host.lecturas.length;
    host.tic(120_000);
    await flush();
    expect(host.lecturas.length).toBe(n);
  });

  it('un bache de lectura no cierra el paso; sigue esperando con los retardos siguientes', async () => {
    const { host, c } = montar();
    let paso = 0;
    host.senales.set('tms_probada', () => { paso++; return paso === 1 ? { estado: 'no' } : paso < 4 ? { estado: 'sin_dato' } : { estado: 'si' }; });
    c.iniciar();
    await flush();
    host.tic(3000); await flush();
    expect(c.instantanea().espera?.estado).toBe('esperando');
    host.tic(6000); await flush();
    expect(c.instantanea().espera?.estado).toBe('esperando');
    host.tic(10_000); await flush();
    expect(c.instantanea().espera?.estado).toBe('hecho');
  });

  it('avanzar con «Siguiente» antes de que se cumpla lo deja «omitido» (no aprendido)', async () => {
    const { host, c, eventos } = montar();
    host.senales.set('tms_probada', { estado: 'no' });
    c.iniciar();
    await flush();
    c.siguiente();
    expect(c.resultados()).toEqual({ hechos: [], confirmados: [], omitidos: ['h1'] });
    expect(eventos.map((e) => e.tipo)).toContain('paso_omitido');
  });

  it('tras el tiempo límite pasa a «sin dato» y ofrece «Ya lo hice»; lo declarado se rotula confirmado, nunca medido', async () => {
    const { host, c, eventos } = montar();
    host.senales.set('tms_probada', { estado: 'no' });
    c.iniciar();
    await flush();
    expect(c.instantanea().espera?.declarable).toBe(false);
    c.declarar(); // todavía no se puede
    expect(c.instantanea().espera?.estado).toBe('esperando');
    host.tic(30_000);
    await flush();
    expect(c.instantanea().espera).toEqual({ estado: 'sin_dato', evidencia: null, declarable: true });
    c.declarar();
    expect(c.instantanea().espera).toEqual({ estado: 'hecho', evidencia: 'confirmado', declarable: false });
    expect(c.resultados()).toEqual({ hechos: [], confirmados: ['h1'], omitidos: [] });
    expect(eventos.map((e) => e.tipo)).toContain('paso_hecho_confirmado');
    expect(eventos.map((e) => e.tipo)).not.toContain('paso_hecho_senal');
  });

  it('sin lector de señales (o con error) el paso queda en sin dato y declarable desde el inicio', async () => {
    const { host, c } = montar();
    host.leerSenal = async () => { throw new Error('caído'); };
    c.iniciar();
    await flush();
    expect(c.instantanea().espera).toEqual({ estado: 'sin_dato', evidencia: null, declarable: true });
    const sin = new AnfitrionFalso();
    const c2 = new ControladorTour(R, sin, { ambito: 'u2' });
    (sin as { leerSenal?: unknown }).leerSenal = undefined;
    sin.anclas.set('demo.conectar', new ElementoFalso());
    c2.iniciar();
    expect(c2.instantanea().espera?.estado).toBe('sin_dato');
  });

  it('«sondear» (al volver a la pestaña) relee una vez y no crea otro temporizador', async () => {
    const { host, c } = montar();
    let hecha = false;
    host.senales.set('tms_probada', () => ({ estado: hecha ? 'si' : 'no' }));
    c.iniciar();
    await flush();
    hecha = true;
    c.sondear();
    await flush();
    expect(c.instantanea().espera?.estado).toBe('hecho');
  });

  it('cambiar de paso invalida las esperas viejas', async () => {
    const { host, c } = montar();
    let hecha = false;
    host.senales.set('tms_probada', () => ({ estado: hecha ? 'si' : 'no' }));
    c.iniciar();
    await flush();
    c.siguiente();
    hecha = true;
    host.tic(60_000);
    await flush();
    expect(c.instantanea().paso?.id).toBe('h2');
    expect(c.resultados().hechos).toEqual([]);
  });

  it('en solo lectura («ver como») no emite eventos', async () => {
    const { host, c, eventos } = montar(R, { soloLectura: true });
    host.senales.set('tms_probada', { estado: 'si' });
    c.iniciar();
    await flush();
    expect(eventos).toEqual([]);
  });

  it('un paso «declarada» muestra «Ya lo hice» desde el inicio', async () => {
    const r: Recorrido = { id: 'd', version: 1, titulo: 'd', pasos: [{ id: 'd1', titulo: 'Equipo', texto: 'Quien lleva las cuentas.', tipo: 'hacer', accion: { verbo: 'Invita', objetivo: 'Tu contador' }, deteccion: { via: 'declarada', clave: 'equipo' } }] };
    const { c } = montar(r);
    c.iniciar();
    expect(c.instantanea().espera).toEqual({ estado: 'esperando', evidencia: null, declarable: true });
  });
});

describe('validarRecorrido con pasos «hacer»', () => {
  it('exige detección y la frase de acción; la detección solo va en hacer/practicar', () => {
    const base = { titulo: 'T', texto: 'x' };
    const r = (pasos: Recorrido['pasos']): Recorrido => ({ id: 'v', version: 1, titulo: 'v', pasos });
    expect(validarRecorrido(r([{ id: 'a', ...base, tipo: 'hacer', accion: { verbo: 'Aprieta', objetivo: 'X' } }])).join()).toContain('detección');
    expect(validarRecorrido(r([{ id: 'a', ...base, tipo: 'hacer', deteccion: { via: 'declarada', clave: 'k' } }])).join()).toContain('UNA acción');
    expect(validarRecorrido(r([{ id: 'a', ...base, tipo: 'info', deteccion: { via: 'declarada', clave: 'k' } }])).join()).toContain('solo los pasos');
    expect(validarRecorrido(r([{ id: 'a', ...base, tipo: 'hacer', accion: { verbo: 'Aprieta', objetivo: 'X' }, deteccion: { via: 'senal', senal: 's', modo: 'cambia' } }]))).toEqual([]);
  });
});
