import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BloqueCola, type ColaConductores } from './vista';

// ═══════════════════════════════════════════════════════════════════════════
// FE-6 (auditoría 24): "Esperan aceptar" salía de `getViajes(tenantId)` (los
// 100 viajes más recientes) filtrados y ordenados en memoria — a 500
// viajes/día, ~4.8 h, así que el viaje avisado hace 6 h (el que el agente
// SÍ escala) ya no estaba en la ventana leída. Ahora sale de
// `viajesEsperandoAceptarPaginados`, que pregunta directo por
// avisado_en/aceptado_en/escalado_en con `count` real. Esta prueba fija que
// una lectura caída se dice — no se pinta como "nadie debe respuesta".
// ═══════════════════════════════════════════════════════════════════════════

async function pintar(cola: ColaConductores) {
  const el = await BloqueCola({ cola: Promise.resolve(cola), sufijo: '' });
  return renderToStaticMarkup(el);
}

describe('Conductores — "Esperan aceptar" con lectura dedicada (FE-6)', () => {
  it('lectura caída: dice que no se pudo leer, no "nadie debe respuesta"', async () => {
    const html = await pintar({ esperan: [], totalEsperan: null, sinAvisar: null, error: 'timeout' });
    expect(html).toContain('No se pudo leer la cola de aceptación');
    expect(html).not.toContain('Nadie debe respuesta');
  });

  it('con más en cola de las que se listan, declara el total MEDIDO', async () => {
    const cola: ColaConductores = {
      esperan: Array.from({ length: 20 }, (_, i) => ({
        id: `v${i}`, folio: `F-${i}`, operadorNombre: `Op ${i}`, horasDesdeAviso: 20 - i, avisos: 1,
      })),
      totalEsperan: 47, sinAvisar: null, error: null,
    };
    const html = await pintar(cola);
    expect(html).toContain('47');
    // No debe seguir afirmando que el resto son viajes "más antiguos": con el
    // orden por urgencia, lo que sobra del tope espera MENOS tiempo.
    expect(html).not.toContain('más antiguos');
  });
});
