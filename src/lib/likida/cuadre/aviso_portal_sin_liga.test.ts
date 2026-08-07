import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/likida';

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

// El aviso sale siempre que haya portal y el ticket siga sin timbrar. Lo que
// cambia con la cercanía del vencimiento es el TONO: aquí se usa una fecha
// dentro del umbral de urgencia (2 días) para ejercer la redacción apremiante.
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

  // Esta prueba documentaba que a tres días del cierre el sistema CALLABA, por el
  // umbral de urgencia. Ese comportamiento se eliminó el mismo día, al medir que
  // dejaba $9,070 sin avisar. Queda lo contrario, que es lo que ahora es cierto.
  it('avisa a tres días del cierre, y también mucho antes', () => {
    expect(avisos(base({ rfcEmisor: 'CCO8605231N4' }), '2026-07-28')).toHaveLength(1);
    expect(avisos(base({ rfcEmisor: 'CCO8605231N4' }), '2026-07-17')).toHaveLength(1);
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
    // Compra del 2-jul mirada el 5-jul. Con el mes natural el límite es el 31.
    // Si el catálogo afirmara los 72 h que traía la tabla vieja sin haberlos
    // comprobado, aquí diría "vencido" — y sería mentira.
    const a = avisos(base({ rfcEmisor: 'CCO8605231N4', fecha: '2026-07-02' }), '2026-07-05');
    expect(a).toHaveLength(1);
    expect(a[0].nota).toContain('2026-07-31');
    expect(a[0].nota).not.toContain('se pasó');
  });

  it('avisa como vencido cuando ya se pasó el plazo', () => {
    const a = avisos(base({ rfcEmisor: 'CCO8605231N4', fecha: '2026-06-16' }));
    expect(a).toHaveLength(1);
    // Dice "el plazo" y no "el mes de la compra": con `mes_siguiente` en el
    // catálogo, hablar del mes de la compra sería incorrecto para ese comercio.
    expect(a[0].nota).toContain('se pasó el plazo');
  });
});
