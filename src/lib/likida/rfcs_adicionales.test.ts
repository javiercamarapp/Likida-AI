import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LAS OTRAS RAZONES SOCIALES DE LA FLOTA — auditoría 20, hallazgo 7.
//
// `config.empresa.rfcsAdicionales` se CONSUMÍA (el motor acepta CFDI cuyo
// receptor sea cualquiera de esos RFC) y se MOSTRABA en /dashboard/
// configuracion, pero NADA en `src/` lo escribía: la segunda razón social de
// una flota solo se podía declarar con un UPDATE a mano sobre `tenant.config`.
//
// Lo que estas pruebas fijan, y por qué cada una vale un renglón:
//
//   · el RFC pasa por el MISMO doble filtro que el alta de flota (forma +
//     dígito verificador). Un RFC con un dígito mal no truena en ningún lado:
//     simplemente no empata NUNCA con el receptor de un CFDI, y el contador se
//     queda buscando por qué su segunda razón social sigue "a revisar";
//   · el RFC principal no se cuela a la lista (sería un duplicado que le hace
//     dudar a quien lo lee);
//   · vacío es una respuesta VÁLIDA y BORRA — porque la pantalla lo ofrece
//     como forma de volver a un solo RFC, y si aquí se tratara como "no
//     cambies nada", ese botón mentiría;
//   · la escritura va por `tenant_config_merge`, NUNCA por un update de
//     `config` entero: `empresa.rfc` vive en el mismo objeto y perderlo apaga
//     la validación de receptor de TODO el histórico (DAT-20).
// ═══════════════════════════════════════════════════════════════════════════

const from = vi.fn();
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [])), rpc: (...a: unknown[]) => rpc(...a) }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./config', () => ({ getConfig: vi.fn() }));

const anotarBitacora = vi.fn(async () => true);
vi.mock('@/lib/likida/bitacora_escritura', () => ({
  anotarBitacora: (...a: unknown[]) => anotarBitacora(...(a as [])),
}));

const {
  parsearRfcsAdicionales, guardarRfcsAdicionales, MAX_RFCS_ADICIONALES, DatoInvalido,
} = await import('./administracion');

const { rfcChecksumOk } = await import('./intake/cfdi');

// RFC de persona moral con dígito verificador BUENO (el mismo que fija
// `rfc_dv.test.ts` contra el algoritmo del SAT).
const PRINCIPAL = 'PEC1411282LA';

const ALFA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Cierra un RFC de 11 caracteres con el homoclave que hace válido su dígito
 *  verificador, usando la MISMA función del producto. */
function cerrarRfc(prefijo11: string): string {
  for (const c of ALFA) if (rfcChecksumOk(prefijo11 + c)) return prefijo11 + c;
  throw new Error(`no hay dígito verificador posible para ${prefijo11}`);
}

beforeEach(() => {
  from.mockReset();
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  anotarBitacora.mockClear();
});

describe('parsearRfcsAdicionales', () => {
  it('vacío es una respuesta válida: cero RFC, sin error', () => {
    expect(parsearRfcsAdicionales('', PRINCIPAL)).toEqual([]);
    expect(parsearRfcsAdicionales('   \n\n , ; ', PRINCIPAL)).toEqual([]);
  });

  it('acepta uno por línea, por coma o por punto y coma, y normaliza a mayúsculas', () => {
    // El contador pega lo que tiene, y lo que tiene viene de un Excel.
    const r = parsearRfcsAdicionales('pex1411282la\nXAXX010101000, XEXX010101000', PRINCIPAL);
    expect(r).toEqual(['PEX1411282LA', 'XAXX010101000', 'XEXX010101000']);
  });

  it('rechaza lo que no tiene FORMA de RFC, con el texto que ve la persona', () => {
    expect(() => parsearRfcsAdicionales('mi otra empresa', PRINCIPAL)).toThrow(DatoInvalido);
    expect(() => parsearRfcsAdicionales('AAA', PRINCIPAL)).toThrow(/no tiene forma de RFC/);
  });

  it('rechaza el RFC con dígito verificador malo — el fallo silencioso que importa', () => {
    // Forma impecable, dígito equivocado: sin este filtro se guardaría y no
    // empataría jamás con un CFDI, sin un solo error en ningún log.
    expect(() => parsearRfcsAdicionales('PEC1411282LB', PRINCIPAL)).toThrow(/dígito verificador/);
  });

  it('el RFC principal no se cuela como "adicional"', () => {
    expect(() => parsearRfcsAdicionales(PRINCIPAL, PRINCIPAL)).toThrow(/ya es el RFC principal/);
    // Y da igual cómo se teclee: la comparación es en mayúsculas.
    expect(() => parsearRfcsAdicionales(PRINCIPAL.toLowerCase(), PRINCIPAL)).toThrow(/ya es el RFC principal/);
  });

  it('el repetido se dice, no se traga', () => {
    expect(() => parsearRfcsAdicionales('PEX1411282LA\nPEX1411282LA', PRINCIPAL)).toThrow(/repetido/);
  });

  it('pasado el máximo, se explica que eso ya es un grupo y no una flota', () => {
    // RFC distintos y con dígito verificador BUENO de verdad: se generan
    // buscando el homoclave que cierra el checksum con la MISMA función del
    // producto, no con una tabla escrita a mano que se desincronizaría.
    const muchos = Array.from({ length: MAX_RFCS_ADICIONALES + 1 }, (_, i) => cerrarRfc(`AAA010101A${ALFA[i]}`));
    expect(new Set(muchos).size).toBe(MAX_RFCS_ADICIONALES + 1);
    // Uno menos que el tope sí pasa: el mensaje de arriba no viene de otro lado.
    expect(parsearRfcsAdicionales(muchos.slice(0, MAX_RFCS_ADICIONALES).join('\n'), PRINCIPAL))
      .toHaveLength(MAX_RFCS_ADICIONALES);
    expect(() => parsearRfcsAdicionales(muchos.join('\n'), PRINCIPAL))
      .toThrow(new RegExp(`el máximo aquí es ${MAX_RFCS_ADICIONALES}`));
  });
});

describe('guardarRfcsAdicionales', () => {
  it('mezcla por `tenant_config_merge` y NO reescribe `config` entero', async () => {
    await guardarRfcsAdicionales('t-1', ['PEX1411282LA'], { id: 'u-1' });
    expect(rpc).toHaveBeenCalledWith('tenant_config_merge', {
      p_tenant: 't-1',
      p_parcial: { empresa: { rfcsAdicionales: ['PEX1411282LA'] } },
      p_borrar: [],
    });
    // Ni un `from('tenant').update(...)`: ése es el patrón que se lleva por
    // delante `empresa.rfc` cuando dos pantallas guardan a la vez.
    expect(from).not.toHaveBeenCalledWith('tenant');
  });

  it('guardar la lista vacía BORRA los que hubiera — es lo que la pantalla ofrece', async () => {
    await guardarRfcsAdicionales('t-1', []);
    expect(rpc).toHaveBeenCalledWith('tenant_config_merge', expect.objectContaining({
      p_parcial: { empresa: { rfcsAdicionales: [] } },
    }));
  });

  it('la bitácora guarda LOS RFC, no un "se editó"', async () => {
    await guardarRfcsAdicionales('t-1', ['PEX1411282LA'], { id: 'u-1' });
    expect(anotarBitacora).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't-1',
      accion: 'empresa.rfcs_adicionales.editados',
      detalle: { rfcs: ['PEX1411282LA'] },
    }));
  });

  it('si la mezcla falla, LANZA — no se dice "guardado" sobre una escritura que no ocurrió', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(guardarRfcsAdicionales('t-1', ['PEX1411282LA'])).rejects.toThrow(/guardarRfcsAdicionales/);
  });
});
