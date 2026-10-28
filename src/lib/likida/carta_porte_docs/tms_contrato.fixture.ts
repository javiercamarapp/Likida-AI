// PRUEBA DE CONTRATO del puerto `SalidaTms` (OLA1-A3) — el punto de extensión para el adaptador de producción.
//
// Cuando el cliente entregue la especificación de su API, quien escriba el adaptador real lo prueba así (contra un entorno de
// prueba del TMS o un servidor simulado de la especificación), sin tocar el motor:
//
//   import { describirContratoSalidaTms } from './tms_contrato.fixture';
//   describirContratoSalidaTms('adaptador del TMS', () => crearAdaptadorTms({ ...credencialesDePrueba }));
//
// y lo conecta con `fijarProveedorSalida(async (tenantId) => adaptadorDeEsaFlota)` (worker_envios_deps.ts). Lo que exige el contrato
// es lo que el motor ASUME (worker_envios.ts, prechequeo.ts): jamás lanza, siempre contesta con la forma de `ResultadoCarga`, un
// fallo trae `clase` y un mensaje llano, la MISMA llave de idempotencia no duplica la carga, y las consultas opcionales (si existen)
// contestan `existe | no_existe | desconocido` y nunca lanzan.
//
// El doble en memoria (`tms_falso.fixture.ts`) lo cumple en su modo `duplicado`; `tms_contrato.test.ts` lo demuestra y demuestra
// también que un adaptador que miente (lanza, o duplica) NO lo cumple.

import { describe, expect, it } from 'vitest';
import type { EntradaCarga, ResultadoCarga, SalidaTms } from './tms_puerto';

const CLASES = ['transitorio', 'auth', 'validacion', 'reque_inexistente', 'duplicado_distinto', 'permanente'];

export const entradaDeContrato = (over: Partial<EntradaCarga> = {}): EntradaCarga => ({
  tenantId: 'flota-sintetica', idempotencyKey: `contrato-${Math.random().toString(36).slice(2)}`, archivo: new Uint8Array([80, 75, 3, 4]),
  nombre: 'plantilla.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', plantilla: 'normal',
  metadatos: { clienteInterno: 'CLI-SINTETICO', folio: 'F-CONTRATO' }, ...over,
});

export function formaValida(r: ResultadoCarga): boolean {
  if (r.ok) return typeof r.duplicado === 'boolean' && (r.referencia === null || typeof r.referencia === 'string');
  return CLASES.includes(r.clase) && typeof r.mensajeLlano === 'string' && r.mensajeLlano.trim() !== '' && Array.isArray(r.errores);
}

export function describirContratoSalidaTms(nombre: string, crear: () => SalidaTms | Promise<SalidaTms>): void {
  describe(`contrato SalidaTms · ${nombre}`, () => {
    it('cargarPlantilla contesta SIEMPRE con la forma de ResultadoCarga y no lanza', async () => {
      const r = await (await crear()).cargarPlantilla(entradaDeContrato());
      expect(formaValida(r)).toBe(true);
    });

    it('la MISMA llave con el MISMO contenido no duplica la carga (segunda vez: ok con duplicado:true y la misma referencia)', async () => {
      const tms = await crear();
      const e = entradaDeContrato();
      const a = await tms.cargarPlantilla(e);
      const b = await tms.cargarPlantilla(e);
      expect(formaValida(a) && formaValida(b)).toBe(true);
      if (a.ok) {
        expect(b.ok).toBe(true);
        if (b.ok) { expect(b.duplicado).toBe(true); expect(b.referencia).toBe(a.referencia); }
      }
    });

    it('la misma llave con contenido DISTINTO se rechaza como duplicado_distinto (nunca se sobrescribe en silencio)', async () => {
      const tms = await crear();
      const llave = entradaDeContrato().idempotencyKey;
      const a = await tms.cargarPlantilla(entradaDeContrato({ idempotencyKey: llave }));
      if (!a.ok) return; // un entorno que rechaza la primera ya probó la forma arriba
      const b = await tms.cargarPlantilla(entradaDeContrato({ idempotencyKey: llave, archivo: new Uint8Array([80, 75, 3, 4, 9, 9, 9]), nombre: 'otra.xlsx' }));
      expect(b.ok).toBe(false);
      if (!b.ok) expect(b.clase).toBe('duplicado_distinto');
    });

    it('una señal ya cancelada no lanza una excepción cruda: contesta transitorio o aborta de forma controlada', async () => {
      const tms = await crear();
      const ac = new AbortController(); ac.abort();
      const r = await tms.cargarPlantilla(entradaDeContrato(), ac.signal).catch((e: unknown) => e);
      if (r instanceof Error) expect(r.name === 'AbortError' || /abort/i.test(r.message)).toBe(true);
      else expect(formaValida(r as ResultadoCarga)).toBe(true);
    });

    it('las consultas opcionales, si existen, contestan existe | no_existe | desconocido y no lanzan', async () => {
      const tms = await crear();
      for (const consulta of [tms.consultarReque, tms.consultarCaja]) {
        if (!consulta) continue;
        const v = await consulta.call(tms, { tenantId: 'flota-sintetica', clienteInterno: 'CLI-SINTETICO', caja: 'CAJA-1', folio: 'F-CONTRATO' });
        expect(['existe', 'no_existe', 'desconocido']).toContain(v);
      }
    });
  });
}
