import { afterEach, describe, expect, it } from 'vitest';
import { crearFuentesEnMemoria, datosVacios } from './fuentes.fixture';
import { ponerFuentes } from './fuentes';
import type { TareaAbierta } from './escalamiento';
import { leerTareasDeDinero, TOPE_TAREAS_DINERO } from './tareas_de_dinero';

// A37-S17-03: el filtro de dinero va ANTES del límite; recortar a 20 avisa; un fallo no se confunde con «sin tareas».
const tarea = (i: number, destino: TareaAbierta['destino'], motivo: TareaAbierta['motivo']): TareaAbierta & { dedupe: string; tenantId: string; usuarioId: null } => ({
  id: `e-${i}`, creadaEn: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), destino, motivo, viajeFolio: null, resumen: `tarea ${i}`, pedidaPorRol: 'flota_admin',
  dedupe: `d-${i}`, tenantId: 't-1', usuarioId: null,
});
const instalar = (lista: ReturnType<typeof tarea>[]) => {
  const f = crearFuentesEnMemoria({ 't-1': { datos: datosVacios() } });
  f.tareas.set('t-1', lista);
  ponerFuentes(f.fuentes);
};
afterEach(() => ponerFuentes(null));

describe('leerTareasDeDinero', () => {
  it('una tarea de dinero VIEJA aparece aunque haya más de 60 operativas más recientes', async () => {
    const dinero = tarea(0, 'contador', 'duda_fiscal');
    const operativas = Array.from({ length: 70 }, (_, i) => tarea(i + 1, 'jefe_de_trafico', 'operador_sin_respuesta'));
    instalar([dinero, ...operativas]);
    const r = await leerTareasDeDinero('t-1', 'contador');
    expect(r).toMatchObject({ estado: 'ok', hayMas: false });
    expect(r.estado === 'ok' && r.tareas.map((t) => t.id)).toEqual(['e-0']);
  });

  it('con más de 20 tareas de dinero se pintan 20 y se avisa que hay más', async () => {
    instalar(Array.from({ length: TOPE_TAREAS_DINERO + 5 }, (_, i) => tarea(i, 'liquidacion', 'diferencia_liquidacion')));
    const r = await leerTareasDeDinero('t-1', 'flota_admin');
    expect(r.estado === 'ok' && r.tareas).toHaveLength(TOPE_TAREAS_DINERO);
    expect(r).toMatchObject({ hayMas: true });
  });

  it('un fallo de lectura es «error», no «sin tareas»; sin la tabla es «sin_tabla»', async () => {
    ponerFuentes({ escalacionesAbiertas: async () => { throw new Error('caída'); } } as never);
    expect(await leerTareasDeDinero('t-1', 'contador')).toEqual({ estado: 'error' });
    ponerFuentes({ escalacionesAbiertas: async () => null } as never);
    expect(await leerTareasDeDinero('t-1', 'contador')).toEqual({ estado: 'sin_tabla' });
  });

  it('un rol sin área de dinero no lee nada aunque la fuente se las entregue', async () => {
    instalar([tarea(1, 'contador', 'duda_fiscal')]);
    const r = await leerTareasDeDinero('t-1', 'encargado');
    expect(r.estado === 'ok' && r.tareas).toEqual([]);
  });
});
