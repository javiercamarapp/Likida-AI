import { describe, it, expect } from 'vitest';
import {
  calcularInsightsA1, entradaDesdeConteo, entradaDesdeFichas, aInsightComun, TEXTO_SIN_DATOS,
  type EntradaInsightsA1, type InsightA1,
} from './insights_a1';

// Siete escenarios con datos sintéticos. Lo que se fija es lo que haría FALSO a un insight: afirmar «sin captura manual» sin
// conocer el origen, un cero donde no se midió, un ahorro sin línea base o una cifra sin fuente.

const base: EntradaInsightsA1 = {
  periodo: 'últimos 30 días', desgloses: 10, entregados: 10, enviados: 0, rebotados: 0, retenidos: 0, sinPoliza: 0,
  origen: { pull: 10, importado: 0, captura: 0 }, medianaEnvioMin: 10 * 60 + 30, medianaEntradaMin: 8 * 60 + 15,
  lineaBase: { minutosPorDesglose: 12, personas: 2 },
};
const por = (r: InsightA1[], id: string) => r.find((x) => x.id === id);
const hace = (r: InsightA1[], id: string) => { const x = por(r, id); if (!x) throw new Error(`falta ${id}`); return x; };

describe('escenarios', () => {
  it('sano: todo entregado, sin captura manual, con línea base', () => {
    const r = calcularInsightsA1(base);
    expect(r.map((x) => x.id)).toEqual(['cobertura', 'sin_captura', 'ahorro', 'hora_envio']);
    expect(hace(r, 'cobertura')).toMatchObject({ quePaso: '10 de 10 desgloses ya llegó al buzón (100 %)', tono: 'ok' });
    expect(hace(r, 'sin_captura')).toMatchObject({ quePaso: '100 % sin captura manual', tono: 'ok' });
    expect(hace(r, 'hora_envio').queSignifica).toBe('Un desglose tarda 2 h 15 min en salir desde que entra su bitácora');
    expect(hace(r, 'ahorro').quePaso).toBe('10 desgloses sin armarse a mano: unas 2 h de trabajo');
    expect(hace(r, 'ahorro').fuente).toMatch(/^Calculado por Likida/);
    expect(r.some((x) => x.tono === 'bad' || x.tono === 'warn')).toBe(false);
  });

  it('con rebotes: texto exacto, tono malo y primero en la lista', () => {
    const r = calcularInsightsA1({ ...base, entregados: 7, rebotados: 3 });
    expect(r[0]).toMatchObject({
      id: 'rebotes', tono: 'bad', quePaso: '3 correos rebotaron', queSignifica: 'Algunos operadores no recibieron su desglose',
      queHacer: 'Corrige el correo en la pantalla y reenvía',
    });
    expect(hace(r, 'cobertura')).toMatchObject({ quePaso: '7 de 10 desgloses ya llegó al buzón (70 %)', tono: 'warn' });
    expect(calcularInsightsA1({ ...base, rebotados: 1 })[0].quePaso).toBe('1 correo rebotó');
  });

  it('sin póliza: dice cuántas no se enviarán, qué hacer y la antigüedad', () => {
    const r = calcularInsightsA1({ ...base, sinPoliza: 4, sinPolizaAntiguedadDias: 3 });
    expect(hace(r, 'sin_poliza')).toMatchObject({
      tono: 'bad', quePaso: '4 bitácoras no se enviarán hasta tener póliza; la más antigua espera desde hace 3 días', queHacer: 'Revisa en el TMS',
    });
    expect(hace(calcularInsightsA1({ ...base, sinPoliza: 1 }), 'sin_poliza').quePaso).toBe('1 bitácora no se enviará hasta tener póliza');
  });

  it('sin línea base: no calcula ahorro ni inventa un porcentaje', () => {
    const r = calcularInsightsA1({ ...base, lineaBase: null });
    const a = hace(r, 'ahorro');
    expect(a).toMatchObject({ quePaso: 'Ahorro de tiempo: sin línea base', tono: 'muted' });
    expect(JSON.stringify(a)).not.toMatch(/\d+ h|\d+ %/);
    expect(calcularInsightsA1({ ...base, lineaBase: { minutosPorDesglose: 0, personas: 2 } }).find((x) => x.id === 'ahorro')!.quePaso).toBe('Ahorro de tiempo: sin línea base');
  });

  it('sin datos: una sola frase, sin cifras', () => {
    const r = calcularInsightsA1({ ...base, desgloses: 0, entregados: 0, enviados: 0, rebotados: 0, retenidos: 0, sinPoliza: 0 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'sin_datos', quePaso: TEXTO_SIN_DATOS, tono: 'muted' });
    expect(TEXTO_SIN_DATOS).toBe('Aún sin desgloses este periodo');
  });

  it('solo plan B: sin captura manual pero se avisa que todo vino por archivo', () => {
    const r = calcularInsightsA1({ ...base, origen: { pull: 0, importado: 10, captura: 0 } });
    expect(hace(r, 'sin_captura')).toMatchObject({ tono: 'warn' });
    expect(hace(r, 'sin_captura').quePaso).toBe('100 % sin captura manual, pero todo llegó por archivo');
    expect(hace(r, 'sin_captura').queHacer).toBe('Conecta el sistema de tu empresa para que lleguen solos');
  });

  it('mezcla: rebotes, retenidos, sin correo, corrección, captura a mano y una terminal que concentra', () => {
    const r = calcularInsightsA1({
      ...base, entregados: 5, rebotados: 3, retenidos: 2, sinPoliza: 1, operadorSinCorreo: 2, correccionPendiente: 1,
      origen: { pull: 6, importado: 2, captura: 2 },
      porTerminal: [{ terminal: 'Terminal Norte', desgloses: 6, rebotados: 3 }, { terminal: 'Terminal Sur', desgloses: 4, rebotados: 0 }],
    });
    expect(r.map((x) => x.tono)).toEqual([...r.map((x) => x.tono)].sort((a, b) => ['bad', 'warn', 'ok', 'muted'].indexOf(a) - ['bad', 'warn', 'ok', 'muted'].indexOf(b)));
    expect(hace(r, 'retenidos').quePaso).toBe('2 desgloses están retenidos');
    expect(hace(r, 'operador_sin_correo').quePaso).toBe('2 operadores no tienen correo registrado');
    expect(hace(r, 'correccion_pendiente').quePaso).toBe('1 operador pidió una corrección');
    expect(hace(r, 'sin_captura').quePaso).toBe('80 % sin captura manual (2 desgloses capturados a mano)');
    expect(hace(r, 'terminal').quePaso).toBe('Terminal Norte concentra 3 de 3 rebotes (6 desgloses en total)');
  });
});

describe('honestidad', () => {
  it('sin origen no afirma «sin captura manual»', () => {
    const r = calcularInsightsA1({ ...base, origen: null });
    expect(hace(r, 'sin_captura')).toMatchObject({ tono: 'muted', quePaso: 'No se puede afirmar «sin captura manual»' });
    expect(JSON.stringify(r)).not.toMatch(/\d+ % sin captura/);
  });

  it('un conteo no medido no es un cero: sin rebotados medidos no hay insight de rebotes ni de cobertura falsa', () => {
    const r = calcularInsightsA1({ ...base, rebotados: null, entregados: null });
    expect(por(r, 'rebotes')).toBeUndefined();
    expect(por(r, 'cobertura')).toBeUndefined();
  });

  it('nada medido ⇒ dice que no pudo leer, no «sin desgloses»', () => {
    const r = calcularInsightsA1({ periodo: 'hoy', desgloses: null, entregados: null, enviados: null, rebotados: null, retenidos: null, sinPoliza: null });
    expect(r).toHaveLength(1);
    expect(r[0].quePaso).toBe('No se pudieron leer los desgloses ahora');
  });

  it('la cobertura nunca pasa de 100 %', () => {
    expect(hace(calcularInsightsA1({ ...base, entregados: 12 }), 'cobertura').quePaso).toBe('10 de 10 desgloses ya llegó al buzón (100 %)');
  });

  it('NINGUNA salida lleva una cifra sin fuente, y lo estimado se rotula «calculado por Likida»', () => {
    const entradas: EntradaInsightsA1[] = [
      base,
      { ...base, entregados: 5, rebotados: 3, retenidos: 2, sinPoliza: 1, operadorSinCorreo: 2, correccionPendiente: 1, origen: { pull: 6, importado: 2, captura: 2 },
        porTerminal: [{ terminal: 'A', desgloses: 3, rebotados: 3 }, { terminal: 'B', desgloses: 3, rebotados: 0 }] },
      { ...base, lineaBase: null, origen: null },
      { ...base, desgloses: 0, entregados: 0, sinPoliza: 0 },
      entradaDesdeFichas({ enviados: 1, entregados: 2, rebotados: 1, retenidos: 0, sinPoliza: 2 }),
    ];
    for (const e of entradas) {
      for (const i of calcularInsightsA1(e)) {
        expect(i.fuente.trim().length, i.id).toBeGreaterThan(0);
        if (/\d/.test(`${i.quePaso} ${i.queSignifica}`)) expect(i.fuente, i.id).toMatch(/^(Likida:|Calculado por Likida)/);
        if (i.id === 'hora_envio' || i.id === 'ahorro') expect(i.fuente, i.id).toMatch(/^Calculado por Likida|^Pendiente/);
        expect(`${i.quePaso} ${i.queSignifica} ${i.queHacer}`).not.toMatch(/whatsapp|\bwa_|plantilla meta|botón/i);
      }
    }
  });

  it('es determinista', () => {
    expect(calcularInsightsA1(base)).toEqual(calcularInsightsA1({ ...base }));
  });
});

describe('adaptadores', () => {
  it('entradaDesdeConteo suma rebotada+queja+fallida y deja lo no medido en null', () => {
    const e = entradaDesdeConteo({ desgloses: 5, entregasPorEstado: { entregada: 3, rebotada: 1, queja: 1, fallida: 1, enviada: 2 }, excepcionesAbiertas: 0 }, 'hoy');
    expect(e).toMatchObject({ desgloses: 5, entregados: 3, enviados: 2, rebotados: 3, retenidos: null, sinPoliza: null });
  });

  it('desde fichas no inventa cobertura (no conoce los desgloses del periodo)', () => {
    const r = calcularInsightsA1(entradaDesdeFichas({ enviados: 1, entregados: 2, rebotados: 1, retenidos: 0, sinPoliza: 0 }));
    expect(por(r, 'cobertura')).toBeUndefined();
    expect(por(r, 'rebotes')).toBeDefined();
  });

  it('aInsightComun mapea el tono al tipo del panel de consumo', () => {
    const [mal] = calcularInsightsA1({ ...base, rebotados: 1 });
    expect(aInsightComun(mal)).toEqual({ tipo: 'problema', titulo: '1 correo rebotó', detalle: 'Algunos operadores no recibieron su desglose. Corrige el correo en la pantalla y reenvía.' });
  });
});
