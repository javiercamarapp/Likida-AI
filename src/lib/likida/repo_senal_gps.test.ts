import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA SEÑAL DE GPS DEL AVISO — refinamiento del C.15, 28-ago-2026.
//
// `senalGpsFlota` decide qué renglón de geolocalización recibe cada flota, así
// que sus tres salidas se fijan aquí contra la tabla real que el poller lee
// (`conector_credencial`), con el invariante de la casa: `null` NUNCA se
// convierte en 0. Un error de base que se leyera como «sin conector» le
// callaría un tratamiento a una flota que sí lo tiene — el bug original C.15
// por la puerta de atrás.
// ═══════════════════════════════════════════════════════════════════════════

let filaTenant: Record<string, unknown> | null = null;
/** Lo que contesta la consulta de credenciales: un conteo, o un error. */
let credenciales: { count: number | null; error: { message: string } | null } = { count: 0, error: null };
/** Si es cierto, la consulta de credenciales LANZA (red caída, mock sin método). */
let credencialesLanzan = false;

const from = vi.fn((tabla: string) => {
  if (tabla === 'conector_credencial') {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = () => {
      if (credencialesLanzan) throw new Error('fetch failed');
      return Promise.resolve(credenciales);
    };
    return q;
  }
  const enlace: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) enlace[m] = () => enlace;
  enlace.maybeSingle = async () => ({ data: filaTenant, error: null });
  return enlace;
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { senalGpsFlota, getDatosResponsable } = await import('./repo');

beforeEach(() => {
  filaTenant = { razon_social: 'FLOTA SA DE CV', domicilio_fiscal: 'Calle 1, Mérida', url_aviso_privacidad: '', contacto_privacidad: null };
  credenciales = { count: 0, error: null };
  credencialesLanzan = false;
});

describe('senalGpsFlota — capacidad medida, con null que nunca es 0', () => {
  it('credencial activa → conectado', async () => {
    credenciales = { count: 2, error: null };
    expect(await senalGpsFlota('t1')).toBe('conectado');
  });

  it('cero credenciales → sin_conector', async () => {
    expect(await senalGpsFlota('t1')).toBe('sin_conector');
  });

  it('error de PostgREST → no_medible, jamás sin_conector', async () => {
    credenciales = { count: null, error: { message: 'boom' } };
    expect(await senalGpsFlota('t1')).toBe('no_medible');
  });

  it('count nulo sin error → no_medible: null no se convierte en 0', async () => {
    credenciales = { count: null, error: null };
    expect(await senalGpsFlota('t1')).toBe('no_medible');
  });

  it('excepción de red → no_medible, sin tumbar al llamador', async () => {
    credencialesLanzan = true;
    expect(await senalGpsFlota('t1')).toBe('no_medible');
  });
});

describe('getDatosResponsable — trae la señal, y su fallo no roba el aviso', () => {
  it('incluye la señal medida junto con los datos del responsable', async () => {
    credenciales = { count: 1, error: null };
    const r = await getDatosResponsable('t1');
    expect(r?.gps).toBe('conectado');
  });

  it('con la medición caída, los datos salen igual y la señal es no_medible', async () => {
    // La geolocalización condicional no puede costarle el aviso ENTERO a la
    // flota: sin señal se declara el caso amplio, no el silencio.
    credencialesLanzan = true;
    const r = await getDatosResponsable('t1');
    expect(r).not.toBeNull();
    expect(r?.gps).toBe('no_medible');
  });
});
