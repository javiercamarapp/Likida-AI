import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL MOTOR OAUTH DEL MCP, CONTRA UN SUPABASE FALSO.
//
// Mismo criterio que `portal_pago_lectura.test.ts`: no se prueba que un
// insert inserte (eso probaría el mock) — se prueban las DECISIONES:
//
//   · PKCE es S256 y el vector de prueba del RFC 7636 cuadra;
//   · un código expirado, con verifier malo o con otra redirect_uri se niega
//     SIEMPRE con el mismo texto (no se regala cuál mitad falló);
//   · el REUSO de un código o de un refresco ya rotado revoca la familia;
//   · «la base no contestó» es `no_disponible`, JAMÁS `no_valido` — un bache
//     de red no puede hacer que Claude tire un token bueno;
//   · las redirect_uris: https exacto, loopback con puerto libre, y nada de
//     esquemas custom ni credenciales incrustadas.
// ═══════════════════════════════════════════════════════════════════════════

const sbMock = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => sbMock() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { hashDeLlave } from '@/lib/auth/llave-api';
import {
  retoS256, redirectUriAceptable, redirectUriRegistrada,
  canjearCodigo, refrescarTokens, validarAcceso, registrarCliente,
  PREFIJO_CODIGO, PREFIJO_ACCESO, PREFIJO_REFRESCO,
} from './oauth';

type Resultado = { data: unknown; error: { message: string } | null };
const OK = (data: unknown): Resultado => ({ data, error: null });
const FALLA = (message = 'la base no contestó'): Resultado => ({ data: null, error: { message } });

/** Cadena PostgREST falsa: todo método devuelve la cadena, await → resultado. */
function cadena(resultado: Resultado): unknown {
  const p = Promise.resolve(resultado);
  const proxy: unknown = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      return () => proxy;
    },
  });
  return proxy;
}

/** Respuestas por tabla, consumidas en orden; la última se repite. Y, por
 *  RPC (`porRpc`), para `mcp_oauth_usuario_vigente` — la revalidación del
 *  hallazgo 1 no pasa por `.from()`. */
function conTablas(porTabla: Record<string, Resultado[]>, porRpc: Record<string, Resultado[]> = {}) {
  const usados: Record<string, number> = {};
  const usadosRpc: Record<string, number> = {};
  sbMock.mockReturnValue({
    from(tabla: string) {
      const r = porTabla[tabla];
      if (!r) return cadena(OK([]));
      const i = usados[tabla] ?? 0;
      usados[tabla] = i + 1;
      return cadena(r[Math.min(i, r.length - 1)]);
    },
    rpc(fn: string) {
      const r = porRpc[fn];
      if (!r) return cadena(OK(true));
      const i = usadosRpc[fn] ?? 0;
      usadosRpc[fn] = i + 1;
      return cadena(r[Math.min(i, r.length - 1)]);
    },
  });
}

beforeEach(() => {
  sbMock.mockReset();
});

const FUTURO = new Date(Date.now() + 60_000).toISOString();
const PASADO = new Date(Date.now() - 60_000).toISOString();

// Vector de prueba de PKCE del RFC 7636 (apéndice B).
const VERIFIER_RFC = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE_RFC = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const CODIGO = `${PREFIJO_CODIGO}abcdefghijklmnopqrstuvwxyz0123456789ABCDEF`;

function filaCodigo(extra: Record<string, unknown> = {}) {
  return {
    id: 'cod-1', cliente_id: 'cli-1', user_id: 'u-1', user_email: null,
    tenant_id: 't-1', rol: 'contador', redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    code_challenge: CHALLENGE_RFC, resource: null, familia: 'fam-1',
    expira_en: FUTURO, usado_en: null,
    ...extra,
  };
}

describe('retoS256', () => {
  it('cuadra con el vector del RFC 7636', () => {
    expect(retoS256(VERIFIER_RFC)).toBe(CHALLENGE_RFC);
  });
});

describe('redirectUriAceptable', () => {
  it('acepta https y loopback http; rechaza lo demás', () => {
    expect(redirectUriAceptable('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectUriAceptable('http://localhost:33418/callback')).toBe(true);
    expect(redirectUriAceptable('http://127.0.0.1/cb')).toBe(true);
    // Un host normal sin TLS no protege el código en tránsito.
    expect(redirectUriAceptable('http://ejemplo.com/cb')).toBe(false);
    // El vector clásico de intercepción en móvil.
    expect(redirectUriAceptable('myapp://callback')).toBe(false);
    // Credenciales incrustadas: no.
    expect(redirectUriAceptable('https://user:pass@claude.ai/cb')).toBe(false);
    expect(redirectUriAceptable('no-es-una-url')).toBe(false);
  });
});

describe('redirectUriRegistrada', () => {
  const registradas = ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback'];

  it('exacta para https: un sufijo o query de más NO pasa', () => {
    expect(redirectUriRegistrada('https://claude.ai/api/mcp/auth_callback', registradas)).toBe(true);
    expect(redirectUriRegistrada('https://claude.ai/api/mcp/auth_callback2', registradas)).toBe(false);
    expect(redirectUriRegistrada('https://claude.ai/api/mcp/auth_callback?x=1', registradas)).toBe(false);
    expect(redirectUriRegistrada('https://claude.evil/api/mcp/auth_callback', registradas)).toBe(false);
  });

  it('loopback: el puerto es libre (RFC 8252 §7.3), la ruta no', () => {
    expect(redirectUriRegistrada('http://localhost:49152/callback', registradas)).toBe(true);
    expect(redirectUriRegistrada('http://localhost:49152/otra', registradas)).toBe(false);
    // El puerto libre es SOLO para loopback: un https con otro puerto no pasa.
    expect(redirectUriRegistrada('https://claude.ai:8443/api/mcp/auth_callback', registradas)).toBe(false);
  });
});

describe('canjearCodigo', () => {
  it('canje limpio: marca usado y emite el par', async () => {
    conTablas({
      mcp_oauth_codigo: [OK(filaCodigo()), OK([{ id: 'cod-1' }])],
      mcp_oauth_token: [OK(null)],
    });
    const r = await canjearCodigo(CODIGO, 'cli-1', 'https://claude.ai/api/mcp/auth_callback', VERIFIER_RFC);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tokens.acceso.startsWith(PREFIJO_ACCESO)).toBe(true);
      expect(r.tokens.refresco.startsWith(PREFIJO_REFRESCO)).toBe(true);
      expect(r.tokens.expiraEnSegundos).toBeGreaterThan(0);
    }
  });

  it('el mismo texto para expirado, verifier malo, redirect distinto y cliente ajeno', async () => {
    const casos: Array<[Record<string, unknown>, string, string, string]> = [
      [{ expira_en: PASADO }, 'cli-1', 'https://claude.ai/api/mcp/auth_callback', VERIFIER_RFC],
      [{}, 'cli-1', 'https://claude.ai/api/mcp/auth_callback', 'a'.repeat(43)],
      [{}, 'cli-1', 'https://otro.example/cb', VERIFIER_RFC],
      [{}, 'cli-OTRO', 'https://claude.ai/api/mcp/auth_callback', VERIFIER_RFC],
    ];
    const textos = new Set<string>();
    for (const [extra, cli, uri, verifier] of casos) {
      conTablas({ mcp_oauth_codigo: [OK(filaCodigo(extra))] });
      const r = await canjearCodigo(CODIGO, cli, uri, verifier);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('no_valido');
        textos.add(r.detalle);
      }
    }
    // UN solo texto para todos: no se dice cuál mitad falló.
    expect(textos.size).toBe(1);
  });

  it('el REUSO revoca la familia y se niega', async () => {
    const updates: string[] = [];
    sbMock.mockReturnValue({
      from(tabla: string) {
        if (tabla === 'mcp_oauth_codigo') return cadena(OK(filaCodigo({ usado_en: PASADO })));
        if (tabla === 'mcp_oauth_token') {
          updates.push('revocar');
          return cadena(OK([]));
        }
        return cadena(OK([]));
      },
    });
    const r = await canjearCodigo(CODIGO, 'cli-1', 'https://claude.ai/api/mcp/auth_callback', VERIFIER_RFC);
    expect(r.ok).toBe(false);
    expect(updates).toContain('revocar');
  });

  it('la CARRERA (dos canjes simultáneos): el que no marcó la fila se niega', async () => {
    conTablas({
      // La lectura ve el código libre… pero el UPDATE condicionado no
      // encuentra fila (el otro canje ganó): cero filas devueltas.
      mcp_oauth_codigo: [OK(filaCodigo()), OK([])],
      mcp_oauth_token: [OK(null)],
    });
    const r = await canjearCodigo(CODIGO, 'cli-1', 'https://claude.ai/api/mcp/auth_callback', VERIFIER_RFC);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_valido');
  });

  it('la base que no contesta es no_disponible, no no_valido', async () => {
    conTablas({ mcp_oauth_codigo: [FALLA()] });
    const r = await canjearCodigo(CODIGO, 'cli-1', 'https://claude.ai/api/mcp/auth_callback', VERIFIER_RFC);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_disponible');
  });
});

describe('refrescarTokens', () => {
  const REFRESCO = `${PREFIJO_REFRESCO}xyz`;
  const filaRefresco = (extra: Record<string, unknown> = {}) => ({
    id: 'tok-r', cliente_id: 'cli-1', user_id: 'u-1', user_email: null,
    tenant_id: 't-1', rol: 'contador', familia: 'fam-1',
    expira_en: FUTURO, revocado_en: null, tipo: 'refresco',
    ...extra,
  });

  it('rota: revoca el viejo y emite el par nuevo', async () => {
    conTablas({
      mcp_oauth_token: [OK(filaRefresco()), OK([{ id: 'tok-r' }]), OK(null)],
    });
    const r = await refrescarTokens(REFRESCO, 'cli-1');
    expect(r.ok).toBe(true);
  });

  it('un refresco YA ROTADO que reaparece tumba la familia', async () => {
    const llamadas: Resultado[] = [OK(filaRefresco({ revocado_en: PASADO })), OK([])];
    let i = 0;
    sbMock.mockReturnValue({ from: () => cadena(llamadas[Math.min(i++, llamadas.length - 1)]) });
    const r = await refrescarTokens(REFRESCO, 'cli-1');
    expect(r.ok).toBe(false);
    // La segunda llamada fue el update de revocación de la familia.
    expect(i).toBeGreaterThanOrEqual(2);
  });

  it('un token de ACCESO donde va el refresco no se acepta', async () => {
    conTablas({ mcp_oauth_token: [OK(filaRefresco({ tipo: 'acceso' }))] });
    const r = await refrescarTokens(REFRESCO, 'cli-1');
    expect(r.ok).toBe(false);
  });

  // AUDITORÍA FINAL 2026-08-29, HALLAZGO 1: la identidad congelada se
  // revalida contra app_user (mcp_oauth_usuario_vigente) ANTES de rotar.
  describe('revalidación de identidad (hallazgo 1)', () => {
    it('usuario dado de baja o con el rol/tenant cambiado: tumba la familia y niega, igual que el reuso', async () => {
      const updates: string[] = [];
      sbMock.mockReturnValue({
        from(tabla: string) {
          if (tabla === 'mcp_oauth_token') {
            updates.push('token');
            return cadena(OK(filaRefresco()));
          }
          return cadena(OK([]));
        },
        rpc(fn: string) {
          if (fn === 'mcp_oauth_usuario_vigente') {
            updates.push('vigente');
            return cadena(OK(false));
          }
          return cadena(OK(true));
        },
      });
      const r = await refrescarTokens(REFRESCO, 'cli-1');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('no_valido');
      // Se llamó la revalidación, y el SIGUIENTE `.from('mcp_oauth_token')`
      // (tras negarse) fue el UPDATE de `revocarFamilia` — la misma rama que
      // el reuso de un refresco ya rotado.
      expect(updates).toEqual(['token', 'vigente', 'token']);
    });

    it('usuario vigente (mismo tenant y rol): rota normal', async () => {
      conTablas(
        { mcp_oauth_token: [OK(filaRefresco()), OK([{ id: 'tok-r' }]), OK(null)] },
        { mcp_oauth_usuario_vigente: [OK(true)] },
      );
      const r = await refrescarTokens(REFRESCO, 'cli-1');
      expect(r.ok).toBe(true);
    });

    it('la base que no contesta la revalidación es no_disponible, no no_valido', async () => {
      conTablas(
        { mcp_oauth_token: [OK(filaRefresco())] },
        { mcp_oauth_usuario_vigente: [FALLA()] },
      );
      const r = await refrescarTokens(REFRESCO, 'cli-1');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('no_disponible');
    });
  });
});

describe('validarAcceso', () => {
  const ACCESO = `${PREFIJO_ACCESO}abc`;
  const filaAcceso = (extra: Record<string, unknown> = {}) => ({
    id: 'tok-a', tipo: 'acceso', user_id: 'u-1', user_email: 'ana@flota.mx',
    tenant_id: 't-1', rol: 'contador', expira_en: FUTURO, revocado_en: null,
    ...extra,
  });

  it('un acceso vivo resuelve tenant, usuario y rol', async () => {
    conTablas({ mcp_oauth_token: [OK(filaAcceso())] });
    const r = await validarAcceso(ACCESO);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.acceso.tenantId).toBe('t-1');
      expect(r.acceso.rol).toBe('contador');
      expect(r.acceso.userId).toBe('u-1');
    }
  });

  it('expirado, revocado o de otro tipo → no_valido con el mismo texto', async () => {
    const textos = new Set<string>();
    for (const extra of [{ expira_en: PASADO }, { revocado_en: PASADO }, { tipo: 'refresco' }]) {
      conTablas({ mcp_oauth_token: [OK(filaAcceso(extra))] });
      const r = await validarAcceso(ACCESO);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('no_valido');
        textos.add(r.detalle);
      }
    }
    expect(textos.size).toBe(1);
  });

  it('sin el prefijo ni se consulta la base', async () => {
    const r = await validarAcceso('lk_live_esto-es-una-llave');
    expect(r.ok).toBe(false);
    expect(sbMock).not.toHaveBeenCalled();
  });

  it('la base caída es no_disponible', async () => {
    conTablas({ mcp_oauth_token: [FALLA()] });
    const r = await validarAcceso(ACCESO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_disponible');
  });
});

describe('registrarCliente', () => {
  it('rechaza listas vacías y URIs que no se aceptan', async () => {
    expect((await registrarCliente('X', [])).ok).toBe(false);
    expect((await registrarCliente('X', ['http://ejemplo.com/cb'])).ok).toBe(false);
    expect((await registrarCliente('X', 'no-lista')).ok).toBe(false);
    expect(sbMock).not.toHaveBeenCalled();
  });

  it('el hash guardado JAMÁS es el secreto: lo que se inserta es 64 hex', () => {
    // Guardia estructural barata: el hash de cualquier secreto emitido tiene
    // la forma que el CHECK de la 0260 exige, y no contiene el secreto.
    const h = hashDeLlave(`${PREFIJO_ACCESO}loquesea`);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h.includes('loquesea')).toBe(false);
  });
});
