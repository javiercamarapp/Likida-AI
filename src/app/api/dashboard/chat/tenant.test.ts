// ═══════════════════════════════════════════════════════════════════════════
// BE-16 (auditoría 24) — `tenantEfectivoChat` no contesta con la flota
// equivocada cuando la lectura de `?tenant=` se cae.
//
// El escenario: un superadmin abre /dashboard/chat?tenant=<Flota B> durante un
// parpadeo de Supabase. `acotada` resuelve por valor, así que `data` es null
// igual que si el uuid no existiera; sin mirar `error`, la función se quedaba
// con el tenant de la SESIÓN (la demo) y el chat contestaba con cifras de otra
// flota bajo un encabezado que no lo desmentía — y guardaba el historial ahí.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Respuesta = { data: unknown; error: { message: string } | null };
let respuesta: Respuesta = { data: null, error: null };
// Solo se usa si la corrida hace una SEGUNDA consulta — el fallback al tenant
// de la sesión/demo cuando el `?tenant=` pedido no existe (MEDIO, reauditoría
// 25). `null` = "usa `respuesta` también para la segunda", que es lo que
// quiere la mayoría de las pruebas de abajo (una sola consulta).
let respuestaSesion: Respuesta | null = null;
let llamadaGlobal = 0;

function builder() {
  const miLlamada = ++llamadaGlobal;
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.maybeSingle = async () => (miLlamada === 2 && respuestaSesion) ? respuestaSesion : respuesta;
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builder() }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (p: unknown) => p }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { tenantEfectivoChat } = await import('./tenant');

const SUPER = { userId: 'u-0', tenantId: null, rol: 'superadmin', nombre: 'Javier', operadorId: null, avatarUrl: null };

beforeEach(() => {
  respuesta = { data: null, error: null };
  respuestaSesion = null;
  llamadaGlobal = 0;
  logger.error.mockClear();
  vi.stubEnv('DEMO_TENANT_ID', 'demo-fija');
});

describe('tenantEfectivoChat', () => {
  it('lectura CAÍDA de `?tenant=`: devuelve null (quien llama corta) y lo deja en el log', async () => {
    respuesta = { data: null, error: { message: 'fetch failed' } };
    expect(await tenantEfectivoChat(SUPER, 't-b')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('chat.tenant_pedido_ilegible',
      expect.objectContaining({ tenant: 't-b', err: 'fetch failed' }));
  });

  it('`?tenant=` que RESUELVE: esa flota y su nombre', async () => {
    respuesta = { data: { id: 't-b', nombre: 'Flota B' }, error: null };
    expect(await tenantEfectivoChat(SUPER, 't-b')).toEqual({ tenantId: 't-b', nombreFlota: 'Flota B' });
  });

  it('un uuid que simplemente NO existe cae al de la sesión — Y esa flota SÍ se verifica', async () => {
    respuesta = { data: null, error: null }; // `t-fantasma` no existe
    respuestaSesion = { data: { nombre: 'tu flota real' }, error: null }; // el respaldo SÍ existe
    expect(await tenantEfectivoChat(SUPER, 't-fantasma')).toEqual({ tenantId: 'demo-fija', nombreFlota: 'tu flota real' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MEDIO (reauditoría 25, `agentico.md:603`): el commit `66339d5` cerró la
  // rama `else` (verificar que el tenant de la sesión/demo existe) y dejó
  // ABIERTA esta — cuando `?tenant=` no existe, el código seguía de largo con
  // el `tenantId` original SIN comprobar que existiera. Para un superadmin
  // sin flota propia eso es `tenantDemo()`, y si ESE también es fantasma
  // (el incidente real del 3-sep-2026, `chat.analista.fallo`) la respuesta
  // salía 200 con un `tenantId` que revienta la FK en `reservar_presupuesto_llm`
  // en CADA turno del chat.
  // ═══════════════════════════════════════════════════════════════════════
  it('`?tenant=` inexistente Y el tenant de respaldo TAMBIÉN fantasma: null, no un 200 mudo', async () => {
    respuesta = { data: null, error: null }; // `t-fantasma` no existe
    // respuestaSesion se queda en null: la segunda consulta usa `respuesta`
    // también, así que el respaldo `demo-fija` TAMPOCO existe.
    expect(await tenantEfectivoChat(SUPER, 't-fantasma')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('chat.tenant_sesion_fantasma',
      expect.objectContaining({ tenant: 'demo-fija' }));
  });

  it('un rol real ignora `?tenant=` entero y se queda en SU flota', async () => {
    respuesta = { data: { nombre: 'Fletes del Golfo' }, error: null };
    const r = await tenantEfectivoChat(
      { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null, avatarUrl: null }, 't-b');
    expect(r).toEqual({ tenantId: 't-1', nombreFlota: 'Fletes del Golfo' });
  });

  it('sin tenant y sin ser superadmin: null', async () => {
    expect(await tenantEfectivoChat(
      { userId: 'u-2', tenantId: null, rol: 'contador', nombre: null, operadorId: null, avatarUrl: null }, null)).toBeNull();
  });

  // 3-sep-2026, producción: `DEMO_TENANT_ID` apuntaba a una flota que ya no
  // existe. Sin esta rama, `tenantId` seguía de largo hacia `ejecutarAnalista`
  // y `reservar_presupuesto_llm` tronaba por FK violation en cada turno
  // (`chat.analista.fallo`, 12 fallos en 5 minutos, mismo tenant fantasma).
  it('el demo de tenantDemo() ya no existe: null, fail-closed (ANTES seguía de largo)', async () => {
    respuesta = { data: null, error: null };
    expect(await tenantEfectivoChat(SUPER, null)).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('chat.tenant_sesion_fantasma',
      expect.objectContaining({ tenant: 'demo-fija' }));
  });

  it('lectura CAÍDA del tenant de sesión/demo: null, fail-closed', async () => {
    respuesta = { data: null, error: { message: 'fetch failed' } };
    expect(await tenantEfectivoChat(SUPER, null)).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('chat.tenant_sesion_ilegible',
      expect.objectContaining({ tenant: 'demo-fija', err: 'fetch failed' }));
  });
});
