import { describe, it, expect } from 'vitest';
import type { FacturaRow } from './comercial';
import {
  diaMx, clasificarAntiguedad, esFacturaViva, armarCartera, armarEnLaMesa,
  CUBETAS, CUBETAS_VENCIDAS, LIMITE_EN_LA_MESA,
  type ViajeLiquidado,
} from './facturacion_clientes';

// ═══════════════════════════════════════════════════════════════════════════
// Todo lo que se prueba aquí es PURO: sin base, sin reloj, sin mock de
// PostgREST — que además acepta cualquier `.select()` y no probaría la consulta
// de todos modos (`embeds_con_alias.test.ts` lo dice con detalle).
//
// Lo que estas pruebas defienden son DOS cosas, y las dos son rótulos que
// tendrían que ser verdad:
//
//   1. "Vencido" se deriva contra UN SOLO `hoy`. El bug gemelo ya se documentó
//      en `libro_viaje.ts`: la vista `factura_saldo` calcula `vencida` con el
//      `current_date` de Postgres, y contar los días contra otro reloj deja
//      pasar la combinación imposible «vencida · 0 días vencida».
//   2. Un hueco no es un cero. Una factura sin `vence_en` no está corriente, un
//      viaje sin `ingreso_flete` no valió $0, y un viaje con su factura
//      cancelada vuelve a estar sin facturar.
// ═══════════════════════════════════════════════════════════════════════════

const HOY = '2026-08-14';

const factura = (over: Partial<FacturaRow> = {}): FacturaRow => ({
  id: 'f-1',
  folio: 'A-100',
  cliente: 'Cementos del Norte',
  fecha: '2026-07-01',
  total: 50_000,
  pagado: 0,
  saldo: 50_000,
  estatus: 'emitida',
  venceEn: '2026-07-31',
  // La columna de la VISTA. Entra en cada fixture a propósito: lo que se prueba
  // abajo es que NO la use nadie.
  vencida: false,
  ...over,
});

const viaje = (over: Partial<ViajeLiquidado> = {}): ViajeLiquidado => ({
  id: '11111111-2222-3333-4444-555555555555',
  folio: 'VJ-2026-0845',
  origen: 'Monterrey',
  destino: 'Querétaro',
  cliente: 'Cementos del Norte',
  ingresoFlete: 100_000,
  liquidadoEn: '2026-08-01',
  ...over,
});

const vacio = () => ({ conFacturaViva: new Set<string>(), conBorrador: new Set<string>(), hoy: HOY });

// ── El día del calendario mexicano ─────────────────────────────────────────

describe('diaMx: el cierre nocturno NO se pasa al día siguiente', () => {
  it('un timestamptz de las 20:30 hora de México sigue siendo ese día', () => {
    // 2026-08-14T02:30:00Z son las 20:30 del 13 de agosto en CST (UTC−6).
    // `.slice(0,10)` habría dicho "14": un día de más en "lleva N sin facturar".
    expect(diaMx('2026-08-14T02:30:00Z')).toBe('2026-08-13');
  });

  it('un timestamptz de media mañana cae en su propio día', () => {
    expect(diaMx('2026-08-14T16:00:00Z')).toBe('2026-08-14');
  });

  it('un valor de SOLO FECHA se devuelve tal cual, sin correrlo un día', () => {
    // La otra mitad de la lección: `viaje.fecha_fin` es `date`, no tiene zona, y
    // convertirlo a hora de México lo movería HACIA ATRÁS.
    expect(diaMx('2026-08-14')).toBe('2026-08-14');
    expect(diaMx('  2026-01-01  ')).toBe('2026-01-01');
  });

  it('lo que no se puede leer es null, no una fecha inventada', () => {
    expect(diaMx(null)).toBeNull();
    expect(diaMx(undefined)).toBeNull();
    expect(diaMx('')).toBeNull();
    expect(diaMx('ayer')).toBeNull();
    expect(diaMx(1_755_000_000_000)).toBeNull();
  });
});

// ── Las cubetas ────────────────────────────────────────────────────────────

describe('clasificarAntiguedad: en qué cubeta cae cada saldo', () => {
  it('sin fecha pactada no es corriente ni vencida: es sin_fecha', () => {
    const a = clasificarAntiguedad(null, HOY);
    expect(a.cubeta).toBe('sin_fecha');
    expect(a.diasVencida).toBeNull();
    expect(a.rotulo).toBe('Sin crédito pactado');
  });

  it('una fecha ilegible tampoco se supone vigente — se dice', () => {
    const a = clasificarAntiguedad('31-07-2026', HOY);
    expect(a.cubeta).toBe('sin_fecha');
    expect(a.diasVencida).toBeNull();
    expect(a.rotulo).toBe('No se pudo leer su vencimiento');
  });

  it('el día del vencimiento TODAVÍA no está vencido', () => {
    const a = clasificarAntiguedad(HOY, HOY);
    expect(a.cubeta).toBe('corriente');
    expect(a.diasVencida).toBeNull();
    expect(a.rotulo).toBe('Vence hoy');
  });

  it('lo que aún no vence dice cuánto le falta, no cuánto lleva', () => {
    expect(clasificarAntiguedad('2026-08-15', HOY).rotulo).toBe('Vence mañana');
    expect(clasificarAntiguedad('2026-08-24', HOY).rotulo).toBe('Vence en 10 días');
    expect(clasificarAntiguedad('2026-08-24', HOY).cubeta).toBe('corriente');
  });

  it('el primer día de atraso ya cae en la cubeta 1-30', () => {
    const a = clasificarAntiguedad('2026-08-13', HOY);
    expect(a.cubeta).toBe('v1_30');
    expect(a.diasVencida).toBe(1);
    expect(a.rotulo).toBe('Vencida ayer');
  });

  it('los bordes 30/31 y 60/61 caen donde se decidió, no al azar', () => {
    // 30 días exactos: 2026-07-15 → 2026-08-14.
    expect(clasificarAntiguedad('2026-07-15', HOY).cubeta).toBe('v1_30');
    expect(clasificarAntiguedad('2026-07-14', HOY).cubeta).toBe('v31_60');
    // 60 días exactos: 2026-06-15 → 2026-08-14. El 60 es de la cubeta 31-60.
    expect(clasificarAntiguedad('2026-06-15', HOY).diasVencida).toBe(60);
    expect(clasificarAntiguedad('2026-06-15', HOY).cubeta).toBe('v31_60');
    expect(clasificarAntiguedad('2026-06-14', HOY).cubeta).toBe('v60_mas');
  });

  it('NUNCA «vencida · 0 días vencida»: el rótulo y los días salen del mismo cálculo', () => {
    // El bug de los dos relojes, barrido sobre medio año alrededor de hoy.
    for (let salto = -180; salto <= 180; salto++) {
      const d = new Date(Date.UTC(2026, 7, 14) + salto * 86_400_000);
      const vence = d.toISOString().slice(0, 10);
      const a = clasificarAntiguedad(vence, HOY);

      if (CUBETAS_VENCIDAS.includes(a.cubeta)) {
        // Si está en una cubeta vencida, lleva AL MENOS un día vencida.
        expect(a.diasVencida, `${vence} cayó en ${a.cubeta} sin días`).not.toBeNull();
        expect(a.diasVencida as number).toBeGreaterThanOrEqual(1);
        expect(a.rotulo).toMatch(/^Vencida /);
      } else {
        // Y si no, el rótulo no puede decir "vencida".
        expect(a.diasVencida).toBeNull();
        expect(a.rotulo).not.toMatch(/Vencida/);
      }
    }
  });
});

describe('esFacturaViva', () => {
  it('el borrador y la cancelada no son dinero que alguien deba', () => {
    expect(esFacturaViva('emitida')).toBe(true);
    expect(esFacturaViva('pagada')).toBe(true);
    expect(esFacturaViva('borrador')).toBe(false);
    expect(esFacturaViva('cancelada')).toBe(false);
  });
});

// ── La cartera ─────────────────────────────────────────────────────────────

describe('armarCartera: la antigüedad de saldos', () => {
  it('sin facturas no afirma nada: todo en cero y ninguna cubeta con renglones', () => {
    const c = armarCartera([], HOY);
    expect(c.facturas).toEqual([]);
    expect(c.vivas).toBe(0);
    expect(c.porCobrar).toBe(0);
    expect(c.vencido).toBe(0);
    expect(c.clientes).toEqual([]);
    expect(c.cubetas.map((x) => x.facturas)).toEqual([0, 0, 0, 0, 0]);
    expect(c.hoy).toBe(HOY);
  });

  it('las cubetas vienen SIEMPRE las cinco, en el orden en que se pintan', () => {
    const c = armarCartera([factura()], HOY);
    expect(c.cubetas.map((x) => x.clave)).toEqual(CUBETAS.map((x) => x.clave));
  });

  it('la suma de las cubetas cuadra con el por cobrar', () => {
    const c = armarCartera([
      factura({ id: 'a', venceEn: '2026-09-30' }),               // corriente
      factura({ id: 'b', venceEn: '2026-08-01', saldo: 10_000 }), // 13 días
      factura({ id: 'c', venceEn: '2026-06-01', saldo: 7_500 }),  // 74 días
      factura({ id: 'd', venceEn: null, saldo: 2_500 }),          // sin fecha
    ], HOY);
    const suma = c.cubetas.reduce((s, x) => s + x.saldo, 0);
    expect(suma).toBe(c.porCobrar);
    expect(c.porCobrar).toBe(70_000);
  });

  it('un residuo de un centavo no descuadra el total contra las cubetas', () => {
    // El umbral es el MISMO de la base (`factura_saldo`, 0049): con saldo de un
    // centavo la factura está saldada. Si el total lo sumara y las cubetas no,
    // el renglón "Total por cobrar" dejaría de ser la suma de las columnas de
    // arriba — la única comprobación que un contralor le hace a esta tabla de
    // un vistazo.
    const c = armarCartera([
      factura({ id: 'a', total: 50_000, pagado: 20_000, saldo: 30_000, venceEn: '2026-08-01' }),
      factura({ id: 'b', total: 10_000, pagado: 9_999.99, saldo: 0.01, venceEn: '2026-06-01' }),
    ], HOY);
    expect(c.porCobrar).toBe(30_000);
    expect(c.cubetas.reduce((s, x) => s + x.saldo, 0)).toBe(c.porCobrar);
    // Y la de un centavo no se acusa de vencida: la base ya la da por saldada.
    expect(c.vencido).toBe(30_000);
    expect(c.clientes[0].saldo).toBe(30_000);
  });

  it('"vencido" son las tres cubetas de atraso — la de sin fecha NO cuenta', () => {
    const c = armarCartera([
      factura({ id: 'a', venceEn: '2026-08-01', saldo: 10_000 }), // vencida
      factura({ id: 'b', venceEn: null, saldo: 40_000 }),         // sin condiciones
      factura({ id: 'c', venceEn: '2026-09-30', saldo: 25_000 }), // corriente
    ], HOY);
    expect(c.vencido).toBe(10_000);
    expect(c.sinCondiciones).toBe(1);
    // Suponer 30 días de crédito pintaría de rojo $40,000 que nadie pactó.
    expect(c.cubetas.find((x) => x.clave === 'sin_fecha')?.saldo).toBe(40_000);
  });

  it('IGNORA la columna `vencida` de la vista: un solo reloj manda', () => {
    // La vista la calcula con el `current_date` de Postgres. Si esta función la
    // creyera, la factura saldría marcada vencida y con 0 días vencida — la
    // combinación imposible que este archivo existe para no producir.
    const c = armarCartera([factura({ venceEn: '2026-09-30', vencida: true })], HOY);
    expect(c.vencido).toBe(0);
    expect(c.facturas[0].antiguedad.cubeta).toBe('corriente');
    expect(c.facturas[0].antiguedad.diasVencida).toBeNull();
  });

  it('el borrador y la cancelada no engordan la cartera, pero se cuentan', () => {
    const c = armarCartera([
      factura({ id: 'a', estatus: 'emitida', saldo: 10_000, venceEn: '2026-08-01' }),
      factura({ id: 'b', estatus: 'borrador', saldo: 90_000, venceEn: null }),
      factura({ id: 'c', estatus: 'cancelada', saldo: 70_000, venceEn: '2026-06-01' }),
    ], HOY);
    expect(c.vivas).toBe(1);
    expect(c.borradores).toBe(1);
    expect(c.canceladas).toBe(1);
    expect(c.porCobrar).toBe(10_000);
    expect(c.vencido).toBe(10_000);
    // Los tres renglones siguen en la tabla: la pantalla los distingue.
    expect(c.facturas).toHaveLength(3);
  });

  it('una factura ya pagada no engorda la columna "corriente"', () => {
    const c = armarCartera([
      factura({ id: 'a', total: 50_000, pagado: 50_000, saldo: 0, venceEn: '2026-09-30' }),
      factura({ id: 'b', total: 20_000, pagado: 0, saldo: 20_000, venceEn: '2026-09-30' }),
    ], HOY);
    expect(c.facturado).toBe(70_000);
    expect(c.cobrado).toBe(50_000);
    expect(c.porCobrar).toBe(20_000);
    expect(c.cubetas.find((x) => x.clave === 'corriente')).toMatchObject({ saldo: 20_000, facturas: 1 });
  });

  it('un pago parcial deja el saldo en su cubeta, no el total', () => {
    const c = armarCartera([
      factura({ total: 50_000, pagado: 30_000, saldo: 20_000, venceEn: '2026-08-01' }),
    ], HOY);
    expect(c.vencido).toBe(20_000);
    expect(c.cubetas.find((x) => x.clave === 'v1_30')?.saldo).toBe(20_000);
  });

  it('agrupa por cliente y pone arriba a quien más debe vencido', () => {
    const c = armarCartera([
      factura({ id: 'a', cliente: 'Alfa', saldo: 90_000, venceEn: '2026-09-30' }),
      factura({ id: 'b', cliente: 'Beta', saldo: 10_000, venceEn: '2026-06-01' }),
      factura({ id: 'c', cliente: 'Beta', saldo: 5_000, venceEn: '2026-08-10' }),
    ], HOY);
    expect(c.clientes.map((x) => x.cliente)).toEqual(['Beta', 'Alfa']);
    const beta = c.clientes[0];
    expect(beta.facturas).toBe(2);
    expect(beta.saldo).toBe(15_000);
    expect(beta.vencido).toBe(15_000);
    expect(beta.porCubeta.v60_mas).toBe(10_000);
    expect(beta.porCubeta.v1_30).toBe(5_000);
    // La más atrasada de ese cliente: 2026-06-01 → 74 días.
    expect(beta.diasMasVencido).toBe(74);
    expect(c.clientes[1].vencido).toBe(0);
    expect(c.clientes[1].diasMasVencido).toBeNull();
  });

  it('ordena la tabla por lo más vencido, con lo no vivo al final', () => {
    const c = armarCartera([
      factura({ id: 'corriente', venceEn: '2026-09-30' }),
      factura({ id: 'cancelada', estatus: 'cancelada', venceEn: '2026-01-01' }),
      factura({ id: 'vieja', venceEn: '2026-06-01' }),
      factura({ id: 'nueva', venceEn: '2026-08-10' }),
    ], HOY);
    expect(c.facturas.map((f) => f.id)).toEqual(['vieja', 'nueva', 'corriente', 'cancelada']);
  });
});

// ── El dinero en la mesa ───────────────────────────────────────────────────

describe('armarEnLaMesa: viajes liquidados que nadie facturó', () => {
  it('un viaje con factura viva NO está en la mesa', () => {
    const m = armarEnLaMesa({
      ...vacio(),
      viajes: [viaje({ id: 'v1' })],
      conFacturaViva: new Set(['v1']),
    });
    expect(m.total).toBe(0);
    expect(m.viajes).toEqual([]);
    expect(m.ingresoCapturado).toBe(0);
  });

  it('un viaje con solo BORRADOR sigue sin facturar, pero se dice', () => {
    // Likida no timbra: el UUID del CFDI llega de fuera (0049). Un borrador es
    // papel que todavía no le cobra a nadie — pero tampoco es "nadie lo tocó".
    const m = armarEnLaMesa({
      ...vacio(),
      viajes: [viaje({ id: 'v1' })],
      conBorrador: new Set(['v1']),
    });
    expect(m.total).toBe(1);
    expect(m.conBorrador).toBe(1);
    expect(m.viajes[0].soloBorrador).toBe(true);
  });

  it('un viaje cuya única factura se canceló vuelve a la mesa', () => {
    // El caso que previó la 0049 en el comentario de `factura_viaje`: "un viaje
    // puede refacturarse tras una cancelación". Una cancelada no marca nada.
    const m = armarEnLaMesa({ ...vacio(), viajes: [viaje({ id: 'v1' })] });
    expect(m.total).toBe(1);
    expect(m.viajes[0].soloBorrador).toBe(false);
  });

  it('un viaje sin ingreso capturado NO suma cero: se cuenta aparte', () => {
    const m = armarEnLaMesa({
      ...vacio(),
      viajes: [
        viaje({ id: 'a', ingresoFlete: 80_000 }),
        viaje({ id: 'b', ingresoFlete: null }),
        viaje({ id: 'c', ingresoFlete: '' }),
      ],
    });
    expect(m.total).toBe(3);
    expect(m.ingresoCapturado).toBe(80_000);
    expect(m.sinIngreso).toBe(2);
    expect(m.viajes.find((v) => v.viajeId === 'b')?.ingreso).toBeNull();
  });

  it('cuenta los días desde que se liquidó, contra el mismo hoy', () => {
    const m = armarEnLaMesa({
      ...vacio(),
      viajes: [viaje({ liquidadoEn: '2026-08-01' })],
    });
    expect(m.viajes[0].diasSinFacturar).toBe(13);
    expect(m.diasMasViejo).toBe(13);
  });

  it('un viaje que no se puede fechar no recibe fecha inventada, y va al final', () => {
    const m = armarEnLaMesa({
      ...vacio(),
      viajes: [
        viaje({ id: 'sinFecha', liquidadoEn: null }),
        viaje({ id: 'viejo', liquidadoEn: '2026-05-01' }),
        viaje({ id: 'nuevo', liquidadoEn: '2026-08-10' }),
      ],
    });
    expect(m.viajes.map((v) => v.viajeId)).toEqual(['viejo', 'nuevo', 'sinFecha']);
    expect(m.viajes[2].diasSinFacturar).toBeNull();
    // El más viejo se mide sobre los que SÍ se pueden fechar.
    expect(m.diasMasViejo).toBe(105);
  });

  it('sin un solo viaje fechable, no hay "el más viejo" que inventar', () => {
    const m = armarEnLaMesa({ ...vacio(), viajes: [viaje({ liquidadoEn: null })] });
    expect(m.diasMasViejo).toBeNull();
  });

  it('un viaje sin folio se puede citar por teléfono de todos modos', () => {
    const m = armarEnLaMesa({
      ...vacio(),
      viajes: [viaje({ id: 'abcdef01-2222-3333-4444-555555555555', folio: null })],
    });
    expect(m.viajes[0].folio).toBe('abcdef01');
  });

  it('arma la ruta con lo que haya, y null cuando no hay nada', () => {
    const m = armarEnLaMesa({
      ...vacio(),
      viajes: [
        viaje({ id: 'a', origen: 'Monterrey', destino: 'Querétaro' }),
        viaje({ id: 'b', origen: 'Monterrey', destino: null }),
        viaje({ id: 'c', origen: null, destino: null, liquidadoEn: null }),
      ],
    });
    const porId = new Map(m.viajes.map((v) => [v.viajeId, v.ruta]));
    expect(porId.get('a')).toBe('Monterrey → Querétaro');
    expect(porId.get('b')).toBe('Monterrey');
    expect(porId.get('c')).toBeNull();
  });

  it('recorta la LISTA pero nunca las cifras', () => {
    // Recortar la lista está bien; recortar la suma sin decirlo produce la cifra
    // inventada más fácil de este archivo.
    const muchos = Array.from({ length: LIMITE_EN_LA_MESA + 10 }, (_, i) => viaje({
      id: `v${i}`,
      folio: `VJ-${i}`,
      ingresoFlete: 1_000,
      liquidadoEn: '2026-08-01',
    }));
    const m = armarEnLaMesa({ ...vacio(), viajes: muchos });
    expect(m.viajes).toHaveLength(LIMITE_EN_LA_MESA);
    expect(m.total).toBe(LIMITE_EN_LA_MESA + 10);
    expect(m.ingresoCapturado).toBe((LIMITE_EN_LA_MESA + 10) * 1_000);
  });
});
