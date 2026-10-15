import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGO_PLANTILLAS } from './plantillas_catalogo';

const RAIZ = process.cwd();
const doc = readFileSync(join(RAIZ, 'docs/operacion/vigia-meta-checklist.md'), 'utf8');
const vigia = CATALOGO_PLANTILLAS.filter((p) => p.agente === 'vigia_cliente');

describe('docs/operacion/vigia-meta-checklist.md', () => {
  it('cubre exactamente las 5 plantillas del Vigía del catálogo', () => {
    expect(vigia.map((p) => p.nombre).sort()).toEqual([
      'vigia_aprobacion_v1', 'vigia_aviso_cambio_v1', 'vigia_aviso_viaje_v1',
      'vigia_escalamiento_v1', 'vigia_respuesta_cliente_v1',
    ]);
    for (const p of vigia) expect(doc).toContain(`\`${p.nombre}\``);
  });

  it('lleva el cuerpo exacto, los ejemplos y los botones de cada una (para copiar y pegar)', () => {
    for (const p of vigia) {
      expect(doc).toContain(p.cuerpo);
      for (const e of p.ejemplos) expect(doc).toContain(e);
      for (const b of p.botones) expect(doc).toContain(`«${b.texto}»`);
    }
  });

  it('no incluye plantillas de otros agentes', () => {
    for (const p of CATALOGO_PLANTILLAS.filter((x) => x.agente !== 'vigia_cliente')) {
      expect(doc).not.toContain(`\`${p.nombre}\``);
    }
  });

  it('dice categoría UTILITY, tiempos de 2–5 días hábiles y el comando que corre Javier', () => {
    expect(doc).toContain('UTILITY');
    expect(doc).toContain('2–5 días hábiles');
    expect(doc).toContain('scripts/verificar-plantillas-meta.ts --consultar');
  });

  it('no contiene llaves ni tokens (solo nombres de variables de entorno)', () => {
    expect(doc).not.toMatch(/EAA[A-Za-z0-9]{20,}/);
    expect(doc).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{20,}/);
  });

  it('el comando para someter plantillas lleva las banderas que el script exige', () => {
    const script = readFileSync(join(RAIZ, 'scripts/verificar-plantillas-meta.ts'), 'utf8');
    // El script exige consultar + confirmo-meta-real para --crear.
    expect(script).toMatch(/crear && !\(consultar && confirmado\)/);
    const linea = doc.split('\n').find((l) => l.includes('--crear'));
    expect(linea).toBeDefined();
    const cmd = /`(npx tsx scripts\/verificar-plantillas-meta\.ts[^`]*--crear[^`]*)`/.exec(linea ?? '')?.[1];
    expect(cmd).toBeDefined();
    for (const b of ['--consultar', '--crear', '--confirmo-meta-real']) expect(cmd).toContain(b);
    expect(linea).toContain('tres banderas');
    expect(linea).not.toContain('dos banderas');
  });
});
