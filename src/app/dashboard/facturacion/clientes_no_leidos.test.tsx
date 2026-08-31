// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · FE-1 (ALTO) — «no leí» no es «no hay».
//
// `page.tsx` leía el catálogo de clientes con `if (!error && data)` y dejaba
// `clientes = []` en CUALQUIER falla: PostgREST 500, timeout, una policy nueva.
// El formulario entra entonces por la rama `clientes.length === 0` y afirma, en
// color de advertencia: «No tienes clientes dados de alta.»
//
// Una flota con 40 clientes activos lee que no tiene ninguno, se va a
// /dashboard/clientes —que sí los lista—, y no puede registrar su factura sin
// un solo mensaje de error en pantalla. Es exactamente el modo de falla que
// CLAUDE.md nombra: supabase-js reporta errores POR VALOR, así que sin
// comprobar `error` una base caída se lee como «no hay nada».
//
// El propio archivo ya sabía distinguirlo: `datos` y `auditoria` se dejan en
// `null` con el comentario «El catch NO finge que no hay facturas». El catálogo
// de clientes era la única lectura de la pantalla que mezclaba las dos cosas.
//
// `null` = no se pudo leer · `[]` = se leyó y de verdad no hay.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormaFactura } from './forma';

const accion = async () => ({ ok: true as const, mensaje: 'ok' });
const PROPS = { accion, viajesSinFacturar: [], hoy: '2026-08-30' };

const pintar = (clientes: React.ComponentProps<typeof FormaFactura>['clientes']) =>
  renderToStaticMarkup(<FormaFactura {...PROPS} clientes={clientes} />);

describe('FE-1: el catálogo de clientes distingue «no leí» de «no hay»', () => {
  it('con la lectura CAÍDA (null) no acusa al cliente de no tener clientes', () => {
    const html = pintar(null);
    // Lo que rompía: esta frase aparecía cuando la consulta había fallado.
    expect(html).not.toContain('No tienes clientes dados de alta');
    // Y lo que tiene que aparecer en su lugar: que falló la lectura.
    expect(html).toContain('no se pudo leer');
    // Tampoco ofrece un selector vacío que fabricaría una factura sin cliente.
    expect(html).not.toContain('Elige al cliente');
  });

  it('con la lectura BUENA y cero filas sí dice que no hay clientes dados de alta', () => {
    const html = pintar([]);
    expect(html).toContain('No tienes clientes dados de alta');
    expect(html).not.toContain('no se pudo leer');
  });

  it('con clientes leídos pinta el selector y no ninguno de los dos avisos', () => {
    const html = pintar([{ id: 'c1', nombre: 'Transportes Innovativos', diasCredito: 30 }]);
    expect(html).toContain('Transportes Innovativos');
    expect(html).toContain('Elige al cliente');
    expect(html).not.toContain('No tienes clientes dados de alta');
    expect(html).not.toContain('no se pudo leer');
  });
});
