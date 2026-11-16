import { describe, expect, it } from 'vitest';
import { CUENTAS_PROPUESTAS } from './cuentas';
import {
  aCentavos, aPesos, armarBalanza, asientoCuadra, balanceGeneral, bloqueantesEnRojo, comprobacionesLibro, delPeriodo, estadoDeResultados, folioDe,
  hashDe, hastaPeriodo, HASH_CERO, invertir, lineasCanon, lineasDeFormulario, reversaNeutraliza, saldoNatural, textoCanonico, validarAsiento, verificarCadenaHash,
  type AsientoLibro, type LineaAsiento,
} from './libro';
import { armarLibro, cobro, gastoNube } from './libro_fixtures';

const CUENTAS = CUENTAS_PROPUESTAS.map((c) => ({ ...c }));

describe('validarAsiento', () => {
  it('un asiento que cuadra (debe = haber, dos renglones, un lado por renglón) no tiene errores', () => {
    expect(validarAsiento(cobro(10050), CUENTAS)).toEqual([]);
    expect(asientoCuadra(cobro(10050))).toBe(true);
  });

  it('descuadrado: lo rechaza y dice cuánto', () => {
    const l: LineaAsiento[] = [{ cuenta: '1110', debeCent: 10000, haberCent: 0 }, { cuenta: '4100', debeCent: 0, haberCent: 9999 }];
    expect(validarAsiento(l)).toEqual([{ tipo: 'descuadre', debeCent: 10000, haberCent: 9999 }]);
    expect(asientoCuadra(l)).toBe(false);
  });

  it('un solo renglón, o un renglón con debe y haber (o ninguno), se rechazan', () => {
    expect(validarAsiento([{ cuenta: '1110', debeCent: 100, haberCent: 0 }]).map((e) => e.tipo)).toContain('pocas_lineas');
    const ambos = validarAsiento([{ cuenta: '1110', debeCent: 100, haberCent: 100 }, { cuenta: '4100', debeCent: 0, haberCent: 0 }]);
    expect(ambos.filter((e) => e.tipo === 'debe_y_haber').map((e) => 'cuenta' in e && e.cuenta)).toEqual(['1110', '4100']);
  });

  it('centavos no enteros o negativos son importes inválidos (el dinero se cuenta en enteros)', () => {
    const e = validarAsiento([{ cuenta: '1110', debeCent: 10.5, haberCent: 0 }, { cuenta: '4100', debeCent: 0, haberCent: -10.5 }]);
    expect(e.filter((x) => x.tipo === 'monto_invalido')).toHaveLength(2);
  });

  it('cuenta mal formada, inexistente o inactiva', () => {
    expect(validarAsiento([{ cuenta: '12', debeCent: 1, haberCent: 0 }, { cuenta: '4100', debeCent: 0, haberCent: 1 }]).map((e) => e.tipo)).toEqual(['cuenta_invalida']);
    expect(validarAsiento([{ cuenta: '9999', debeCent: 1, haberCent: 0 }, { cuenta: '4100', debeCent: 0, haberCent: 1 }], CUENTAS).map((e) => e.tipo)).toEqual(['cuenta_inexistente']);
    expect(validarAsiento([{ cuenta: '7100', debeCent: 1, haberCent: 0 }, { cuenta: '4100', debeCent: 0, haberCent: 1 }], CUENTAS).map((e) => e.tipo)).toEqual(['cuenta_inactiva']);
  });
});

describe('reversa', () => {
  it('invertir cambia los lados y la reversa neutraliza al original cuenta por cuenta', () => {
    const original = cobro(12345);
    const reversa = invertir(original);
    expect(reversa[0]).toMatchObject({ cuenta: '1110', debeCent: 0, haberCent: 12345 });
    expect(reversa[1]).toMatchObject({ cuenta: '4100', debeCent: 12345, haberCent: 0 });
    expect(asientoCuadra(reversa)).toBe(true);
    expect(reversaNeutraliza(original, reversa)).toBe(true);
    expect(reversaNeutraliza(original, original)).toBe(false);
  });

  it('el libro con asiento y reversa deja el mayor en cero', () => {
    const libro = armarLibro([
      { fecha: '2026-10-05', lineas: cobro(10000) },
      { fecha: '2026-10-07', lineas: invertir(cobro(10000)), origenTipo: 'reversa', reversaDe: 'id-1' },
    ]);
    const b = armarBalanza(libro, CUENTAS);
    expect(b.filas.every((f) => f.saldoCent === 0)).toBe(true);
    expect(b.cuadra).toBe(true);
  });
});

describe('saldos, balanza, resultados y balance', () => {
  it('saldoNatural: deudora = debe − haber; acreedora = haber − debe', () => {
    expect(saldoNatural('D', 500, 200)).toBe(300);
    expect(saldoNatural('A', 200, 500)).toBe(300);
  });

  const libro = armarLibro([
    { fecha: '2026-09-30', lineas: [{ cuenta: '1110', debeCent: 500000, haberCent: 0 }, { cuenta: '3110', debeCent: 0, haberCent: 500000 }], descripcion: 'Aportación inicial' },
    { fecha: '2026-10-05', lineas: cobro(120000) },
    { fecha: '2026-10-09', lineas: gastoNube(30000) },
    { fecha: '2026-10-12', lineas: [{ cuenta: '6110', debeCent: 5000, haberCent: 0 }, { cuenta: '1110', debeCent: 0, haberCent: 5000 }] },
  ]);

  it('la balanza solo trae cuentas con movimiento, ordenadas, y cuadra', () => {
    const b = armarBalanza(libro, CUENTAS);
    expect(b.filas.map((f) => f.cuenta)).toEqual(['1110', '3110', '4100', '5100', '6110']);
    expect(b.totalDebeCent).toBe(b.totalHaberCent);
    expect(b.cuadra).toBe(true);
    expect(b.filas.find((f) => f.cuenta === '1110')?.saldoCent).toBe(500000 + 120000 - 30000 - 5000);
    expect(b.sinCatalogo).toEqual([]);
  });

  it('una cuenta fuera del catálogo se muestra y se avisa; no se esconde', () => {
    const raro = armarLibro([{ fecha: '2026-10-05', lineas: [{ cuenta: '9999', debeCent: 100, haberCent: 0 }, { cuenta: '4100', debeCent: 0, haberCent: 100 }] }]);
    expect(armarBalanza(raro, CUENTAS).sinCatalogo).toEqual(['9999']);
  });

  it('estado de resultados del mes: ingresos − costos − gastos, y «sin movimientos» no es una utilidad de cero', () => {
    const e = estadoDeResultados(delPeriodo(libro, '2026-10-01'), CUENTAS);
    expect(e).toMatchObject({ ingresosCent: 120000, costosCent: 30000, gastosCent: 5000, utilidadBrutaCent: 90000, resultadoCent: 85000, hayMovimientos: true });
    const vacio = estadoDeResultados(delPeriodo(libro, '2026-08-01'), CUENTAS);
    expect(vacio.hayMovimientos).toBe(false);
    expect(vacio.porCuenta).toEqual([]);
    // septiembre solo tiene capital: no toca cuentas de resultados
    expect(estadoDeResultados(delPeriodo(libro, '2026-09-01'), CUENTAS).hayMovimientos).toBe(false);
  });

  it('una contra-cuenta de ingreso (4210, deudora) resta de los ingresos', () => {
    const l = armarLibro([
      { fecha: '2026-10-05', lineas: cobro(100000) },
      { fecha: '2026-10-06', lineas: [{ cuenta: '4210', debeCent: 10000, haberCent: 0 }, { cuenta: '1110', debeCent: 0, haberCent: 10000 }] },
    ]);
    expect(estadoDeResultados(l, CUENTAS).ingresosCent).toBe(90000);
  });

  it('balance general acumulado: activo = pasivo + capital + resultado', () => {
    const b = balanceGeneral(libro, CUENTAS);
    expect(b).toMatchObject({ activoCent: 585000, pasivoCent: 0, capitalCent: 500000, resultadoCent: 85000, diferenciaCent: 0, cuadra: true });
    expect(balanceGeneral(hastaPeriodo(libro, '2026-09-01'), CUENTAS)).toMatchObject({ activoCent: 500000, capitalCent: 500000, resultadoCent: 0, cuadra: true });
  });

  it('delPeriodo y hastaPeriodo filtran por el mes del asiento', () => {
    expect(delPeriodo(libro, '2026-10-01')).toHaveLength(3);
    expect(hastaPeriodo(libro, '2026-10-01')).toHaveLength(4);
    expect(delPeriodo(libro, '2026-11-01')).toEqual([]);
  });
});

describe('cadena de hash', () => {
  it('folioDe: cuatro dígitos con ceros y sin truncar los largos', () => {
    expect(folioDe(1)).toBe('A-0001');
    expect(folioDe(42)).toBe('A-0042');
    expect(folioDe(12345)).toBe('A-12345');
  });

  it('el canónico de líneas es el mismo que arma la base (n:cuenta:debeCent:haberCent)', () => {
    expect(lineasCanon([{ cuenta: '1110', debeCent: 10050, haberCent: 0 }, { cuenta: '4100', debeCent: 0, haberCent: 10050 }])).toBe('1:1110:10050:0;2:4100:0:10050');
    expect(textoCanonico({ folio: 'A-0001', claveIdem: 'prueba-1014-a', fechaNeg: '2026-10-05', origenTipo: 'manual', reversaDe: null, lineas: cobro(10050) }))
      .toBe('A-0001|prueba-1014-a|2026-10-05|manual||1:1110:10050:0;2:4100:0:10050');
  });

  it('hashDe es sha256 hexadecimal de anterior|texto', () => {
    expect(hashDe(HASH_CERO, 'x')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDe(HASH_CERO, 'x')).toBe(hashDe(HASH_CERO, 'x'));
    expect(hashDe(HASH_CERO, 'x')).not.toBe(hashDe(HASH_CERO, 'y'));
  });

  const sano = (): AsientoLibro[] => armarLibro([
    { fecha: '2026-10-05', lineas: cobro(10000) },
    { fecha: '2026-10-06', lineas: gastoNube(2500) },
    { fecha: '2026-10-07', lineas: cobro(5000) },
  ]);

  it('un libro bien encadenado está íntegro', () => {
    expect(verificarCadenaHash(sano())).toEqual({ integra: true, primerRotoFolio: null, motivo: null, huecos: 0 });
  });

  it('alterar un importe rompe la cadena y nombra el folio del asiento alterado', () => {
    const libro = sano();
    libro[1] = { ...libro[1], lineas: gastoNube(2501) };
    expect(verificarCadenaHash(libro)).toMatchObject({ integra: false, primerRotoFolio: 'A-0002', motivo: 'hash' });
  });

  it('alterar la fecha también se detecta; un enlace roto se marca como enlace', () => {
    const libro = sano();
    libro[0] = { ...libro[0], fechaNeg: '2026-10-06' };
    expect(verificarCadenaHash(libro)).toMatchObject({ primerRotoFolio: 'A-0001', motivo: 'hash' });
    const enlace = sano();
    enlace[2] = { ...enlace[2], hashAnterior: HASH_CERO };
    expect(verificarCadenaHash(enlace)).toMatchObject({ primerRotoFolio: 'A-0003', motivo: 'enlace' });
  });

  it('un hueco de folios se cuenta aunque los hashes encadenen', () => {
    const libro = sano();
    const sinMedio = [libro[0], { ...libro[2], seq: 3, hashAnterior: libro[0].hash }];
    const r = verificarCadenaHash(sinMedio);
    expect(r.huecos).toBe(1);
    expect(r.integra).toBe(false);
  });

  it('una porción (desdeInicio: false) no exige que empiece en 1 ni en ceros', () => {
    const libro = sano();
    expect(verificarCadenaHash([libro[1], libro[2]], { desdeInicio: false }).integra).toBe(true);
    expect(verificarCadenaHash([libro[1], libro[2]]).integra).toBe(false);
  });
});

describe('comprobaciones por dos vías', () => {
  const libro = armarLibro([
    { fecha: '2026-10-05', lineas: cobro(10000) },
    { fecha: '2026-10-06', lineas: gastoNube(2500) },
  ]);
  const porCodigo = (c: ReturnType<typeof comprobacionesLibro>) => Object.fromEntries(c.map((x) => [x.codigo, x]));

  it('con el libro sano: C3, C10, C21 y CU1 en verde y con las dos vías iguales; C4 no evaluable sin auxiliares', () => {
    const c = porCodigo(comprobacionesLibro(libro, CUENTAS));
    for (const k of ['C3', 'C10', 'C21', 'CU1']) {
      expect(c[k].ok, k).toBe(true);
      expect(c[k].viaA.cent, k).toBe(c[k].viaB.cent);
      expect(c[k].bloqueante, k).toBe(true);
    }
    expect(c.C4).toMatchObject({ ok: null, bloqueante: false });
    expect(c.C4.viaA.cent).toBeNull();
  });

  it('un libro vacío tampoco rompe nada: todo en verde con ceros reales', () => {
    const c = porCodigo(comprobacionesLibro([], CUENTAS));
    expect(c.C3.ok).toBe(true);
    expect(c.C21.ok).toBe(true);
    expect(c.CU1.ok).toBe(true);
  });

  it('asiento descuadrado: C3, C10 y CU1 se ponen en rojo y son bloqueantes', () => {
    const roto = armarLibro([{ fecha: '2026-10-05', lineas: [{ cuenta: '1110', debeCent: 10000, haberCent: 0 }, { cuenta: '4100', debeCent: 0, haberCent: 9000 }] }]);
    const c = comprobacionesLibro(roto, CUENTAS);
    expect(bloqueantesEnRojo(c).map((x) => x.codigo).sort()).toEqual(['C10', 'C3', 'CU1']);
  });

  it('cadena alterada: C21 en rojo con el asiento roto contado', () => {
    const alterado = [...libro];
    alterado[0] = { ...alterado[0], lineas: cobro(10001) };
    const c = porCodigo(comprobacionesLibro(alterado, CUENTAS));
    expect(c.C21.ok).toBe(false);
    expect(c.C21.viaA.cent).toBe(1);
    expect(bloqueantesEnRojo(Object.values(c)).map((x) => x.codigo)).toContain('C21');
  });

  it('C4 con auxiliares: coincide, no coincide, y sin dato NO es verde ni roja', () => {
    // El libro deja el banco (1110) en 10000 − 2500 = 7500.
    const ok = porCodigo(comprobacionesLibro(libro, CUENTAS, { auxiliares: [{ cuenta: '1110', fuente: 'tesoreria', saldoCent: 7500 }] }));
    expect(ok.C4).toMatchObject({ ok: true });
    expect(ok.C4.viaA.cent).toBe(7500);
    const mal = porCodigo(comprobacionesLibro(libro, CUENTAS, { auxiliares: [{ cuenta: '1110', fuente: 'tesoreria', saldoCent: 7000 }] }));
    expect(mal.C4.ok).toBe(false);
    const sinDato = porCodigo(comprobacionesLibro(libro, CUENTAS, { auxiliares: [{ cuenta: '1110', fuente: 'tesoreria', saldoCent: null }] }));
    expect(sinDato.C4.ok).toBeNull();
    expect(sinDato.C4.viaB.cent).toBeNull();
    // una C4 en rojo es informativa: no bloquea
    expect(bloqueantesEnRojo(Object.values(mal))).toEqual([]);
  });

  it('una comprobación no evaluable no bloquea', () => {
    expect(bloqueantesEnRojo(comprobacionesLibro(libro, CUENTAS))).toEqual([]);
  });
});

describe('conversión y formulario', () => {
  it('aCentavos redondea al centavo (el caso 0.005 y los flotantes de siempre)', () => {
    expect(aCentavos(1234.56)).toBe(123456);
    expect(aCentavos('10.05')).toBe(1005);
    expect(aCentavos(0.1 + 0.2)).toBe(30);
    expect(aPesos(123456)).toBe(1234.56);
  });

  const forma = (campos: Record<string, string>) => (c: string) => campos[c] ?? '';

  it('lee los renglones llenos, ignora los vacíos y convierte a centavos', () => {
    const r = lineasDeFormulario(forma({ cuenta_1: '1110', debe_1: '1,234.50', cuenta_2: '4100', haber_2: '1234.50' }));
    expect(r.errores).toEqual([]);
    expect(r.lineas).toEqual([
      { cuenta: '1110', debeCent: 123450, haberCent: 0 },
      { cuenta: '4100', debeCent: 0, haberCent: 123450 },
    ]);
  });

  it('un importe ilegible o con más de dos decimales NO se adivina', () => {
    expect(lineasDeFormulario(forma({ cuenta_1: '1110', debe_1: '50,000' })).errores).toEqual([{ n: 1, tipo: 'monto_ilegible' }]);
    expect(lineasDeFormulario(forma({ cuenta_1: '1110', debe_1: 'abc' })).errores).toEqual([{ n: 1, tipo: 'monto_ilegible' }]);
    expect(lineasDeFormulario(forma({ cuenta_2: '4100', haber_2: '10.0050' })).errores).toEqual([{ n: 2, tipo: 'mas_de_dos_decimales' }]);
  });

  it('un renglón con cuenta pero sin importes se conserva con ceros para que la validación lo rechace', () => {
    const r = lineasDeFormulario(forma({ cuenta_1: '1110' }));
    expect(r.lineas).toEqual([{ cuenta: '1110', debeCent: 0, haberCent: 0 }]);
    expect(validarAsiento(r.lineas).map((e) => e.tipo)).toContain('debe_y_haber');
  });
});
