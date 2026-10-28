import { describe, expect, it } from 'vitest';
import { ControladorTour, rutaCoincide } from './controlador';
import { AnfitrionFalso, ElementoFalso } from './anfitrion_falso';
import { borrarGuardado, claveTour, leerGuardado } from './persistencia';
import type { Recorrido } from './tipos';

// Recorrido SINTÉTICO de prueba (no es contenido de producto).
const R: Recorrido = {
  id: 'demo', version: 1, titulo: 'Recorrido de prueba',
  pasos: [
    { id: 'p1', titulo: 'Bienvenida', texto: 'Así se ve.' },
    { id: 'p2', ancla: 'demo.subir', ruta: '/dashboard/conexiones', titulo: 'Sube el archivo', texto: 'Muestra.',
      accion: { verbo: 'Aprieta', objetivo: 'Subir archivo' }, avance: { tipo: 'accion', evento: 'click' } },
    { id: 'p3', ancla: 'demo.estado', ruta: '/dashboard/conexiones', titulo: 'Estado', texto: 'Aquí ves el avance.' },
    { id: 'p4', ancla: 'demo.fin', ruta: '/dashboard/agentes/liquidacion', titulo: 'Liquidación', texto: 'Fin.' },
  ],
};

function montar(op: Partial<ConstructorParameters<typeof ControladorTour>[2]> = {}, recorrido = R) {
  const host = new AnfitrionFalso();
  const c = new ControladorTour(recorrido, host, { ambito: 'u1', ...op });
  return { host, c };
}

describe('pasos y navegación', () => {
  it('nunca arranca solo; iniciar() deja el primer paso activo', () => {
    const { c } = montar();
    expect(c.instantanea().fase).toBe('inactivo');
    c.iniciar();
    const s = c.instantanea();
    expect(s.fase).toBe('activo');
    expect(s.paso?.id).toBe('p1');
    expect(s.total).toBe(4);
    expect(s.esPrimero).toBe(true);
    expect(s.anclaLista).toBe(true); // paso centrado
  });

  it('«Siguiente» lleva a la persona a la ruta del paso SOLO al avanzar, y resalta al llegar', () => {
    const { host, c } = montar();
    c.iniciar();
    expect(host.destinos).toEqual([]); // abrir no navega
    c.siguiente();
    expect(host.destinos).toEqual(['/dashboard/conexiones']);
    expect(c.instantanea().navegando).toBe(true);
    host.anclas.set('demo.subir', new ElementoFalso());
    host.llegarA('/dashboard/conexiones');
    c.alCambiarRuta();
    const s = c.instantanea();
    expect(s.navegando).toBe(false);
    expect(s.anclaLista).toBe(true);
    expect(c.elementoActual).toBe(host.anclas.get('demo.subir'));
    expect(host.anclas.get('demo.subir')!.enVista).toBe(1);
  });

  it('si la persona ya está en la ruta no navega', () => {
    const { host, c } = montar();
    host.ruta = '/dashboard/conexiones';
    host.anclas.set('demo.subir', new ElementoFalso());
    c.iniciar(1);
    expect(host.destinos).toEqual([]);
    expect(c.instantanea().paso?.id).toBe('p2');
  });

  it('el ancla que tarda en aparecer se espera; si nunca aparece, el paso sigue guiado centrado', () => {
    const { host, c } = montar({ esperaAnclaMs: 600 });
    host.ruta = '/dashboard/conexiones';
    c.iniciar(1);
    expect(c.instantanea().anclaLista).toBeNull();
    host.tic(300);
    host.anclas.set('demo.subir', new ElementoFalso());
    host.tic(300);
    expect(c.instantanea().anclaLista).toBe(true);

    const b = montar({ esperaAnclaMs: 600 });
    b.host.ruta = '/dashboard/conexiones';
    b.c.iniciar(1);
    b.host.tic(1000);
    expect(b.c.instantanea().anclaLista).toBe(false);
    expect(b.c.instantanea().paso?.texto).toBe('Muestra.'); // texto disponible aunque no haya foco
  });

  it('si la ruta nunca confirma, el seguro busca igual', () => {
    const { host, c } = montar({ esperaAnclaMs: 500 });
    c.iniciar();
    c.siguiente();
    expect(c.instantanea().navegando).toBe(true);
    host.tic(600);
    expect(c.instantanea().navegando).toBe(false);
  });

  it('Atrás vuelve un paso y no pasa del primero; el último «Siguiente» termina', () => {
    const { host, c } = montar();
    host.ruta = '/dashboard/conexiones';
    host.anclas.set('demo.subir', new ElementoFalso());
    host.anclas.set('demo.estado', new ElementoFalso());
    c.iniciar();
    c.atras();
    expect(c.instantanea().indice).toBe(0);
    c.siguiente(); c.siguiente();
    expect(c.instantanea().paso?.id).toBe('p3');
    c.atras();
    expect(c.instantanea().paso?.id).toBe('p2');
    host.anclas.set('demo.fin', new ElementoFalso());
    c.siguiente(); c.siguiente();
    expect(c.instantanea().esUltimo).toBe(true);
    c.siguiente();
    expect(c.instantanea().fase).toBe('terminado');
    expect(leerGuardado(host.almacen, 'u1', R)?.estado).toBe('terminado');
  });

  it('rutaCoincide: exacta, con barra final, con query y comodín', () => {
    expect(rutaCoincide('/a/b/', '/a/b')).toBe(true);
    expect(rutaCoincide('/a/b?x=1', '/a/b')).toBe(true);
    expect(rutaCoincide('/a/b/c', '/a/b')).toBe(false);
    expect(rutaCoincide('/a/b/c', '/a/b/*')).toBe(true);
  });

  it('quita los pasos de rutas que el rol no puede ver', () => {
    const { c } = montar({ puedeVerRuta: (r) => r !== '/dashboard/agentes/liquidacion' });
    expect(c.total).toBe(3);
    c.iniciar(2);
    c.siguiente();
    expect(c.instantanea().fase).toBe('terminado'); // p4 (dinero) nunca se ofrece
  });
});

describe('avance por acción', () => {
  it('avanza cuando la persona hace la acción; «Siguiente» sigue valiendo', () => {
    const { host, c } = montar();
    host.ruta = '/dashboard/conexiones';
    const el = new ElementoFalso();
    host.anclas.set('demo.subir', el);
    host.anclas.set('demo.estado', new ElementoFalso());
    c.iniciar(1);
    expect(el.oyentesActivos()).toBe(1);
    el.disparar('click');
    host.tic(1);
    expect(c.instantanea().paso?.id).toBe('p3');
    expect(el.oyentesActivos()).toBe(0); // el oyente del paso viejo se soltó

    // y con «Siguiente» sin hacer la acción
    const b = montar();
    b.host.ruta = '/dashboard/conexiones';
    b.host.anclas.set('demo.subir', new ElementoFalso());
    b.host.anclas.set('demo.estado', new ElementoFalso());
    b.c.iniciar(1);
    b.c.siguiente();
    expect(b.c.instantanea().paso?.id).toBe('p3');
  });

  it('una acción tardía de un paso viejo no avanza el nuevo', () => {
    const { host, c } = montar();
    host.ruta = '/dashboard/conexiones';
    const el = new ElementoFalso();
    host.anclas.set('demo.subir', el);
    host.anclas.set('demo.estado', new ElementoFalso());
    c.iniciar(1);
    el.disparar('click'); // programa el avance
    c.siguiente();        // la persona avanza antes de que corra
    expect(c.instantanea().paso?.id).toBe('p3');
    host.tic(5);
    expect(c.instantanea().paso?.id).toBe('p3'); // no saltó a p4
  });
});

describe('saltar, más tarde, reanudar', () => {
  it('Saltar cierra, guarda omitido y no vuelve a abrirse solo', () => {
    const { host, c } = montar();
    c.iniciar();
    c.saltar();
    expect(c.instantanea().fase).toBe('omitido');
    expect(c.instantanea().paso).toBeNull();
    expect(leerGuardado(host.almacen, 'u1', R)?.estado).toBe('omitido');
  });

  it('Más tarde guarda el paso; un controlador nuevo reanuda donde se quedó', () => {
    const { host, c } = montar();
    host.ruta = '/dashboard/conexiones';
    host.anclas.set('demo.subir', new ElementoFalso());
    host.anclas.set('demo.estado', new ElementoFalso());
    c.iniciar(); c.siguiente(); c.siguiente();
    c.masTarde();
    expect(c.instantanea().fase).toBe('inactivo');
    const g = leerGuardado(host.almacen, 'u1', R)!;
    expect(g.estado).toBe('en_curso');
    expect(g.pasoId).toBe('p3');

    const c2 = new ControladorTour(R, host, { ambito: 'u1' });
    c2.reanudar();
    expect(c2.instantanea().paso?.id).toBe('p3');
  });

  it('un cambio de versión del recorrido descarta el progreso viejo', () => {
    const { host, c } = montar();
    c.iniciar(); c.masTarde();
    expect(leerGuardado(host.almacen, 'u1', { ...R, version: 2 })).toBeNull();
  });

  it('el ámbito aísla a dos personas en el mismo navegador', () => {
    const { host, c } = montar();
    c.iniciar(); c.saltar();
    expect(leerGuardado(host.almacen, 'otro-usuario', R)).toBeNull();
    expect(claveTour('u1', 'demo')).not.toBe(claveTour('u2', 'demo'));
  });

  it('soloLectura («viendo como») no escribe progreso', () => {
    const { host, c } = montar({ soloLectura: true });
    c.iniciar(); c.siguiente(); c.saltar();
    expect(host.datos.size).toBe(0);
  });

  it('reiniciar() olvida lo guardado y empieza de cero', () => {
    const { host, c } = montar();
    c.iniciar(); c.saltar();
    c.reiniciar();
    expect(c.instantanea().fase).toBe('activo');
    expect(c.instantanea().indice).toBe(0);
    expect(leerGuardado(host.almacen, 'u1', R)?.estado).toBe('en_curso');
    borrarGuardado(host.almacen, 'u1', 'demo');
    expect(leerGuardado(host.almacen, 'u1', R)).toBeNull();
  });

  it('un almacén que lanza o con JSON roto no rompe el recorrido', () => {
    const host = new AnfitrionFalso();
    host.almacen = { getItem: () => '{no es json', setItem: () => { throw new Error('cuota'); }, removeItem: () => { throw new Error('x'); } };
    const c = new ControladorTour(R, host, { ambito: 'u1' });
    expect(() => { c.iniciar(); c.siguiente(); c.saltar(); }).not.toThrow();
    expect(c.progreso()).toBeNull();
  });
});

describe('reduced-motion', () => {
  it('lo informa en la instantánea y los pasos siguen igual de guiados', () => {
    const { host, c } = montar();
    host.reducido = true;
    host.ruta = '/dashboard/conexiones';
    const el = new ElementoFalso();
    host.anclas.set('demo.subir', el);
    c.iniciar(1);
    const s = c.instantanea();
    expect(s.reducirMovimiento).toBe(true);
    expect(s.paso?.accion).toEqual({ verbo: 'Aprieta', objetivo: 'Subir archivo' });
    expect(s.anclaLista).toBe(true);
    expect(el.enVista).toBe(1);
  });
});

describe('suscripción', () => {
  it('notifica cambios y deja de hacerlo tras destruir()', () => {
    const { c } = montar();
    let n = 0;
    c.suscribir(() => { n++; });
    c.iniciar();
    expect(n).toBeGreaterThan(0);
    const antes = n;
    c.destruir();
    c.siguiente();
    expect(n).toBe(antes);
  });
});
