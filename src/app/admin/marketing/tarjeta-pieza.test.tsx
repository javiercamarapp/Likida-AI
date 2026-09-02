import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TarjetaPieza } from './tarjeta-pieza';
import type { PiezaEstudio } from '@/lib/likida/marketing/estudio';

// ═══════════════════════════════════════════════════════════════════════════
// LA TARJETA DE PIEZA — lo que se prueba es que pinta DE VERDAD lo que trae
// la fila de `cola_aprobacion` (título, tipo, agente, cuerpo COMPLETO), y
// que el copy por canal solo se parte cuando el propio cuerpo lo marca así
// — nunca una estructura inventada para una pieza que es un guion o un
// encargo.
// ═══════════════════════════════════════════════════════════════════════════

const accionOk = async () => ({ ok: 'listo' });

function pieza(p: Partial<PiezaEstudio>): PiezaEstudio {
  return {
    id: 'pz-1', tipo: 'guion_video', agente: 'guiones',
    titulo: 'Guion semanal — semana del 2026-08-24',
    cuerpo: 'GUION SEMANAL — semana del 2026-08-24\n\nHOOK: algo.',
    fuentes: null, creadoEn: '2026-08-24T12:00:00Z',
    ...p,
  };
}

describe('TarjetaPieza — refleja de verdad lo que hay en cola_aprobacion', () => {
  it('pinta título, tipo legible, agente y el CUERPO COMPLETO cuando no hay marcadores de canal', () => {
    const html = renderToStaticMarkup(
      <TarjetaPieza pieza={pieza({})} publicar={accionOk} rechazar={accionOk} />,
    );
    expect(html).toContain('Guion semanal — semana del 2026-08-24');
    expect(html).toContain('Guion de video');
    expect(html).toContain('guiones');
    expect(html).toContain('HOOK: algo.');
    expect(html).toContain('Publicar');
  });

  it('parte el cuerpo en bloques por canal cuando la pieza los trae (promo_diaria)', () => {
    const cuerpo = ['── LinkedIn ──', 'texto de LinkedIn', '── Instagram ──', 'texto de Instagram'].join('\n');
    const html = renderToStaticMarkup(
      <TarjetaPieza pieza={pieza({ tipo: 'promo_diaria', agente: 'promos_diarias', cuerpo })} publicar={accionOk} rechazar={accionOk} />,
    );
    expect(html).toContain('LinkedIn');
    expect(html).toContain('texto de LinkedIn');
    expect(html).toContain('Instagram');
    expect(html).toContain('texto de Instagram');
    expect(html).toContain('Promo del día');
  });

  it('un tipo sin etiqueta conocida muestra el tipo crudo, nunca "undefined"', () => {
    const html = renderToStaticMarkup(
      <TarjetaPieza pieza={pieza({ tipo: 'tipo_nuevo_sin_etiqueta' })} publicar={accionOk} rechazar={accionOk} />,
    );
    expect(html).toContain('tipo_nuevo_sin_etiqueta');
    expect(html).not.toContain('undefined');
  });

  it('el pie deja claro que "publicar" es la aprobación, no un post real en el canal', () => {
    const html = renderToStaticMarkup(
      <TarjetaPieza pieza={pieza({})} publicar={accionOk} rechazar={accionOk} />,
    );
    expect(html).toContain('no hay integración de redes sociales todavía');
  });
});
