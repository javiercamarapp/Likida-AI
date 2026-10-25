import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// A36-R15-01 / A36-R15-02 — el chat de onboarding NO pisa la fila fiscal del
// tenant con un perfil viejo, y el régimen tiene un solo camino de escritura.
// El tenant es el que va al CFDI y al aviso de privacidad; el perfil es solo
// la declaración del chat. Se usa la fiscal.ts REAL contra una fila en memoria.
// ═══════════════════════════════════════════════════════════════════════════
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
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const campo = <T,>(valor: T) => ({ valor, procedencia: 'declarado' });
// Perfil VIEJO: lo que el chat declaró antes de que el dueño corrigiera en otras pantallas.
const PERFIL_VIEJO = {
  rfcEmpresa: campo(RFC_OK),
  razonSocial: campo('RAZON VIEJA SA'),
  regimenSat: campo('626'),
  codigoPostalFiscal: campo('01000'),
};
vi.mock('../repo', () => ({
  guardarPerfilPatch: vi.fn(async () => undefined),
  actualizarFacilidad15: vi.fn(async () => undefined),
  getPerfilCrudo: vi.fn(async () => PERFIL_VIEJO),
}));
vi.mock('../agentes/cobranza', () => ({ guardarConfigCobranza: vi.fn(), leerConfigCobranza: vi.fn() }));
vi.mock('../administracion', () => ({ crearOperador: vi.fn(async () => undefined), guardarPolitica: vi.fn() }));
vi.mock('../operacion', () => ({ crearUnidad: vi.fn(async () => undefined) }));
vi.mock('../config', () => ({ getConfig: vi.fn(async () => ({ politica: [] })) }));

let hechosDelTurno: Record<string, unknown> = {};
vi.mock('./entrevista', async (orig) => ({
  ...(await orig<typeof import('./entrevista')>()),
  interpretarTurno: vi.fn(async () => ({ hechos: hechosDelTurno, noSe: [], ambiguo: null, preguntaDeTurno: null })),
}));

const repo = await import('../repo');
const admin = await import('../administracion');
const cfgMod = await import('../config');
const { aplicarTurnoEntrevista } = await import('./entrevista-aplicar');
const turno = () => aplicarTurnoEntrevista({ tenantId: 't-1', userId: 'u-1', perfilCrudo: PERFIL_VIEJO, texto: 'x' });

beforeEach(() => {
  update.mockClear();
  fila = {
    rfc: RFC_OK, razon_social: 'RAZON NUEVA SA', regimen_fiscal: '601', codigo_postal_fiscal: '97000',
    uso_cfdi: 'G01', email_facturacion: 'factura@flota.mx',
    domicilio_fiscal: 'Calle 10 número 123, colonia Centro, 97000 Mérida, Yucatán',
  };
});

describe('A36-R15-01 — un turno sin datos fiscales no toca la fila fiscal', () => {
  it('"agrega la unidad 12" NO reescribe RFC/razón/uso/domicilio/email desde el perfil viejo', async () => {
    hechosDelTurno = { unidadesAlta: [{ economico: '12' }] };
    await turno();
    expect(update).not.toHaveBeenCalled();
    expect(fila.razon_social).toBe('RAZON NUEVA SA');
  });

  it('un turno que declara SOLO el régimen conserva uso CFDI, domicilio, email y razón del tenant', async () => {
    hechosDelTurno = { regimenSat: '626' };
    await turno();
    expect(fila.regimen_fiscal).toBe('626');
    expect(fila.razon_social).toBe('RAZON NUEVA SA');
    expect(fila.codigo_postal_fiscal).toBe('97000');
    expect(fila.uso_cfdi).toBe('G01');
    expect(fila.email_facturacion).toBe('factura@flota.mx');
    expect(fila.domicilio_fiscal).toContain('Mérida');
  });

  it('con el tenant vacío, el chat completa lo faltante desde el perfil (uso G03 por defecto)', async () => {
    fila = { rfc: null, razon_social: null, regimen_fiscal: null, codigo_postal_fiscal: null, uso_cfdi: null, email_facturacion: null, domicilio_fiscal: null };
    hechosDelTurno = { regimenSat: '626' };
    await turno();
    expect(fila).toMatchObject({ rfc: RFC_OK, razon_social: 'RAZON VIEJA SA', regimen_fiscal: '626', codigo_postal_fiscal: '01000', uso_cfdi: 'G03' });
  });
});

describe('A37-S53-05 — operadores/unidades se declaran SOLO si se crearon', () => {
  beforeEach(() => { vi.mocked(repo.guardarPerfilPatch).mockClear(); });

  it('si crearOperador falla, operadoresAlta NO queda declarado y el chat no afirma que ya pueden usar WhatsApp', async () => {
    vi.mocked(admin.crearOperador).mockRejectedValueOnce(new Error('Ese teléfono ya está registrado en otra flota.'));
    hechosDelTurno = { operadoresAlta: [{ nombre: 'Juan Prueba', telefono: '5500000000' }] };
    const r = await turno();
    const parches = vi.mocked(repo.guardarPerfilPatch).mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(parches.some((p) => 'operadoresAlta' in p)).toBe(false);
    expect(r.texto).toContain('otra flota');
    expect(r.texto).not.toContain('Operadores para WhatsApp');
    expect(r.texto).not.toContain('ya pueden mandar fotos');
  });
  it('si la alta sale bien, se declara', async () => {
    hechosDelTurno = { operadoresAlta: [{ nombre: 'Juan Prueba', telefono: '5500000000' }] };
    await turno();
    const parches = vi.mocked(repo.guardarPerfilPatch).mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(parches.some((p) => 'operadoresAlta' in p)).toBe(true);
  });
});

describe('A37-S53-07 — los topes por chat conservan requiereCfdi', () => {
  it('«diésel 4000» sobre un renglón con requiereCfdi:true mantiene la exigencia de CFDI', async () => {
    vi.mocked(cfgMod.getConfig).mockResolvedValueOnce({ politica: [{ concepto: 'diesel', topeMonto: 3000, requiereCfdi: true }] } as never);
    hechosDelTurno = { topesPolitica: { diesel: 4000 } };
    await turno();
    const llamada = vi.mocked(admin.guardarPolitica).mock.calls.at(-1)!;
    expect(llamada[1]).toContainEqual({ concepto: 'diesel', topeMonto: 4000, requiereCfdi: true });
  });
});
