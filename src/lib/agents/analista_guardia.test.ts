import { describe, it, expect } from 'vitest';
import { extraerNumeros, cifrasRespaldadas, esDerivada, validarBloques, type Bloque } from './analista';
import { proyectarPuntos } from './chat-tools';

// ═══════════════════════════════════════════════════════════════════════════
// La guardia de cifras del chat del panel — el mismo principio que
// cuadre/guardia.ts: una cifra que ninguna tool devolvió NO sale hacia el
// contralor. Estas pruebas fijan el contrato ANTES de que un modelo lo
// ejercite: la guardia es determinística y se prueba sin LLM.
// ═══════════════════════════════════════════════════════════════════════════

function respaldoDe(...valores: unknown[]): Set<number> {
  const s = new Set<number>();
  for (const v of valores) extraerNumeros(v, s);
  return s;
}

describe('extraerNumeros', () => {
  it('saca números crudos, anidados y con decimales', () => {
    const s = respaldoDe({ montoComprobado: 8340.5, viajes: [{ anticipo: 1200 }] });
    expect(s.has(8340.5)).toBe(true);
    expect(s.has(1200)).toBe(true);
  });
  it('saca los dígitos incrustados en strings (fechas, folios, semanas)', () => {
    const s = respaldoDe({ creadaEn: '2026-08-12', folio: 'F-00123', etiqueta: 'Sem 32' });
    for (const n of [2026, 8, 12, 123, 32]) expect(s.has(n)).toBe(true);
  });
});

describe('cifrasRespaldadas', () => {
  const respaldo = respaldoDe({ montoComprobado: 8340.5, tasaCuadre: 87, liquidados: 14 });

  it('deja pasar una respuesta cuyas cifras vienen todas de tools', () => {
    const bloques: Bloque[] = [
      { tipo: 'texto', texto: 'Llevas 8,340.50 comprobados con tasa de cuadre de 87%.' },
      { tipo: 'cifra', valor: 8340.5, formato: 'mxn' },
    ];
    expect(cifrasRespaldadas(bloques, respaldo)).toBe(true);
  });

  it('BLOQUEA un monto que ninguna tool devolvió', () => {
    const bloques: Bloque[] = [{ tipo: 'texto', texto: 'Te puedes ahorrar unos $12,500 al mes.' }];
    expect(cifrasRespaldadas(bloques, respaldo)).toBe(false);
  });

  it('bloquea la cifra inventada también dentro de una tabla y una dona', () => {
    expect(cifrasRespaldadas([{ tipo: 'tabla', filas: [['Ahorro estimado', 99999]] }], respaldo)).toBe(false);
    expect(cifrasRespaldadas([{ tipo: 'dona', segmentos: [{ etiqueta: 'x', valor: 4321 }] }], respaldo)).toBe(false);
  });

  it('los números que el USUARIO escribió cuentan como respaldo (van en el set)', () => {
    const conPregunta = respaldoDe({ tasaCuadre: 87 }, '¿cómo voy contra mi meta de 90%?');
    expect(cifrasRespaldadas([{ tipo: 'texto', texto: 'Tu tasa es 87%, abajo de tu meta de 90%.' }], conPregunta)).toBe(true);
  });

  it('conteos chicos y 50/100 no bloquean (el modelo cuenta listas él solo)', () => {
    expect(cifrasRespaldadas([{ tipo: 'texto', texto: 'Te muestro 3 rutas; el peaje acredita al 50%.' }], respaldo)).toBe(true);
  });
});

describe('esDerivada — comparar es interpretar, no inventar', () => {
  const respaldo = respaldoDe({ semanaActual: 8500, semanaPasada: 8000, total: 22000 });
  it('acepta la resta de dos cifras respaldadas ("gastaste 500 más")', () => {
    expect(cifrasRespaldadas([{ tipo: 'texto', texto: 'Gastaste 500 más que la semana pasada.' }], respaldo)).toBe(true);
  });
  it('acepta la suma y el porcentaje entre respaldadas', () => {
    expect(esDerivada(16500, respaldo)).toBe(true);          // 8500 + 8000
    expect(esDerivada(38.64, respaldo)).toBe(true);          // 8500/22000 ≈ 38.6%
  });
  it('sigue bloqueando lo que no es cifra ni derivada simple', () => {
    expect(cifrasRespaldadas([{ tipo: 'texto', texto: 'Podrías ahorrar 12,345 al mes.' }], respaldo)).toBe(false);
  });
});

describe('proyectarPuntos — la proyección la calcula código y declara su supuesto', () => {
  it('promedia los últimos 4 cortes con datos y extiende', () => {
    const r = proyectarPuntos([0, 1000, 2000, 3000, 4000]);
    expect(r).toMatchObject({ promedioPorCorte: 2500, proyeccionSiguienteCorte: 2500, proyeccionSiguientes4: 10000 });
    if (!('sinDatos' in r)) expect(r.supuesto).toMatch(/promedio simple/);
  });
  it('sin datos lo dice, no proyecta ceros con cara de pronóstico', () => {
    expect(proyectarPuntos([0, 0, 0])).toEqual({ sinDatos: true });
  });
});

describe('validarBloques — nunca se confía en la forma que entregó el modelo', () => {
  it('acepta el contrato completo y recorta espacios', () => {
    const b = validarBloques([
      { tipo: 'texto', texto: '  hola  ' },
      { tipo: 'cifra', valor: 5, formato: 'mxn' },
      { tipo: 'tabla', filas: [['a', 1]] },
      { tipo: 'dona', segmentos: [{ etiqueta: 'x', valor: 1 }] },
      { tipo: 'serie', puntos: [{ dia: 'Sem 31', valor: 2 }], formato: 'mxn' },
    ]);
    expect(b).not.toBeNull();
    expect(b![0]).toEqual({ tipo: 'texto', texto: 'hola' });
  });
  it('rechaza lo irrescatable y RESCATA lo válido junto a lo inválido', () => {
    expect(validarBloques([{ tipo: 'html', html: '<script>' }])).toBeNull();
    expect(validarBloques([])).toBeNull();
    // Tolerancia medida el 12-ago: un bloque malo NO tira la entrega entera.
    const rescatados = validarBloques([
      { tipo: 'html', html: '<script>' },
      { tipo: 'texto', texto: 'esto sí vale' },
    ]);
    expect(rescatados).toHaveLength(1);
    expect(rescatados![0]).toEqual({ tipo: 'texto', texto: 'esto sí vale' });
    // Una tabla larga se recorta a 10, no se rechaza.
    const larga = validarBloques([{ tipo: 'tabla', filas: Array.from({ length: 14 }, (_, i) => [String(i), i]) }]);
    expect(larga![0]).toMatchObject({ tipo: 'tabla' });
    expect((larga![0] as { filas: unknown[] }).filas).toHaveLength(10);
  });
});
