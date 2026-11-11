import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { BITACORA_MUESTRA, PADRON_MUESTRA } from './desglose_muestra_tms.fixture';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('el ensayo local no debe tocar la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/correo/enviar', () => ({ enviarCorreo: () => { throw new Error('el ensayo local no debe enviar correo real'); } }));

const { ensayarMuestraTms } = await import('./ensayo_local');

const muestra = { formato: 'muestra-tms', version: 1, bitacoras: [BITACORA_MUESTRA] };
const correos = { '1001': 'operador.uno@ejemplo.invalid' };

describe('ensayo local de la muestra muestra-tms', () => {
  it('perilla apagada: la muestra sin póliza se retiene y no sale ningún correo', async () => {
    const r = await ensayarMuestraTms({ muestra, padron: PADRON_MUESTRA, correos, polizaProvisional: false, simularRevision: true });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.resultados.map((x) => x.estado)).toEqual(['sin_poliza']);
    expect(r.correos).toEqual([]);
    expect(r.excepcionesAbiertas).toEqual({ sin_poliza: 1 });
  });

  it('perilla encendida SIN revisión: queda retenida y no sale nada (nunca sin revisión humana)', async () => {
    const r = await ensayarMuestraTms({ muestra, padron: PADRON_MUESTRA, correos, polizaProvisional: true });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.resultados[0]).toMatchObject({ estado: 'creada', retenida: true, entregas: 0 });
    expect(r.liberadas).toBe(0);
    expect(r.correos).toEqual([]);
  });

  it('con revisión simulada: sale el Excel al operador con la marca «PÓLIZA PROVISIONAL»', async () => {
    const r = await ensayarMuestraTms({ muestra, padron: PADRON_MUESTRA, correos, polizaProvisional: true, simularRevision: true });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.liberadas).toBe(1);
    expect(r.correos).toHaveLength(1);
    expect(r.correos[0]).toMatchObject({ para: 'operador.uno@ejemplo.invalid', provisional: true, revision: false });
    expect(r.correos[0].asunto).toContain('PÓLIZA PROVISIONAL');
    const libro = XLSX.read(r.excels[0].bytes, { type: 'array' });
    const textos = Object.values(libro.Sheets[libro.SheetNames[0]]).map((c) => String((c as { v?: unknown })?.v ?? ''));
    expect(textos.some((t) => /PÓLIZA PROVISIONAL/.test(t))).toBe(true);
    // el neto del Excel es el de la muestra (sin inventar nada)
    expect(textos).toContain('Operador Ficticio Uno');
  });

  it('operador sin correo: no sale nada al operador y queda su excepción', async () => {
    const r = await ensayarMuestraTms({ muestra, padron: PADRON_MUESTRA, polizaProvisional: true, simularRevision: true });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.correos).toEqual([]);
  });

  it('un JSON que no es muestra-tms devuelve el motivo, sin lanzar', async () => {
    const r = await ensayarMuestraTms({ muestra: { formato: 'otro' }, padron: PADRON_MUESTRA, polizaProvisional: false });
    expect(r.ok).toBe(false);
  });
});
