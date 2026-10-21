// ═══════════════════════════════════════════════════════════════════════════
// LA CONEXIÓN REAL: `flotaBajoPerfil` ya no depende solo de `fijarGuardiaPerfil` (mecanismo de
// prueba) — por defecto lee el perfil REAL de la flota en `tenant_perfil` (mig. 0770), igual que
// `perfilRestringido`. Esta prueba NO usa `fijarGuardiaPerfil`: siembra la tabla real (con el mismo
// doble de `@/lib/supabase/admin` que usa `perfil_tenant.test.ts`) y comprueba que `aprobarDocumento`
// toma la rama `prepararEnvioTms` para una flota marcada `cinco_agentes`, y la rama de siempre
// (`aplicarSalidaViaje`) para una flota sin fila en esa tabla.
// ═══════════════════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
const bitacora = vi.hoisted(() => ({ anotarBitacora: vi.fn(async (_entrada: unknown, _opciones?: unknown) => true) }));
vi.mock('../bitacora_escritura', () => bitacora);
vi.mock('../carta_porte_datos', async (orig) => ({ ...(await orig<typeof import('../carta_porte_datos')>()), getBorradorViaje: vi.fn(async () => null) }));

// El mismo doble de `@/lib/supabase/admin` que usa `src/lib/auth/perfil_tenant.test.ts`: solo
// contesta `tenant_perfil`, nada más de este archivo lo necesita (todo lo demás pasa por `./repo`,
// ya mockeado arriba).
type Resp = { data: unknown; error: { message: string; code?: string } | null };
let porTenant = new Map<string, Resp>();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      expect(t).toBe('tenant_perfil');
      let tenant: string | null = null;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (_c: string, v: string) => { tenant = v; return b; };
      b.maybeSingle = async () => porTenant.get(tenant ?? '') ?? { data: null, error: null };
      return b;
    },
  }),
}));

import { estado, reset } from './repo_falso.fixture';
import { A, ACTOR, B, USUARIO_B, llmBoreal, sembrarFlotas, subirYProcesar } from './escenario.fixture';
import { aprobarDocumento } from './bandeja';
import { fijarGuardiaPerfil } from './envio';
import { llmFalso, lecturaBoreal } from './llm_falso.fixture';
import { pdfBoreal } from './documentos_sinteticos.fixture';
import { reiniciarCachePerfil } from '@/lib/auth/perfil_tenant';

beforeEach(() => {
  reset();
  sembrarFlotas();
  bitacora.anotarBitacora.mockClear();
  porTenant = new Map();
  reiniciarCachePerfil();
  // Nada de `fijarGuardiaPerfil(...)` aquí: se deja la guardia REAL conectada por defecto.
});
afterEach(() => { fijarGuardiaPerfil(); reiniciarCachePerfil(); });

/** Un documento sintético cuyo operador NO se puede identificar: sin perfil, la salida de siempre no crearía viaje. */
async function documentoSinOperador(tenantId: string) {
  const llm = llmFalso((e) => {
    const s = lecturaBoreal(e.nivel);
    const op = s.campos.find((c) => c.clave === 'operador_nombre')!;
    op.valor = 'Persona Desconocida'; op.evidencia = 'Operador: Maria Hernandez Soto';
    return s;
  });
  const r = await subirYProcesar(tenantId, await pdfBoreal(), llm, 'orden.pdf', { clienteId: 'cli-boreal', remitente: 'logistica@boreal.example' });
  return { id: r.documentoId, doc: () => estado.docs.get(r.documentoId)! };
}

describe('flotaBajoPerfil conectada al perfil REAL de tenant_perfil (sin fijarGuardiaPerfil)', () => {
  it('flota marcada cinco_agentes en tenant_perfil: aprobarDocumento toma la rama prepararEnvioTms', async () => {
    porTenant.set(A, { data: { perfil: 'cinco_agentes' }, error: null });
    const { id, doc } = await documentoSinOperador(A);

    const r = await aprobarDocumento(A, id, doc().version, ACTOR);

    expect(r.documento.estado).toBe('aprobado');
    expect(r.salida).toBeNull();
    expect(r.envio).toMatchObject({ ok: true, creado: true });
    expect(estado.envios).toHaveLength(1);
    expect(estado.envios[0]).toMatchObject({ tenantId: A, documentoId: id, estado: 'pendiente_prechequeo' });
    expect(estado.viajes).toHaveLength(0);
    expect(estado.llamadas).not.toContain('insertarViaje');
  });

  it('flota SIN fila en tenant_perfil: aprobarDocumento conserva la rama de siempre (intenta crear viaje, nunca prepara envío)', async () => {
    // B no tiene fila en `porTenant`: `perfilDeTenant` devuelve null (sin perfil, comportamiento de siempre). Lo que
    // importa aquí no es si `aplicarSalidaViaje` logra resolver el operador, sino que la bifurcación NO toma la
    // rama del TMS: el camino de siempre (`r.salida`) se ejecuta y `r.envio` nunca se intenta.
    const r0 = await subirYProcesar(B, await pdfBoreal(), llmBoreal(), 'orden.pdf', { clienteId: 'cli-b' });
    const ap = await aprobarDocumento(B, r0.documentoId, estado.docs.get(r0.documentoId)!.version, { id: USUARIO_B });

    expect(ap.salida).not.toBeNull();
    expect(ap.envio).toBeNull();
    expect(estado.envios).toHaveLength(0);
  });
});
