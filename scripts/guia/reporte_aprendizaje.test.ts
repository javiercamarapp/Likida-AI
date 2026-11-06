import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'scripts/guia/reporte-aprendizaje.sql'), 'utf8');
const sinComentarios = sql.replace(/--.*$/gm, '');

describe('reporte de aprendizaje', () => {
  it('es de solo lectura: ninguna sentencia que escriba', () => {
    expect(sinComentarios).not.toMatch(/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i);
    expect(sinComentarios).toMatch(/\bselect\b/i);
  });
  it('solo lee la tabla de eventos y no pide ningún dato personal', () => {
    const tablas = [...sinComentarios.matchAll(/\b(?:from|join)\s+([a-z_.]+)/gi)].map((m) => m[1]).filter((t) => t !== 'ultimo' && t !== 'terminados' && !/^u$|^t$/.test(t));
    for (const t of tablas) expect(t).toBe('public.onboarding_evento');
    expect(sinComentarios).not.toMatch(/\b(email|correo|nombre|telefono|ip|user_agent)\b/i);
  });
  it('cubre los cuatro cortes de la especificación', () => {
    for (const k of ['iniciaron', 'por_senal', 'abandonos', 'mediana_ms']) expect(sql).toContain(k);
  });
});

describe('guía de encendido', () => {
  const doc = readFileSync(join(process.cwd(), 'docs/operacion/guia-encendido.md'), 'utf8');
  it('enciende y apaga con una sentencia, sin build ni variable de entorno', () => {
    expect(doc).toContain('invitacion = true');
    expect(doc).toContain('invitacion = false');
    expect(doc).toMatch(/Builds de Vercel: 0/);
  });
  it('declara que no se ejecutó y exige las migraciones primero', () => {
    expect(doc).toMatch(/NO ejecutado/);
    expect(doc).toContain('0983');
    expect(doc).toContain('0984');
  });
});
