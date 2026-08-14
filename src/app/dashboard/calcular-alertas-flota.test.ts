import { describe, it, expect } from 'vitest';
import { calcularAlertasFlota, cuentaQuePide, type SenalesFlota } from './calcular-alertas-flota';
import type { Conector } from '@/lib/likida/conexiones';

const conector = (id: Conector['id'], estado: Conector['estado'], falta: string[] = []): Conector => ({
  id, nombre: `Conector ${id}`, estado, detalle: 'medido', falta,
});

const NADA: SenalesFlota = {
  porRevisar: 0, duplicados: 0, huerfanos: 0, escalados: 0, conectores: [],
};

describe('calcularAlertasFlota', () => {
  it('sin condiciones reales no inventa un solo renglón', () => {
    expect(calcularAlertasFlota(NADA)).toEqual([]);
  });

  it('una flota que nunca conectó rastreo NO tiene una alerta — tiene una decisión', () => {
    const alertas = calcularAlertasFlota({
      ...NADA,
      conectores: [conector('rastreo', 'sin_configurar'), conector('portales', 'sin_configurar')],
    });
    expect(alertas).toEqual([]);
  });

  it('un conector A MEDIAS sí es trabajo pendiente de una persona', () => {
    const alertas = calcularAlertasFlota({
      ...NADA,
      conectores: [conector('fiscal', 'incompleto', ['falta el RFC de la flota'])],
    });
    expect(alertas).toHaveLength(1);
    expect(alertas[0].tipo).toBe('atencion');
    // El qué-falta viaja en el texto: una alerta que no dice qué hacer obliga
    // a abrir la pantalla para enterarse.
    expect(alertas[0].texto).toContain('falta el RFC de la flota');
    expect(alertas[0].href).toBe('/dashboard/conexiones');
  });

  it('varios conectores rotos se agrupan en un renglón con sus nombres', () => {
    const alertas = calcularAlertasFlota({
      ...NADA,
      conectores: [conector('fiscal', 'incompleto'), conector('timbrado', 'incompleto')],
    });
    expect(alertas).toHaveLength(1);
    expect(alertas[0].texto).toContain('2 conexiones');
    expect(alertas[0].texto).toContain('Conector fiscal');
    expect(alertas[0].texto).toContain('Conector timbrado');
  });

  it('el orden es el de ataque: conectores → escalados → huérfanos → duplicados → revisión', () => {
    const alertas = calcularAlertasFlota({
      porRevisar: 4, duplicados: 3, huerfanos: 2, escalados: 1,
      conectores: [conector('fiscal', 'incompleto')],
    });
    expect(alertas.map((a) => a.id.split(':')[0])).toEqual([
      'conectores', 'escalados', 'huerfanos', 'duplicados', 'por-revisar',
    ]);
  });

  it('CADA alerta lleva a una pantalla donde se resuelve — nunca al Inicio', () => {
    const alertas = calcularAlertasFlota({
      porRevisar: 1, duplicados: 1, huerfanos: 1, escalados: 1,
      conectores: [conector('fiscal', 'incompleto')],
    });
    expect(alertas.length).toBeGreaterThan(0);
    for (const a of alertas) {
      expect(a.href).toMatch(/^\/dashboard\/.+/);
      expect(a.href).not.toBe('/dashboard');
    }
  });

  it('el sufijo del superadmin viaja en TODOS los links (o lo saca de la flota que mira)', () => {
    const alertas = calcularAlertasFlota(
      { porRevisar: 1, duplicados: 1, huerfanos: 1, escalados: 1, conectores: [conector('fiscal', 'incompleto')] },
      '?tenant=abc',
    );
    for (const a of alertas) expect(a.href).toContain('?tenant=abc');
  });

  it('el singular y el plural están escritos, no armados con "(s)"', () => {
    const uno = calcularAlertasFlota({ ...NADA, huerfanos: 1 })[0];
    expect(uno.texto).toContain('1 comprobante llegó');

    const varios = calcularAlertasFlota({ ...NADA, huerfanos: 2 })[0];
    expect(varios.texto).toContain('2 comprobantes llegaron');
  });

  it('el id carga el conteo: si el número cambia, la alerta vuelve a ser nueva', () => {
    const antes = calcularAlertasFlota({ ...NADA, huerfanos: 3 })[0].id;
    const despues = calcularAlertasFlota({ ...NADA, huerfanos: 5 })[0].id;
    expect(antes).not.toBe(despues);
  });

  it('el id de conectores es estable aunque cambie el ORDEN de la consulta', () => {
    const a = calcularAlertasFlota({
      ...NADA, conectores: [conector('timbrado', 'incompleto'), conector('fiscal', 'incompleto')],
    })[0].id;
    const b = calcularAlertasFlota({
      ...NADA, conectores: [conector('fiscal', 'incompleto'), conector('timbrado', 'incompleto')],
    })[0].id;
    expect(a).toBe(b);
  });

  it('las liquidaciones por revisar son trabajo normal, no urgencia', () => {
    const alertas = calcularAlertasFlota({ ...NADA, porRevisar: 9 });
    expect(alertas[0].tipo).toBe('aviso');
  });
});

describe('el gate por rol', () => {
  const TODO: SenalesFlota = {
    porRevisar: 1, duplicados: 1, huerfanos: 1, escalados: 1,
    conectores: [conector('fiscal', 'incompleto')],
  };

  it('sin predicado se enseña todo — el default sirve al dueño', () => {
    expect(calcularAlertasFlota(TODO)).toHaveLength(5);
  });

  it('el encargado NO ve las alertas de dinero: son callejón sin salida', () => {
    // `/dashboard/huerfanos` es área dinero — un clic ahí lo rebota al Inicio.
    const soloOperacion = (href: string) => href !== '/dashboard/huerfanos';
    const alertas = calcularAlertasFlota(TODO, '', soloOperacion);
    expect(alertas.some((a) => a.href.startsWith('/dashboard/huerfanos'))).toBe(false);
    // Y las suyas siguen ahí: escalados vive en /viajes, que sí es operación.
    expect(alertas.some((a) => a.id.startsWith('escalados:'))).toBe(true);
  });

  it('el conteo se va con la alerta — no se filtra solo el link', () => {
    // Un renglón que dice "2 comprobantes sin viaje" pero no navega seguiría
    // filtrando la cifra a un rol que no ve dinero.
    const alertas = calcularAlertasFlota(
      { ...NADA, huerfanos: 7 }, '', (href) => href !== '/dashboard/huerfanos',
    );
    expect(alertas).toEqual([]);
  });

  it('el filtro corre sobre la ruta BASE, no sobre la que ya trae ?tenant=', () => {
    const visto: string[] = [];
    calcularAlertasFlota(TODO, '?tenant=abc', (href) => { visto.push(href); return true; });
    for (const h of visto) expect(h).not.toContain('?tenant=');
  });

  it('y aun filtrando, los links que sobreviven conservan el sufijo', () => {
    const alertas = calcularAlertasFlota(TODO, '?tenant=abc', (href) => href === '/dashboard/viajes');
    expect(alertas.length).toBeGreaterThan(0);
    for (const a of alertas) expect(a.href).toBe('/dashboard/viajes?tenant=abc');
  });
});

describe('una señal que NO se pudo leer no se lee como cero', () => {
  it('un null confiesa, y va ANTES que todo lo demás', () => {
    const alertas = calcularAlertasFlota({ ...NADA, huerfanos: null });
    expect(alertas[0].id).toBe('ilegibles:comprobantes sin viaje');
    expect(alertas[0].tipo).toBe('atencion');
    expect(alertas[0].texto).toContain('no en cero');
  });

  it('la flota ciega NO puede quedarse en "sin novedades"', () => {
    // Todo en null es exactamente el caso de una base caída: sin este
    // renglón, la pantalla diría "Sin novedades" estando ciega.
    const alertas = calcularAlertasFlota({
      porRevisar: null, duplicados: null, huerfanos: null, escalados: null, conectores: null,
    });
    expect(alertas).not.toEqual([]);
    expect(alertas[0].texto).toContain('5 señales');
  });

  it('un null NO fabrica el renglón de su propia señal', () => {
    const alertas = calcularAlertasFlota({ ...NADA, escalados: null });
    expect(alertas.some((a) => a.id.startsWith('escalados:'))).toBe(false);
  });

  it('lo que SÍ se pudo leer se sigue reportando junto a la confesión', () => {
    const alertas = calcularAlertasFlota({ ...NADA, escalados: null, huerfanos: 2 });
    expect(alertas.map((a) => a.id.split(':')[0])).toEqual(['ilegibles', 'huerfanos']);
  });

  it('conectores en null no truena y no inventa conectores rotos', () => {
    const alertas = calcularAlertasFlota({ ...NADA, conectores: null });
    expect(alertas.some((a) => a.id.startsWith('conectores:'))).toBe(false);
  });

  it('el id de ilegibles es estable aunque cambie el orden de las llaves', () => {
    const a = calcularAlertasFlota({ ...NADA, huerfanos: null, escalados: null })[0].id;
    const b = calcularAlertasFlota({ ...NADA, escalados: null, huerfanos: null })[0].id;
    expect(a).toBe(b);
  });
});

describe('cuentaQuePide', () => {
  it('el globito cuenta solo lo que pide a un humano YA', () => {
    const alertas = calcularAlertasFlota({
      porRevisar: 7,           // aviso — no cuenta
      duplicados: 0, huerfanos: 2, escalados: 1, conectores: [],
    });
    expect(alertas).toHaveLength(3);
    expect(cuentaQuePide(alertas)).toBe(2);
  });

  it('un globito que nunca llega a cero enseña a ignorarlo: sin atenciones, es cero', () => {
    expect(cuentaQuePide(calcularAlertasFlota({ ...NADA, porRevisar: 40 }))).toBe(0);
  });
});
