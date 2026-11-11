import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/crons', useSearchParams: () => new URLSearchParams() }));
import { CRONS, type CronId, type LatidoDetallado } from '@/lib/admin/salud';
import { NOMBRE_RELOJ, OFICIO_RELOJ, guiaDeArreglo, porQueNoCorrio } from './estado-relojes';
import { VistaCrons } from './vista';

// F7: «por qué no corrió» y la guía de arreglo para los relojes con corrida parcial por falta de configuración.

const latido = (sobre: Partial<LatidoDetallado> = {}): LatidoDetallado => ({
  estado: 'ok', haceMin: 1, ultimoEstado: 'ok', ultimoLatido: '2026-11-09T12:00:00.000Z', cadenciaMs: 3_600_000, detalle: {}, motivoSalto: null, ...sobre,
});
const todos = (sobre: Partial<Record<CronId, Partial<LatidoDetallado>>> = {}): Record<CronId, LatidoDetallado> => {
  const r = {} as Record<CronId, LatidoDetallado>;
  for (const c of CRONS) r[c] = latido(sobre[c]);
  return r;
};

describe('nombres', () => {
  it('cada reloj tiene nombre y oficio en palabras (ninguno se pinta con su id)', () => {
    for (const c of CRONS) {
      expect(NOMBRE_RELOJ[c].length).toBeGreaterThan(3);
      expect(OFICIO_RELOJ[c].length).toBeGreaterThan(10);
    }
  });
});

describe('porQueNoCorrio', () => {
  it('un reloj sano no inventa un motivo', () => {
    expect(porQueNoCorrio(latido())).toEqual({ texto: '', causa: 'ninguna' });
  });
  it('apagado por palanca se dice como apagado a propósito', () => {
    const p = porQueNoCorrio(latido({ ultimoEstado: 'saltado', motivoSalto: 'apagado por la palanca «global»' }));
    expect(p.causa).toBe('apagado');
  });
  it('parcial por configuración ausente es config, no avería', () => {
    const p = porQueNoCorrio(latido({ ultimoEstado: 'parcial', detalle: { configAusente: true, motivo: 'falta LIKIDA_SAT_PROVEEDOR' } }));
    expect(p.causa).toBe('config');
    expect(p.texto).toContain('Falta configuración');
  });
  it('un fallo con código, un reloj que dejó de latir y uno que nunca latió se distinguen', () => {
    expect(porQueNoCorrio(latido({ ultimoEstado: 'fallo', detalle: { codigo: 'base_caida' } }))).toMatchObject({ causa: 'averia', texto: 'Falló con código base_caida' });
    expect(porQueNoCorrio(latido({ estado: 'vencido' })).causa).toBe('averia');
    expect(porQueNoCorrio(latido({ estado: 'sin_latido', ultimoLatido: null, ultimoEstado: null })).causa).toBe('sin_dato');
  });
});

describe('guiaDeArreglo', () => {
  it('la descarga del SAT sin proveedor trae su guía propia, con quién la destraba', () => {
    const g = guiaDeArreglo('descarga-sat', latido({ ultimoEstado: 'parcial', detalle: { configAusente: true, motivo: 'La descarga masiva no está configurada' } }));
    expect(g).not.toBeNull();
    expect(g!.queFalta).toContain('SAT');
    expect(g!.quien).toContain('Javier');
    expect(g!.pasos.join(' ')).toContain('LIKIDA_SAT_PROVEEDOR');
    expect(g!.dicho).toContain('no está configurada');
  });
  it('escalar sin Cal.com trae la suya', () => {
    const g = guiaDeArreglo('escalar', latido({ ultimoEstado: 'parcial', detalle: { configAusente: true, motivo: 'Cal.com no configurado' } }));
    expect(g!.pasos.join(' ')).toContain('CALCOM_API_KEY');
  });
  it('un reloj sin guía propia con hueco declarado recibe la genérica', () => {
    const g = guiaDeArreglo('gps', latido({ ultimoEstado: 'parcial', detalle: { configAusente: true } }));
    expect(g!.queFalta).toContain('Posiciones GPS');
  });
  it('una corrida parcial por otra cosa NO se disfraza de «falta configurar», ni un reloj sano tiene guía', () => {
    expect(guiaDeArreglo('descarga-sat', latido({ ultimoEstado: 'parcial', detalle: { errores: 3 } }))).toBeNull();
    expect(guiaDeArreglo('descarga-sat', latido())).toBeNull();
  });
});

describe('VistaCrons con guía', () => {
  it('pinta «Qué falta para que corran completos» con el paso a paso, y la fila dice la causa', () => {
    const html = renderToStaticMarkup(<VistaCrons latidos={todos({ 'descarga-sat': { ultimoEstado: 'parcial', detalle: { configAusente: true, motivo: 'falta LIKIDA_SAT_PROVEEDOR' } } })} />);
    expect(html).toContain('Qué falta para que corran completos');
    expect(html).toContain('Lo destraba Javier');
    expect(html).toContain('Falta configuración');
  });
  it('sin huecos de configuración no hay sección de guía', () => {
    expect(renderToStaticMarkup(<VistaCrons latidos={todos()} />)).not.toContain('Qué falta para que corran');
  });
  it('no imprime rutas internas de los relojes', () => {
    expect(renderToStaticMarkup(<VistaCrons latidos={todos()} />)).not.toContain('/api/cron');
  });
});
