import { describe, test, expect } from 'vitest';
import {
  validarLanzar, estadoFinalDe, resumenVeredicto,
  MAX_FOTOS_CARRIL_RAPIDO, TOPE_DIA_USD,
  type FilaVeredicto,
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

  test('rechaza un escenario fuera de Fase A, con el motivo dicho', () => {
    const r = validarLanzar({ ...BASE, escenario: 'duplicado' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Fase B/);
  });

  test(`más de ${MAX_FOTOS_CARRIL_RAPIDO} fotos manda al carril completo — no entra al rápido`, () => {
    const muchas = Array.from({ length: MAX_FOTOS_CARRIL_RAPIDO + 1 }, (_, i) =>
      `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const r = validarLanzar({ ...BASE, fotoIds: muchas });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/carril completo/);
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
