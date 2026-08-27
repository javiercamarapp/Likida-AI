import { describe, it, expect } from 'vitest';
import { armarDesglose, type CostosDeclarados, type EntradaCotizacion } from './motor';
import { viajesDeMismaRuta } from './lector';

// ═══════════════════════════════════════════════════════════════════════════
// EL MOTOR DEL COTIZADOR — los escenarios que definen el contrato:
//   1. Todo declarado + casetas MEDIDAS → precio sugerido con cada supuesto
//      en su línea y la fuente de la medición dicha.
//   2. Sin un costo declarado → SIN precio, y la lista dice exactamente qué
//      falta (null jamás como 0: un diésel supuesto cotiza a pérdida).
//   3. Sin histórico de la ruta → las casetas capturadas a mano entran con
//      su supuesto; sin captura → faltante.
//   4. El margen se aplica sobre el costo completo, nunca sobre uno a medias.
//   5. El pacto de detención es NOTA, no costo: una estadía no se afirma
//      antes de que pase.
// ═══════════════════════════════════════════════════════════════════════════

const COSTOS: CostosDeclarados = {
  dieselPorKm: 12,
  salarioDia: 800,
  viaticosDia: 400,
  fijosPorKm: 3,
  factorRegresoVacio: 2,
  margenObjetivoPct: 20,
};

function entrada(extra: Partial<EntradaCotizacion> = {}): EntradaCotizacion {
  return {
    km: 500,
    dias: 2,
    casetas: { tipo: 'medida', promedio: 1850.5, viajes: 7 },
    costos: COSTOS,
    pactoDetencion: null,
    ...extra,
  };
}

describe('armarDesglose — el camino completo', () => {
  it('con todo declarado y casetas medidas, arma costo y precio con supuestos', () => {
    const d = armarDesglose(entrada());
    // Diésel: 12 × 500 × 2 = 12,000 · Fijos: 3 × 500 × 2 = 3,000
    // Operador: (800+400) × 2 = 2,400 · Casetas medidas: 1,850.50
    expect(d.costoTotal).toBe(12000 + 3000 + 2400 + 1850.5);
    // Margen 20%: el precio sugerido sale del costo COMPLETO.
    expect(d.precioSugerido).toBe(Math.round(d.costoTotal! * 1.2 * 100) / 100);
    expect(d.faltantes).toEqual([]);
    // La fuente de la medición viaja EN la línea, con el conteo de viajes.
    const casetas = d.lineas.find((l) => l.concepto === 'Casetas')!;
    expect(casetas.supuesto).toContain('MEDIDO');
    expect(casetas.supuesto).toContain('7 viajes liquidados');
    // Cada línea con monto trae su supuesto no vacío.
    for (const l of d.lineas) expect(l.supuesto.length).toBeGreaterThan(0);
  });

  it('el factor de regreso multiplica diésel y fijos, no las casetas medidas', () => {
    const conFactor1 = armarDesglose(entrada({ costos: { ...COSTOS, factorRegresoVacio: 1 } }));
    const conFactor2 = armarDesglose(entrada());
    // Solo cambian los renglones por km: (12+3)×500 de diferencia.
    expect(conFactor2.costoTotal! - conFactor1.costoTotal!).toBe(15 * 500);
    const casetas1 = conFactor1.lineas.find((l) => l.concepto === 'Casetas')!;
    const casetas2 = conFactor2.lineas.find((l) => l.concepto === 'Casetas')!;
    expect(casetas1.monto).toBe(casetas2.monto);
  });
});

describe('armarDesglose — lo no declarado NO se inventa', () => {
  it('sin diésel declarado: sin costo total, sin precio, y el faltante dicho', () => {
    const d = armarDesglose(entrada({ costos: { ...COSTOS, dieselPorKm: null } }));
    expect(d.costoTotal).toBeNull();
    expect(d.precioSugerido).toBeNull();
    expect(d.faltantes).toContain('el costo de diésel por km (config)');
    // Las demás líneas calculables SÍ se muestran: lo incompleto no apaga
    // lo que sí se sabe.
    expect(d.lineas.find((l) => l.concepto === 'Operador (salario y viáticos)')!.monto).toBe(2400);
  });

  it('viáticos declarados en 0 NO son "sin declarar": el costo sale', () => {
    const d = armarDesglose(entrada({ costos: { ...COSTOS, viaticosDia: 0 } }));
    expect(d.costoTotal).toBe(12000 + 3000 + 1600 + 1850.5);
    expect(d.faltantes).toEqual([]);
  });

  it('sin margen declarado: el costo sí, el precio no, y el faltante dicho', () => {
    const d = armarDesglose(entrada({ costos: { ...COSTOS, margenObjetivoPct: null } }));
    expect(d.costoTotal).not.toBeNull();
    expect(d.precioSugerido).toBeNull();
    expect(d.faltantes).toContain('el margen objetivo (config)');
  });

  it('sin km: los renglones por km no se calculan y el faltante lo dice', () => {
    const d = armarDesglose(entrada({ km: null }));
    expect(d.costoTotal).toBeNull();
    expect(d.faltantes).toContain('los km de la ruta');
    expect(d.lineas.find((l) => l.concepto === 'Diésel')!.monto).toBeNull();
  });

  it('un NaN colado se trata como no declarado, jamás como número', () => {
    const d = armarDesglose(entrada({ costos: { ...COSTOS, dieselPorKm: Number.NaN } }));
    expect(d.costoTotal).toBeNull();
    expect(d.lineas.every((l) => l.monto === null || Number.isFinite(l.monto))).toBe(true);
  });
});

describe('armarDesglose — las casetas y su jerarquía de fuentes', () => {
  it('capturadas a mano: entran con el supuesto de captura, no de medición', () => {
    const d = armarDesglose(entrada({ casetas: { tipo: 'capturada', monto: 900 } }));
    const l = d.lineas.find((x) => x.concepto === 'Casetas')!;
    expect(l.monto).toBe(900);
    expect(l.supuesto).toContain('capturado a mano');
    expect(l.supuesto).not.toContain('MEDIDO');
  });

  it('sin medición ni captura: faltante dicho, jamás $0', () => {
    const d = armarDesglose(entrada({ casetas: { tipo: 'falta' } }));
    expect(d.costoTotal).toBeNull();
    expect(d.faltantes).toContain('las casetas (captura manual)');
    expect(d.lineas.find((x) => x.concepto === 'Casetas')!.monto).toBeNull();
  });

  it('una medición rota (promedio NaN) degrada a faltante, no a silencio', () => {
    const d = armarDesglose(entrada({ casetas: { tipo: 'medida', promedio: Number.NaN, viajes: 3 } }));
    expect(d.faltantes).toContain('las casetas (captura manual)');
  });
});

describe('armarDesglose — el pacto de detención es nota, no costo', () => {
  it('con pacto completo: la nota lo cita y el costo NO lo suma', () => {
    const sin = armarDesglose(entrada());
    const con = armarDesglose(entrada({
      pactoDetencion: { horasLibres: 8, tarifaHora: 350, origen: 'cliente' },
    }));
    expect(con.costoTotal).toBe(sin.costoTotal);
    expect(con.notas.some((n) => n.includes('8 h libres') && n.includes('$350/h') && n.includes('NO sumado'))).toBe(true);
  });

  it('sin pacto: la nota avisa que las estadías no tendrían tarifa cobrable', () => {
    const d = armarDesglose(entrada());
    expect(d.notas.some((n) => n.includes('Sin pacto de detención'))).toBe(true);
  });
});

describe('viajesDeMismaRuta — la ruta se compara normalizada', () => {
  const viajes = [
    { id: 'a', origen: 'León', destino: 'CDMX' },
    { id: 'b', origen: 'leon ', destino: ' cdmx' },
    { id: 'c', origen: 'León', destino: 'Monterrey' },
    { id: 'd', origen: null, destino: 'CDMX' },
  ];

  it('acentos, mayúsculas y espacios no parten la ruta en dos', () => {
    const r = viajesDeMismaRuta(viajes, 'leon', 'CDMX');
    expect(r.map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('otra ruta u origen nulo quedan fuera', () => {
    expect(viajesDeMismaRuta(viajes, 'León', 'Monterrey').map((v) => v.id)).toEqual(['c']);
  });
});
