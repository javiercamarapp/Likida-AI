import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// La sesión ya iniciada de un portal: se guarda cifrada, se lee, y su frescura
// por edad es un PRE-cheque —no un veredicto—. Lo que se fija aquí:
//
//   · la sesión viaja al cofre CIFRADA (nunca el storageState en claro);
//   · una fila apagada (activo=false) se lee como "no hay sesión";
//   · una fecha en el futuro o ilegible NO se toma como fresca (confiar de más
//     gasta un navegador contra una cookie que quizá ya no sirve);
//   · un error de base LANZA en cargar (no se confunde con "no hay sesión").
// ═══════════════════════════════════════════════════════════════════════════

const from = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [])) }),
}));
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
// `acotada` envuelve la promesa de PostgREST; en prueba se deja pasar tal cual.
vi.mock('../presupuesto', () => ({ acotada: (p: unknown) => p }));

// El cofre REAL: se prueba que lo que se guarda no es el storageState en claro.
process.env.LIKIDA_COFRE_LLAVE = 'llave-de-prueba-de-al-menos-32-caracteres!!';

const {
  guardarSesionPortal, cargarSesionPortal, sesionFresca, idSesion,
  MAX_EDAD_SESION_MS_DEFECTO,
} = await import('./sesion_portal');
const { descifrar } = await import('../conectores/cofre');

const TENANT = '11111111-1111-1111-1111-111111111111';
const PORTAL = 'portal_facturacion:g500';
const STORAGE = JSON.stringify({ cookies: [{ name: 'ASP.NET_SessionId', value: 'abc123' }], origins: [] });

beforeEach(() => {
  from.mockReset();
  for (const f of Object.values(logger)) f.mockReset();
});

describe('idSesion', () => {
  it('la fila de sesión es determinista y aparte de la credencial', () => {
    expect(idSesion(PORTAL)).toBe('portal_facturacion:g500#sesion');
  });
});

describe('guardarSesionPortal', () => {
  it('el storageState viaja CIFRADO, no en claro, y se puede descifrar de vuelta', async () => {
    let filaGuardada: Record<string, unknown> | undefined;
    from.mockImplementation(() => ({
      upsert: (fila: Record<string, unknown>) => {
        filaGuardada = fila;
        return Promise.resolve({ error: null });
      },
    }));

    await guardarSesionPortal(TENANT, PORTAL, { storageState: STORAGE, capturadaEn: '2026-08-21T10:00:00.000Z' });

    const cifrado = filaGuardada!.valores_cifrados as string;
    // Lo guardado NO contiene la cookie en claro.
    expect(cifrado).not.toContain('ASP.NET_SessionId');
    expect(cifrado).not.toContain('abc123');
    expect(cifrado.startsWith('v1.')).toBe(true);
    // Y descifra de vuelta a la sesión íntegra.
    const vuelta = descifrar(cifrado) as unknown as { storageState: string; capturadaEn: string };
    expect(vuelta.storageState).toBe(STORAGE);
    expect(vuelta.capturadaEn).toBe('2026-08-21T10:00:00.000Z');
    // La fila de sesión no deja pistas (una cookie no tiene nada que enseñar).
    expect(filaGuardada!.pistas).toEqual({});
    expect(filaGuardada!.conector_id).toBe('portal_facturacion:g500#sesion');
  });
});

describe('cargarSesionPortal', () => {
  function cadena(resultado: unknown) {
    const nodo: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) nodo[m] = () => nodo;
    nodo.maybeSingle = () => Promise.resolve(resultado);
    return nodo;
  }

  it('devuelve la sesión descifrada cuando existe y está activa', async () => {
    const { cifrar } = await import('../conectores/cofre');
    const cifrado = cifrar({ storageState: STORAGE, capturadaEn: '2026-08-21T10:00:00.000Z' } as unknown as Record<string, string>);
    from.mockImplementation(() => cadena({ data: { valores_cifrados: cifrado, activo: true }, error: null }));

    const s = await cargarSesionPortal(TENANT, PORTAL);
    expect(s?.storageState).toBe(STORAGE);
  });

  it('una fila APAGADA (activo=false) se lee como "no hay sesión"', async () => {
    from.mockImplementation(() => cadena({ data: { valores_cifrados: 'v1.x.y.z', activo: false }, error: null }));
    expect(await cargarSesionPortal(TENANT, PORTAL)).toBeNull();
  });

  it('sin fila devuelve null (no lanza)', async () => {
    from.mockImplementation(() => cadena({ data: null, error: null }));
    expect(await cargarSesionPortal(TENANT, PORTAL)).toBeNull();
  });

  it('un error de base LANZA — no se confunde con "no hay sesión"', async () => {
    from.mockImplementation(() => cadena({ data: null, error: { message: 'timeout' } }));
    await expect(cargarSesionPortal(TENANT, PORTAL)).rejects.toThrow(/timeout/);
  });
});

describe('sesionFresca — pre-cheque por edad, no veredicto', () => {
  const base = { storageState: STORAGE, capturadaEn: '2026-08-21T10:00:00.000Z' };
  const ahora = Date.parse('2026-08-21T10:00:00.000Z');

  it('recién capturada es fresca', () => {
    expect(sesionFresca(base, ahora + 60_000)).toBe(true);
  });

  it('más vieja que el tope NO es fresca', () => {
    expect(sesionFresca(base, ahora + MAX_EDAD_SESION_MS_DEFECTO + 1)).toBe(false);
  });

  it('una captura en el FUTURO (reloj desalineado) no se toma como fresca', () => {
    expect(sesionFresca(base, ahora - 60_000)).toBe(false);
  });

  it('una fecha ilegible se trata como vencida', () => {
    expect(sesionFresca({ storageState: STORAGE, capturadaEn: 'no-es-fecha' }, ahora)).toBe(false);
  });

  it('respeta un maxEdad medido por portal', () => {
    // Si G500 resulta durar 8 h, una sesión de 2 h sigue fresca.
    const dosHoras = 2 * 60 * 60 * 1000;
    const ochoHoras = 8 * 60 * 60 * 1000;
    expect(sesionFresca(base, ahora + dosHoras, ochoHoras)).toBe(true);
  });
});
