import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  validarLanzar, estadoFinalDe, resumenVeredicto, ESCENARIOS_VALIDOS,
  MAX_FOTOS_CARRIL_RAPIDO, TOPE_DIA_USD,
  MARGEN_PASADA_MS, COSTO_CIERRE_PASADA_MS, PASOS_CIERRE_PASADA,
  PRESUPUESTO_MENSAJE_MS, TECHO_PASADA_MS, MAX_DURATION_PASADA_S, PASADA_MUERTA_MS,
  resumirAvance, carrilPara,
  type FilaVeredicto, type FotoDeCorrida,
} from './qa-tipos';

const FOTO = 'aaaaaaaa-0000-4000-8000-000000000001';
const BASE = {
  escenario: 'demo_guion',
  fotoIds: [FOTO],
  anticipo: 10_600,
  rfcEmpresa: 'GMX0902279I1',
  ruta: { origen: 'Silao', destino: 'Nuevo Laredo' },
  politica: [{ concepto: 'diesel', topeMonto: 4000 }],
  retencion: 'borrar_al_terminar',
};

describe('validarLanzar — el cliente no es frontera de confianza', () => {
  test('acepta el body bueno y normaliza', () => {
    const r = validarLanzar(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.escenario).toBe('demo_guion');
    expect(r.datos.params.anticipo).toBe(10_600);
    expect(r.datos.params.rfcEmpresa).toBe('GMX0902279I1');
    expect(r.datos.params.retencion).toBe('borrar_al_terminar');
  });

  test('rechaza un escenario que no está en el selector, y DICE cuántos faltan del catálogo', () => {
    const r = validarLanzar({ ...BASE, escenario: 'sobregiro' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/escenario desconocido/);
    expect(r.error).toMatch(/restantes del catálogo/);
  });

  test('los escenarios del selector SÍ pasan — la lista y el tipo no pueden divergir', () => {
    for (const id of ESCENARIOS_VALIDOS) {
      expect(validarLanzar({ ...BASE, escenario: id }).ok, id).toBe(true);
    }
  });

  test(`más de ${MAX_FOTOS_CARRIL_RAPIDO} fotos ya no se RECHAZAN: se van al carril completo (Fase C)`, () => {
    // Hasta la Fase C esto devolvía `ok: false`. El tope de fotos dejó de ser
    // un rechazo y pasó a ser una elección de carril — 91 comprobantes reales
    // son el caso que el panel existe para correr, no un error del usuario.
    const muchas = Array.from({ length: 91 }, (_, i) =>
      `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const r = validarLanzar({ ...BASE, fotoIds: muchas });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.carril).toBe('completo');
    expect(r.datos.params.fotoIds).toHaveLength(91);
  });

  test('pedir el carril RÁPIDO con más de diez sí se rechaza, y el motivo manda al completo', () => {
    const muchas = Array.from({ length: MAX_FOTOS_CARRIL_RAPIDO + 1 }, (_, i) =>
      `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const r = validarLanzar({ ...BASE, carril: 'rapido', fotoIds: muchas });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/carril completo/);
    // La cifra que no cabe se dice, no se insinúa.
    expect(r.error).toContain(String(MAX_FOTOS_CARRIL_RAPIDO + 1));
  });

  test('diez o menos siguen siendo carril rápido, y un carril inventado se rechaza', () => {
    expect(validarLanzar(BASE).ok && validarLanzar(BASE)).toMatchObject({ datos: { carril: 'rapido' } });
    const malo = validarLanzar({ ...BASE, carril: 'turbo' });
    expect(malo.ok).toBe(false);
    if (!malo.ok) expect(malo.error).toMatch(/carril desconocido/);
  });

  test('cero fotos, anticipo inválido y política vacía se rechazan', () => {
    expect(validarLanzar({ ...BASE, fotoIds: [] }).ok).toBe(false);
    expect(validarLanzar({ ...BASE, anticipo: 0 }).ok).toBe(false);
    expect(validarLanzar({ ...BASE, anticipo: NaN }).ok).toBe(false);
    expect(validarLanzar({ ...BASE, anticipo: -5 }).ok).toBe(false);
    expect(validarLanzar({ ...BASE, politica: [] }).ok).toBe(false);
    expect(validarLanzar({ ...BASE, politica: [{ concepto: '' }] }).ok).toBe(false);
  });

  test('un RFC con basura se normaliza; uno imposible se rechaza', () => {
    const r = validarLanzar({ ...BASE, rfcEmpresa: ' gmx-090227 9i1 ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datos.params.rfcEmpresa).toBe('GMX0902279I1');
    expect(validarLanzar({ ...BASE, rfcEmpresa: 'XX' }).ok).toBe(false);
  });

  test('retencion solo admite el dominio; cualquier otra cosa cae al default seguro (borrar)', () => {
    const r = validarLanzar({ ...BASE, retencion: 'para_siempre' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datos.params.retencion).toBe('borrar_al_terminar');
  });

  test('fotoIds que no son uuid se rechazan (nada de rutas arbitrarias hacia Storage)', () => {
    expect(validarLanzar({ ...BASE, fotoIds: ['../../secreto'] }).ok).toBe(false);
  });
});

describe('estadoFinalDe — fallar cerrado', () => {
  const fila = (estado: FilaVeredicto['estado']): FilaVeredicto =>
    ({ invariante: '#1', oraculo: 'x', estado, severidad: 'CRÍTICO', esperado: 1, real: 1 });

  test('un fallo manda sobre todo lo demás', () => {
    expect(estadoFinalDe([fila('ok'), fila('no_verificado'), fila('fallo')])).toBe('fallo');
  });
  test('lo no verificado NO cuenta como pasó — es parcial', () => {
    expect(estadoFinalDe([fila('ok'), fila('no_verificado')])).toBe('parcial');
  });
  test('solo ok limpio es ok', () => {
    expect(estadoFinalDe([fila('ok'), fila('ok')])).toBe('ok');
  });
});

describe('resumenVeredicto', () => {
  test('cuenta por estado y respeta el null (sin veredicto ≠ 0/0/0)', () => {
    expect(resumenVeredicto(null)).toBeNull();
    const filas: FilaVeredicto[] = [
      { invariante: 'a', oraculo: 'a', estado: 'ok', severidad: '-', esperado: 0, real: 0 },
      { invariante: 'b', oraculo: 'b', estado: 'fallo', severidad: '-', esperado: 0, real: 0 },
      { invariante: 'c', oraculo: 'c', estado: 'no_verificado', severidad: '-', esperado: 0, real: 0 },
    ];
    expect(resumenVeredicto(filas)).toEqual({ ok: 1, noVerificado: 1, fallo: 1 });
  });
});

test('el tope diario es el del diseño (§6, default $5) — no un número inventado', () => {
  expect(TOPE_DIA_USD).toBe(5);
});

// ═══════════════════════════════════════════════════════════════════════════
// EL RELOJ DE LA PASADA — el margen contra su cola, y las copias contra su
// fuente.
//
// `MARGEN_PASADA_MS` es lo que la pasada se guarda para CERRAR: escribir su
// corte, dejar el estado consistente y soltar la llave. Si se quedara corto,
// Vercel mataría la invocación a media escritura y la corrida quedaría
// diciendo 'corriendo' para siempre con la llave puesta — exactamente el
// fallo mudo que este carril vino a evitar. Justificarlo en prosa no basta:
// en `agentes/runner.ts` un margen justificado sólo en prosa ya se quedó
// corto una vez (auditoría ciclo 7, c7-31). Aquí se COMPARA contra la suma.
// ═══════════════════════════════════════════════════════════════════════════
describe('el margen de la pasada alcanza para lo que la pasada tiene que cerrar', () => {
  test('la suma de la cola de cierre es la que dice la tabla, paso por paso', () => {
    expect(PASOS_CIERRE_PASADA).toHaveLength(4);
    expect(COSTO_CIERRE_PASADA_MS).toBe(PASOS_CIERRE_PASADA.reduce((s, p) => s + p.ms, 0));
    expect(COSTO_CIERRE_PASADA_MS).toBe(38_000);
    // Cada paso es una consulta de supabase-js, acotada por `TOPE_CONSULTA_MS`
    // (8 000) más la gracia del envoltorio (1 500). Los dos números se leen
    // del ARCHIVO fuente y no de una constante importada: este módulo es
    // client-safe a propósito y `presupuesto.ts` arrastra `logger` y `node:`.
    const presupuesto = readFileSync('src/lib/likida/presupuesto.ts', 'utf8');
    expect(presupuesto).toContain('export const TOPE_CONSULTA_MS = Number(process.env.LIKIDA_TOPE_CONSULTA_MS) || 8_000;');
    expect(presupuesto).toContain('const GRACIA_TOPE_MS = 1_500;');
    expect(PASOS_CIERRE_PASADA.every((p) => p.ms === 8_000 + 1_500)).toBe(true);
  });

  test('el margen es MAYOR que la cola — con holgura, no justo', () => {
    expect(MARGEN_PASADA_MS).toBeGreaterThan(COSTO_CIERRE_PASADA_MS);
    // 45 000 − 38 000 = 7 000 ms de holgura. Se fija el número para que
    // agregar un paso a la cola sin subir el margen ROMPA aquí y no en
    // producción a las once de la noche.
    expect(MARGEN_PASADA_MS - COSTO_CIERRE_PASADA_MS).toBe(7_000);
  });

  test('`PRESUPUESTO_MENSAJE_MS` es la copia declarada de `PRESUPUESTO_WEBHOOK_MS`, y no derivó', () => {
    const presupuesto = readFileSync('src/lib/likida/presupuesto.ts', 'utf8');
    expect(presupuesto).toContain('export const PRESUPUESTO_WEBHOOK_MS = 120_000;');
    expect(PRESUPUESTO_MENSAJE_MS).toBe(120_000);
  });

  test('el techo de trabajo y el plazo de una pasada muerta salen del maxDuration real', () => {
    expect(MAX_DURATION_PASADA_S).toBe(300);
    expect(TECHO_PASADA_MS).toBe(300_000 - MARGEN_PASADA_MS);
    // Se reclama una pasada ajena sólo tras el `maxDuration` COMPLETO: antes
    // de eso todavía puede estar viva, y quitarle la llave sería ponerse a
    // mandar las mismas fotos en paralelo.
    expect(PASADA_MUERTA_MS).toBe(300_000);
    expect(PASADA_MUERTA_MS).toBeGreaterThan(TECHO_PASADA_MS);
  });
});

describe('el carril y el avance: lo que no se procesó se cuenta y se NOMBRA', () => {
  test('carrilPara es la misma regla para el formulario y para el servidor', () => {
    expect(carrilPara(1)).toBe('rapido');
    expect(carrilPara(MAX_FOTOS_CARRIL_RAPIDO)).toBe('rapido');
    expect(carrilPara(MAX_FOTOS_CARRIL_RAPIDO + 1)).toBe('completo');
    expect(carrilPara(91)).toBe('completo');
  });

  test('resumirAvance separa los cuatro estados y nombra las que no tuvieron turno', () => {
    const fila = (id: string, estado: FotoDeCorrida['estado'], n: number): FotoDeCorrida => ({
      fotoId: id, n, estado, pasada: 1, detalle: null, costoUsd: null,
      inicio: '2026-08-27T15:00:00.000Z', fin: null,
    });
    const av = resumirAvance(['a', 'b', 'c', 'd', 'e'], [
      fila('a', 'ok', 1), fila('b', 'bad', 2),
      fila('c', 'interrumpida', 3), fila('d', 'corriendo', 4),
    ]);
    expect(av).toEqual({
      total: 5, ok: 1, bad: 1, interrumpidas: 1, enVuelo: 1,
      sinTurno: 1, sinTurnoIds: ['e'],
    });
    // Lo interrumpido NO se suma ni a ok ni a bad: «no se procesó» ≠ «salió
    // mal», y meterlo en cualquiera de los dos sería afirmar lo que no se sabe.
    expect(av.ok + av.bad).toBe(2);
  });

  test('sin una sola fila, TODO está sin turno — jamás un 0 de fotos «procesadas»', () => {
    const av = resumirAvance(['a', 'b', 'c'], []);
    expect(av.sinTurno).toBe(3);
    expect(av.sinTurnoIds).toEqual(['a', 'b', 'c']);
    expect(av.ok).toBe(0);
  });
});
