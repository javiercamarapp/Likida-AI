import { describe, it, expect, vi, beforeEach } from 'vitest';

// A36-R15-02 — el formulario de onboarding y el chat comparten el MISMO camino
// de escritura del régimen: elegir 601 en el formulario tras haber dicho 612
// en el chat cambia también tenant.regimen_fiscal (el que va al CFDI).
const RFC_OK = 'GMX0902279I1';
let fila: Record<string, string | null>;
const update = vi.fn((patch: Record<string, string | null>) => ({
  eq: vi.fn(async () => { fila = { ...fila, ...patch }; return { error: null }; }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fila, error: null }) }) }),
      update: (p: Record<string, string | null>) => update(p),
    }),
  }),
}));
const guardarPerfilPatch = vi.fn(async () => undefined);
const actualizarFacilidad15 = vi.fn(async () => undefined);
vi.mock('../repo', () => ({ guardarPerfilPatch, actualizarFacilidad15 }));

const { guardarPerfilFormulario, PerfilGuardadoParcial } = await import('./guardar_forma');
const { declararOnboarding, formularioDeclarado } = await import('./preguntas');

beforeEach(() => {
  update.mockClear(); guardarPerfilPatch.mockClear(); actualizarFacilidad15.mockClear();
  fila = {
    rfc: RFC_OK, razon_social: 'RAZON NUEVA SA', regimen_fiscal: '612', codigo_postal_fiscal: '97000',
    uso_cfdi: 'G01', email_facturacion: 'f@flota.mx', domicilio_fiscal: 'Calle 10 número 123, Centro, 97000 Mérida',
  };
});

describe('A36-R15-02 — un solo camino para el régimen fiscal', () => {
  it('el formulario con 601 actualiza perfil, facilidad del 15 % Y el régimen del tenant, sin pisar uso/domicilio', async () => {
    const patch = declararOnboarding({ ingresosMenoresA300M: true, parteRelacionada: false, dedicacionExclusivaCarga: true, regimenSat: '601', regimenElegible: false });
    await guardarPerfilFormulario('t-1', patch, 'u-1');
    expect(guardarPerfilPatch).toHaveBeenCalled();
    expect(fila.regimen_fiscal).toBe('601');
    expect(fila.uso_cfdi).toBe('G01');
    expect(fila.domicilio_fiscal).toContain('Mérida');
  });

  it('sin régimen en el formulario no toca el tenant', async () => {
    await guardarPerfilFormulario('t-1', declararOnboarding({ ingresosMenoresA300M: true, parteRelacionada: false, tanquePropio: true }), 'u-1');
    expect(update).not.toHaveBeenCalled();
  });

  it('el tenant sin datos fiscales completos no se inventa: queda como estaba', async () => {
    fila = { rfc: null, razon_social: null, regimen_fiscal: null, codigo_postal_fiscal: null, uso_cfdi: null, email_facturacion: null, domicilio_fiscal: null };
    await guardarPerfilFormulario('t-1', declararOnboarding({ ingresosMenoresA300M: true, parteRelacionada: false, regimenSat: '601', regimenElegible: false }), 'u-1');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('A37-S19-08 — el guardado en pasos dice la verdad cuando queda a medias', () => {
  it('si la facilidad del 15 % falla tras escribir el perfil lanza PerfilGuardadoParcial (no un error genérico)', async () => {
    actualizarFacilidad15.mockRejectedValueOnce(new Error('timeout'));
    const patch = declararOnboarding({ ingresosMenoresA300M: true, parteRelacionada: false, dedicacionExclusivaCarga: true, regimenSat: '601', regimenElegible: false });
    const r = guardarPerfilFormulario('t-1', patch, 'u-1');
    await expect(r).rejects.toBeInstanceOf(PerfilGuardadoParcial);
    await expect(r).rejects.toThrow(/quedaron guardadas/);
    expect(guardarPerfilPatch).toHaveBeenCalledTimes(1);
  });

  it('si el propio perfil no se escribe, el error original sale tal cual (nada quedó guardado)', async () => {
    guardarPerfilPatch.mockRejectedValueOnce(new Error('base caída'));
    await expect(guardarPerfilFormulario('t-1', declararOnboarding({ ingresosMenoresA300M: true, parteRelacionada: false }), 'u-1'))
      .rejects.toThrow('base caída');
    expect(actualizarFacilidad15).not.toHaveBeenCalled();
  });
});

describe('A36-R15-02 — el formulario precarga lo ya declarado', () => {
  it('formularioDeclarado devuelve régimen, dedicación, dedicado, hombre-camión y tanque', () => {
    const perfil = declararOnboarding({ ingresosMenoresA300M: true, parteRelacionada: false,
      dedicacionExclusivaCarga: true, regimenSat: '612', regimenElegible: true,
      transporteDedicado: false, hombreCamion: true, tanquePropio: false,
    });
    expect(formularioDeclarado(perfil)).toEqual({
      dedicacion: 'si', regimenSat: '612', dedicado: 'no', hombreCamion: 'si', tanquePropio: 'no',
    });
    expect(formularioDeclarado({})).toEqual({ dedicacion: '', regimenSat: '', dedicado: '', hombreCamion: '', tanquePropio: '' });
  });
});
