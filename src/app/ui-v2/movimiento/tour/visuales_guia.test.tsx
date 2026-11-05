import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BannerCelebracion } from './banner-celebracion';
import { CheckDibujado } from './check-dibujado';
import { CursorGesto } from './cursor-gesto';
import { EtiquetaObjetivo } from './etiqueta-objetivo';
import { EstadoDelPaso, GloboTour } from './globo';
import { Ilustracion, NOMBRES_ILU } from './ilustraciones';
import { ProgresoGuia } from './progreso-guia';
import type { EstadoEspera, Instantanea, PasoTour } from './tipos';
import { VacioGuiado } from './vacio-guiado';

const CSS = readFileSync(join(__dirname, '..', '..', 'onboarding.css'), 'utf8');
const html = (n: React.ReactElement) => renderToStaticMarkup(n);

const PASO: PasoTour = {
  id: 'PM2-03', titulo: 'Prueba la conexión', texto: 'Aprieta el botón y espera.', tipo: 'hacer', ancla: 'pm.probar',
  accion: { verbo: 'Aprieta', objetivo: 'Probar conexión' }, deteccion: { via: 'senal', senal: 'tms_probada', modo: 'cambia' },
};
const snap = (espera?: EstadoEspera, paso: PasoTour = PASO): Instantanea => ({
  fase: 'activo', indice: 0, total: 3, paso, anclaLista: true, navegando: false, reducirMovimiento: false, esPrimero: true, esUltimo: false, ...(espera ? { espera } : {}),
});
const noop = () => {};

describe('piezas visuales de la guía', () => {
  it('lo decorativo está oculto a lectores de pantalla; el estado se dice con texto', () => {
    for (const h of [html(<CheckDibujado />), html(<CursorGesto />), html(<EtiquetaObjetivo texto="X" estado="accion" />)]) expect(h).toContain('aria-hidden="true"');
    expect(html(<EtiquetaObjetivo texto="Probar" estado="accion" />)).toContain('Haz clic aquí: Probar');
    expect(html(<EtiquetaObjetivo texto="Probar" estado="aqui" />)).toContain('Aquí: Probar');
    expect(html(<EtiquetaObjetivo texto="Probar" estado="hecho" />)).toContain('Hecho');
  });

  it('el anillo de avance es una barra de progreso con valor y nombre, y no se pasa de su total', () => {
    const h = html(<ProgresoGuia hechos={9} total={6} />);
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-valuenow="6"');
    expect(h).toContain('aria-valuemax="6"');
    expect(h).toContain('aria-label="Avance de la guía"');
    expect(html(<ProgresoGuia hechos={-2} total={0} />)).toContain('aria-valuenow="0"');
    expect(html(<ProgresoGuia hechos={3} total={6} />)).toContain('stroke-dasharray="50 50"');
  });

  it('el aviso de logro siempre es visible con texto y se cierra con un botón nombrado', () => {
    const h = html(<BannerCelebracion titulo="Conectaste tu sistema" texto="Ya llegan tus viajes." onCerrar={noop} />);
    expect(h).toContain('role="status"');
    expect(h).toContain('Conectaste tu sistema');
    expect(h).toContain('aria-label="Cerrar aviso"');
    expect(html(<BannerCelebracion titulo="Listo" />)).not.toContain('Cerrar aviso');
  });

  it('el vacío guiado enseña los pasos en orden', () => {
    const h = html(<VacioGuiado titulo="Aún no hay viajes" texto="Se llenan al conectar tu sistema." pasos={['Conecta tu sistema', 'Pide 20 bitácoras']} />);
    expect(h).toContain('<ol');
    expect(h.indexOf('Conecta tu sistema')).toBeLessThan(h.indexOf('Pide 20 bitácoras'));
    expect(html(<VacioGuiado titulo="x" texto="y" pasos={[]} />)).not.toContain('<ol');
  });

  it('cada ilustración dibuja algo y las nuevas están en el catálogo', () => {
    expect(NOMBRES_ILU.length).toBeGreaterThanOrEqual(20);
    for (const n of ['conectar', 'documento', 'correo', 'llave', 'celebrar', 'reloj']) expect(NOMBRES_ILU).toContain(n);
    for (const n of NOMBRES_ILU) expect(html(<Ilustracion nombre={n} />), n).toMatch(/<(path|rect|circle)/);
  });
});

describe('estado del paso en la tarjeta', () => {
  const e = (estado: EstadoEspera['estado'], extra: Partial<EstadoEspera> = {}): EstadoEspera => ({ estado, evidencia: null, declarable: false, ...extra });
  it('dice qué pasa en cada estado, con texto', () => {
    expect(html(<EstadoDelPaso snap={snap(e('leyendo'))} />)).toContain('Comprobando');
    expect(html(<EstadoDelPaso snap={snap(e('esperando'))} />)).toContain('Esperando que lo hagas');
    expect(html(<EstadoDelPaso snap={snap(e('hecho', { evidencia: 'medido' }))} />)).toContain('Hecho');
    expect(html(<EstadoDelPaso snap={snap(e('ya_hecho', { evidencia: 'medido' }))} />)).toContain('Ya lo tenías');
    expect(html(<EstadoDelPaso snap={snap(e('sin_dato', { declarable: true }))} onDeclarar={noop} />)).toContain('No pude comprobarlo');
  });
  it('lo declarado se rotula «confirmado por ti»; lo medido no', () => {
    expect(html(<EstadoDelPaso snap={snap(e('hecho', { evidencia: 'confirmado' }))} />)).toContain('confirmado por ti');
    expect(html(<EstadoDelPaso snap={snap(e('hecho', { evidencia: 'medido' }))} />)).not.toContain('confirmado por ti');
  });
  it('«Ya lo hice» solo aparece si el paso lo permite', () => {
    expect(html(<EstadoDelPaso snap={snap(e('esperando'))} onDeclarar={noop} />)).not.toContain('Ya lo hice');
    expect(html(<EstadoDelPaso snap={snap(e('sin_dato', { declarable: true }))} onDeclarar={noop} />)).toContain('Ya lo hice');
    expect(html(<EstadoDelPaso snap={snap(e('hecho', { declarable: true }))} onDeclarar={noop} />)).not.toContain('Ya lo hice');
  });
  it('un paso «practicar» lleva el rótulo fijo de datos de muestra', () => {
    expect(html(<EstadoDelPaso snap={snap(e('esperando'), { ...PASO, tipo: 'practicar' })} />)).toContain('Datos de muestra');
    expect(html(<EstadoDelPaso snap={snap(e('esperando'))} />)).not.toContain('Datos de muestra');
  });
  it('un paso informativo no muestra estado', () => {
    expect(html(<EstadoDelPaso snap={snap(undefined, { id: 'x', titulo: 't', texto: 'x' })} />)).toBe('');
  });
  it('el botón principal cambia: omitir mientras espera, continuar cuando se cumplió', () => {
    const props = { onSiguiente: noop, onAtras: noop, onSaltar: noop };
    expect(html(<GloboTour snap={snap(e('esperando'))} {...props} />)).toContain('Omitir este paso');
    expect(html(<GloboTour snap={snap(e('hecho', { evidencia: 'medido' }))} {...props} />)).toContain('>Continuar<');
    expect(html(<GloboTour snap={snap(e('ya_hecho', { evidencia: 'medido' }))} {...props} />)).toContain('>Continuar<');
  });
});

describe('onboarding.css · nuevas piezas', () => {
  it('el cursor, la marca de hecho y el anillo solo se mueven bajo no-preference; sin él quedan en su estado final', () => {
    const fuera = CSS.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*$/, '');
    expect(fuera).not.toMatch(/animation\s*:/);
    expect(fuera).not.toMatch(/transition\s*:/);
    expect(CSS).toMatch(/no-preference[\s\S]*\.rv-onb-cursor \{ animation: rv-onb-gesto/);
    expect(CSS).toMatch(/no-preference[\s\S]*\.rv-onb-check__marca \{ animation/);
  });
  it('el gesto se repite 2 veces y no es infinito (WCAG 2.2.2)', () => {
    expect(CSS).not.toMatch(/animation:[^;]*infinite/);
    expect(CSS).toMatch(/rv-onb-gesto 1400ms[^;]* 2 both/);
  });
  it('el alto contraste forzado cubre las piezas nuevas y el móvil da objetivos de 44 px', () => {
    const forzado = CSS.slice(CSS.indexOf('@media (forced-colors: active)'));
    for (const c of ['.rv-onb-check', '.rv-onb-anillo__valor', '.rv-onb-cursor__flecha', '.rv-onb-celebra', '.rv-onb-vacio']) expect(forzado).toContain(c);
    const movil = CSS.slice(CSS.indexOf('@media (max-width: 767px)'));
    expect(movil).toMatch(/\.rv-onb-celebra \.rv-btn[\s\S]*min-height: 44px/);
  });
  it('solo usa los tokens del sistema: ningún color suelto nuevo en las piezas', () => {
    const bloque = CSS.slice(CSS.indexOf('/* ── Pasos que piden hacer algo'), CSS.indexOf('/* ── Alto contraste forzado'));
    expect(bloque).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(bloque).not.toMatch(/rgba?\(/);
  });
});

describe('accesibilidad del globo', () => {
  it('«Ya lo hice» mide 44 px siempre (no solo en móvil) y las notas no duplican role=status', () => {
    const base = CSS.split('@media')[0];
    expect(base).toMatch(/\.rv-onb__estado \.rv-onb__enlace \{[^}]*min-height: 44px/);
    const h = html(<GloboTour snap={{ ...snap({ estado: 'esperando', evidencia: null, declarable: false }), navegando: true, anclaLista: false }} />);
    expect(h).toContain('Te llevo a la página');
    expect(h.match(/role="status"/g) ?? []).toHaveLength(1); // solo el estado del paso; las notas son texto
  });
});
