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
/** Cuando está puesta, cada `maybeSingle()` sucesivo saca la SIGUIENTE
 *  respuesta de la cola en vez de repetir `respuesta` — para las pruebas que
 *  necesitan distinguir la lectura del `?tenant=` pedido de la del fallback. */
let cola: Respuesta[] | null = null;

function builder() {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.maybeSingle = async () => (cola ? cola.shift()! : respuesta);
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
  cola = null;
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

  // MEDIO (auditoría 25): un uuid de `?tenant=` que no existe cae al tenant de
  // la sesión — pero ese fallback pasa por la MISMA validación de existencia
  // que la rama `else`. ANTES esta prueba fijaba lo contrario (`tenantId:
  // 'demo-fija'` SIN comprobar que ese demo existiera), que es exactamente el
  // bug que resucitó `chat.analista.fallo` en producción el 3-sep-2026 con un
  // `DEMO_TENANT_ID` fantasma.
  it('un uuid que simplemente NO existe cae al de la sesión, y ESE también se valida', async () => {
    // El mock comparte `respuesta` entre las dos lecturas: ni el `?tenant=`
    // pedido ni el tenant de sesión/demo existen.
    respuesta = { data: null, error: null };
    expect(await tenantEfectivoChat(SUPER, 't-fantasma')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('chat.tenant_sesion_fantasma',
      expect.objectContaining({ tenant: 'demo-fija' }));
  });

  it('un uuid que NO existe cae al de la sesión, y ESE sí existe: se usa', async () => {
    cola = [
      { data: null, error: null }, // el `?tenant=` pedido: no existe
      { data: { nombre: 'Flota de la sesión' }, error: null }, // el fallback: sí
    ];
    expect(await tenantEfectivoChat(SUPER, 't-fantasma')).toEqual({ tenantId: 'demo-fija', nombreFlota: 'Flota de la sesión' });
    expect(logger.error).not.toHaveBeenCalled();
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
