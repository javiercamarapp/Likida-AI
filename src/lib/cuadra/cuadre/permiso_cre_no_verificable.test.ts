import { describe, it, expect } from 'vitest';
import { cuadrarViaje, cubetaDe } from './engine';
import { SOLO_CONTRALOR } from './resumen';
import { filasDeducibilidad } from '../liquidacion/deducibilidad';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO (fiscal) — "El permiso CRE en el CFDI de combustible es
// requisito de deducibilidad y no se valida en ninguna parte".
//
// LISR 27-III 2º párrafo y RFA 2026 regla 2.9 exigen que el CFDI de
// combustible consigne el permiso vigente del proveedor. El motor no
// mencionaba el requisito en absoluto: un diésel de $5,800 con XML verificado
// pero SIN permiso salía "Deducible" en verde, sin una sola nota.
//
// La tabla de 12,625 permisos (`facturacion/permiso_cre.ts`) identifica la
// gasolinera desde el TEXTO IMPRESO del ticket — sirve para enrutar el portal
// de facturación, no para leer el permiso del XML. El atributo exacto donde
// el SAT lo pone dentro del complemento de hidrocarburos no está confirmado
// contra el esquema oficial, así que el motor NO intenta extraerlo ni
// afirmar cumplimiento/incumplimiento: solo avisa, siempre, para que el
// contador lo confirme a mano contra el papel — mismo criterio que EFOS y el
// complemento: nunca declarar sin verificar.
//
// AUDITORÍA 9 · ALTO (frontend) — la decisión original (ronda 8) mandaba el
// aviso a la bandeja de REVISAR "sin bajar la cubeta ni cambiar el color del
// demo". Era falso: `permiso_cre_no_verificable` se dispara en TODO diésel
// con XML verificado —el camino de MEJOR calidad de dato, el que el demo usa
// como pieza central— y `REVISAR` pinta el estatus de rojo
// (`--color-bad`) en el panel. Un viaje sin ningún otro problema quedaba
// estructuralmente incapaz de volver a ser "Cuadrada". Corregido: el aviso ya
// NO entra a REVISAR (mismo criterio que `ieps_no_desglosado`, que tampoco
// entra por la misma razón) y en su lugar el renglón "Deducible para ISR" se
// imprime con tono `condicionado` — la afirmación que el motor no puede
// sostener entera, junto al número, no en REVISAR ni tres párrafos abajo.
// ═══════════════════════════════════════════════════════════════════════════

const politica = [{ concepto: 'diesel' }, { concepto: 'alimentacion' }];

const cfdiDiesel = (): Gasto => ({
  id: 'g1', concepto: 'diesel', monto: 5800, fecha: '2026-07-15', cfdiUuid: 'uuid-1',
  rfcReceptor: 'REC010101AA1',
  xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR',
  tipoComprobante: 'I', complementoHidrocarburos: true, // con complemento: se aísla el hallazgo del permiso
  formaPago: '03', ivaTraslado: 689.66, iepsTraslado: 400,
  ocrExtra: { litros: 200 },
});

const cuadre = (gastos: Gasto[]) => cuadrarViaje({
  viajeId: 'v-permiso', anticipo: 5800, politica,
  hidrocarburos: { claves: ['15101505', '15101514', '15101515'], unidad: 'LTR', vigenteDesde: '2026-04-24' },
  estimulos: { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] },
  gastos,
});

describe('permiso CRE — el motor avisa que no lo valida, sin bajar la cubeta', () => {
  it('un diésel con XML verificado y SIN permiso mencionado trae la nota de aviso', () => {
    const liq = cuadre([cfdiDiesel()]);
    const nota = liq.diferencias.find((d) => d.tipo === 'permiso_cre_no_verificable');
    expect(nota, 'el motor sigue sin mencionar el requisito de permiso CRE').toBeDefined();
    expect(nota!.nota).toMatch(/permiso CRE/i);
  });

  it('dos CFDI de diésel producen UNA sola nota, no una por CFDI (mismo criterio que alimentacion_sin_soporte)', () => {
    const g2: Gasto = { ...cfdiDiesel(), id: 'g2', cfdiUuid: 'uuid-2', monto: 3200 };
    const liq = cuadre([cfdiDiesel(), g2]);
    const notas = liq.diferencias.filter((d) => d.tipo === 'permiso_cre_no_verificable');
    expect(notas).toHaveLength(1);
    expect(notas[0].nota).toMatch(/2 CFDI de combustible/i);
  });

  it('el diésel SIGUE deducible: la nota no baja la cubeta (decisión explícita)', () => {
    const g = cfdiDiesel();
    const liq = cuadre([g]);
    const suyas = liq.diferencias.filter((d) => d.gastoId === g.id);
    expect(cubetaDe(g, suyas)).toBe('deducible');
    expect(liq.totalDeducible).toBe(5800);
  });

  it('la liquidación NO queda en "revisar": ese estatus no puede volver a "cuadrada" nunca', () => {
    const liq = cuadre([cfdiDiesel()]);
    expect(liq.estatus).toBe('cuadrada');
  });

  it('el renglón "Deducible para ISR" sale con tono condicionado y su pie, no liso en verde', () => {
    const liq = cuadre([cfdiDiesel()]);
    const filas = filasDeducibilidad(liq)!;
    const deducible = filas.find((f) => f.label.startsWith('Deducible para ISR'))!;
    expect(deducible.tono).toBe('condicionado');
    expect(deducible.label).toMatch(/permiso CRE/i);
    expect(deducible.pie).toMatch(/permiso CRE vigente/i);
  });

  it('un gasto que NO es combustible (alimentación) no trae la nota', () => {
    const alimento: Gasto = {
      id: 'g2', concepto: 'alimentacion', monto: 300, fecha: '2026-07-15',
      cfdiUuid: 'uuid-2', rfcReceptor: 'REC010101AA1', xmlVerificado: true, formaPago: '03',
    };
    const liq = cuadre([alimento]);
    expect(liq.diferencias.some((d) => d.tipo === 'permiso_cre_no_verificable')).toBe(false);
  });

  it('un diésel SIN XML verificado (solo ticket) no trae la nota: no hay comprobante fiscal que revisar todavía', () => {
    const soloTicket: Gasto = { id: 'g3', concepto: 'diesel', monto: 500, fecha: '2026-07-15' };
    const liq = cuadre([soloTicket]);
    expect(liq.diferencias.some((d) => d.tipo === 'permiso_cre_no_verificable')).toBe(false);
  });

  it('va SOLO al contralor: el operador no puede resolver un requisito del emisor', () => {
    expect(SOLO_CONTRALOR).toContain('permiso_cre_no_verificable');
  });
});
