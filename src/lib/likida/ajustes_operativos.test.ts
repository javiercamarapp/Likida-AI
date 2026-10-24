import { describe, it, expect } from 'vitest';
import {
  validarAjustes, parsearCuentas, formatearCuentas, esFormato, FORMATOS, type AjustesCrudos,
} from './ajustes_operativos';
import { DatoInvalido } from './errores';

const BUENOS: AjustesCrudos = {
  rendimientoPorDefecto: '3.0',
  factorCarga: '0.78',
  precioDieselPorDefecto: '27',
  umbralDesviacionPct: '15',
  salida: 'csv',
  cuentas: 'diesel=600-001\ncaseta=600-002',
};

describe('validarAjustes — el umbral entra en % y sale en fracción', () => {
  it('15 (%) se guarda como 0.15, que es lo que el motor lee', () => {
    // Si esto se rompe, el motor compara una desviación de 0.18 contra 15 y
    // NUNCA marca nada — sin un solo error en el log.
    expect(validarAjustes(BUENOS).tabulador.umbralDesviacion).toBe(0.15);
  });

  it('no arrastra la cola binaria de dividir entre 100', () => {
    // 15/100 en punto flotante es 0.15000000000000002 y esa cola se guardaría
    // tal cual en el jsonb, y se vería en pantalla.
    const r = validarAjustes({ ...BUENOS, umbralDesviacionPct: '15' });
    expect(String(r.tabulador.umbralDesviacion)).toBe('0.15');
  });

  it('acepta la coma decimal — es como se teclea en México', () => {
    expect(validarAjustes({ ...BUENOS, factorCarga: '0,78' }).tabulador.factorCarga).toBe(0.78);
  });
});

describe('validarAjustes — los rangos protegen al motor, no al formulario', () => {
  it('un rendimiento de 0 haría una división entre cero', () => {
    expect(() => validarAjustes({ ...BUENOS, rendimientoPorDefecto: '0' })).toThrow(DatoInvalido);
  });

  it('un factor de carga > 1 invertiría la relación cargado/vacío', () => {
    // Con factor 1.2 el motor esperaría MENOS diésel en el viaje cargado, y la
    // diferencia se leería como "el chofer se robó menos".
    expect(() => validarAjustes({ ...BUENOS, factorCarga: '1.2' })).toThrow(/factor de carga/i);
  });

  it('el factor de carga sí puede ser exactamente 1 (flota que va siempre vacía)', () => {
    expect(validarAjustes({ ...BUENOS, factorCarga: '1' }).tabulador.factorCarga).toBe(1);
  });

  it('un umbral de 0% marcaría todos los viajes y uno de 100% ninguno', () => {
    expect(() => validarAjustes({ ...BUENOS, umbralDesviacionPct: '0' })).toThrow(DatoInvalido);
    expect(() => validarAjustes({ ...BUENOS, umbralDesviacionPct: '100' })).toThrow(DatoInvalido);
  });

  it('un diésel a $2 o a $500 es un dedazo, no una configuración', () => {
    expect(() => validarAjustes({ ...BUENOS, precioDieselPorDefecto: '2' })).toThrow(DatoInvalido);
    expect(() => validarAjustes({ ...BUENOS, precioDieselPorDefecto: '500' })).toThrow(DatoInvalido);
  });

  it('un campo vacío se cacha: Number("") es 0 y 0 pasaría de largo', () => {
    expect(() => validarAjustes({ ...BUENOS, rendimientoPorDefecto: '' })).toThrow(/Falta/);
    expect(() => validarAjustes({ ...BUENOS, precioDieselPorDefecto: '   ' })).toThrow(/Falta/);
  });

  it('texto que no es número no se convierte en NaN silencioso', () => {
    expect(() => validarAjustes({ ...BUENOS, factorCarga: 'mucho' })).toThrow(/número/);
  });
});

describe('validarAjustes — el formato de salida', () => {
  it('acepta el que el export SÍ sabe escribir', () => {
    expect(validarAjustes({ ...BUENOS, salida: 'csv' }).salida).toBe('csv');
  });

  it('RECHAZA los que el tipo admite pero el export no escribe', () => {
    // `config.salida` existe en el tipo desde hace tiempo, pero nadie la lee:
    // `aFilasExport` produce siempre el mismo renglón. Guardar 'contpaqi_txt'
    // dejaría la config diciendo una cosa y el archivo descargado siendo otra,
    // y nadie se enteraría porque el CSV sale igual de bien.
    for (const f of ['contpaqi_txt', 'aspel_xls']) {
      expect(() => validarAjustes({ ...BUENOS, salida: f })).toThrow(/todavía no lo escribe el export/);
    }
  });

  it('cada formato declara si está implementado — la pantalla lo lee de aquí', () => {
    // Si alguien implementa el layout de CONTPAQi y olvida marcarlo, esta
    // prueba no truena; la de arriba sí, y es la que obliga a venir aquí.
    expect(FORMATOS.find((f) => f.valor === 'csv')!.implementado).toBe(true);
    expect(FORMATOS.every((f) => typeof f.implementado === 'boolean')).toBe(true);
  });

  it('rechaza uno inventado — el export no sabría qué escribir', () => {
    expect(() => validarAjustes({ ...BUENOS, salida: 'sap_idoc' })).toThrow(DatoInvalido);
  });

  it('esFormato es el mismo juicio, para la pantalla', () => {
    expect(esFormato('csv')).toBe(true);
    expect(esFormato('xml')).toBe(false);
  });
});

describe('parsearCuentas — el contador pega su Excel', () => {
  it('A37-S28-10: «constructor» y «__proto__» son conceptos válidos, no duplicados falsos', () => {
    const r = parsearCuentas('constructor=600-001\n__proto__=600-002');
    expect(Object.keys(r)).toEqual(['constructor', '__proto__']);
    expect(Object.getOwnPropertyDescriptor(r, '__proto__')?.value).toBe('600-002');
    expect(() => parsearCuentas('constructor=1\nconstructor=2')).toThrow(/ya tiene cuenta/);
  });

  it('A37-S28-10: acota número de líneas y longitud del concepto', () => {
    expect(() => parsearCuentas(Array.from({ length: 501 }, (_, i) => `c${i}=1`).join('\n'))).toThrow(/demasiadas líneas/);
    expect(() => parsearCuentas(`${'x'.repeat(81)}=1`)).toThrow(/concepto es demasiado largo/);
  });

  it('lee el bloque entero, una cuenta por línea', () => {
    expect(parsearCuentas('diesel=600-001\ncaseta=600-002')).toEqual({
      diesel: '600-001', caseta: '600-002',
    });
  });

  it('ignora líneas vacías y espacios de sobra', () => {
    expect(parsearCuentas('\n  diesel = 600-001  \n\n caseta=600-002 \n')).toEqual({
      diesel: '600-001', caseta: '600-002',
    });
  });

  it('el concepto se normaliza a minúsculas — el motor busca así', () => {
    expect(parsearCuentas('DIESEL=600-001')).toEqual({ diesel: '600-001' });
  });

  it('una cuenta con "=" adentro se respeta: corta en el PRIMERO', () => {
    expect(parsearCuentas('diesel=600=001')).toEqual({ diesel: '600=001' });
  });

  it('un renglón sin "=" dice QUÉ línea, no "formato inválido"', () => {
    expect(() => parsearCuentas('diesel=600-001\ncaseta 600-002')).toThrow(/Línea 2/);
  });

  it('un duplicado se avisa en vez de dejar que el último gane callado', () => {
    // Silenciarlo dejaría al contador buscando por qué su primera cuenta no
    // se aplicó.
    expect(() => parsearCuentas('diesel=600-001\ndiesel=600-999')).toThrow(/Línea 2.*ya tiene cuenta/s);
  });

  it('falta el concepto o falta la cuenta — los dos se cachan', () => {
    expect(() => parsearCuentas('=600-001')).toThrow(/falta el concepto/i);
    expect(() => parsearCuentas('diesel=')).toThrow(/falta la cuenta/i);
  });

  it('un catálogo vacío no se guarda: el export saldría sin cuenta en cada renglón', () => {
    expect(() => validarAjustes({ ...BUENOS, cuentas: '   \n\n ' })).toThrow(/no puede quedar vacío/);
  });
});

describe('formatearCuentas — el viaje de regreso', () => {
  it('ordena alfabéticamente para que el textarea no baile entre cargas', () => {
    expect(formatearCuentas({ diesel: '600-001', caseta: '600-002' }))
      .toBe('caseta=600-002\ndiesel=600-001');
  });

  it('ida y vuelta conserva exactamente lo mismo', () => {
    const original = { caseta: '600-002', diesel: '600-001', flete: '600-005' };
    expect(parsearCuentas(formatearCuentas(original))).toEqual(original);
  });
});

describe('lo que NO se puede tocar', () => {
  it('los ajustes válidos NO incluyen estímulos, hidrocarburos ni validación', () => {
    // El corte es legal, no de UI: una flota que se sube el peajeFactor a 0.8
    // no está configurando su software, está declarando un estímulo que la ley
    // no le da, con nuestro PDF como evidencia.
    const r = validarAjustes(BUENOS) as unknown as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(['catalogoCuentas', 'salida', 'tabulador']);
    expect(r.estimulos).toBeUndefined();
    expect(r.hidrocarburos).toBeUndefined();
    expect(r.validacion).toBeUndefined();
    expect(r.empresa).toBeUndefined();
  });
});

// A36-R01-02 (oleada 4): el precio del diésel y el rendimiento son números que
// tecleó una persona. `Number('50,000'.replace(',', '.'))` daba 50, que cae
// DENTRO del rango del diésel (5-99) y se guardaba sin una sola queja.
describe('validarAjustes — separadores ambiguos no se adivinan', () => {
  const diesel = (v: string) => () => validarAjustes({ ...BUENOS, precioDieselPorDefecto: v });

  it.each(['50,000', '52,500', '1.234'])('«%s» es ambiguo (decimal o miles): se rechaza, no se guarda 50', (v) => {
    expect(diesel(v)).toThrow(DatoInvalido);
    expect(diesel(v)).toThrow(/número/);
  });

  it('los casos no ambiguos conservan su valor', () => {
    expect(validarAjustes({ ...BUENOS, precioDieselPorDefecto: '22,5' }).tabulador.precioDieselPorDefecto).toBe(22.5);
    expect(validarAjustes({ ...BUENOS, precioDieselPorDefecto: '22.50' }).tabulador.precioDieselPorDefecto).toBe(22.5);
    expect(validarAjustes({ ...BUENOS, rendimientoPorDefecto: '0,5' }).tabulador.rendimientoPorDefecto).toBe(0.5);
  });

  it('«1,234.50» y «1.234,50» se leen como 1234.5 (y el rango los rechaza por grandes, no por basura)', () => {
    expect(diesel('1,234.50')).toThrow(/entre/);
    expect(diesel('1.234,50')).toThrow(/entre/);
  });

  it('vacío y texto basura se rechazan', () => {
    expect(diesel('')).toThrow(/Falta/);
    expect(diesel('   ')).toThrow(/Falta/);
    expect(diesel('abc')).toThrow(/número/);
    expect(diesel('2x,5')).toThrow(/número/);
  });
});
