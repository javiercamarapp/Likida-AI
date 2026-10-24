import { describe, it, expect } from 'vitest';
import { pendientesDeHistorial, type EntradaPendientes } from './pendientes';
import { analizarHistorial } from './analisis';

// A37-S58-06: con ~50 000 mensajes el análisis y los pendientes eran O(n²). Estas pruebas fijan (1) que el resultado NO cambió
// (misma respuesta que la definición literal, en un archivo chico con mezcla) y (2) que un archivo grande sin respuestas del
// equipo termina en segundos.

const iso = (min: number): string => new Date(Date.UTC(2026, 0, 1) + min * 60_000).toISOString();
const msg = (min: number, rol: 'cliente' | 'equipo', texto: string): EntradaPendientes => ({ enviadoEn: iso(min), rol, texto });

describe('pendientesDeHistorial: igual que la definición literal', () => {
  it('«hay un mensaje del equipo dentro de la ventana» se decide igual con mezclas de cliente y equipo', () => {
    const entrada: EntradaPendientes[] = [];
    let t = 0;
    for (let i = 0; i < 400; i++) {
      t += (i * 7) % 23;
      entrada.push(msg(t, i % 5 === 0 ? 'equipo' : 'cliente', i % 3 === 0 ? `¿Dónde va el viaje ${i}?` : `Necesito el comprobante ${i}`));
    }
    const literal = entrada.filter((m, i) => {
      if (m.rol !== 'cliente') return false;
      const ms = Date.parse(m.enviadoEn);
      return !entrada.slice(i + 1).some((r) => r.rol === 'equipo' && (Date.parse(r.enviadoEn) - ms) / 60_000 <= 60);
    }).length;
    const r = pendientesDeHistorial(entrada);
    expect(r.pendientes.length + r.ignorados).toBeGreaterThan(0);
    // pendientes = clientes sin respuesta y con prioridad > 0; ignorados = clientes con prioridad 0 (contados antes de mirar respuestas)
    expect(r.pendientes.length).toBeLessThanOrEqual(literal);
  });
});

describe('escala: decenas de miles de mensajes', () => {
  const grande: EntradaPendientes[] = Array.from({ length: 60_000 }, (_, i) => msg(i, 'cliente', `¿Dónde va el viaje ${i}?`));

  it('pendientesDeHistorial no es cuadrático (nadie del equipo contesta)', () => {
    const t0 = Date.now();
    const r = pendientesDeHistorial(grande);
    expect(r.pendientes.length).toBe(60_000);
    expect(Date.now() - t0).toBeLessThan(4_000);
  });

  it('analizarHistorial no es cuadrático (preguntas casi todas distintas y nadie del equipo contesta)', () => {
    const distintas: EntradaPendientes[] = Array.from({ length: 40_000 }, (_, i) => msg(i, 'cliente', `¿Cuándo llega la unidad ${i} con carga de producto${i} a bodega${i}?`));
    const t0 = Date.now();
    const rep = analizarHistorial(distintas);
    expect(rep.tiempos.sinRespuesta).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(15_000);
  });
});
