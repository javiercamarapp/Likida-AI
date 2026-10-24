import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONFIG_ATIPICOS_DEFAULT, VELOCIDAD_MIN_KMH, VELOCIDAD_MAX_KMH, validarConfigAtipicos as validarDetector } from './atipicos';
import {
  configAtipicosSchema, validarConfigAtipicos, configAtipicosEfectiva, puedeCambiarEstado, estadoTrasReguardar,
  exigeRevisor, esEstadoAtipico, ESTADOS_ATIPICO,
} from './atipicos_config';

describe('la configuración de cruces atípicos (zod)', () => {
  it('vacío o nulo = defaults; el detector nace con la madrugada apagada', () => {
    expect(configAtipicosSchema.parse({})).toEqual(CONFIG_ATIPICOS_DEFAULT);
    const v = validarConfigAtipicos(null);
    expect(v.ok && v.valor).toEqual(CONFIG_ATIPICOS_DEFAULT);
    expect(CONFIG_ATIPICOS_DEFAULT.ida_y_vuelta_madrugada.activa).toBe(false);
  });

  it('completa con defaults los campos ausentes de una regla parcial', () => {
    const v = validarConfigAtipicos({ repeticion_caseta: { minCruces: 5 } });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.valor.repeticion_caseta).toEqual({ activa: true, minCruces: 5, ventanaHoras: 6 });
      expect(v.valor.secuencia_imposible).toEqual(CONFIG_ATIPICOS_DEFAULT.secuencia_imposible);
    }
  });

  it('rechaza una ventana H <= 0 (cero, negativa) o fuera de rango', () => {
    for (const h of [0, -1, -0.5, 73, Number.NaN, '6']) {
      const v = validarConfigAtipicos({ repeticion_caseta: { ventanaHoras: h } });
      expect(v.ok, `H=${String(h)}`).toBe(false);
    }
    const v = validarConfigAtipicos({ repeticion_caseta: { ventanaHoras: 0 } });
    expect(!v.ok && v.motivo).toMatch(/mayor que 0/);
    expect(validarConfigAtipicos({ repeticion_caseta: { ventanaHoras: 0.5 } }).ok).toBe(true);
  });

  it('A37-A2-27: rechaza una velocidad fuera de 60-300 km/h, los MISMOS límites del detector', () => {
    for (const k of [59.9, 50, 30, 0, -10, 301, 400, '130']) {
      expect(validarConfigAtipicos({ secuencia_imposible: { velocidadMaxKmh: k } }).ok, `v=${String(k)}`).toBe(false);
    }
    const v = validarConfigAtipicos({ secuencia_imposible: { velocidadMaxKmh: 20 } });
    expect(!v.ok && v.motivo).toMatch(/60 km\/h/);
    expect(validarConfigAtipicos({ secuencia_imposible: { velocidadMaxKmh: 60 } }).ok).toBe(true);
    expect(validarConfigAtipicos({ secuencia_imposible: { velocidadMaxKmh: 300 } }).ok).toBe(true);
  });

  it('A37-A2-27: todo lo que la pantalla acepta lo acepta también el detector (sin descartar la configuración)', () => {
    for (const k of [VELOCIDAD_MIN_KMH, 100, VELOCIDAD_MAX_KMH]) {
      const v = validarConfigAtipicos({ secuencia_imposible: { velocidadMaxKmh: k } });
      expect(v.ok).toBe(true);
      if (v.ok) expect(validarDetector(v.valor)).toBeNull();
    }
  });

  it('el mínimo de cruces es un entero de 2 a 50', () => {
    for (const n of [1, 0, 51, 2.5, -3]) {
      expect(validarConfigAtipicos({ repeticion_caseta: { minCruces: n } }).ok, `N=${n}`).toBe(false);
      expect(validarConfigAtipicos({ ida_y_vuelta_madrugada: { minCruces: n } }).ok, `M=${n}`).toBe(false);
    }
    expect(validarConfigAtipicos({ repeticion_caseta: { minCruces: 2 } }).ok).toBe(true);
  });

  it('activa debe ser booleana', () => {
    expect(validarConfigAtipicos({ secuencia_imposible: { activa: 'si' } }).ok).toBe(false);
  });

  it('una fila corrupta cae a los defaults sin mutarlos', () => {
    const ef = configAtipicosEfectiva({ repeticion_caseta: { ventanaHoras: -4 } });
    expect(ef).toEqual(CONFIG_ATIPICOS_DEFAULT);
    ef.repeticion_caseta.minCruces = 99;
    expect(CONFIG_ATIPICOS_DEFAULT.repeticion_caseta.minCruces).toBe(4);
  });
});

describe('el estado del hallazgo no retrocede', () => {
  it('avanza nuevo → avisado → revisado → justificado', () => {
    expect(ESTADOS_ATIPICO).toEqual(['nuevo', 'avisado', 'revisado', 'justificado']);
    expect(puedeCambiarEstado('nuevo', 'avisado')).toBe(true);
    expect(puedeCambiarEstado('avisado', 'revisado')).toBe(true);
    expect(puedeCambiarEstado('revisado', 'justificado')).toBe(true);
    expect(puedeCambiarEstado('avisado', 'avisado')).toBe(true);
  });

  it('justificado no vuelve a nuevo (ni a nada anterior)', () => {
    for (const a of ['nuevo', 'avisado', 'revisado'] as const) expect(puedeCambiarEstado('justificado', a)).toBe(false);
    expect(estadoTrasReguardar('justificado', 'nuevo')).toBe('justificado');
    expect(estadoTrasReguardar('revisado', 'nuevo')).toBe('revisado');
    expect(estadoTrasReguardar('nuevo', 'nuevo')).toBe('nuevo');
  });

  it('revisado y justificado exigen revisor; estados desconocidos se rechazan', () => {
    expect(exigeRevisor('revisado') && exigeRevisor('justificado')).toBe(true);
    expect(exigeRevisor('nuevo') || exigeRevisor('avisado')).toBe(false);
    expect(esEstadoAtipico('cerrado')).toBe(false);
  });
});

describe('contrato SQL de la migración 0779', () => {
  const sql = readFileSync('supabase/migrations/0779_peaje_atipicos.sql', 'utf8');
  const ejecutable = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('es aditiva e idempotente: nada destructivo, todo `if not exists`', () => {
    expect(ejecutable).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete\s+from\b|\balter\s+table\s+\S+\s+drop\b/i);
    expect(ejecutable).not.toMatch(/alter\s+table\s+public\.(desglose_peaje|peaje_linea|peaje_reclamo|peaje_tag|unidad)\b/i);
    for (const t of ['peaje_atipico_config', 'peaje_atipico']) {
      expect(ejecutable).toMatch(new RegExp(`create table if not exists public\\.${t}\\b`));
    }
    expect((ejecutable.match(/create table/gi) ?? []).length).toBe(2);
    expect((ejecutable.match(/create index/gi) ?? []).length).toBe((ejecutable.match(/create index if not exists/gi) ?? []).length);
  });

  it('prende RLS en ambas tablas', () => {
    for (const t of ['peaje_atipico_config', 'peaje_atipico']) {
      expect(ejecutable).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
    }
  });

  it('config: una fila por flota, apagada de origen; hallazgos: llave única por flota y estados cerrados', () => {
    expect(ejecutable).toMatch(/tenant_id\s+uuid primary key references public\.tenant/);
    expect(ejecutable).toMatch(/activo\s+boolean not null default false/);
    expect(ejecutable).toMatch(/unique \(tenant_id, llave\)/);
    expect(ejecutable).toMatch(/estado in \('nuevo', 'avisado', 'revisado', 'justificado'\)/);
    expect(ejecutable).toMatch(/foreign key \(desglose_id, tenant_id\)/);
    for (const c of ['unidad_archivo', 'regla', 'detalle', 'monto', 'avisado_en', 'revisado_por', 'nota', 'desglose_id', 'unidad_id']) {
      expect(ejecutable).toContain(c);
    }
  });
});
