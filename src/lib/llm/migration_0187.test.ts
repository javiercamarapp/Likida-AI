import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/0187_wa_evento_pendiente_leases_fencing.sql', 'utf8');

describe('contrato SQL del fencing WhatsApp 0187', () => {
  it('todas las SECURITY DEFINER fijan search_path vacío y califican tablas', () => {
    expect((sql.match(/security definer/g) ?? []).length).toBe(10);
    expect((sql.match(/set search_path = ''/g) ?? []).length).toBe(10);
    expect(sql).toContain('from public.wa_evento_pendiente w');
    expect(sql).toContain('from public.wa_mensaje_procesado');
    expect(sql).toContain('for update skip locked');
  });

  it('todas las transiciones mutan con token y owner', () => {
    expect(sql).toContain('and claim_token = p_claim_token');
    expect(sql).toContain('and claim_owner = p_owner');
    expect(sql).toContain('and lease_token = p_lease_token');
    expect(sql).toContain('and lease_owner = p_lease_owner');
    expect(sql).toContain('renovar_wa_pendiente');
    expect(sql).toContain('renew_wa_mensaje_procesado');
  });

  it('impone el orden causal por chofer dentro del claim autoritativo', () => {
    expect(sql).toContain("coalesce(nullif(anterior.evento ->> 'from', ''), anterior.id)");
    expect(sql).toContain('(anterior.recibido_en, anterior.id) < (w.recibido_en, w.id)');
    expect((sql.match(/and not exists \(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
