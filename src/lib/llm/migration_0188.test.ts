import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/0188_runtime_idempotencia_clock.sql', 'utf8');

describe('contrato SQL del runtime 0188', () => {
  it('mueve expiración, renovación y fencing al reloj de PostgreSQL', () => {
    expect(sql).toContain('create or replace function public.claim_agente_mutacion');
    expect(sql).toContain('create or replace function public.renew_agente_mutacion');
    expect(sql).toContain('create or replace function public.complete_agente_mutacion');
    expect(sql).toContain('create or replace function public.fail_agente_mutacion');
    expect(sql).toContain('clock_timestamp()');
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('grant execute on function public.claim_agente_mutacion');
    expect(sql).not.toContain('Date.now');
    expect(sql).not.toContain('new Date');
  });
});
