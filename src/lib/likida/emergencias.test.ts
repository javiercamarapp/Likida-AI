import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL DIRECTORIO DE EMERGENCIA. Lo que se fija:
//  · el candado de tenant del contacto (un operador de OTRA flota rebota con
//    un mensaje humano, antes de tocar el insert);
//  · un teléfono que no parece teléfono no entra — se descubre en la captura,
//    no a las 3 a.m. cuando el gruero no contesta;
//  · capturar NO es verificar: el proveedor nace sin `verificado_en`;
//  · `avisar_si_lesionados` solo es true con el sí EXPLÍCITO.
// ═══════════════════════════════════════════════════════════════════════════

const insertado = vi.hoisted(() => vi.fn());
let operadorExiste = true;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla === 'operador') {
        const cadena: Record<string, unknown> = {};
        for (const m of ['select', 'eq']) cadena[m] = () => cadena;
        cadena.maybeSingle = async () => ({ data: operadorExiste ? { id: 'op-1' } : null, error: null });
        return cadena;
      }
      return {
        insert: (fila: Record<string, unknown>) => {
          insertado(tabla, fila);
          const conSelect = {
            select: () => ({ single: async () => ({ data: { id: 'nuevo-1' }, error: null }) }),
            then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
          };
          return conSelect;
        },
      };
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

import {
  crearContactoEmergencia, crearProveedorEmergencia, guardarPoliza, telefonoValido,
} from './emergencias';

beforeEach(() => {
  vi.clearAllMocks();
  operadorExiste = true;
});

describe('telefonoValido', () => {
  it('acepta 10-15 dígitos con + opcional y espacios/guiones; rechaza lo demás', () => {
    expect(telefonoValido('5219991234567')).toBe(true);
    expect(telefonoValido('+52 999 123 4567')).toBe(true);
    expect(telefonoValido('999-123-4567')).toBe(true);
    expect(telefonoValido('12345')).toBe(false);
    expect(telefonoValido('llámame al 800')).toBe(false);
    expect(telefonoValido('')).toBe(false);
  });
});

describe('crearContactoEmergencia — el candado de tenant', () => {
  const bueno = { operadorId: 'op-1', nombre: 'María', telefono: '5219991234567' };

  it('un operador de OTRA flota rebota con mensaje humano, sin insertar', async () => {
    operadorExiste = false;
    await expect(crearContactoEmergencia('t-1', bueno)).rejects.toThrow(/no pertenece a esta flota/);
    expect(insertado).not.toHaveBeenCalled();
  });

  it('avisar_si_lesionados solo es true con el sí EXPLÍCITO — el default protege al familiar', async () => {
    await crearContactoEmergencia('t-1', bueno);
    expect(insertado).toHaveBeenCalledWith('contacto_emergencia', expect.objectContaining({ avisar_si_lesionados: false }));

    insertado.mockClear();
    await crearContactoEmergencia('t-1', { ...bueno, avisarSiLesionados: true });
    expect(insertado).toHaveBeenCalledWith('contacto_emergencia', expect.objectContaining({ avisar_si_lesionados: true }));
  });

  it('un teléfono roto no entra', async () => {
    await expect(crearContactoEmergencia('t-1', { ...bueno, telefono: '123' })).rejects.toThrow(/no se ve completo/);
    expect(insertado).not.toHaveBeenCalled();
  });
});

describe('crearProveedorEmergencia — capturar no es verificar', () => {
  it('nace SIN verificado_en, con el teléfono limpio', async () => {
    await crearProveedorEmergencia('t-1', { tipo: 'grua', nombre: 'Grúas García', telefono: '999 123 4567' });
    const [, fila] = insertado.mock.calls[0] as unknown as [string, Record<string, unknown>];
    // c4-4: el 10 dígitos que el placeholder invita se guarda en E.164 — a
    // 10 dígitos Meta rechazaba el mensaje inicial de la coordinación.
    expect(fila.telefono).toBe('529991234567');
    expect('verificado_en' in fila).toBe(false);
  });

  it('un tipo inventado rebota antes del insert', async () => {
    await expect(crearProveedorEmergencia('t-1', { tipo: 'drone', nombre: 'X', telefono: '5219991234567' }))
      .rejects.toThrow(/tipo de proveedor no existe/);
    expect(insertado).not.toHaveBeenCalled();
  });
});

describe('guardarPoliza — el 800 es EL dato', () => {
  it('sin un 800 legible no se guarda nada', async () => {
    await expect(guardarPoliza('t-1', { aseguradora: 'Qualitas', numeroPoliza: 'P-1', telefonoSiniestros: '800' }))
      .rejects.toThrow(/EL dato que se necesita/);
    expect(insertado).not.toHaveBeenCalled();
  });

  it('con los tres datos entra, teléfono limpio', async () => {
    await guardarPoliza('t-1', { aseguradora: 'Qualitas', numeroPoliza: 'P-1', telefonoSiniestros: '800 288 8500' });
    expect(insertado).toHaveBeenCalledWith('flota_poliza', expect.objectContaining({ telefono_siniestros: '8002888500' }));
  });
});
