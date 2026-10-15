import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { evaluarPreflight, type DatosPreflight } from '@/lib/likida/conductor/preflight_piloto';
import { plantillasRequeridas } from '@/lib/likida/conductor/plantillas_requeridas';
import { CONFIG_CONDUCTOR_DEFAULT } from '@/lib/likida/conductor/config';
import { BannerPreflight, PanelPreflight } from './preflight';

const verde = (): DatosPreflight => ({
  config: { activo: true, perfilSeguimiento: 'esenciales', solicitudesMin: [0, 15, 30, 45] }, zonaDeclarada: 'America/Mexico_City',
  voluntarios: [{ telefono: '3312345678' }], // grep-limpio:ok
  viajes: [1, 2, 3].map((n) => ({ terminalId: 'p1', unidadId: `u${n}`, conSitio: true })),
  posicionesPorUnidad: { u1: { ultimas2h: 9, ultimaHora: 5 }, u2: { ultimas2h: 9, ultimaHora: 5 }, u3: { ultimas2h: 9, ultimaHora: 5 } },
  contactos: [{ nombre: 'Patio', telefono: '523312345678', nivel: 1, terminalId: 'p1' }], // grep-limpio:ok
  aprobadas: plantillasRequeridas({ ...CONFIG_CONDUCTOR_DEFAULT, avisarSenalVida: true }),
});

describe('«¿Está lista la flota?» (pantallas)', () => {
  it('el banner NO aparece con todo en verde ni cuando no se pudo leer', () => {
    expect(renderToStaticMarkup(<BannerPreflight preflight={evaluarPreflight(verde())} />)).toBe('');
    expect(renderToStaticMarkup(<BannerPreflight preflight={null} />)).toBe('');
  });

  it('el banner aparece con un faltante, dice cuántos y lleva a la configuración (conservando la flota elegida)', () => {
    const html = renderToStaticMarkup(<BannerPreflight preflight={evaluarPreflight({ ...verde(), zonaDeclarada: null })} sufijo="?tenant=abc" />);
    expect(html).toContain('falta 1 cosa');
    expect(html).toContain('La flota no tiene zona horaria definida.');
    expect(html).toContain('href="/dashboard/agentes/conductores/configuracion?tenant=abc#cfg-preflight"');
  });

  it('el panel lista las 8 comprobaciones con su «qué hacer» solo en las que faltan', () => {
    const html = renderToStaticMarkup(<PanelPreflight preflight={evaluarPreflight({ ...verde(), contactos: [] })} />);
    expect(html).toContain('¿Está lista la flota?');
    expect((html.match(/<li /g) ?? []).length).toBe(8);
    expect((html.match(/Qué hacer:/g) ?? []).length).toBe(1);
    expect(html).toContain('Falta 1 cosa');
    const todo = renderToStaticMarkup(<PanelPreflight preflight={evaluarPreflight(verde())} />);
    expect(todo).toContain('Todo en orden');
    expect(todo).not.toContain('Qué hacer:');
  });

  it('sin lectura: lo dice, no pinta una lista inventada', () => {
    const html = renderToStaticMarkup(<PanelPreflight preflight={null} />);
    expect(html).toContain('No se pudo revisar');
    expect(html).not.toContain('<li');
  });
});
