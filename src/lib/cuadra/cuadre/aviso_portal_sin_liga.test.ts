import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/cuadra';

// EL FALLO QUE ESTO FIJA — medido sobre un ticket real de OXXO (28-jul-2026).
//
// El aviso "esto se va a quedar sin factura" solo disparaba si el gasto traía
// `ocrExtra.urlFacturacion`, y esa liga solo se llena desde un QR. El ticket de
// OXXO no trae QR: trae el ID de venta impreso y nada más. Resultado: compra del
// 16 de julio, tres días de ventana para timbrarla, y el sistema callado.
//
// Y el catálogo que resuelve esto —`identificarComercio` sobre 35 comercios, con
// portal, plazo y los campos que pide cada uno— estaba escrito, probado y sin
// llamar desde ningún lado. Aquí queda conectado.

// El umbral de urgencia del módulo es de 2 días: el aviso NO sale antes. Se fija
// aquí en pruebas para que el día que alguien lo mueva se vea qué cambia.
const HOY_URGENTE = '2026-07-30'; // el mes cierra el 31 → 1 día

const base = (over: Partial<Gasto> = {}): Gasto => ({
  id: 'g1',
  concepto: 'otro',
  monto: 41.5,
  fecha: '2026-07-16',
  folio: '4688958',
  ocrConfianza: 0.98,
  ...over,
});

const cuadrar = (g: Gasto, hoy = HOY_URGENTE) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 5000, gastos: [g], politica: [], hoy });

const avisos = (g: Gasto, hoy = HOY_URGENTE) =>
  cuadrar(g, hoy).diferencias?.filter((d) => d.tipo === 'factura_por_vencer') ?? [];

describe('aviso de facturación sin liga impresa', () => {
  it('reconoce el comercio por RFC y avisa aunque el ticket no traiga QR ni URL', () => {
    const a = avisos(base({ rfcEmisor: 'CCO8605231N4' }));
    expect(a).toHaveLength(1);
    expect(a[0].nota).toContain('1 día(s)');
    expect(a[0].nota).toContain('OXXO (tienda)');
  });

  // EL TICKET REAL, tal cual se comportó el 28-jul-2026. Queda escrito que a tres
  // días del cierre el sistema todavía calla: es el umbral de urgencia, no la
  // falta de cableado. Antes de este cambio no avisaba NUNCA, ni el día 31.
  it('a 3 días del cierre todavía no avisa (umbral de urgencia = 2)', () => {
    expect(avisos(base({ rfcEmisor: 'CCO8605231N4' }), '2026-07-28')).toHaveLength(0);
    expect(avisos(base({ rfcEmisor: 'CCO8605231N4' }), '2026-07-29')).toHaveLength(1);
  });

  it('dice a qué portal ir y qué datos va a pedir', () => {
    const nota = avisos(base({ rfcEmisor: 'CCO8605231N4' }))[0].nota ?? '';
    expect(nota).toContain('https://www4.oxxo.com:9443/facturacionElectronica-web/');
    // Los cuatro campos requeridos del portal de OXXO, que el OCR ya extrae.
    for (const campo of ['Fecha del ticket', 'Folio de venta', 'ID de venta', 'Monto total con IVA']) {
      expect(nota).toContain(campo);
    }
  });

  it('reconoce por razón social impresa cuando el RFC no se leyó', () => {
    const a = avisos(base({ ocrExtra: { emisor: 'Cadena Comercial Oxxo, S.A. de C.V.' } }));
    expect(a).toHaveLength(1);
    expect(a[0].nota).toContain('OXXO (tienda)');
  });

  // El límite del cambio: sin comercio reconocido Y sin liga no se promete nada.
  // Una fonda sin RFC legible no tiene portal, y mandar a la oficina a buscarlo
  // es peor que callarse.
  it('no inventa portal para un ticket que no se puede atribuir', () => {
    expect(avisos(base({ ocrExtra: { emisor: 'ABARROTES DOÑA MARY' } }))).toHaveLength(0);
  });

  it('sigue sin avisar de un gasto ya timbrado', () => {
    const g = base({ rfcEmisor: 'CCO8605231N4', cfdiUuid: '5f0e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b' });
    expect(avisos(g)).toHaveLength(0);
  });

  // El plazo del catálogo NO se afirma mientras no esté verificado contra el
  // portal: todas las entradas traen `plazoVerificado: false` a propósito, así
  // que el cálculo cae al mes natural, que es la regla general defendible.
  it('usa el mes natural mientras el plazo del comercio no esté verificado', () => {
    // Compra del 2-jul mirada el 5-jul. Con el mes natural quedan 29 días: no hay
    // nada que decir. Si el catálogo afirmara un plazo de 72 h sin haberlo
    // comprobado, aquí saldría "vencido" — y sería mentira.
    expect(avisos(base({ rfcEmisor: 'CCO8605231N4', fecha: '2026-07-02' }), '2026-07-05')).toHaveLength(0);
  });

  it('avisa como vencido cuando ya se pasó el mes de la compra', () => {
    const a = avisos(base({ rfcEmisor: 'CCO8605231N4', fecha: '2026-06-16' }));
    expect(a).toHaveLength(1);
    expect(a[0].nota).toContain('se pasó el mes de la compra');
  });
});
