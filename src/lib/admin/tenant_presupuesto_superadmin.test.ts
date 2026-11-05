import { beforeEach, describe, expect, it, vi } from 'vitest';

// MX-004: el presupuesto de IA del superadmin sale SIEMPRE del tenant interno; sin él, falla cerrado.
const estado = vi.hoisted(() => ({
  resultado: { data: [] as unknown[] | null, error: null as { code?: string; message?: string } | null },
  consultas: [] as Array<{ tabla: string; columnas: string; col: string; val: unknown; limite: number }>,
}));

vi.mock('@/lib/likida/repo', () => ({
  leerTenantsInternos: () => {
    estado.consultas.push({ tabla: 'tenant', columnas: 'id', col: 'interno', val: true, limite: 2 });
    return Promise.resolve(estado.resultado);
  },
}));

const { tenantDePresupuestoSuperadmin } = await import('./tenant_presupuesto_superadmin');
const ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  estado.resultado = { data: [], error: null };
  estado.consultas.length = 0;
});

describe('tenantDePresupuestoSuperadmin (MX-004)', () => {
  it('paga el tenant interno de Likida (tenant.interno = true)', async () => {
    estado.resultado = { data: [{ id: ID }], error: null };
    const r = await tenantDePresupuestoSuperadmin();
    expect(r).toEqual({ ok: true, tenantId: ID, origen: 'interno' });
    expect(estado.consultas).toEqual([{ tabla: 'tenant', columnas: 'id', col: 'interno', val: true, limite: 2 }]);
  });

  it('sin tenant interno falla cerrado con el motivo que la pantalla muestra', async () => {
    const r = await tenantDePresupuestoSuperadmin();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe('sin_tenant_interno');
      expect(r.mensaje).toMatch(/tenant\.interno = true/);
    }
  });

  it('la columna ausente (migración 0970 sin aplicar) se dice tal cual, no como falla del modelo', async () => {
    estado.resultado = { data: null, error: { code: '42703', message: 'column tenant.interno does not exist' } };
    const r = await tenantDePresupuestoSuperadmin();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe('migracion_pendiente');
      expect(r.mensaje).toMatch(/0970/);
    }
  });

  it('un error de lectura cualquiera falla cerrado (nunca cae en un presupuesto global)', async () => {
    estado.resultado = { data: null, error: { code: '57014', message: 'timeout' } };
    const r = await tenantDePresupuestoSuperadmin();
    expect(r).toMatchObject({ ok: false, motivo: 'error_lectura' });
  });

  it('dos internos o un id inválido también fallan cerrado', async () => {
    estado.resultado = { data: [{ id: ID }, { id: '44444444-4444-4444-8444-444444444444' }], error: null };
    expect(await tenantDePresupuestoSuperadmin()).toMatchObject({ ok: false, motivo: 'varios_internos' });
    estado.resultado = { data: [{ id: 'no-es-uuid' }], error: null };
    expect(await tenantDePresupuestoSuperadmin()).toMatchObject({ ok: false, motivo: 'error_lectura' });
  });
});
