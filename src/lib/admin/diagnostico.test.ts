import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diagnosticarAlertas, topeMensualUsd, endurecerSalida, COSTO_MAX_LLAMADA_USD, type Puertos, type SalidaDiagnostico } from './diagnostico';
import type { ItemClasificado } from './guardia';

const item = (n = 1, sev: 'S1' | 'S2' | 'S3' = 'S2'): ItemClasificado => ({ severidad: sev, regla: 'regla', fuente: 'corridas', titulo: `Corrida ${n} fallo`, flota: 'F', desde: '2026-11-01T00:00:00Z', vence: null, href: null });
const salida: SalidaDiagnostico = { causa_probable: 'El runner está frenado', confianza: 'media', evidencia: [{ fuente: 'latido:runner', cita: 'estado=ok, ultimo=parcial' }], arreglo_propuesto: 'Revisar la bandeja' };

function puertos(over: Partial<Puertos> = {}) {
  const p = {
    gastoMesUsd: vi.fn(async (): Promise<number | null> => 0),
    leerEvidencia: vi.fn(async () => [{ fuente: 'alerta', texto: 'x' }]),
    llamarModelo: vi.fn(async () => ({ data: salida, costoUsd: 0.02, modelo: 'doble' })),
    proponer: vi.fn(async () => {}),
    registrarGasto: vi.fn(async () => {}),
  };
  return { ...p, ...over } as typeof p;
}

describe('tope de gasto', () => {
  it('por omisión 20; configurable; inválido cierra (0)', () => {
    expect(topeMensualUsd({} as NodeJS.ProcessEnv)).toBe(20);
    expect(topeMensualUsd({ DIAGNOSTICO_TOPE_USD: '35' } as unknown as NodeJS.ProcessEnv)).toBe(35);
    expect(topeMensualUsd({ DIAGNOSTICO_TOPE_USD: 'abc' } as unknown as NodeJS.ProcessEnv)).toBe(0);
    expect(topeMensualUsd({ DIAGNOSTICO_TOPE_USD: '-1' } as unknown as NodeJS.ProcessEnv)).toBe(0);
  });
  it('apagado: no lee gasto ni llama al modelo', async () => {
    const p = puertos();
    const r = await diagnosticarAlertas([item()], [], p, { encendido: false });
    expect(r.estado).toBe('apagado');
    expect(p.gastoMesUsd).not.toHaveBeenCalled();
    expect(p.llamarModelo).not.toHaveBeenCalled();
  });
  it('gasto ilegible (null o lanza): falla cerrado, no llama', async () => {
    for (const g of [async () => null, async () => { throw new Error('x'); }]) {
      const p = puertos({ gastoMesUsd: g });
      const r = await diagnosticarAlertas([item()], [], p, { encendido: true, topeUsd: 20 });
      expect(r.estado).toBe('gasto_ilegible');
      expect(p.llamarModelo).not.toHaveBeenCalled();
    }
  });
  it('en el tope o por encima: se detiene sin llamar y lo dice', async () => {
    const p = puertos({ gastoMesUsd: async () => 20 });
    const r = await diagnosticarAlertas([item()], [], p, { encendido: true, topeUsd: 20 });
    expect(r.estado).toBe('tope');
    expect(r.detalle).toEqual({ estado: 'tope', gastoMesUsd: 20, topeUsd: 20 });
    expect(p.llamarModelo).not.toHaveBeenCalled();
  });
  it('no cruza el tope con una llamada que arranca justo debajo (reserva la cota)', async () => {
    const p = puertos({ gastoMesUsd: async () => 20 - COSTO_MAX_LLAMADA_USD / 2 });
    const r = await diagnosticarAlertas([item()], [], p, { encendido: true, topeUsd: 20 });
    expect(r.estado).toBe('tope');
    expect(p.llamarModelo).not.toHaveBeenCalled();
  });
});

describe('el diagnóstico', () => {
  it('solo S1/S2 nuevas; propone una pieza y anota el gasto; no repite una ya diagnosticada', async () => {
    const p = puertos();
    const r = await diagnosticarAlertas([item(1, 'S3'), item(2)], [], p, { encendido: true, topeUsd: 20 });
    expect(r.estado).toBe('ok');
    expect(p.llamarModelo).toHaveBeenCalledTimes(1);
    expect(p.proponer).toHaveBeenCalledTimes(1);
    expect(p.registrarGasto).toHaveBeenCalledWith(expect.objectContaining({ costoUsd: 0.02, ok: true }));
    const otra = puertos();
    await diagnosticarAlertas([item(2)], r.diagnosticados, otra, { encendido: true, topeUsd: 20 });
    expect(otra.llamarModelo).not.toHaveBeenCalled();
  });
  it('máximo 2 por pasada', async () => {
    const p = puertos();
    await diagnosticarAlertas([item(1), item(2), item(3)], [], p, { encendido: true, topeUsd: 20 });
    expect(p.llamarModelo).toHaveBeenCalledTimes(2);
  });
  it('la evidencia se redacta antes de llegar al modelo y en la pieza', async () => {
    const p = puertos({ leerEvidencia: async () => [{ fuente: 'x', texto: 'tel 55 1234 5678 correo a@b.com RFC XAXX010101000' }],
      llamarModelo: vi.fn(async () => ({ data: { ...salida, causa_probable: 'contactar a a@b.com' }, costoUsd: 0.01, modelo: 'doble' })) });
    await diagnosticarAlertas([item()], [], p, { encendido: true, topeUsd: 20 });
    const enviado = (p.llamarModelo.mock.calls[0] as unknown as [{ usuario: string }])[0].usuario;
    expect(enviado).not.toMatch(/a@b\.com|XAXX|1234/);
    expect(JSON.stringify(p.proponer.mock.calls)).not.toMatch(/a@b\.com/);
  });
  it('si el modelo falla, anota la cota de costo (nunca cero) y sigue sin lanzar', async () => {
    const p = puertos({ llamarModelo: async () => { throw new Error('proveedor'); } });
    const r = await diagnosticarAlertas([item()], [], p, { encendido: true, topeUsd: 20 });
    expect(r.estado).toBe('ok');
    expect(p.proponer).not.toHaveBeenCalled();
    expect(p.registrarGasto).toHaveBeenCalledWith({ costoUsd: COSTO_MAX_LLAMADA_USD, ok: false, huella: expect.any(String) });
  });
  it('un arreglo que roza dinero lleva la marca de que lo decide el dueño', async () => {
    const p = puertos({ llamarModelo: async () => ({ data: { ...salida, arreglo_propuesto: 'Reembolsar el cobro duplicado' }, costoUsd: 0.01, modelo: 'd' }) });
    await diagnosticarAlertas([item()], [], p, { encendido: true, topeUsd: 20 });
    expect(JSON.stringify(p.proponer.mock.calls)).toContain('Lo decide el dueño');
  });
  it('sin cita no hay causa raíz: queda inconclusivo', () => {
    expect(endurecerSalida({ ...salida, evidencia: [] }).confianza).toBe('inconclusivo');
  });
});

describe('solo lectura por construcción', () => {
  it('el módulo no importa cliente de base ni de red ni escribe', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/admin/diagnostico.ts'), 'utf8');
    expect(src).not.toMatch(/supabase|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|fetch\(|openrouter/);
  });
  it('los puertos reales escriben solo la pieza propuesta y la fila de gasto', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/admin/diagnostico-puertos.ts'), 'utf8');
    expect(src).not.toMatch(/supabase|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
    expect([...src.matchAll(/encolarPieza\(|registrarCorrida\(/g)]).toHaveLength(2);
    expect(src).not.toMatch(/interruptor|autonomia|aprobarPieza|marcarEnviada|enviarPiezaPorCorreo/);
  });
});
