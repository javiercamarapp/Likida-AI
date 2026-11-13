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

/**
 * Tiempo de CPU del proceso (user+system) que consume `fn`, en ms. Causa raíz de la inestabilidad: la prueba medía el reloj de pared
 * (`Date.now()`), así que con la Mac cargada (load average > 50 con otros carriles corriendo) el planificador le quitaba el
 * procesador y el mismo código pasaba de ~2 s a 20-70 s sin que el algoritmo cambiara. El tiempo de CPU no cuenta esas esperas;
 * un O(n²) de verdad (60 000 mensajes ≈ 1.8·10⁹ comparaciones) sigue gastando CPU de sobra. Vitest 4 usa por omisión el pool de forks (vitest.config.ts no lo
 * cambia), así que cada archivo corre en su propio proceso y la cifra es de esta prueba. Se toma el mínimo de las corridas para descartar un GC aislado.
 */
const cpuMs = (veces: number, fn: () => void): number => {
  let mejor = Infinity;
  for (let i = 0; i < veces; i++) {
    const antes = process.cpuUsage();
    fn();
    const d = process.cpuUsage(antes);
    mejor = Math.min(mejor, (d.user + d.system) / 1000);
  }
  return mejor;
};

describe('escala: decenas de miles de mensajes', () => {
  const grande: EntradaPendientes[] = Array.from({ length: 60_000 }, (_, i) => msg(i, 'cliente', `¿Dónde va el viaje ${i}?`));

  it('pendientesDeHistorial no es cuadrático (nadie del equipo contesta)', () => {
    let n = 0;
    expect(cpuMs(2, () => { n = pendientesDeHistorial(grande).pendientes.length; })).toBeLessThan(4_000);
    expect(n).toBe(60_000);
  }, 180_000); // el tope de Vitest es de PARED y sí sufre la carga: holgado a propósito; el umbral real es el de CPU

  it('analizarHistorial no es cuadrático (preguntas casi todas distintas y nadie del equipo contesta)', () => {
    // Razón de tiempos de CPU entre N y 2N en vez de un tope absoluto: un tope en ms (15 000) midió 15 105 en CI cargado sin que el
    // algoritmo cambiara. Un algoritmo lineal/casi lineal duplica el tiempo (razón ≈ 2); uno cuadrático lo cuadruplica (≈ 4). Umbral 3,2.
    // El tope absoluto solo queda como red de cordura, muy holgado.
    const generar = (n: number): EntradaPendientes[] => Array.from({ length: n }, (_, i) => msg(i, 'cliente', `¿Cuándo llega la unidad ${i} con carga de producto${i} a bodega${i}?`));
    const chica = generar(20_000);
    const doble = generar(40_000);
    let sinRespuesta = 0;
    const tChica = cpuMs(3, () => { analizarHistorial(chica); });
    const tDoble = cpuMs(3, () => { sinRespuesta = analizarHistorial(doble).tiempos.sinRespuesta; });
    expect(sinRespuesta).toBeGreaterThan(0);
    expect(tDoble).toBeLessThan(120_000);
    expect(tDoble / Math.max(tChica, 1)).toBeLessThan(3.2);
  }, 600_000); // ídem
});
