import { describe, it, expect } from 'vitest';
import { resumirCorridas, resumirLecturas } from './calidad';
import type { LecturaFoto } from '@/lib/admin/qa-storage';
import type { Medicion, MedicionCampo } from '@/lib/admin/qa-verdad';

// El tablero de calidad junta tres fuentes YA medidas. Estas pruebas fijan
// las dos agregaciones puras — y sobre todo la regla heredada de qa-verdad:
// sin un solo campo medido la precisión es null («sin medir»), jamás 0%.

const campo = (veredicto: MedicionCampo['veredicto'], esperado: MedicionCampo['esperado'] = 'x'): MedicionCampo =>
  ({ clave: 'emisor', esperado, leido: 'y', veredicto, motivo: veredicto === 'ok' ? null : 'motivo' });

const lectura = (medicion: Medicion, corridaEn: string): LecturaFoto => ({
  id: 'l1', fotoId: 'f1', corridaId: null, corridaEn, modelo: 'm',
  ocrLeido: {
    emisor: null, rfcEmisor: null, folio: null, monto: null,
    fecha: null, sucursal: null, dominioFacturacion: null,
  },
  medicion, camposOk: medicion.camposOk, camposMal: medicion.camposMal,
  costoUsd: null, motivo: null,
} as unknown as LecturaFoto);

const medicion = (ok: number, mal: number, noMedidos: number, campos: MedicionCampo[] = []): Medicion =>
  ({ campos, camposOk: ok, camposMal: mal, camposNoMedidos: noMedidos });

describe('resumirCorridas', () => {
  it('cuenta veredictos y pone a los agentes con fallos ARRIBA — lo roto se enseña primero', () => {
    const r = resumirCorridas([
      { agente: 'liquidacion', estado: 'ok' },
      { agente: 'liquidacion', estado: 'ok' },
      { agente: 'cobranza', estado: 'fallo' },
      { agente: 'peajes', estado: 'parcial' },
    ]);
    expect(r).toMatchObject({ total: 4, ok: 2, parcial: 1, fallo: 1 });
    expect(r.porAgente.map((a) => a.agente)).toEqual(['cobranza', 'peajes', 'liquidacion']);
  });

  it('sin corridas devuelve ceros contados, no inventados — el que pinta decide qué decir con n=0', () => {
    expect(resumirCorridas([])).toEqual({ total: 0, ok: 0, parcial: 0, fallo: 0, porAgente: [] });
  });
});

describe('resumirLecturas', () => {
  it('la precisión sale de la MISMA aritmética que el panel de QA: ok/(ok+mal), sin contar lo no medido', () => {
    const r = resumirLecturas([
      lectura(medicion(6, 1, 2), '2026-08-27T10:00:00Z'),
      lectura(medicion(3, 2, 0), '2026-08-28T10:00:00Z'),
    ]);
    expect(r.fotosMedidas).toBe(2);
    expect(r.camposOk).toBe(9);
    expect(r.camposMal).toBe(3);
    expect(r.camposNoMedidos).toBe(2);
    expect(r.precisionPct).toBeCloseTo(75);
    expect(r.ultimaMedicionEn).toBe('2026-08-28T10:00:00Z');
  });

  it('sin un solo campo medido la precisión es null («sin medir»), jamás 0%', () => {
    const r = resumirLecturas([lectura(medicion(0, 0, 7), '2026-08-28T10:00:00Z')]);
    expect(r.precisionPct).toBeNull();
    expect(r.fotosMedidas).toBe(1);
  });

  it('sin lecturas: todo en cero contado y sin última medición', () => {
    const r = resumirLecturas([]);
    expect(r).toMatchObject({ fotosMedidas: 0, precisionPct: null, alucinaciones: 0, ultimaMedicionEn: null });
  });

  it('las alucinaciones se cuentan con la regla de qa-verdad: esperado null y veredicto mal', () => {
    const campos = [campo('mal', null), campo('mal', 'algo'), campo('ok')];
    const r = resumirLecturas([lectura(medicion(1, 2, 0, campos), '2026-08-28T10:00:00Z')]);
    expect(r.alucinaciones).toBe(1);
  });
});
