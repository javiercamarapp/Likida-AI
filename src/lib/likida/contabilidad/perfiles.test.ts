import { describe, expect, it } from 'vitest';
import { interpretarPerfilExportacion } from './perfiles';

const CONFIRMADO = '2026-08-24T10:00:00.000Z';

describe('perfil ERP por tenant', () => {
  it('CONTPAQi exige tipo, número, separador y un encabezado completo confirmados', () => {
    const r = interpretarPerfilExportacion('contpaqi', {
      tipo: 'Dr', numeroInicial: 42, separador: '|',
      encabezado: ['Tipo', 'Numero', 'Fecha', 'Concepto', 'Cuenta', 'TipoMovimiento', 'Importe', 'Referencia', 'ConceptoMovimiento'],
    }, CONFIRMADO);
    expect(r).toMatchObject({ sistema: 'contpaqi', opciones: { tipo: 'Dr', numero: 42, separador: '|' } });
  });

  it('no acepta un perfil sin confirmación ni un encabezado inventado', () => {
    expect(interpretarPerfilExportacion('contpaqi', { tipo: 'Dr', separador: ',' }, null)).toBeNull();
    expect(interpretarPerfilExportacion('contpaqi', { tipo: 'Dr', separador: ',' }, CONFIRMADO)).toBeNull();
    expect(interpretarPerfilExportacion('contpaqi', { tipo: 'Dr', separador: ',', encabezado: ['solo', 'dos'] }, CONFIRMADO)).toBeNull();
  });

  it('SAP B1 exige las cuatro filas de plantilla con igual número de columnas', () => {
    const r = interpretarPerfilExportacion('sap_b1', {
      cabeceraTecnica: ['JdtNum', 'RefDate', 'DueDate', 'TaxDate', 'Memo'],
      cabeceraVisible: ['JdtNum', 'RefDate', 'DueDate', 'TaxDate', 'Memo'],
      lineasTecnica: ['JdtNum', 'Line_ID', 'Account', 'Debit', 'Credit', 'LineMemo', 'Ref1'],
      lineasVisible: ['JdtNum', 'Line_ID', 'Account', 'Debit', 'Credit', 'LineMemo', 'Ref1'],
    }, CONFIRMADO);
    expect(r?.sistema).toBe('sap_b1');
    expect(interpretarPerfilExportacion('sap_b1', {}, CONFIRMADO)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL ESCRITOR (plan maestro 26-ago, sección B). La tabla tenía lector y ruta
// cableados pero cero caminos de inserción: el export a SAP B1/CONTPAQi
// respondía 409 para CUALQUIER flota, para siempre. Estas pruebas fijan las
// dos mitades del contrato del escritor: valida con el MISMO intérprete que
// el lector antes de escribir (una fila que el lector rechazaría no entra),
// y la fila que escribe ROUND-TRIPEA (lo guardado se puede volver a leer).
// ═══════════════════════════════════════════════════════════════════════════
import { vi, beforeEach } from 'vitest';

const upsert = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ upsert }) }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const CONTPAQI_OK = {
  tipo: 'Dr', numeroInicial: 7, separador: '|',
  encabezado: ['Tipo', 'Numero', 'Fecha', 'Concepto', 'Cuenta', 'TipoMovimiento', 'Importe', 'Referencia', 'ConceptoMovimiento'],
};

describe('guardarPerfilExportacionErp — el escritor que faltaba', () => {
  beforeEach(() => upsert.mockClear());

  it('rechaza sin escribir una plantilla que el lector rechazaría', async () => {
    const { guardarPerfilExportacionErp } = await import('./perfiles');
    await expect(guardarPerfilExportacionErp('t-1', 'contpaqi', { tipo: 'Dr' }, 'u1'))
      .rejects.toThrow(/no tiene la forma que el export exige/);
    await expect(guardarPerfilExportacionErp('t-1', 'otro_sistema', CONTPAQI_OK, 'u1'))
      .rejects.toThrow(/no tiene la forma/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('la fila CONTPAQi que escribe round-tripea por el intérprete del lector', async () => {
    const { guardarPerfilExportacionErp, interpretarPerfilExportacion: interpretar } = await import('./perfiles');
    await guardarPerfilExportacionErp('t-1', 'contpaqi', CONTPAQI_OK, 'u1');
    expect(upsert).toHaveBeenCalledTimes(1);
    const [fila, opts] = upsert.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(opts).toEqual({ onConflict: 'tenant_id,sistema' });
    expect(fila.tenant_id).toBe('t-1');
    expect(fila.confirmado_por).toBe('u1');
    // Lo que la fila guarda es exactamente lo que el lector puede volver a
    // interpretar — si esto falla, el escritor produce el mismo 409 que
    // venía a arreglar, con una fila de por medio que parece confirmada.
    const releido = interpretar(fila.sistema, fila.plantilla, fila.confirmado_en as string);
    expect(releido).toMatchObject({ sistema: 'contpaqi', opciones: { tipo: 'Dr', numero: 7, separador: '|' } });
  });

  it('la fila SAP B1 también round-tripea', async () => {
    const { guardarPerfilExportacionErp, interpretarPerfilExportacion: interpretar } = await import('./perfiles');
    const plantilla = {
      cabeceraTecnica: ['JdtNum', 'RefDate', 'DueDate', 'TaxDate', 'Memo'],
      cabeceraVisible: ['JdtNum', 'RefDate', 'DueDate', 'TaxDate', 'Memo'],
      lineasTecnica: ['JdtNum', 'Line_ID', 'Account', 'Debit', 'Credit', 'LineMemo', 'Ref1'],
      lineasVisible: ['JdtNum', 'Line_ID', 'Account', 'Debit', 'Credit', 'LineMemo', 'Ref1'],
    };
    await guardarPerfilExportacionErp('t-2', 'sap_b1', plantilla, null);
    const [fila] = upsert.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(fila.confirmado_por).toBeNull();
    expect(interpretar(fila.sistema, fila.plantilla, fila.confirmado_en as string)?.sistema).toBe('sap_b1');
  });

  it('si el upsert falla, lanza — no reporta confirmado lo que no se guardó', async () => {
    upsert.mockResolvedValueOnce({ error: { message: 'boom' } as never });
    const { guardarPerfilExportacionErp } = await import('./perfiles');
    await expect(guardarPerfilExportacionErp('t-1', 'contpaqi', CONTPAQI_OK, 'u1'))
      .rejects.toThrow(/boom/);
  });
});
