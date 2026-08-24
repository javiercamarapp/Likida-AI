import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/0186_runtime_idempotencia_y_presupuesto.sql', 'utf8');

describe('contrato SQL del runtime 0186', () => {
  it('protege efectos y presupuesto con invariantes de base', () => {
    expect(sql).toContain('unique (tenant_id, effect_key)');
    expect(sql).toContain('alter table public.agente_mutacion_idempotencia enable row level security');
    expect(sql).toContain('pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0))');
    expect(sql).toContain('create or replace function public.reservar_presupuesto_llm');
    expect(sql).toContain('p_tope_run_usd numeric');
    expect(sql).toContain('run_id = p_run_id');
    expect(sql).toContain('usado_run + p_reserva_usd > p_tope_run_usd');
    expect(sql).toContain('create or replace function public.liquidar_presupuesto_llm');
    expect(sql).toContain('grant execute on function public.reservar_presupuesto_llm');
    expect(sql).toContain('grant execute on function public.liquidar_presupuesto_llm');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('attempts integer not null default 1');
  });
});
