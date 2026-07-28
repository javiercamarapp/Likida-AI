import { describe, it, expect } from 'vitest';
import { resumenCuadre } from './resumen';
import { LEYENDA_CORTA } from './leyendas';
import type { Liquidacion, Diferencia } from '@/types/cuadra';

const liq = (diferencias: Diferencia[]): Omit<Liquidacion, 'id' | 'creadaEn'> => ({
  viajeId: 'v', totalComprobado: 1000, totalAnticipo: 1000, diferencia: 0,
  estatus: 'revisar', diferencias, gastos: [],
  totalDeducible: 1000, totalNoDeducible: 0, totalPorConfirmar: 0,
  iepsAcreditable: 0, litrosDieselAcreditables: 0, ivaAcreditable: 0, peajeAcreditable: 0,
});

const d = (tipo: Diferencia['tipo'], nota: string): Diferencia => ({ tipo, concepto: 'diesel', monto: 0, nota });

// ═══════════════════════════════════════════════════════════════════════════
// A QUIÉN SE LE DICE QUÉ.
//
// El mismo resumen se le mandaba al OPERADOR y servía de respuesta autoritativa.
// Ahí iban veredictos que él no puede arreglar y que además lo señalan: que su
// proveedor está en la lista negra del SAT, que el CFDI está cancelado, que el
// RFC receptor no es el de la empresa. Eso es trabajo del contralor.
//
// Al operador se le pide lo que falta; no se le juzga.
// ═══════════════════════════════════════════════════════════════════════════
describe('resumenCuadre — qué ve el operador y qué el contralor', () => {
  const FISCALES: Diferencia[] = [
    d('cfdi_efos', 'El emisor aparece en la lista 69-B del SAT.'),
    d('cfdi_cancelado', 'El CFDI fue cancelado ante el SAT.'),
    d('rfc_receptor', 'El CFDI está a un RFC distinto al de la empresa.'),
    d('ieps_no_desglosado', 'El CFDI no desglosa el IEPS.'),
  ];
  const OPERABLES: Diferencia[] = [
    d('sin_cfdi', 'Diésel de $1,000 requiere factura CFDI y no trae UUID válido.'),
    d('ocr_baja_confianza', 'La foto salió difícil de leer.'),
  ];

  it('al operador NO se le manda el veredicto fiscal', () => {
    const texto = resumenCuadre(liq([...FISCALES, ...OPERABLES]), true, 'operador');
    expect(texto).not.toMatch(/69-B/);
    expect(texto).not.toMatch(/cancelado/i);
    expect(texto).not.toMatch(/RFC distinto/i);
    expect(texto).not.toMatch(/IEPS/);
  });

  it('al operador SÍ se le pide lo que puede arreglar', () => {
    const texto = resumenCuadre(liq([...FISCALES, ...OPERABLES]), true, 'operador');
    expect(texto).toMatch(/requiere factura CFDI/);
    expect(texto).toMatch(/difícil de leer/);
  });

  it('el contralor ve todo, incluido lo fiscal', () => {
    const texto = resumenCuadre(liq([...FISCALES, ...OPERABLES]), true, 'contralor');
    expect(texto).toMatch(/69-B/);
    expect(texto).toMatch(/cancelado/i);
    expect(texto).toMatch(/requiere factura CFDI/);
  });

  it('si al operador no le queda nada que arreglar, no se inventa una sección vacía', () => {
    const texto = resumenCuadre(liq(FISCALES), true, 'operador');
    expect(texto).not.toMatch(/Ojo con esto/);
  });

  it('por omisión el destinatario es el contralor (no filtra de más por accidente)', () => {
    expect(resumenCuadre(liq(FISCALES), true)).toMatch(/69-B/);
  });
});

// El descargo del art. 89 del CFF: los criterios del Anexo 3 alcanzan a "quien
// asesore, aconseje, PRESTE SERVICIOS o participe". Esa es la posición de
// Likida, no la del cliente. La leyenda es la mitigación que la propia ley ofrece.
describe('resumenCuadre — descargo de responsabilidad', () => {
  it('el resumen del contralor lleva la leyenda', () => {
    expect(resumenCuadre(liq([]), true, 'contralor')).toContain(LEYENDA_CORTA);
  });

  it('el del operador NO la lleva: no toma decisiones fiscales', () => {
    // Al operador se le dice qué falta, no cómo tributa. Meterle un descargo
    // legal a un mensaje de WhatsApp que dice "mándame la factura" solo estorba.
    expect(resumenCuadre(liq([]), true, 'operador')).not.toContain(LEYENDA_CORTA);
  });
});

describe('resumenCuadre — el texto sospechoso no viaja al operador', () => {
  const liqTexto = {
    viajeId: 'v1', totalComprobado: 487.5, totalAnticipo: 500, diferencia: 12.5,
    estatus: 'revisar' as const, totalDeducible: 487.5, totalNoDeducible: 0, totalPorConfirmar: 0,
    gastos: [], iepsAcreditable: 0, litrosDieselAcreditables: 0, ivaAcreditable: 0, peajeAcreditable: 0,
    diferencias: [{ tipo: 'texto_sospechoso' as const, concepto: 'diesel' as const, monto: 0,
                    nota: 'El comprobante traía texto dirigido al lector automático.' }],
  };

  it('al operador no se le menciona', () => {
    // Es quien pudo haberlo intentado. Decírselo solo le enseña a hacerlo mejor
    // la próxima; y si el renglón lo imprimió el comercio, lo acusa de nada.
    expect(resumenCuadre(liqTexto, true, 'operador')).not.toMatch(/lector autom/i);
  });

  it('al contralor sí, que es quien decide sobre ese gasto', () => {
    expect(resumenCuadre(liqTexto, true, 'contralor')).toMatch(/lector autom/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// UNA PETICIÓN AL OPERADOR NO PUEDE ESTAR EN LA LISTA "SOLO CONTRALOR".
//
// `complemento_no_verificable` le dice textualmente al operador "reenvía el XML
// (el que te manda la gasolinera por correo)". Pero el tipo estaba en
// SOLO_CONTRALOR, así que esa petición se filtraba y nunca le llegaba a quien
// tiene el correo.
//
// La regla de SOLO_CONTRALOR es "veredictos que el operador no puede arreglar y
// que además lo señalan". Este es lo contrario: es lo ÚNICO que él puede
// arreglar, y sin el XML la flota pierde el acreditamiento de IVA y el estímulo.
// ═══════════════════════════════════════════════════════════════════════════
describe('resumenCuadre — lo que el operador SÍ puede arreglar le llega', () => {
  const liqXml = {
    viajeId: 'v1', totalComprobado: 4812, totalAnticipo: 5000, diferencia: 188,
    estatus: 'revisar' as const, totalDeducible: 4812, totalNoDeducible: 0, totalPorConfirmar: 0,
    gastos: [], iepsAcreditable: 0, litrosDieselAcreditables: 0, ivaAcreditable: 0, peajeAcreditable: 0,
    diferencias: [{ tipo: 'complemento_no_verificable' as const, concepto: 'diesel' as const, monto: 0,
                    nota: 'La factura de Diésel es de combustible: reenvía el XML (el que te manda la gasolinera por correo) para verificar el complemento de hidrocarburos.' }],
  };

  it('al operador le llega la petición del XML', () => {
    expect(resumenCuadre(liqXml, true, 'operador')).toMatch(/reenv[íi]a el XML/i);
  });

  it('al contralor también: él puede pedírselo a la gasolinera', () => {
    expect(resumenCuadre(liqXml, true, 'contralor')).toMatch(/XML/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — el estímulo de diésel no llegaba al canal donde se vende.
//
// `engine.ts` fija `const iepsAcreditable = 0` a propósito: el estímulo del LIF
// 20-A es cuota semanal del DOF × litros, y el motor no puede calcularlo. El dato
// útil pasó a ser `litrosDieselAcreditables` — y ese cambio llegó al PDF y al hero
// del panel, pero no aquí.
//
// Resultado: la condición `liq.iepsAcreditable > 0` ya no puede ser verdadera
// nunca (verificado: `desde_db.ts` RECALCULA con cuadrarViaje, no lee la columna),
// así que la línea del IEPS era código muerto y los litros no aparecían en
// ningún lado del mensaje. El beneficio más grande que Likida le enseña a una
// flota no existía en WhatsApp, que es el canal sobre el que se vende.
// ═══════════════════════════════════════════════════════════════════════════
describe('resumenCuadre — el estímulo de diésel llega al mensaje', () => {
  it('los litros elegibles aparecen en el bloque de acreditables', () => {
    const l = { ...liq([]), litrosDieselAcreditables: 300, ivaAcreditable: 1116 };
    const texto = resumenCuadre(l, true, 'operador');
    expect(texto).toMatch(/300/);
    expect(texto).toMatch(/litros|L\b/i);
    expect(texto).toMatch(/IVA: \$1,116\.00/);
  });

  it('el bloque aparece aunque los litros sean lo ÚNICO acreditable', () => {
    const l = { ...liq([]), litrosDieselAcreditables: 300 };
    expect(resumenCuadre(l, true, 'operador')).toMatch(/Acreditable/);
  });

  it('sin nada acreditable no se inventa el bloque (regresión)', () => {
    expect(resumenCuadre(liq([]), true, 'operador')).not.toMatch(/Acreditable/);
  });

  it('los litros NO se presentan en pesos: la cuota del DOF no la tenemos', () => {
    const l = { ...liq([]), litrosDieselAcreditables: 300 };
    expect(resumenCuadre(l, true, 'operador')).not.toMatch(/IEPS diésel: \$/);
  });
});
