import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extraerComprobante, CONCEPTOS_OCR, type ExtraerResultado } from './intake/ocr';
import { decidirFoto } from './intake/decidir';
import { cuadrarViaje, cubetaDe, etiquetaConcepto } from './cuadre/engine';
import { DEMO_CONFIG } from './config';
import type { Gasto, Liquidacion } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS DE TICKET REAL — corre el pipeline COMPLETO sobre una foto de verdad.
//
//     TICKET_PATH=~/Downloads/ticket.jpg npx vitest run arnes_ticket_real
//     TICKET_PATH="a.jpg,b.jpg" npx vitest run arnes_ticket_real   ← dos fotos
//
// Gasta dinero real (una llamada de visión por corrida, ~$0.02 USD) y necesita
// OPENROUTER_API_KEY, así que se SALTA solo cuando no hay `TICKET_PATH`. Nunca
// rompe CI y nunca cuesta sin que alguien lo pida.
//
// POR QUÉ VIVE EN EL REPO: la versión anterior de este arnés se escribió en un
// directorio temporal, se perdió al cerrar la sesión y hubo que reconstruirla.
//
// POR QUÉ PASA LA CONFIG ENTERA: el arnés viejo mandaba solo `politica`. Sin
// `estimulos` no se evalúa el tope de $750/día, y sin `hoy` no corren ni la
// fecha ni el plazo de facturación. Probar con fotos reales contra un motor a
// medias probaba menos de lo que parecía: un ticket de $1,050 de comida pasaba
// sin que nadie notara que excede el tope.
//
// ───────────────────────────────────────────────────────────────────────────
// AUDITORÍA 5 · ALTO — este archivo tenía CERO `expect`.
//
// Era el único de la suite sin una sola assertion: corría el pipeline entero y
// lo imprimía por consola. Con `TICKET_PATH` puesto y ~$0.02 gastados, PASABA
// SIEMPRE salvo que algo lanzara. Un arnés que gasta dinero y no puede fallar no
// es cobertura: es un visor.
//
// Se cierra en dos piezas, y ninguna de las dos gasta un centavo:
//
//   1) VERIFICADORES DE FORMA (`afirmarFormaDeExtraccion`, `afirmarFormaDe-
//      Liquidacion`). Son las afirmaciones que tienen que valer para CUALQUIER
//      ticket real, sin saber cuál es: el monto es un número finito y positivo,
//      el concepto está en el catálogo del OCR, el comprobado es la suma de los
//      gastos, y las tres cubetas de deducibilidad PARTEN el total (ni pierden
//      ni inventan pesos). La corrida cara ahora puede fallar.
//
//   2) CASO DE ORO. Una extracción FIJA —el mismo ticket, congelado— que corre
//      SIEMPRE, en CI, gratis, con la fecha inyectada. Ancla los números que el
//      contralor mira en la sala y ejercita la MISMA config del demo.
//
// Y se le quitó al arnés su imitación de `decidirFoto`: ahora llama la función
// real. La imitación es lo que produjo un hallazgo falso en su día (una foto
// borrosa entrando como gasto de $0), y una imitación que se desincroniza vuelve
// a producirlos.
//
// Nota de reloj: el `new Date()` de abajo solo afecta a la corrida con
// `TICKET_PATH`. El caso de oro fija `hoy`, así que la suite no depende de la
// hora del sistema en ningún punto.
// ═══════════════════════════════════════════════════════════════════════════

// Un COMPROBANTE por grupo; dentro del grupo, varias fotos del MISMO ticket
// (el protocolo de dos fotos: el ticket completo y el acercamiento al código).
//
//   TICKET_PATH="a.jpg;b.jpg,b2.jpg;c.jpg"
//              └─ ticket 1 ─┘└─ ticket 2, dos fotos ─┘└─ 3 ─┘
//
// Separar por ";" importa: pasar cuatro tickets distintos como cuatro fotos del
// mismo comprobante da UN gasto y tira tres. Y esa es justo la liquidación de
// verdad — un viaje trae varios comprobantes, no uno.
const GRUPOS = (process.env.TICKET_PATH ?? '')
  .split(';').map((g) => g.split(',').map((s) => s.trim()).filter(Boolean)).filter((g) => g.length);
const HOY = process.env.TICKET_HOY ?? new Date().toISOString().slice(0, 10);

for (const l of GRUPOS.length ? readFileSync('.env.local', 'utf8').split('\n') : []) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i)] ||= l.slice(i + 1).trim();
}

const dataUrl = (r: string) => `data:image/jpeg;base64,${readFileSync(r).toString('base64')}`;

type Cuadre = Omit<Liquidacion, 'id' | 'creadaEn'>;

const cuadrar = (gastos: Gasto[], anticipo: number, hoy: string): Cuadre => cuadrarViaje({
  viajeId: 'arnes',
  anticipo,
  gastos,
  politica: DEMO_CONFIG.politica,
  estimulos: DEMO_CONFIG.estimulos,
  hidrocarburos: DEMO_CONFIG.hidrocarburos,
  empresaRfc: DEMO_CONFIG.empresa.rfc,
  hoy,
});

/**
 * Lo que tiene que valer para CUALQUIER ticket real, sin saber cuál es.
 *
 * Sin esto, la corrida cara solo podía fallar si algo LANZABA: un OCR que
 * devolviera `monto: NaN`, un concepto fuera del catálogo o un costo de $0
 * (señal de que la llamada de visión ni siquiera ocurrió) pasaban en verde.
 */
function afirmarFormaDeExtraccion(r: ExtraerResultado, etiqueta: string): void {
  expect(typeof r.legible, etiqueta).toBe('boolean');
  // `motivo` es la razón de NO ser legible: presente exactamente cuando lo es.
  if (r.legible) expect(r.motivo, etiqueta).toBeUndefined();
  else expect(['ilegible', 'fallo_tecnico', 'solo_codigo'], etiqueta).toContain(r.motivo);

  // Una visión que costó $0 es una visión que no ocurrió: sin esto, un arnés
  // apuntado a un stub o a una caché pasaría igual y diría lo mismo.
  expect(r.costo.costoUsd, `${etiqueta}: la llamada de visión no costó nada`).toBeGreaterThan(0);
  expect(r.costo.tokensIn, etiqueta).toBeGreaterThan(0);
  expect(r.costo.modelo, etiqueta).toBeTruthy();

  expect(CONCEPTOS_OCR as readonly string[], etiqueta).toContain(r.gasto.concepto);
  expect(Number.isFinite(r.gasto.monto), `${etiqueta}: monto no finito (${r.gasto.monto})`).toBe(true);
  expect(r.gasto.monto, etiqueta).toBeGreaterThanOrEqual(0);
  // Un ticket legible con monto 0 es el fantasma que ya nos costó un hallazgo
  // falso: se da de alta, entra al cuadre y no se ve en ningún total.
  if (r.legible) expect(r.gasto.monto, `${etiqueta}: legible con monto 0`).toBeGreaterThan(0);
  if (r.gasto.fecha) expect(r.gasto.fecha, etiqueta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
}

/**
 * Lo que tiene que valer para CUALQUIER liquidación, con los tickets que sean.
 *
 * La de en medio es la que de verdad muerde: las tres cubetas de deducibilidad
 * son la cifra que compra el contralor, y tienen que PARTIR el comprobado —ni
 * perder pesos ni inventarlos—. Un gasto que se cae de las tres se ve idéntico
 * a uno bien clasificado si nadie suma.
 */
function afirmarFormaDeLiquidacion(liq: Cuadre, gastos: Gasto[], anticipo: number): void {
  const suma = Math.round(gastos.reduce((a, g) => a + g.monto, 0) * 100) / 100;
  expect(liq.totalComprobado, 'el comprobado no es la suma de los gastos').toBe(suma);
  expect(liq.totalAnticipo).toBe(anticipo);
  // El SIGNO es el que el operador lee en su WhatsApp: positivo = sobró del
  // anticipo (a favor de la empresa), negativo = puso de su bolsa.
  expect(liq.diferencia, 'diferencia ≠ anticipo − comprobado').toBe(Math.round((anticipo - suma) * 100) / 100);

  const cubetas = liq.totalDeducible + liq.totalNoDeducible + liq.totalPorConfirmar;
  expect(Math.round(cubetas * 100) / 100, 'las tres cubetas no parten el comprobado').toBe(liq.totalComprobado);
  for (const t of [liq.totalDeducible, liq.totalNoDeducible, liq.totalPorConfirmar]) {
    expect(t).toBeGreaterThanOrEqual(0);
  }

  expect(['cuadrada', 'con_diferencias', 'revisar']).toContain(liq.estatus);
  expect(liq.ivaAcreditable).toBeGreaterThanOrEqual(0);
  expect(liq.litrosDieselAcreditables).toBeGreaterThanOrEqual(0);
  expect(liq.peajeAcreditable).toBeGreaterThanOrEqual(0);
  // Cada observación se puede volver a atar a su gasto (o es del viaje entero).
  for (const d of liq.diferencias ?? []) {
    if (d.gastoId) expect(gastos.map((g) => g.id)).toContain(d.gastoId);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CASO DE ORO — corre SIEMPRE, en CI, sin gastar y sin mirar el reloj.
//
// Es una extracción congelada de tres comprobantes de un viaje real: el diésel
// timbrado y pagado por transferencia, la caseta, y la comida de $1,050 que
// excede el tope fiscal del día. Los números de abajo son los que el contralor
// ve en la sala el 6-ago, calculados con la MISMA `DEMO_CONFIG` que corre el
// demo — que hasta hoy ninguna prueba ejercitaba de punta a punta.
// ═══════════════════════════════════════════════════════════════════════════
const ORO: Gasto[] = [
  {
    id: 'g-diesel', concepto: 'diesel', monto: 3500, fecha: '2026-05-08',
    folio: 'A-10231', cfdiUuid: '11111111-1111-1111-1111-111111111111',
    rfcEmisor: 'PEP970101P77', rfcReceptor: 'XAXX010101000',
    claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I',
    complementoHidrocarburos: true, xmlVerificado: true,
    formaPago: '03',                       // transferencia: LIF 20-A-IV, 4º párrafo
    subTotal: 2426.72, ivaTraslado: 388.28, iepsTraslado: 685.0,
    ocrExtra: { litros: 130 }, ocrConfianza: 0.96, estadoSat: 'vigente', efos: false,
  },
  {
    id: 'g-caseta', concepto: 'caseta', monto: 800, fecha: '2026-05-08',
    folio: 'C-778', cfdiUuid: '22222222-2222-2222-2222-222222222222',
    rfcEmisor: 'CAP980713RG9', rfcReceptor: 'XAXX010101000',
    claveProdServ: '95111602', tipoComprobante: 'I', xmlVerificado: true, formaPago: '03',
    subTotal: 689.66, ivaTraslado: 110.34,
    ocrConfianza: 0.95, estadoSat: 'vigente', efos: false,
  },
  // Ticket de comida sin timbrar: por confirmar hasta que se facture, y encima
  // por encima del tope diario de LISR 28-V.
  {
    id: 'g-comida', concepto: 'alimentacion', monto: 1050, fecha: '2026-05-08',
    folio: 'T-0042', formaPago: '01', ocrConfianza: 0.93,
  },
];
const ORO_ANTICIPO = 5000;
const ORO_HOY = '2026-05-10';

describe('arnés · caso de oro (sin gastar): el pipeline post-OCR contra cifras fijas', () => {
  const liq = cuadrar(ORO, ORO_ANTICIPO, ORO_HOY);

  it('la forma se sostiene: comprobado = suma, y las tres cubetas parten el total', () => {
    afirmarFormaDeLiquidacion(liq, ORO, ORO_ANTICIPO);
  });

  it('los totales del viaje son exactamente estos', () => {
    expect(liq.totalComprobado).toBe(5350);
    expect(liq.totalAnticipo).toBe(5000);
    // NEGATIVO = el operador puso de su bolsa. Invertir este signo en el mensaje
    // le dice al chofer que devuelva $350 que en realidad le deben.
    expect(liq.diferencia).toBe(-350);
    expect(liq.estatus).toBe('revisar');
  });

  it('las tres cubetas de deducibilidad, en pesos', () => {
    expect(liq.totalDeducible).toBe(4300);        // diésel timbrado + caseta
    expect(liq.totalNoDeducible).toBe(0);
    expect(liq.totalPorConfirmar).toBe(1050);     // la comida sin timbrar
  });

  it('lo acreditable sale de los importes del XML, no de una tasa asumida', () => {
    expect(liq.ivaAcreditable).toBe(498.62);      // 388.28 + 110.34
    expect(liq.peajeAcreditable).toBe(344.83);    // 689.66 × 0.5 (LIF 2026 20-A)
    expect(liq.litrosDieselAcreditables).toBe(130);
    // El estímulo de IEPS se reporta en LITROS, nunca en pesos: la cuota la pone
    // el acuerdo semanal del DOF y este motor no la conoce.
    expect(liq.iepsAcreditable).toBe(0);
  });

  it('cada comprobante cae en su cubeta y se etiqueta como el contralor lo lee', () => {
    const suyas = (id: string) => (liq.diferencias ?? []).filter((d) => d.gastoId === id);
    expect(cubetaDe(ORO[0], suyas('g-diesel'))).toBe('deducible');
    expect(cubetaDe(ORO[1], suyas('g-caseta'))).toBe('deducible');
    expect(cubetaDe(ORO[2], suyas('g-comida'))).toBe('por_confirmar');
    expect(etiquetaConcepto(ORO[0].concepto, ORO[0].ocrExtra as Record<string, unknown>)).toBe('Combustible');
    expect(etiquetaConcepto(ORO[2].concepto)).toBe('Alimentación');
  });

  it('la comida levanta el tope fiscal del día y el tope de política, y lo dice con cifras', () => {
    const tipos = (liq.diferencias ?? []).map((d) => d.tipo);
    expect(tipos).toContain('viatico_excede_fiscal');   // LISR 28-V, $750/día
    expect(tipos).toContain('sobre_politica');          // DEMO_CONFIG: $800
    const fiscal = (liq.diferencias ?? []).find((d) => d.tipo === 'viatico_excede_fiscal');
    expect(fiscal?.monto).toBe(300);                    // 1,050 − 750
    expect(fiscal?.nota).toMatch(/750/);
  });

  it('el MISMO diésel pagado en EFECTIVO no acredita un solo litro (LIF 20-A-IV)', () => {
    // El 4º párrafo exige monedero, tarjeta, cheque nominativo o transferencia, y
    // no tiene la válvula del 15% que la RFA 2.9 sí concede para ISR.
    //
    // ALCANCE, medido: con `formaPago: '01'` el gasto lo ataja la PRIMERA capa
    // (`SIN_ACREDITAMIENTO`, por la diferencia `combustible_efectivo`), así que
    // esta prueba NO mata la mutación M6 — corrida en copia, sigue verde. La que
    // sí la mata es `engine_diesel_medio_pago.test.ts`, con el caso del gasto SIN
    // forma de pago conocida, que es donde `pagoElectronico` es lo único que
    // queda. Aquí lo que se ancla es el efecto compuesto sobre la liquidación
    // entera: 0 litros Y el gasto entero movido a "por confirmar".
    const efectivo = cuadrar(
      ORO.map((g) => (g.id === 'g-diesel' ? { ...g, formaPago: '01' } : g)),
      ORO_ANTICIPO, ORO_HOY,
    );
    expect(efectivo.litrosDieselAcreditables).toBe(0);
    // Y el gasto entero se va a "por confirmar": el 15% del ejercicio decide.
    expect(efectivo.totalPorConfirmar).toBe(4550);      // 3,500 + 1,050
    expect(efectivo.totalDeducible).toBe(800);
  });

  it('el arnés usa la MISMA decisión que el processor, no una imitación suya', () => {
    // La imitación anterior ya produjo un hallazgo falso (una foto borrosa
    // entrando como gasto de $0). Estas cuatro son las que el arnés distingue.
    const base = { costo: { modelo: 'm', tokensIn: 1, tokensOut: 1, costoUsd: 0.01 } };
    const g = (m: number): Gasto => ({ id: 'x', concepto: 'diesel', monto: m });
    expect(decidirFoto({ ...base, legible: true, gasto: g(100) }, [])).toEqual({ accion: 'alta' });
    expect(decidirFoto({ ...base, legible: false, motivo: 'ilegible', gasto: g(0) }, [])).toEqual({ accion: 'pedir_reenvio' });
    expect(decidirFoto({ ...base, legible: false, motivo: 'fallo_tecnico', gasto: g(0) }, [])).toEqual({ accion: 'avisar_falla' });
    expect(decidirFoto({ ...base, legible: false, motivo: 'solo_codigo', gasto: g(100) }, [])).toEqual({ accion: 'pedir_ticket' });
  });
});

describe('arnés · los verificadores de forma SÍ pueden fallar', () => {
  // Sin esta prueba, los verificadores de arriba podrían estar vacíos y la
  // corrida cara seguiría sin poder fallar — que es exactamente el hallazgo que
  // este archivo cierra. Es el control del control.
  const ok: ExtraerResultado = {
    legible: true,
    gasto: { id: 'g', concepto: 'diesel', monto: 1200, fecha: '2026-05-08' },
    costo: { modelo: 'google/gemini-3.6-flash', tokensIn: 900, tokensOut: 120, costoUsd: 0.0021 },
  };

  it('una extracción sana pasa', () => {
    expect(() => afirmarFormaDeExtraccion(ok, 'control')).not.toThrow();
  });

  it('un monto NaN no pasa', () => {
    expect(() => afirmarFormaDeExtraccion({ ...ok, gasto: { ...ok.gasto, monto: NaN } }, 'x')).toThrow();
  });

  it('un ticket legible con monto 0 no pasa (el fantasma de $0)', () => {
    expect(() => afirmarFormaDeExtraccion({ ...ok, gasto: { ...ok.gasto, monto: 0 } }, 'x')).toThrow();
  });

  it('un costo de $0 no pasa: significa que la visión nunca se llamó', () => {
    expect(() => afirmarFormaDeExtraccion({ ...ok, costo: { ...ok.costo, costoUsd: 0 } }, 'x')).toThrow();
  });

  it('un concepto fuera del catálogo del OCR no pasa', () => {
    const raro = { ...ok, gasto: { ...ok.gasto, concepto: 'gasolina' as Gasto['concepto'] } };
    expect(() => afirmarFormaDeExtraccion(raro, 'x')).toThrow();
  });

  it('una liquidación cuyas cubetas no parten el comprobado no pasa', () => {
    const gastos: Gasto[] = [{ id: 'a', concepto: 'diesel', monto: 1000 }];
    const liq = cuadrar(gastos, 1000, ORO_HOY);
    expect(() => afirmarFormaDeLiquidacion(liq, gastos, 1000)).not.toThrow();
    // Un peso que se cae de las tres cubetas: es la forma exacta del error que
    // nadie ve sin sumar.
    const rota = { ...liq, totalPorConfirmar: liq.totalPorConfirmar - 1 };
    expect(() => afirmarFormaDeLiquidacion(rota, gastos, 1000)).toThrow();
  });
});

describe.skipIf(GRUPOS.length === 0)('arnés: tickets reales', () => {
  it('pasa por el pipeline entero', async () => {
    const gastos: Gasto[] = [];
    let costo = 0;

    for (const grupo of GRUPOS) {
      const t0 = Date.now();
      const etiqueta = grupo.map((g) => g.split('/').pop()).join(' + ');
      const r = await extraerComprobante(grupo.map(dataUrl));
      costo += r.costo.costoUsd;
      console.log(`\n══════ OCR · ${etiqueta} ══════`);
      console.log('legible:', r.legible, r.motivo ? `(motivo: ${r.motivo})` : '', `· $${r.costo.costoUsd.toFixed(4)} · ${Date.now() - t0} ms`);
      console.log(JSON.stringify(r.gasto, null, 2));

      // AQUÍ el arnés empieza a poder fallar. Antes solo imprimía.
      afirmarFormaDeExtraccion(r, etiqueta);

      // LA DECISIÓN REAL, no una imitación: `decidirFoto` es la misma función que
      // corre el processor. El arnés viejo daba de alta TODO lo que no fuera un
      // acercamiento, así que una foto borrosa entraba como un gasto de $0 y el
      // informe acusaba al producto de un fantasma que había inventado el arnés.
      const decision = decidirFoto(r, gastos);
      if (decision.accion !== 'alta') {
        console.log(`→ ${decision.accion}: no se da de alta como gasto`);
        continue;
      }
      gastos.push(r.gasto);
    }

    expect(costo, 'ninguna llamada de visión ocurrió').toBeGreaterThan(0);
    expect(gastos.length, 'ninguna de las fotos produjo un gasto').toBeGreaterThan(0);

    const anticipo = Number(process.env.TICKET_ANTICIPO ?? 5000);
    const liq = cuadrar(gastos, anticipo, HOY);

    console.log('\n══════ MOTOR ══════  (hoy =', HOY, `· ${gastos.length} comprobantes)`);
    for (const g of gastos) {
      console.log(`  ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown>).padEnd(22)} $${String(g.monto).padStart(9)}  → ${cubetaDe(g, (liq.diferencias ?? []).filter((d) => d.gastoId === g.id))}`);
    }
    console.log('\ncomprobado:', liq.totalComprobado, '· anticipo:', liq.totalAnticipo, '· diferencia:', liq.diferencia, '· estatus:', liq.estatus);
    console.log('deducible:', liq.totalDeducible, '· no deducible:', liq.totalNoDeducible, '· por confirmar:', liq.totalPorConfirmar);
    console.log('IVA acreditable:', liq.ivaAcreditable, '· IEPS:', liq.iepsAcreditable, '· litros diésel:', liq.litrosDieselAcreditables, '· peaje:', liq.peajeAcreditable);
    console.log(`\nobservaciones (${liq.diferencias?.length ?? 0}):`);
    for (const d of liq.diferencias ?? []) console.log(`  · [${d.tipo}] ${d.nota ?? ''}`);
    console.log(`\ncosto total de visión: $${costo.toFixed(4)} USD`);

    afirmarFormaDeLiquidacion(liq, gastos, anticipo);
  }, 300_000);
});
