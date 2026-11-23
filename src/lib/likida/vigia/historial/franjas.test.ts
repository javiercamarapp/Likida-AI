import { describe, it, expect } from 'vitest';
import { esperaPorFranja, franjasConHueco } from './franjas';

// Hora de México = UTC-6 todo el año. 20:00Z = 14:00 local.
const msg = (iso: string, rol: 'cliente' | 'equipo', texto: string) => ({ enviadoEn: iso, rol, texto });
const dia = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;

describe('esperaPorFranja', () => {
  it('mide la espera por hora LOCAL de la petición', () => {
    const f = esperaPorFranja([
      msg(`${dia(14)}T20:00:00Z`, 'cliente', 'me confirman la hora de salida por favor'), // 14:00 local
      msg(`${dia(14)}T20:50:00Z`, 'equipo', 'sale a las 5 pm'),
      msg(`${dia(14)}T16:00:00Z`, 'cliente', 'como vamos con la caja?'), // 10:00 local
      msg(`${dia(14)}T16:02:00Z`, 'equipo', 'va en ruta'),
    ]);
    expect(f).toHaveLength(24);
    expect(f[14]).toMatchObject({ peticiones: 1, medianaMin: 50, sinRespuesta: 0, pctSobreUmbral: 100 });
    expect(f[10]).toMatchObject({ peticiones: 1, medianaMin: 2, pctSobreUmbral: 0 });
    expect(f[3].peticiones).toBe(0);
  });

  it('una petición sin respuesta cuenta como espera sobre el umbral', () => {
    const f = esperaPorFranja([msg(`${dia(14)}T09:30:00Z`, 'cliente', 'nos apoyan con los datos de la unidad')]); // 03:30 local
    expect(f[3]).toMatchObject({ peticiones: 1, sinRespuesta: 1, medianaMin: null, pctSobreUmbral: 100 });
  });

  it('un aviso o un «gracias» no es petición', () => {
    const f = esperaPorFranja([msg(`${dia(14)}T20:00:00Z`, 'cliente', 'la caja ya quedó en el patio'), msg(`${dia(14)}T20:01:00Z`, 'cliente', 'gracias')]);
    expect(f.every((x) => x.peticiones === 0)).toBe(true);
  });

  it('soloRespuestaConDato: un «enterado» no cuenta como respuesta', () => {
    const base = [msg(`${dia(14)}T20:00:00Z`, 'cliente', 'me confirman la hora de salida'), msg(`${dia(14)}T20:03:00Z`, 'equipo', 'enterado'), msg(`${dia(14)}T22:00:00Z`, 'equipo', 'sale a las 6 pm')];
    expect(esperaPorFranja(base)[14].medianaMin).toBe(3);
    expect(esperaPorFranja(base, { soloRespuestaConDato: true })[14].medianaMin).toBe(120);
  });

  it('entrada vacía o con fechas ilegibles no lanza', () => {
    expect(esperaPorFranja([]).every((x) => x.peticiones === 0)).toBe(true);
    expect(esperaPorFranja([msg('no-es-fecha', 'cliente', 'me confirman por favor')]).every((x) => x.peticiones === 0)).toBe(true);
  });
});

describe('franjasConHueco', () => {
  const base = [...Array(24).keys()].map((_, hora) => ({ hora, peticiones: 30, medianaMin: 3, p90Min: 20, sinRespuesta: 0, pctSobreUmbral: 5 }));
  it('señala la franja con muchas peticiones y mucha espera, de peor a mejor', () => {
    const f = [...base];
    f[14] = { ...f[14], pctSobreUmbral: 20 };
    f[7] = { ...f[7], pctSobreUmbral: 30 };
    expect(franjasConHueco(f).map((x) => x.hora)).toEqual([7, 14]);
  });
  it('una franja con pocas peticiones no se señala (sería ruido)', () => {
    const f = [...base];
    f[3] = { ...f[3], peticiones: 4, pctSobreUmbral: 100 };
    expect(franjasConHueco(f)).toEqual([]);
  });
});
