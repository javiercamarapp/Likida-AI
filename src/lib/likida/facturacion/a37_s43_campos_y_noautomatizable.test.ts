import { describe, it, expect } from 'vitest';
import { armar, cumpleRestriccion } from './pendientes';
import { enrutar, mensajeParaEncargado } from './enrutar';
import { armarAviso } from './avisar';

// A37-S43-03 (un folio no alimenta cinco campos) y A37-S43-06 (noAutomatizable
// lo leen enrutar y avisar). Datos sintéticos.
const HOY = '2026-08-04';
const g = (o: Record<string, unknown>) => ({
  id: String(o.id ?? '1'), concepto: String(o.concepto ?? 'consumo'), monto: Number(o.monto ?? 400),
  fecha: (o.fecha as string) ?? '2026-08-04', folio: 'folio' in o ? (o.folio as string | null) : '123456',
  rfc_emisor: null, cfdi_uuid: null, ocr_extra: (o.extra ?? {}) as Record<string, unknown>,
});
const OXXO = { urlFacturacion: 'https://www4.oxxo.com:9443/facturacionElectronica-web/views/layout/inicio.do' };

describe('A37-S43-03: un folio alimenta UNA sola clave', () => {
  it('OXXO con un solo folio: «Folio de venta» se llena, «ID de venta» queda vacío (no se inventa)', () => {
    const t = armar(g({ extra: OXXO }), HOY);
    expect(t.comercio?.clave).toBe('oxxo');
    const porClave = Object.fromEntries(t.campos.map((c) => [c.clave, c.valor]));
    expect(porClave.folio).toBe('123456');
    expect(porClave.transaccion, 'el mismo folio NO puede repetirse como ID de venta').toBeNull();
  });

  it('OXXO con un solo folio sale INCOMPLETO y el mensaje no trae un «ID de venta» inventado', () => {
    const t = armar(g({ extra: OXXO }), HOY);
    const r = enrutar(t, true);
    expect(r.via).toBe('incompleto');
    if (r.via === 'incompleto') expect(r.falta.join(' ')).toMatch(/ID de venta/);
  });

  it('si el OCR sí extrajo el segundo dato aparte, se usa', () => {
    const t = armar(g({ extra: { ...OXXO, transaccion: '987654321' } }), HOY);
    const porClave = Object.fromEntries(t.campos.map((c) => [c.clave, c.valor]));
    expect(porClave.transaccion).toBe('987654321');
  });

  it('la restricción del portal se valida: un folio más largo que el campo no se manda', () => {
    const t = armar(g({ folio: '1234567890123', extra: OXXO }), HOY);   // largoMax 9
    expect(t.campos.find((c) => c.clave === 'folio')?.valor).toBeNull();
  });

  it('cumpleRestriccion: largo, solo dígitos y patrón', () => {
    expect(cumpleRestriccion('12345', { largoMax: 5 })).toBe(true);
    expect(cumpleRestriccion('123456', { largoMax: 5 })).toBe(false);
    expect(cumpleRestriccion('12', { largoMin: 3 })).toBe(false);
    expect(cumpleRestriccion('12a', { soloDigitos: true })).toBe(false);
    expect(cumpleRestriccion('AB1', { patron: '^[A-Z]{2}\\d$' })).toBe(true);
    expect(cumpleRestriccion('x', { patron: '([' })).toBe(true);   // patrón roto: no se impone
  });
});

describe('A37-S43-06: noAutomatizable llega a enrutar y a avisar', () => {
  const MEGASUR = { urlFacturacion: 'http://megasur.com.mx:8029/', webId: '650' };
  const IAVE = { urlFacturacion: 'https://iave.capufe.gob.mx/' };

  it('sin_tls: el mensaje advierte que la liga es http y no dice «todavía no lo sé llenar»', () => {
    const t = armar(g({ extra: MEGASUR }), HOY);
    expect(t.comercio?.noAutomatizable?.razon).toBe('sin_tls');
    const r = enrutar(t, false);
    expect(r.via).toBe('mensaje');
    if (r.via !== 'mensaje') return;
    const txt = mensajeParaEncargado(t, r);
    expect(txt).toMatch(/NO usa conexión segura/);
    expect(txt).not.toMatch(/todavía no lo sé llenar/);
  });

  it('TAG de peaje (factura mensual): no es «campos sin leer» y NO cuenta como comprobante sin factura', () => {
    const t = armar(g({ extra: IAVE }), HOY);
    expect(t.comercio?.noAutomatizable?.razon).toBe('factura_mensual_por_cuenta');
    const r = enrutar(t, true);
    expect(r.via).toBe('incompleto');
    if (r.via === 'incompleto') {
      expect(r.falta.join(' ')).toMatch(/mensual/);
      expect(r.falta.join(' ')).not.toMatch(/no se han leído los campos/);
    }
    const aviso = armarAviso([t], () => true);
    expect(aviso.cuantos).toBe(0);
    expect(aviso.texto).toBe('');
  });
});
