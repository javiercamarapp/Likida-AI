/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnfitrionFalso, ElementoFalso } from './anfitrion_falso';
import { ControladorTour } from './controlador';
import { colocarGlobo } from './geometria';
import { GloboTour } from './globo';
import type { Instantanea, Recorrido } from './tipos';
import { validarRecorrido } from './validar';
import { debeOcultar, Revelar } from '../revelar';

const R: Recorrido = {
  id: 'demo', version: 1, titulo: 'Prueba',
  pasos: [
    { id: 'a', ancla: 'demo.subir', titulo: 'Sube el archivo', texto: 'Una muestra basta.', escena: 'conexion-tms',
      accion: { verbo: 'Aprieta', objetivo: 'Subir archivo' }, avance: { tipo: 'accion', evento: 'click' } },
    { id: 'b', titulo: 'Listo', texto: 'Ya está.', escena: 'listo' },
  ],
};

function snap(p: Partial<Instantanea> = {}): Instantanea {
  return { fase: 'activo', indice: 0, total: 2, paso: R.pasos[0], anclaLista: true, navegando: false, reducirMovimiento: false, esPrimero: true, esUltimo: false, ...p };
}
const col = colocarGlobo({ x: 300, y: 100, w: 120, h: 32 }, { w: 340, h: 240 }, { w: 1280, h: 800 });
const noop = () => {};
const props = { col, onSiguiente: noop, onAtras: noop, onSaltar: noop, onMasTarde: noop, onIrAlElemento: noop };

describe('GloboTour', () => {
  it('dice exactamente qué apretar: «Aprieta aquí → Subir archivo»', () => {
    const h = renderToStaticMarkup(<GloboTour snap={snap()} {...props} />);
    expect(h).toContain('Aprieta aquí');
    expect(h).toContain('<strong>Subir archivo</strong>');
    expect(h).toContain('Paso 1 de 2');
  });
  it('«Saltar» está siempre, en cualquier paso y estado', () => {
    for (const s of [snap(), snap({ indice: 1, paso: R.pasos[1], esPrimero: false, esUltimo: true }), snap({ navegando: true }), snap({ anclaLista: false }), snap({ anclaLista: null })]) {
      expect(renderToStaticMarkup(<GloboTour snap={s} {...props} />)).toContain('>Saltar<');
    }
  });
  it('último paso: «Terminar»; primero: sin «Atrás»', () => {
    const ultimo = renderToStaticMarkup(<GloboTour snap={snap({ indice: 1, paso: R.pasos[1], esPrimero: false, esUltimo: true })} {...props} />);
    expect(ultimo).toContain('Terminar');
    expect(ultimo).toContain('>Atrás<');
    expect(renderToStaticMarkup(<GloboTour snap={snap()} {...props} />)).not.toContain('>Atrás<');
  });
  it('accesible: región con nombre y aviso en vivo; NO role=dialog ni <dialog>', () => {
    const h = renderToStaticMarkup(<GloboTour snap={snap()} {...props} />);
    expect(h).toContain('role="region"');
    expect(h).toContain('aria-label="Recorrido guiado, paso 1 de 2"');
    expect(h).toContain('aria-live="polite"');
    expect(h).not.toContain('role="dialog"');
    expect(h).not.toContain('<dialog');
  });
  it('reduced-motion: misma guía (texto, acción, foco, flecha), sin escena animada', () => {
    const normal = renderToStaticMarkup(<GloboTour snap={snap()} {...props} />);
    const quieto = renderToStaticMarkup(<GloboTour snap={snap({ reducirMovimiento: true })} {...props} />);
    expect(normal).toContain('rv-escena--anima');
    expect(quieto).not.toContain('rv-escena--anima');
    for (const t of ['Sube el archivo', 'Una muestra basta.', 'Aprieta aquí', 'rv-tour__flecha', '>Siguiente<', '>Saltar<']) expect(quieto).toContain(t);
    expect(quieto).toContain('data-reducido="true"');
  });
  it('ancla ausente: lo dice y sigue guiando; navegando: avisa', () => {
    expect(renderToStaticMarkup(<GloboTour snap={snap({ anclaLista: false })} {...props} />)).toContain('No vemos ese elemento');
    expect(renderToStaticMarkup(<GloboTour snap={snap({ navegando: true, anclaLista: null })} {...props} />)).toContain('Te llevamos a la página');
  });
  it('móvil: hoja inferior sin flecha', () => {
    const hoja = colocarGlobo({ x: 10, y: 10, w: 80, h: 30 }, { w: 360, h: 240 }, { w: 390, h: 800 });
    const h = renderToStaticMarkup(<GloboTour snap={snap()} {...props} col={hoja} />);
    expect(h).toContain('data-lado="hoja"');
    expect(h).not.toContain('rv-tour__flecha');
  });
});

describe('recorrido completo con anfitrión falso (patrón para cada tour de A/C)', () => {
  it('se puede recorrer de punta a punta por acción y por «Siguiente», sin problemas de calidad', () => {
    expect(validarRecorrido(R)).toEqual([]);
    const host = new AnfitrionFalso();
    const el = new ElementoFalso();
    host.anclas.set('demo.subir', el);
    const c = new ControladorTour(R, host, { ambito: 'u' });
    c.iniciar();
    expect(c.instantanea().paso?.id).toBe('a');
    el.disparar('click');
    host.tic(1);
    expect(c.instantanea().paso?.id).toBe('b');
    c.siguiente();
    expect(c.instantanea().fase).toBe('terminado');
  });
});

describe('Revelar', () => {
  it('decisión: lo ya visible, reduced-motion y sin IntersectionObserver no se ocultan', () => {
    expect(debeOcultar({ arriba: 100, altoVentana: 800, reducido: false, hayObservador: true })).toBe(false);
    expect(debeOcultar({ arriba: 1500, altoVentana: 800, reducido: false, hayObservador: true })).toBe(true);
    expect(debeOcultar({ arriba: 1500, altoVentana: 800, reducido: true, hayObservador: true })).toBe(false);
    expect(debeOcultar({ arriba: 1500, altoVentana: 800, reducido: false, hayObservador: false })).toBe(false);
  });
  it('el HTML servido nunca viene oculto (contenido real en el primer render)', () => {
    const h = renderToStaticMarkup(<Revelar retardoMs={999}>Texto real</Revelar>);
    expect(h).toContain('Texto real');
    expect(h).not.toContain('data-rv-revelar');
    expect(h).toContain('transition-delay:240ms'); // tope del escalonado
  });
});

describe('contrato de código del motor', () => {
  const dir = join(__dirname);
  const archivos = ['tipos.ts', 'controlador.ts', 'persistencia.ts', 'geometria.ts', 'validar.ts', 'globo.tsx', 'capa.tsx', 'proveedor.tsx', 'lanzador.tsx', 'anfitrion-dom.ts'];
  it('sin librerías nuevas (solo react, next, lucide y código propio)', () => {
    for (const a of archivos) {
      const src = readFileSync(join(dir, a), 'utf8');
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        expect(m[1], `${a} importa ${m[1]}`).toMatch(/^(react|next\/|lucide-react|\.|@\/)/);
      }
    }
  });
  it('el DOM solo se toca desde anfitrion-dom.ts y la capa visual', () => {
    for (const a of ['controlador.ts', 'persistencia.ts', 'geometria.ts', 'validar.ts', 'tipos.ts']) {
      const codigo = readFileSync(join(dir, a), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(codigo, a).not.toMatch(/\b(document|window|localStorage)\b/);
    }
  });
  it('no hay datos ni nombres de clientes reales en el motor', () => {
    for (const a of archivos) expect(readFileSync(join(dir, a), 'utf8')).not.toMatch(/innovat/i);
  });
});
