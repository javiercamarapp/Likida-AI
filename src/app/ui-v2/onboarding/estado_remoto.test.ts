import { describe, expect, it } from 'vitest';
import { estadoVacio } from '@/lib/likida/guia/estado';
import { ESTADO_VACIO } from './estado';
import { cosmeticoDeServidor, fusionarParches, hayEstadoLocal, parcheDeImportacion } from './estado_remoto';

describe('cosmeticoDeServidor', () => {
  it('pendiente = no se le ha ofrecido; vista, ahora_no y descartada = ya se ofreció', () => {
    expect(cosmeticoDeServidor(estadoVacio()).visto).toBe(false);
    for (const invitacion of ['vista', 'ahora_no', 'descartada'] as const) expect(cosmeticoDeServidor({ ...estadoVacio(), invitacion }).visto, invitacion).toBe(true);
    expect(cosmeticoDeServidor({ ...estadoVacio(), invitacion: 'descartada' }).descartado).toBe(true);
    expect(cosmeticoDeServidor({ ...estadoVacio(), invitacion: 'ahora_no' }).descartado).toBe(false);
  });
  it('copia modo y pistas sin compartir la referencia', () => {
    const e = { ...estadoVacio(), modo: 'corto' as const, pistas: ['/dashboard/a'] };
    const c = cosmeticoDeServidor(e);
    expect(c).toEqual({ visto: false, descartado: false, modo: 'corto', pistas: ['/dashboard/a'] });
    c.pistas.push('/dashboard/b');
    expect(e.pistas).toEqual(['/dashboard/a']);
  });
});

describe('importación desde local', () => {
  it('un estado local vacío no se importa', () => {
    expect(hayEstadoLocal(ESTADO_VACIO)).toBe(false);
    expect(hayEstadoLocal({ ...ESTADO_VACIO, pistas: ['/dashboard/x'] })).toBe(true);
  });
  it('se traduce a invitación y queda marcada como importada', () => {
    expect(parcheDeImportacion({ visto: true, descartado: false, modo: 'completo', pistas: [] })).toEqual({ invitacion: 'vista', modo: 'completo', pistas: [], importado: true });
    expect(parcheDeImportacion({ visto: true, descartado: true, modo: null, pistas: [] }).invitacion).toBe('descartada');
  });
});

describe('fusionarParches', () => {
  const rec = (paso: string) => ({ paso, hechos: [], omitidos: [], confirmados: [], inicio: '2026-11-04T00:00:00Z', fin: null, version: 1 });
  it('fusiona recorridos por clave y deja ganar al último en lo demás', () => {
    const r = fusionarParches({ invitacion: 'vista', recorridos: { a: rec('1') } }, { invitacion: 'descartada', recorridos: { b: rec('2'), a: rec('3') } });
    expect(r.invitacion).toBe('descartada');
    expect(Object.keys(r.recorridos ?? {}).sort()).toEqual(['a', 'b']);
    expect(r.recorridos?.a.paso).toBe('3');
  });
  it('no inventa llaves que ninguno trae', () => {
    expect(Object.keys(fusionarParches({ modo: 'corto' }, { ofertas: 1 })).sort()).toEqual(['modo', 'ofertas']);
  });
});
