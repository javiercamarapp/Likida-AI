import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { armarAvisoChofer, armarAvisoJefe, RUTA_DE_DIFERENCIA, type ResumenLiquidacion, type DiferenciaResumen } from './cierre_aviso';
import { mxn } from '@/lib/utils';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE CIERRE. LO QUE ESTE ARCHIVO PROTEGE SON DOS COSAS:
//
//   1. QUE NO SE AVISE DE LO QUE SALIÓ BIEN. Una flota de veinte unidades
//      cierra veinte viajes al día. Si los veinte mandan mensaje, el día que
//      llegue el que sí importa va a caer en la misma pila que los otros.
//      Por eso la prueba central no es "el texto dice X": es que una
//      liquidación cuadrada devuelva `requiereDecision: false`.
//
//   2. QUE UN CERO DE CAPTURA NO SE LEA COMO UN CERO DE LA FLOTA. Con el
//      anticipo sin registrar, `diferencia` vale −comprobado, y el mensaje
//      obvio —"te deben $8,400"— le prometería a un chofer un dinero que
//      nadie autorizó.
// ═══════════════════════════════════════════════════════════════════════════

const dif = (o: Partial<DiferenciaResumen> & Pick<DiferenciaResumen, 'tipo'>): DiferenciaResumen => ({
  concepto: 'Alimentación',
  monto: 0,
  nota: 'Nota de la diferencia.',
  ...o,
});

const liq = (o: Partial<ResumenLiquidacion> = {}): ResumenLiquidacion => ({
  folio: 'VJ-2026-0847',
  operador: 'Juan Pérez',
  anticipo: 5000,
  totalComprobado: 5000,
  diferencia: 0,
  diferencias: [],
  ...o,
});

// ─────────────────────────────────────────────────────────────────────────
// LA REGLA DE DISEÑO
// ─────────────────────────────────────────────────────────────────────────

describe('a quién se le avisa y a quién no', () => {
  it('una liquidación cuadrada NO pide decisión — y ese es el punto entero', () => {
    const r = armarAvisoJefe(liq());
    expect(r.requiereDecision).toBe(false);
  });

  it('cuando cuadró, el texto es UNA línea que se puede apilar en el resumen del día', () => {
    const r = armarAvisoJefe(liq());
    expect(r.texto.split('\n')).toHaveLength(1);
    // Con folio y operador: en una lista de veinte, "cuadró ✅" no dice de cuál.
    expect(r.texto).toContain('VJ-2026-0847');
    expect(r.texto).toContain('Juan Pérez');
    expect(r.texto).toContain(mxn(5000));
  });

  it('una con diferencias SÍ pide decisión', () => {
    const r = armarAvisoJefe(liq({
      diferencias: [dif({ tipo: 'sobre_politica', monto: 300, nota: 'Comida de $1,050 sobre el tope de $750.' })],
    }));
    expect(r.requiereDecision).toBe(true);
  });

  it('los centavos no despiertan a nadie: se usa el mismo umbral que el motor', () => {
    // El motor solo levanta la diferencia de anticipo con |dif| >= 0.5. Con un
    // umbral distinto aquí, el aviso diría "hay diferencia" de un viaje que el
    // panel enseña cuadrado.
    expect(armarAvisoJefe(liq({ anticipo: 5000, totalComprobado: 4999.7, diferencia: 0.3 })).requiereDecision).toBe(false);
    expect(armarAvisoJefe(liq({ anticipo: 5000, totalComprobado: 4999.4, diferencia: 0.6 })).requiereDecision).toBe(true);
  });

  it('lo que la máquina ya resolvió no despierta al jefe', () => {
    // El duplicado ya se excluyó del total y al chofer ya se le dijo. Avisar de
    // algo que ya está hecho es lo que entrena a ignorar el canal.
    const r = armarAvisoJefe(liq({
      diferencias: [dif({ tipo: 'duplicado', monto: 780, nota: 'Comprobante duplicado: Alimentación folio 3522 aparece 2 veces (una excluida del total).' })],
    }));
    expect(r.requiereDecision).toBe(false);
  });

  it('lo que ya tiene su propio canal tampoco: avisar dos veces quema los dos', () => {
    // `facturacion/avisar.ts` ya manda los plazos, con su plantilla y su
    // destinatario.
    const r = armarAvisoJefe(liq({
      diferencias: [
        dif({ tipo: 'factura_por_vencer', nota: 'El ticket de OXXO Gas vence en 2 días.' }),
        dif({ tipo: 'folio_verificar', nota: 'Folio leído con baja confianza.' }),
      ],
    }));
    expect(r.requiereDecision).toBe(false);
  });

  it('lo que todavía no es un hecho tampoco: no hay nada que decidir sobre una duda', () => {
    const r = armarAvisoJefe(liq({
      diferencias: [dif({ tipo: 'cfdi_pendiente', nota: 'El SAT no respondió; se reintenta.' })],
    }));
    expect(r.requiereDecision).toBe(false);
  });

  it('un tipo que el mapa no conozca despierta al jefe — se falla hacia avisar de más', () => {
    // Un veredicto nuevo en la base y viejo en el código no puede caer en la
    // rama de "no le avises a nadie".
    const r = armarAvisoJefe(liq({
      diferencias: [dif({ tipo: 'veredicto_del_futuro' as DiferenciaResumen['tipo'], nota: 'Algo que este código no clasifica.' })],
    }));
    expect(r.requiereDecision).toBe(true);
    expect(r.texto).toContain('Algo que este código no clasifica.');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GASTOS SOBRE POLÍTICA
// ─────────────────────────────────────────────────────────────────────────

describe('gastos sobre política', () => {
  const conPolitica = liq({
    diferencias: [dif({ tipo: 'sobre_politica', concepto: 'Alimentación', monto: 300, nota: 'Comida de $1,050 sobre el tope de $750 de la política.' })],
  });

  it('el jefe recibe el motivo tal como se calculó', () => {
    const r = armarAvisoJefe(conPolitica);
    expect(r.requiereDecision).toBe(true);
    expect(r.texto).toContain('sobre el tope de $750');
  });

  it('el chofer NO lo recibe: no fija la política y no puede resolverla', () => {
    // Mandárselo no produce ninguna acción, solo la sensación de que se le
    // está auditando. Su saldo sí lo recibe.
    const texto = armarAvisoChofer(conPolitica);
    expect(texto).not.toContain('política');
    expect(texto).toContain('Cuadró exacto');
  });

  it('lo caro va arriba, para que el recorte a 6 no se lleve lo que importa', () => {
    const muchas = Array.from({ length: 8 }, (_, i) =>
      dif({ tipo: 'sobre_politica', monto: i === 7 ? 9000 : 10, nota: i === 7 ? 'EL GRANDE' : `chico ${i}` }));
    const r = armarAvisoJefe(liq({ diferencias: muchas }));
    expect(r.texto).toContain('EL GRANDE');
    expect(r.texto).toContain('y 2 más en el panel');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FALTANTE DE COMPROBACIÓN
// ─────────────────────────────────────────────────────────────────────────

describe('faltante de comprobación', () => {
  it('pide decisión aunque el dinero cuadre al centavo', () => {
    // Cuadrar contra el anticipo no significa que esté comprobado. Son dos
    // preguntas distintas y solo una la contesta la resta.
    const r = armarAvisoJefe(liq({
      anticipo: 5000, totalComprobado: 5000, diferencia: 0,
      diferencias: [dif({ tipo: 'sin_comprobante', concepto: 'Caseta', monto: 1200, nota: 'Caseta del trayecto sin comprobante.' })],
    }));
    expect(r.requiereDecision).toBe(true);
    expect(r.texto).toContain('sin comprobante');
    // Y el encabezado sigue diciendo la verdad: contra el anticipo sí cuadra.
    expect(r.texto).toContain('Cuadra contra el anticipo');
  });

  it('un CFDI que falta también es faltante de comprobación', () => {
    expect(armarAvisoJefe(liq({
      diferencias: [dif({ tipo: 'sin_cfdi', nota: 'El gasto requiere CFDI y no lo trae.' })],
    })).requiereDecision).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// SIN ANTICIPO REGISTRADO — la regla de no inventar una cifra
// ─────────────────────────────────────────────────────────────────────────

describe('sin anticipo registrado', () => {
  // Con anticipo 0, `diferencia` vale −comprobado. Ese número existe, pero no
  // es una diferencia contra nada.
  const sinAnticipo = liq({ anticipo: 0, totalComprobado: 8400, diferencia: -8400 });

  it('NO se dice que cuadró: se dice que no hay anticipo registrado', () => {
    const r = armarAvisoJefe(sinAnticipo);
    expect(r.requiereDecision).toBe(true);
    expect(r.texto).toContain('Sin anticipo registrado');
    expect(r.texto).not.toMatch(/cuadr/i);
  });

  it('el jefe NO ve la diferencia con rótulo de diferencia: mentiría', () => {
    // El −8,400 existe, pero no es una diferencia contra nada. La misma cifra
    // sí sale con el rótulo que sí es verdad: lo comprobado.
    const r = armarAvisoJefe(sinAnticipo);
    expect(r.texto).toContain(`Comprobado ${mxn(8400)}`);
    expect(r.texto).not.toMatch(/de su bolsa|Sobró|Anticipo \$/);
  });

  it('al chofer NO se le promete un dinero que nadie autorizó', () => {
    const texto = armarAvisoChofer(sinAnticipo);
    expect(texto).not.toMatch(/Te deben/);
    expect(texto).toContain('No hay anticipo registrado');
    // Lo único cierto es lo que comprobó, y eso sí se le dice.
    expect(texto).toContain(mxn(8400));
  });

  it('sin anticipo y sin comprobantes se dice completo, no se inventa un encuadre', () => {
    const texto = armarAvisoChofer(liq({ anticipo: 0, totalComprobado: 0, diferencia: 0 }));
    expect(texto).toContain('No hay anticipo registrado ni comprobantes');
    expect(texto).not.toContain('Cuadró exacto');
    expect(armarAvisoJefe(liq({ anticipo: 0, totalComprobado: 0, diferencia: 0 })).requiereDecision).toBe(true);
  });

  it('una cifra ilegible se dice, no se imprime como $NaN ni se toma por cero', () => {
    // Un null de la base o un NaN de una resta. `mxn(null)` revienta y
    // `mxn(NaN)` imprime "$NaN" en el teléfono de quien liquida.
    const rota = liq({ totalComprobado: NaN, diferencia: NaN });
    const r = armarAvisoJefe(rota);
    expect(r.requiereDecision).toBe(true);
    expect(r.texto).toContain('no se pudieron leer');
    expect(r.texto).not.toContain('NaN');
    const texto = armarAvisoChofer(rota);
    expect(texto).toContain('No pude cerrar las cifras');
    expect(texto).not.toContain('NaN');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// EL MENSAJE DEL CHOFER
// ─────────────────────────────────────────────────────────────────────────

describe('aviso al chofer', () => {
  it('dice cuánto debe cuando le sobró anticipo', () => {
    const texto = armarAvisoChofer(liq({ anticipo: 5000, totalComprobado: 3800, diferencia: 1200 }));
    expect(texto).toContain(`Debes ${mxn(1200)}`);
  });

  it('dice cuánto le deben cuando puso de su bolsa', () => {
    const texto = armarAvisoChofer(liq({ anticipo: 5000, totalComprobado: 5800, diferencia: -800 }));
    expect(texto).toContain(`Te deben ${mxn(800)}`);
    expect(texto).toContain('de tu bolsa');
  });

  it('es corto: sin rechazos, dos líneas', () => {
    // Se lee en un teléfono, de un vistazo, sin hacer scroll.
    expect(armarAvisoChofer(liq()).split('\n')).toHaveLength(2);
  });
});

describe('comprobantes rechazados', () => {
  const rechazados = liq({
    anticipo: 5000, totalComprobado: 4200, diferencia: 800,
    diferencias: [
      dif({ tipo: 'duplicado', concepto: 'Alimentación', monto: 780, nota: 'Comprobante duplicado: Alimentación folio 3522 por $780.00 aparece 2 veces (una excluida del total).' }),
      dif({ tipo: 'monto_invalido', concepto: 'Caseta', monto: 0, nota: 'El comprobante de Caseta tiene un monto inválido ($0.00) — revisar a mano.' }),
    ],
  });

  it('el chofer ve cuáles y por qué, una línea cada uno', () => {
    const texto = armarAvisoChofer(rechazados);
    expect(texto).toContain('2 comprobantes no entraron en la cuenta:');
    expect(texto).toContain('• Comprobante duplicado: Alimentación folio 3522');
    expect(texto).toContain('• El comprobante de Caseta tiene un monto inválido');
  });

  it('no se repite el concepto cuando la nota ya lo dice', () => {
    // "Alimentación: Comprobante duplicado: Alimentación folio…" se lee como un
    // sistema roto.
    const texto = armarAvisoChofer(rechazados);
    expect(texto).not.toContain('Alimentación: Comprobante duplicado');
  });

  it('sí se antepone el concepto cuando la nota no lo nombra', () => {
    const texto = armarAvisoChofer(liq({
      diferencias: [dif({ tipo: 'duplicado', concepto: 'Diésel', nota: 'Ya lo habías mandado.' })],
    }));
    expect(texto).toContain('• Diésel: Ya lo habías mandado.');
  });

  it('NO se imprime el monto de la diferencia junto al comprobante', () => {
    // El monto de un duplicado de tres copias vale dos copias, no una. Puesto
    // junto al concepto se leería como el precio del ticket.
    const texto = armarAvisoChofer(liq({
      diferencias: [dif({ tipo: 'duplicado', concepto: 'Diésel', monto: 1560, nota: 'Ya lo habías mandado.' })],
    }));
    expect(texto).not.toContain(mxn(1560));
  });

  it('un veredicto fiscal NO se le anuncia al chofer como rechazo: a él sí se le paga', () => {
    // Un CFDI cancelado o un EFOS le cuestan a la flota la deducción; siguen
    // sumando al comprobado del operador. Decirle "te rechacé el comprobante"
    // sería el rótulo falso más caro del producto.
    const texto = armarAvisoChofer(liq({
      diferencias: [
        dif({ tipo: 'cfdi_efos', concepto: 'Diésel', nota: 'El emisor está en la lista negra 69-B del SAT.' }),
        dif({ tipo: 'cfdi_cancelado', concepto: 'Hospedaje', nota: 'El CFDI está cancelado ante el SAT.' }),
      ],
    }));
    expect(texto).not.toContain('no entraron en la cuenta');
    expect(texto).not.toContain('69-B');
    // Al jefe sí, que es quien puede pedir la refacturación.
    expect(armarAvisoJefe(liq({
      diferencias: [dif({ tipo: 'cfdi_efos', nota: 'El emisor está en la lista negra 69-B del SAT.' })],
    })).texto).toContain('69-B');
  });

  it('con muchos rechazos se corta, pero se dice cuántos quedaron fuera', () => {
    const muchos = Array.from({ length: 9 }, (_, i) =>
      dif({ tipo: 'duplicado', concepto: 'Diésel', nota: `Copia ${i}.` }));
    const texto = armarAvisoChofer(liq({ diferencias: muchos }));
    expect(texto).toContain('9 comprobantes no entraron en la cuenta:');
    expect(texto).toContain('y 3 más');
    // "en el panel" no: el chofer no tiene panel.
    expect(texto).not.toContain('en el panel');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LA RED QUE IMPIDE EL HUECO
// ─────────────────────────────────────────────────────────────────────────

describe('todo veredicto del motor está clasificado', () => {
  // El mapa es un `Record<TipoDiferencia, …>`, así que un tipo nuevo rompe la
  // compilación. Pero vitest transpila SIN comprobar tipos: sin esta prueba, un
  // veredicto sin clasificar viaja hasta `npx tsc` y mientras tanto las pruebas
  // pasan en verde. Se mide sobre el archivo de tipos, no sobre una lista a
  // mano que también se desactualiza.
  const fuente = readFileSync('src/types/cuadra.ts', 'utf8');
  const bloque = fuente.split('export type TipoDiferencia =')[1]?.split(';')[0] ?? '';
  const tipos = [...bloque.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);

  it('la prueba de verdad está leyendo el archivo de tipos', () => {
    expect(tipos.length).toBeGreaterThan(20);
    expect(tipos).toContain('sobre_politica');
  });

  it('ninguno se quedó sin ruta', () => {
    const sinClasificar = tipos.filter((t) => !(t in RUTA_DE_DIFERENCIA));
    expect(sinClasificar, `estos veredictos no están en RUTA_DE_DIFERENCIA:\n${sinClasificar.join('\n')}`).toEqual([]);
  });

  it('y el mapa no clasifica veredictos que ya no existen', () => {
    const fantasmas = Object.keys(RUTA_DE_DIFERENCIA).filter((t) => !tipos.includes(t));
    expect(fantasmas, `estos ya no están en TipoDiferencia:\n${fantasmas.join('\n')}`).toEqual([]);
  });
});
