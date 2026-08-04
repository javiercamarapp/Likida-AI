// ═══════════════════════════════════════════════════════════════════════════
// EL CAMINO DEL DIÉSEL — qué hace falta para que aparezcan "litros elegibles".
//
// Es la cifra que el guion del demo enseña en el panel, y hasta el ensayo del
// 3-ago-2026 nadie la había recorrido de punta a punta con papel nuevo. El
// resultado sorprende y por eso se fija aquí: **la foto del ticket no basta**.
// El motor exige `xmlVerificado` antes de acreditar nada (engine.ts), así que
// un ticket de gasolinera perfectamente leído —litros, precio, estación, pago
// con tarjeta— produce CERO litros elegibles hasta que llega el XML del CFDI.
//
// Y los dos datos vienen de fuentes distintas, que es lo que lo hace fácil de
// romper sin notarlo:
//   · los LITROS los lee el OCR de la foto  → `ocrExtra.litros`
//   · el permiso para acreditarlos lo da el XML → `xmlVerificado` + clave SAT
// Si mañana alguien "limpia" `ocrExtra` al pegar el XML, el estímulo se va a
// cero sin que falle nada más. Estas pruebas lo atrapan.
//
// El gasto NO está inventado: es la salida literal de `extraerComprobante`
// sobre un ticket de diésel nuevo (ensayo del 3-ago), congelada para no pagar
// una llamada de visión en cada corrida.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import { DEMO_CONFIG } from '../config';
import type { Gasto } from '@/types/cuadra';

/** Lo que el OCR sacó del ticket real. 62.450 L de DIESEL a $27.30, con tarjeta. */
const FOTO_DEL_TICKET = {
  id: 'g-diesel',
  concepto: 'diesel',
  monto: 1704.89,
  fecha: '2026-08-02',
  folio: '4471902',
  folioNorm: '4471902',
  rfcEmisor: 'CGC1005243I3',
  ocrConfianza: 1,
  formaPago: '04', // tarjeta — el 4º párrafo de LIF 20-A-IV exige medio electrónico
  subTotal: 1469.73,
  ocrExtra: {
    producto: 'DIESEL',
    litros: 62.45,
    precioUnitario: 27.3,
    webId: '0028G100447190226',
    estacion: '20187',
    ivaMonto: 235.16,
    ivaTasa: 0.16,
    urlFacturacion: 'https://www.lagas.com.mx',
  },
} as unknown as Gasto;

/** Lo que `processor.ts` le pega al gasto cuando llega el XML del CFDI. */
const DEL_XML = {
  xmlVerificado: true,
  cfdiUuid: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  claveProdServ: '15101505', // diésel. La gasolina (15101514/15) NO tiene el estímulo
  claveUnidad: 'LTR',
  tipoComprobante: 'I',
  complementoHidrocarburos: true,
  rfcReceptor: 'GMX0902279I1',
  ivaTraslado: 235.16,
  iepsTraslado: 0,
};

function liquidar(gastos: Gasto[]) {
  return cuadrarViaje({
    viajeId: 'prueba-diesel',
    anticipo: 5000,
    gastos,
    politica: [{ concepto: 'diesel', topeMonto: 4000 }],
    ruta: 'prueba',
    hoy: '2026-08-04',
    estimulos: DEMO_CONFIG.estimulos,
    hidrocarburos: DEMO_CONFIG.hidrocarburos,
  });
}

describe('estímulo de diésel — qué se necesita para acreditar litros', () => {
  it('LA FOTO SOLA NO ACREDITA: sin XML, cero litros aunque el ticket se lea entero', () => {
    const liq = liquidar([FOTO_DEL_TICKET]);
    expect(liq.litrosDieselAcreditables ?? 0).toBe(0);
    expect(liq.ivaAcreditable).toBe(0);
  });

  it('la foto sola SÍ avisa del plazo y nombra el portal del comercio', () => {
    const liq = liquidar([FOTO_DEL_TICKET]);
    const aviso = liq.diferencias.find((d) => d.tipo === 'factura_por_vencer');
    expect(aviso, 'el ticket sin factura tiene que avisar del plazo').toBeTruthy();
    // Nombrar el portal es lo que convierte el aviso en algo ejecutable. Solo
    // pasa con comercios del catálogo: un dominio desconocido deja el aviso
    // genérico, y eso es correcto — inventarle un portal sería peor.
    expect(aviso!.nota).toContain('lagas.com.mx');
  });

  it('CON EL XML aparecen los litros del ticket y el IVA del CFDI', () => {
    const liq = liquidar([{ ...FOTO_DEL_TICKET, ...DEL_XML } as unknown as Gasto]);
    // Los litros salen del OCR, no del XML: el CFDI no siempre desglosa cantidad.
    expect(liq.litrosDieselAcreditables).toBe(62.45);
    // El IVA sale del XML, nunca recomputado con una tasa asumida.
    expect(liq.ivaAcreditable).toBeCloseTo(235.16, 2);
  });

  it('sin litros en la foto no hay estímulo, aunque el XML sea impecable', () => {
    const sinLitros = {
      ...FOTO_DEL_TICKET, ...DEL_XML,
      ocrExtra: { ...FOTO_DEL_TICKET.ocrExtra, litros: undefined },
    } as unknown as Gasto;
    expect(liquidar([sinLitros]).litrosDieselAcreditables ?? 0).toBe(0);
  });

  it('pagado en EFECTIVO no acredita: LIF 20-A-IV exige medio electrónico', () => {
    const enEfectivo = { ...FOTO_DEL_TICKET, ...DEL_XML, formaPago: '01' } as unknown as Gasto;
    expect(liquidar([enEfectivo]).litrosDieselAcreditables ?? 0).toBe(0);
  });

  it('GASOLINA no acredita el estímulo aunque venga con XML y litros', () => {
    const gasolina = {
      ...FOTO_DEL_TICKET, ...DEL_XML,
      claveProdServ: '15101514', // Magna
      ocrExtra: { ...FOTO_DEL_TICKET.ocrExtra, producto: 'MAGNA' },
    } as unknown as Gasto;
    expect(liquidar([gasolina]).litrosDieselAcreditables ?? 0).toBe(0);
  });
});
