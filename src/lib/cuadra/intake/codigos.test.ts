import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { decodeCodigosFromImage, decodeQrFromImage, clasificarQr } from './cfdi';

// FOTO REAL DE CAMPO (27-jul-2026): acercamiento al ticket de Office Depot que
// Javier tomó a propósito para probar el protocolo de dos fotos. Trae DOS
// códigos —un QR con la liga de facturación y un Code93 con el folio interno—
// y es la evidencia que decidió el cambio de librería: `jsQR` falla sobre esta
// misma imagen en todos los tamaños probados (1600/1200/900 px), y ninguna
// librería que solo lea QR puede ver el Code93.
const TICKET = readFileSync(join(__dirname, '__fixtures__', 'ticket-codigos.jpg'));

describe('decodeCodigosFromImage — códigos de barras, no solo QR', () => {
  it('lee el código de barras de un ticket real (jsQR no puede: no lee 1D)', async () => {
    const codigos = await decodeCodigosFromImage(TICKET);
    const barras = codigos.find((c) => c.formato === 'Code93');
    expect(barras?.texto).toBe('T1131KH1131GQH74C1QJ3');
  });

  it('extrae folio y total EXACTOS del payload de la liga, sin pasar por OCR', async () => {
    // El portal de autofacturación de Office Depot lleva folio y total en base64
    // dentro de la propia liga. Son justo los dos campos que el OCR leyó
    // distinto en cada corrida sobre el mismo ticket.
    const codigos = await decodeCodigosFromImage(TICKET);
    const qr = codigos.find((c) => c.formato === 'QRCode');
    expect(qr?.folioPortal).toBe('2026072500402011000207172POSA9');
    expect(qr?.totalPortal).toBe(4027.1);
  });

  it('no inventa folio ni total en una liga común sin payload', () => {
    // El heurístico de base64 es estricto a propósito: se midió contra 30
    // palabras corrientes de URL (facturacion, comprobante, descargar…) y
    // ninguna pasa. Un falso positivo aquí no deja un hueco: deja un folio
    // inventado que alguien de la oficina teclea en un portal.
    const r = clasificarQr('https://factura.lagas.com.mx/autofactura/consulta');
    expect(r.urlFacturacion).toBe('https://factura.lagas.com.mx/autofactura/consulta');
    expect(r.folioPortal).toBeUndefined();
    expect(r.totalPortal).toBeUndefined();
  });
});

describe('decodeQrFromImage — el camino que ya usa el intake', () => {
  it('lee la foto real de campo donde jsQR fallaba', async () => {
    const qr = await decodeQrFromImage(TICKET);
    expect(qr?.urlFacturacion).toContain('officedepot');
  });

  it('aguanta una foto de celular grande y con orientación EXIF', async () => {
    // Las fotos de iPhone llegan con orientación 3 (180°) y ~24 Mpx. sharp
    // trabaja sobre píxeles crudos: sin aplicar EXIF el código queda de cabeza.
    const grande = await sharp(TICKET)
      .resize({ width: 3200 })
      .rotate(180)
      .withMetadata({ orientation: 3 })
      .jpeg()
      .toBuffer();
    const qr = await decodeQrFromImage(grande);
    expect(qr?.urlFacturacion).toContain('officedepot');
  });
});
