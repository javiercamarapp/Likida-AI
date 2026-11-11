/* eslint-disable security/detect-non-literal-fs-filename -- lee los archivos de esta misma carpeta con nombres fijos */
// ═══════════════════════════════════════════════════════════════════════════
// FACTURACIÓN (dinero y fiscal) — la captura vive en CAJONES del sistema, no en `<details>` con formulario, y cada cajón sigue
// mandando al servidor EXACTAMENTE los campos que sus acciones leen (`guardarFactura`, `guardarPago`, `sellarEmitida`, `cancelar`).
// Esta prueba fija ese contrato antes de que alguien vuelva a tocar el marcado.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormaFactura, FormaPago, FormaEmitir, FormaCancelar } from './forma';

const accion = async () => ({ ok: true as const, mensaje: 'ok' });
const nombres = (html: string) => [...html.matchAll(/<(?:input|select|textarea)[^>]*\sname="([^"]+)"/g)].map((m) => m[1]);

describe('los campos que lee cada server action siguen viajando en el FormData', () => {
  it('registrar factura: cliente, fecha, serie, folio, subtotal, IVA, retención, UUID y los viajes que ampara', () => {
    const html = renderToStaticMarkup(
      <FormaFactura accion={accion} hoy="2026-11-10" clientes={[{ id: 'c1', nombre: 'Cliente', diasCredito: 30 }]}
        viajesSinFacturar={[{ viajeId: 'v1', folio: 'V-1', ruta: 'A → B', cliente: 'Cliente' } as never]} />,
    );
    const n = nombres(html);
    for (const campo of ['clienteId', 'fecha', 'serie', 'folio', 'subtotal', 'iva', 'retencion', 'cfdiUuid', 'viajeIds']) expect(n).toContain(campo);
    // El total NO se teclea (lo calcula el servidor) y los montos aceptan «11,600.00» pegado de Excel (texto, no number).
    expect(n).not.toContain('total');
    expect(html).toMatch(/name="subtotal"[^>]*inputMode="decimal"|inputMode="decimal"[^>]*name="subtotal"/i);
    expect(html).not.toMatch(/type="number"[^>]*name="(subtotal|iva|retencion)"/);
    // Es un cajón (`<dialog>`), no un `<details>`.
    expect(html).toContain('<dialog');
    expect(html).not.toContain('<details');
  });

  it('registrar pago: factura (oculta), fecha, monto, método y referencia', () => {
    const html = renderToStaticMarkup(<FormaPago accion={accion} facturaId="f1" hoy="2026-11-10" />);
    expect(html).toContain('name="facturaId" value="f1"');
    for (const campo of ['fecha', 'monto', 'metodo', 'referencia']) expect(nombres(html)).toContain(campo);
  });

  it('marcar emitida: factura, folio y UUID (obligatorio)', () => {
    const html = renderToStaticMarkup(<FormaEmitir accion={accion} facturaId="f2" folioActual="A-9" />);
    expect(html).toContain('name="facturaId" value="f2"');
    expect(html).toContain('value="A-9"');
    expect(html).toMatch(/name="cfdiUuid"[^>]*required|required[^>]*name="cfdiUuid"/);
  });

  it('cancelar: solo manda la factura y dice el alcance (la cancelación ante el SAT se hace con el PAC)', () => {
    const html = renderToStaticMarkup(<FormaCancelar accion={accion} facturaId="f3" />);
    expect(html).toContain('name="facturaId" value="f3"');
    expect(html).toContain('PAC');
  });
});

describe('la pantalla ya no pinta nada a mano', () => {
  const dir = __dirname;
  for (const f of ['vista.tsx', 'forma.tsx', 'portal.tsx', 'estadias.tsx']) {
    it(`${f}: sin style=, sin <table>, sin <details>, sin <button> crudo`, () => {
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src).not.toMatch(/\sstyle=\{/);
      expect(src).not.toMatch(/<table[\s>]/);
      expect(src).not.toMatch(/<details[\s>]/);
      expect(src).not.toMatch(/<button[\s>]/);
    });
  }
});
