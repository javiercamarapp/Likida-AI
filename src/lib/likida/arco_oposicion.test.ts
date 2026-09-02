import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA OPOSICIÓN ARCO DEJA EVIDENCIA, NO PROSA — auditoría 20, hallazgo 8.
//
// PATRÓN REINCIDENTE #5, tercera vez: `ejecutar_arco_oposicion` existe desde
// la 0178 (misma migración, mismo grant a `service_role` que su hermana de
// cancelación) y NADA en `src/` la llamaba. Una oposición se "resolvía"
// escribiendo un texto en `resolucion`: la solicitud quedaba `resuelta` y en
// una revisión de privacidad no había rastro verificable de qué se hizo. Es
// EXACTAMENTE el hueco que la auditoría 19 cerró para la cancelación.
//
// Lo que se fija aquí, y por qué no es lo mismo que la cancelación:
//
//   · la RPC se llama con el tenant Y la solicitud — el aislamiento lo hace
//     la base (`where id = … and tenant_id = …`), no una comprobación previa
//     en JS que se pueda olvidar;
//   · un `ok:false` de la RPC (no es una oposición, es de otra flota, ya está
//     cerrada) se PROPAGA con su motivo, no se convierte en éxito. Decirle
//     "registrada" a quien apretó el botón sobre una solicitud que la base no
//     tocó es fabricar una constancia falsa;
//   · NO se avisa al titular por WhatsApp. La cancelación sí lo hace porque
//     consuma algo (anonimiza); ésta deja la solicitud EN PROCESO y declara
//     que requiere revisión humana. Un aviso aquí le diría al titular que su
//     caso quedó resuelto cuando apenas empieza.
// ═══════════════════════════════════════════════════════════════════════════

const llamadasRpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
let respuesta: { data: unknown; error: { message: string } | null } = { data: null, error: null };
const tablasTocadas: string[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      llamadasRpc.push({ fn, args });
      return Promise.resolve(respuesta);
    },
    from: (tabla: string) => {
      tablasTocadas.push(tabla);
      const nodo: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'update', 'insert', 'order', 'limit']) nodo[m] = () => nodo;
      nodo.maybeSingle = () => Promise.resolve({ data: null, error: null });
      nodo.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
      return nodo;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Si esto se llegara a llamar, la prueba de "no se avisa al titular" lo caza.
const enviarRespuestaArco = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/meta/client', () => ({
  enviarRespuestaArco: (...a: unknown[]) => enviarRespuestaArco(...(a as [])),
}));

const { ejecutarOposicionArco } = await import('./repo');

beforeEach(() => {
  llamadasRpc.length = 0;
  tablasTocadas.length = 0;
  enviarRespuestaArco.mockClear();
  respuesta = { data: { ok: true, accion: 'oposicion registrada; requiere revisión humana' }, error: null };
});

describe('ejecutarOposicionArco', () => {
  it('llama a la RPC de la 0178 con tenant y solicitud — el aislamiento es de la base', async () => {
    await expect(ejecutarOposicionArco('t-1', 's-9')).resolves.toEqual({ ok: true });
    expect(llamadasRpc).toEqual([
      { fn: 'ejecutar_arco_oposicion', args: { p_tenant: 't-1', p_solicitud: 's-9' } },
    ]);
  });

  it('no escribe `solicitud_arco` por su cuenta: la RPC es la que deja la evidencia', async () => {
    await ejecutarOposicionArco('t-1', 's-9');
    expect(tablasTocadas).toEqual([]);
  });

  it('NO le avisa al titular: la solicitud queda en proceso, no resuelta', async () => {
    await ejecutarOposicionArco('t-1', 's-9');
    expect(enviarRespuestaArco).not.toHaveBeenCalled();
  });

  it('el rechazo de la RPC se propaga CON su motivo, nunca como éxito', async () => {
    respuesta = {
      data: { ok: false, motivo: 'solicitud de oposición inexistente o de otra flota' },
      error: null,
    };
    await expect(ejecutarOposicionArco('t-1', 's-de-otra-flota')).resolves.toEqual({
      ok: false, motivo: 'solicitud de oposición inexistente o de otra flota',
    });
  });

  it('un `ok` que no es `true` tampoco pasa por éxito', async () => {
    // fail-closed ante una respuesta rara: solo el `true` literal cuenta.
    respuesta = { data: { ok: 'sí' }, error: null };
    const r = await ejecutarOposicionArco('t-1', 's-9');
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/no explicó el rechazo/);
  });

  it('un error de transporte LANZA — no se dice "registrada" sobre nada', async () => {
    respuesta = { data: null, error: { message: 'fetch failed' } };
    await expect(ejecutarOposicionArco('t-1', 's-9')).rejects.toThrow(/ejecutarOposicionArco: fetch failed/);
  });
});
