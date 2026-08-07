import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { decodeQrFromImage, decodeCfdiFromImage, clasificarQr } from './cfdi';

// El fixture es un QR de verificación del SAT generado con CoreImage (macOS).
// Sirve de CONTROL: si esta prueba falla, el camino de lectura de QR está roto
// —no es que las fotos de campo estén feas—. Esa distinción costó una tarde:
// con 5 tickets reales el decodificador daba 0/5 y no había forma de saber si
// el problema era el código o el papel. (Resultó ser el papel: dobleces sobre
// el código, impresión térmica y QR fuera de encuadre.)
const FIXTURE = readFileSync(join(__dirname, '__fixtures__', 'qr-sat.png'));

describe('decodeQrFromImage', () => {
  it('decodifica un QR del SAT y extrae los campos fiscales', async () => {
    const qr = await decodeQrFromImage(FIXTURE);
    expect(qr?.cfdi?.uuid).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(qr?.cfdi?.rfcEmisor).toBe('PEC1411282LA');
    expect(qr?.cfdi?.rfcReceptor).toBe('GMX0902279I1');
    expect(qr?.cfdi?.total).toBe(1370.1);
    expect(qr?.urlFacturacion).toBeUndefined(); // es fiscal, no una liga de portal
  });

  it('lo encuentra aunque sea chico dentro de una foto grande', async () => {
    // 130 px de QR en un encuadre de 1600×1200: el caso real de fotografiar el
    // ticket completo. Es la razón por la que la escalera NO necesita mosaico.
    const chico = await sharp(FIXTURE).resize({ width: 130 }).toBuffer();
    const foto = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#909090' } })
      .composite([{ input: chico, left: 210, top: 480 }])
      .jpeg()
      .toBuffer();
    const qr = await decodeQrFromImage(foto);
    expect(qr?.cfdi?.uuid).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('aguanta una foto movida', async () => {
    const borroso = await sharp(FIXTURE).blur(2).jpeg().toBuffer();
    expect((await decodeQrFromImage(borroso))?.cfdi?.uuid).toBeTruthy();
  });

  it('sin QR devuelve null en vez de lanzar', async () => {
    const liso = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#cccccc' } }).jpeg().toBuffer();
    expect(await decodeQrFromImage(liso)).toBeNull();
    expect(await decodeCfdiFromImage(liso)).toBeNull();
  });

  it('un buffer que no es imagen devuelve null en vez de lanzar', async () => {
    expect(await decodeQrFromImage(Buffer.from('no soy una imagen'))).toBeNull();
  });
});

describe('clasificarQr — QR fiscal vs liga de portal', () => {
  it('QR del SAT → datos fiscales', () => {
    const r = clasificarQr('https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=a1b2c3d4-e5f6-7890-abcd-ef1234567890&re=PEC1411282LA&tt=100.00');
    expect(r.cfdi?.uuid).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(r.urlFacturacion).toBeUndefined();
  });

  it('QR de ticket → liga de autofacturación (antes se tiraba en silencio)', () => {
    const r = clasificarQr('https://www.officedepot.com.mx/facturacion');
    expect(r.urlFacturacion).toBe('https://www.officedepot.com.mx/facturacion');
    expect(r.cfdi).toBeUndefined();
  });

  it('liga sin protocolo se normaliza', () => {
    expect(clasificarQr('www.lagas.com.mx').urlFacturacion).toBe('https://www.lagas.com.mx');
  });

  it('texto que no es URL no se convierte en liga', () => {
    const r = clasificarQr('GRACIAS POR SU COMPRA');
    expect(r.urlFacturacion).toBeUndefined();
    expect(r.cfdi).toBeUndefined();
  });
});
