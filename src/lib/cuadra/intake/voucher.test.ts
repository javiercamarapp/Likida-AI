import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decidirFoto } from './decidir';
import type { ExtraerResultado } from './ocr';
import type { Gasto } from '@/types/cuadra';
import { cuadrarViaje } from '@/lib/cuadra/cuadre/engine';
import { sinComentarios } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// 31-jul-2026 · EL VOUCHER DE LA TERMINAL ENTRABA COMO GASTO COMPLETO.
//
// Medido, no supuesto: se pasaron 14 fotos reales de Javier por el pipeline
// (14 llamadas de visión, $0.2384 USD). Entre ellas venían CUATRO pares de la
// misma compra —el voucher de Getnet y el ticket fiscal de la gasolinera—,
// porque la bomba escupe los dos papeles y el operador fotografía los dos.
//
//   24-jul  voucher 009857659  +  ticket 2085826         $500
//   18-jul  voucher 008729792  +  ticket 283665-K050042  $400
//   29-jul  voucher 059286188  +  ticket 286188          $400
//   15-jul  voucher 018976276  +  ticket 2976276-J122100 $300
//
// Los ocho entraron como gasto: $1,600 de comprobado fantasma sobre $1,600 de
// gasto real. El dedup del motor no los une porque su llave es
// `concepto|folio|monto` y el voucher enseña `Oper`/`Aut` mientras el ticket
// enseña `Ticket`: folios distintos, misma compra.
//
// No es un caso raro de laboratorio. Es lo que pasa en CADA carga de una flota.
//
// ── LA FIRMA QUE YA ESTABA EN LOS DATOS ────────────────────────────────────
//
// Los cinco vouchers salieron con `rfcEmisor: null` y `litros: null` y un monto
// presente. Los seis tickets fiscales, con los tres. La señal existía; nadie la
// miraba, porque el esquema del OCR no tenía dónde ponerla —`voucher`,
// `terminal` y `no es un comprobante fiscal` aparecían CERO veces en el prompt—.
// ═══════════════════════════════════════════════════════════════════════════

const base = (over: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', viajeId: 'v1', concepto: 'diesel', monto: 400, ...over,
} as Gasto);

const extraccion = (over: Partial<ExtraerResultado> = {}): ExtraerResultado => ({
  gasto: base(),
  legible: false,
  motivo: 'solo_pago',
  costo: { modelo: 'm', tokensIn: 0, tokensOut: 0, costoUsd: 0 },
  ...over,
} as ExtraerResultado);

describe('el voucher de la terminal no se da de alta dos veces', () => {
  it('con su ticket ya registrado, se PEGA a él en vez de crear otro gasto', () => {
    const ticket = base({ id: 'ticket-real', monto: 400 });
    const d = decidirFoto(extraccion(), [ticket]);
    expect(d).toEqual({ accion: 'enriquecer', gastoId: 'ticket-real' });
  });

  it('sin ticket al cual pegarse, se le PIDE — y tampoco se da de alta', () => {
    // El operador mandó primero el voucher. Pedirle el ticket es correcto: sin
    // él no hay RFC, ni litros, ni folio para facturar en el portal.
    expect(decidirFoto(extraccion(), [])).toEqual({ accion: 'pedir_ticket' });
  });

  it('con DOS gastos del mismo monto no adivina a cuál pegarse', () => {
    // Dos cargas de $400 el mismo viaje es normal. Elegir una al azar pegaría el
    // pago a la carga equivocada; se pide el ticket y no se pierde nada.
    const dos = [base({ id: 'a' }), base({ id: 'b' })];
    expect(decidirFoto(extraccion(), dos)).toEqual({ accion: 'pedir_ticket' });
  });

  it('un comprobante normal SIGUE dándose de alta', () => {
    // El límite: si esto se rompiera, el arreglo del voucher habría dejado de
    // registrar gastos buenos, que cuesta mucho más que el bug que cierra.
    const ok = extraccion({ legible: true, motivo: undefined });
    expect(decidirFoto(ok, [])).toEqual({ accion: 'alta' });
  });
});

describe('la señal que lo distingue, y su límite', () => {
  const OCR = sinComentarios(readFileSync('src/lib/cuadra/intake/ocr.ts', 'utf8'));

  it('un papel solo es voucher si NO trae RFC ni litros', () => {
    // Ante la duda entra como gasto: perder un comprobante bueno —el operador se
    // come la carga— cuesta más que dejar pasar un voucher, que el dedup del
    // motor todavía puede atrapar. La asimetría es deliberada y va en el código.
    expect(OCR).toMatch(/documento === 'voucher_pago'/);
    expect(OCR).toMatch(/!gasto\.rfcEmisor/);
    expect(OCR).toMatch(/litros == null/);
  });

  it('el prompt describe cómo se ve un voucher, no solo la palabra', () => {
    // Nombrar el concepto sin las señales impresas deja al modelo adivinando.
    const prompt = readFileSync('src/lib/cuadra/intake/ocr.ts', 'utf8');
    for (const marca of ['ARQC', 'Autorizado sin firma', 'Getnet', 'voucher_pago']) {
      expect(prompt, `el prompt no menciona ${marca}`).toContain(marca);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL PAPEL QUE DICE DE SÍ MISMO QUE NO SIRVE.
//
// Entre las 14 fotos venía un ticket de restaurante de ese mismo día con RFC,
// subtotal e IVA desglosado... y abajo, impreso: "ESTE NO ES UN COMPROBANTE
// FISCAL". Entró como $116 de alimentación sin que nada lo notara.
//
// Se trata DISTINTO al voucher, y la diferencia es el dinero del operador: un
// voucher es dinero que YA está representado por su ticket fiscal, así que no
// puede entrar dos veces. Una nota no fiscal es dinero que el operador puso y
// del que no hay otro papel — si no entrara, se lo come de su bolsa.
// ═══════════════════════════════════════════════════════════════════════════
describe('la nota no fiscal SÍ entra, pero avisa', () => {
  it('no se trata como voucher: el gasto se da de alta', () => {
    const ocr = sinComentarios(readFileSync('src/lib/cuadra/intake/ocr.ts', 'utf8'));
    // La marca va en `ocrExtra`, no en `motivo`: `motivo` impide el alta.
    expect(ocr).toMatch(/MARCA_NO_FISCAL\]: data\.documento === 'nota_no_fiscal'/);
    expect(ocr).not.toMatch(/motivo.*nota_no_fiscal/);
  });

  it('el motor levanta la diferencia y cita el 29-A', () => {
    const engine = readFileSync('src/lib/cuadra/cuadre/engine.ts', 'utf8');
    expect(engine).toMatch(/tipo: 'comprobante_no_fiscal'/);
    // `monto: 0` — informa, no le castiga el gasto al chofer por lo que le dio
    // el negocio.
    expect(engine).toMatch(/tipo: 'comprobante_no_fiscal', concepto: g\.concepto, monto: 0/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL CONTRATO DE LA NOTA NO FISCAL, EN PESOS Y SIN GASTAR UN CENTAVO.
//
// Las dos pruebas de arriba miran el código fuente, que sirve para fijar la
// forma pero no dice qué le pasa al dinero. Esto corre el motor de verdad, con
// el ticket real de $116 que salió en las 14 fotos.
//
// Lo que tiene que valer, y es lo que distingue esta diferencia de todas las
// demás: el gasto SIGUE contando. El operador puso ese dinero y se le repone.
// Lo que no puede es pasar por deducible.
// ═══════════════════════════════════════════════════════════════════════════
describe('la nota no fiscal, en pesos', () => {
  const gasto = (over: Partial<Gasto> = {}): Gasto => ({
    id: 'g-nota', viajeId: 'v1', concepto: 'alimentacion', monto: 116,
    fecha: '2026-07-31', ocrConfianza: 0.95, ...over,
  } as Gasto);

  const cuadre = (g: Gasto) => cuadrarViaje({
    viajeId: 'v1', anticipo: 500, gastos: [g],
    politica: [{ concepto: 'alimentacion', topeMonto: 800 }],
    empresaRfc: 'CCO8605231N4', hoy: '2026-07-31',
  });

  it('el gasto SIGUE contando en el comprobado: al operador se le repone', () => {
    const liq = cuadre(gasto({ ocrExtra: { noEsComprobanteFiscal: true } }));
    expect(liq.totalComprobado, 'excluirlo sería que el chofer se coma su comida').toBe(116);
  });

  it('pero NO pasa por deducible', () => {
    const liq = cuadre(gasto({ ocrExtra: { noEsComprobanteFiscal: true } }));
    expect(liq.totalDeducible).toBe(0);
  });

  it('levanta la diferencia, cita el 29-A y dice qué hacer', () => {
    const liq = cuadre(gasto({ ocrExtra: { noEsComprobanteFiscal: true } }));
    const d = (liq.diferencias ?? []).find((x) => x.tipo === 'comprobante_no_fiscal');
    expect(d, 'no se levantó la diferencia').toBeDefined();
    expect(d!.monto, 'informa; no le castiga el gasto al chofer').toBe(0);
    expect(d!.nota).toMatch(/29-A/);
    expect(d!.nota).toMatch(/pedirle la factura/);
    expect(d!.gastoId).toBe('g-nota');
  });

  it('sin la marca no se levanta nada: el mismo ticket, sin la leyenda impresa', () => {
    // El control. Sin esto, una diferencia que se levantara SIEMPRE pasaría
    // estas pruebas igual y estaría gritando sobre cada comida del país.
    const liq = cuadre(gasto());
    expect((liq.diferencias ?? []).some((x) => x.tipo === 'comprobante_no_fiscal')).toBe(false);
  });
});
