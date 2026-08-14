import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/likida';

// E1 de la auditoría 4 (legal, CRÍTICO) — el derecho que se anunciaba y no se
// podía honrar.
//
// El aviso de privacidad le dice al operador: "Esa revisión la hace un
// programa... Tienes derecho a oponerte a que se decida así y a pedir que la
// revise alguien" (LFPDPPP art. 26, fr. II). Hasta hoy, oponerse insertaba una
// fila en `solicitud_arco` y NADA MÁS: la liquidación seguía cerrándose sola.
//
// La promesa ahora es mecánica: con `oposicionTitular` el motor calcula IGUAL
// (los números correctos son parte de la revisión) pero la liquidación NO
// puede quedar `cuadrada` sola — sale a `revisar`, con la diferencia que dice
// por qué y con qué fundamento.

const GASTO_LIMPIO: Gasto = {
  id: 'g1', concepto: 'caseta', monto: 500, fecha: '2026-08-14',
};

const cuadrar = (oposicionTitular?: boolean) =>
  cuadrarViaje({ viajeId: 'v', anticipo: 500, politica: [], gastos: [GASTO_LIMPIO], oposicionTitular });

describe('la oposición del titular (LFPDPPP 26-II) obliga la revisión humana', () => {
  it('sin la bandera, un viaje limpio cuadra solo — como siempre', () => {
    expect(cuadrar().estatus).toBe('cuadrada');
    expect(cuadrar(false).estatus).toBe('cuadrada');
  });

  it('con la bandera, el MISMO viaje limpio sale a revisar: una persona lo cierra', () => {
    const l = cuadrar(true);
    expect(l.estatus).toBe('revisar');
  });

  it('la diferencia lo dice con su fundamento, no solo cambia un estatus', () => {
    const d = (cuadrar(true).diferencias ?? []).find((x) => x.tipo === 'oposicion_titular');
    expect(d?.nota).toContain('26');
    expect(d?.nota).toContain('revisión de una persona');
    // monto 0: no es una diferencia de dinero — no toca una sola cifra.
    expect(d?.monto).toBe(0);
  });

  it('no cambia una cifra: deducible, IVA y totales idénticos con y sin bandera', () => {
    const sin = cuadrar(false);
    const con = cuadrar(true);
    expect(con.totalComprobado).toBe(sin.totalComprobado);
    expect(con.totalDeducible).toBe(sin.totalDeducible);
    expect(con.ivaAcreditable).toBe(sin.ivaAcreditable);
    expect(con.diferencia).toBe(sin.diferencia);
  });
});
