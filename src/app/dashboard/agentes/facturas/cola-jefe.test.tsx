import { describe, it, expect } from 'vitest';
import { ligaDelPortal } from './cola-jefe';

// SEGURIDAD (hallazgo 21-oct-2026): el botón "Abrir el portal" no decide aquí
// si una `urlTicket` es de confianza — esa decisión ya la tomó el servidor en
// `armar()` (`lib/likida/facturacion/pendientes.ts`), que la descarta a `null`
// cuando su dominio no pertenece al comercio identificado. Lo que este
// componente garantiza es más simple y es lo que estas pruebas fijan: (a) si
// llegó una `urlTicket` (ya depurada), se respeta tal cual — el caso legítimo
// de sucursal/promoción sigue funcionando; (b) si no llegó, cae al portal
// FIJO del catálogo, SIN volver a prefijarle un esquema que ya trae.
describe('ligaDelPortal', () => {
  it('con urlTicket presente, la respeta (caso legítimo: QR de sucursal o promoción)', () => {
    const fila = { urlTicket: 'https://facturacion.oxxogas.com/ticket/123', portal: 'https://facturacion.oxxogas.com/' };
    expect(ligaDelPortal(fila)).toBe('https://facturacion.oxxogas.com/ticket/123');
  });

  it('sin urlTicket, cae al portal del catálogo SIN volver a prefijar "https://" (fila.portal ya es una URL completa)', () => {
    const fila = { urlTicket: null, portal: 'https://facturacion.oxxogas.com/' };
    expect(ligaDelPortal(fila)).toBe('https://facturacion.oxxogas.com/');
    // La regresión real que esto evita: con `https://${fila.portal}` el botón
    // habría quedado apuntando a un enlace roto con el esquema duplicado.
    expect(ligaDelPortal(fila)).not.toContain('https://https');
  });

  it('comportamiento sin cambio cuando ni el ticket trae liga ni el comercio la tiene ya rota: sigue siendo la del catálogo', () => {
    const fila = { urlTicket: null, portal: 'http://megasur.com.mx:8029/' };
    expect(ligaDelPortal(fila)).toBe('http://megasur.com.mx:8029/');
  });
});
