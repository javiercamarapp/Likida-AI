import { describe, it, expect, vi, beforeEach } from 'vitest';

// GUARDIA (hallazgo ALTO de la revisión adversarial, oct-2026): decisión de producto — A1 (liquidación) es SIEMPRE por
// correo para una flota con el perfil `cinco_agentes`, NUNCA por WhatsApp. El riesgo real: `aplicar-cinco-agentes.sh`
// activa el perfil pero no garantiza por sí solo una fila en `liquidacion_correo_config`; sin ella (o con una fila
// vieja/incorrecta) el default de `canalDeEntregaPorOmision` decidía el canal, y ese default era `whatsapp`.
//
// Esta prueba exige que, para CUALQUIER flota con perfil `cinco_agentes`, el canal resuelto sea `correo` sin
// excepción: sin fila, con una fila que diga `whatsapp` o `ambos`, y aunque la lectura de la config falle o la
// migración 0785 no esté aplicada. Para una flota SIN ese perfil, el comportamiento de siempre (whatsapp por
// defecto) se preserva: cambiarlo de forma global dejaría sin entrega, por NINGÚN canal, a cualquier flota que nunca
// configuró `liquidacion_correo_config` (la entrega por correo depende de que un desglose se haya recibido por su
// propio camino; el default de este gate no puede inventar eso) — ver el razonamiento en `servicio.ts`.

type Resp = { data: unknown; error: { message: string; code?: string } | null };
const porTenantPerfil = new Map<string, Resp>();
const porTenantCanal = new Map<string, Resp>();
let lanzarEnCanal = new Set<string>();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      let tenant: string | null = null;
      b.select = () => b;
      b.eq = (_c: string, v: string) => { tenant = v; return b; };
      b.maybeSingle = async () => {
        if (tabla === 'tenant_perfil') return porTenantPerfil.get(tenant ?? '') ?? { data: null, error: null };
        if (lanzarEnCanal.has(tenant ?? '')) throw new Error('base caída (sintético)');
        return porTenantCanal.get(tenant ?? '') ?? { data: null, error: null };
      };
      return b;
    },
  }),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('NEXT_REDIRECT (no debería llamarse en esta prueba)'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');
const { dependenciasPorOmision } = await import('./servicio');

const CINCO_AGENTES = { data: { perfil: 'cinco_agentes' }, error: null };
const TABLA_AUSENTE = { data: null, error: { message: 'relation "liquidacion_correo_config" does not exist', code: '42P01' } };

beforeEach(() => {
  reiniciarCachePerfil();
  porTenantPerfil.clear();
  porTenantCanal.clear();
  lanzarEnCanal = new Set();
});

const canalDe = (tenantId: string) => dependenciasPorOmision.canalDeEntrega!(tenantId);

describe('canalDeEntregaPorOmision bajo el perfil cinco_agentes: SIEMPRE correo, nunca WhatsApp', () => {
  it('sin fila en liquidacion_correo_config ⇒ correo (el caso real: aplicar el perfil sin el paso manual)', async () => {
    const t = 't-ca-sin-fila';
    porTenantPerfil.set(t, CINCO_AGENTES);
    porTenantCanal.set(t, { data: null, error: null });
    await expect(canalDe(t)).resolves.toBe('correo');
  });

  it('fila explícita con canal=whatsapp ⇒ igual correo (no se confía en una config vieja o incorrecta)', async () => {
    const t = 't-ca-fila-whatsapp';
    porTenantPerfil.set(t, CINCO_AGENTES);
    porTenantCanal.set(t, { data: { canal: 'whatsapp', activa: true }, error: null });
    await expect(canalDe(t)).resolves.toBe('correo');
  });

  it('fila explícita con canal=ambos ⇒ igual correo (A1 nunca manda WhatsApp bajo este perfil)', async () => {
    const t = 't-ca-fila-ambos';
    porTenantPerfil.set(t, CINCO_AGENTES);
    porTenantCanal.set(t, { data: { canal: 'ambos', activa: true }, error: null });
    await expect(canalDe(t)).resolves.toBe('correo');
  });

  it('la migración 0785 no está aplicada (tabla ausente) ⇒ igual correo', async () => {
    const t = 't-ca-sin-migracion';
    porTenantPerfil.set(t, CINCO_AGENTES);
    porTenantCanal.set(t, TABLA_AUSENTE);
    await expect(canalDe(t)).resolves.toBe('correo');
  });

  it('la lectura de la config lanza (base caída) ⇒ igual correo: el perfil decide ANTES de tocar esa tabla', async () => {
    const t = 't-ca-lectura-falla';
    porTenantPerfil.set(t, CINCO_AGENTES);
    lanzarEnCanal.add(t);
    await expect(canalDe(t)).resolves.toBe('correo');
  });

  it('una flota SIN el perfil, sin fila ⇒ sigue en whatsapp (comportamiento preservado para las demás)', async () => {
    const t = 't-sin-perfil';
    porTenantPerfil.set(t, { data: null, error: null });
    porTenantCanal.set(t, { data: null, error: null });
    await expect(canalDe(t)).resolves.toBe('whatsapp');
  });

  it('una flota SIN el perfil, con fila explícita canal=correo ⇒ se respeta correo (su propia decisión)', async () => {
    const t = 't-sin-perfil-correo';
    porTenantPerfil.set(t, { data: null, error: null });
    porTenantCanal.set(t, { data: { canal: 'correo', activa: true }, error: null });
    await expect(canalDe(t)).resolves.toBe('correo');
  });
});
