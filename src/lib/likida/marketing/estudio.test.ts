import { describe, it, expect } from 'vitest';
import { DatoInvalido } from '../errores';
import {
  partirCopyPorCanal, validarFotoReferencia, esTipoReferencia,
  MIME_IMAGEN_REFERENCIA, MIME_VIDEO_HOOK, TOPE_IMAGEN_BYTES, AGENTES_ESTUDIO,
} from './estudio';

// ═══════════════════════════════════════════════════════════════════════════
// EL ESTUDIO DE MARKETING (0266) — las partes PURAS: partir el copy por
// canal (lo que decide si una tarjeta pinta "General" o pinta LinkedIn/
// Instagram/TikTok por separado) y las validaciones de subida que corren
// ANTES de tocar Storage. Nada de red ni de base aquí a propósito.
// ═══════════════════════════════════════════════════════════════════════════

describe('partirCopyPorCanal — nunca inventa una estructura que el agente no dio', () => {
  it('parte el formato EXACTO que copyPorCanal()/armarPromoDiaria() escriben en crecimiento.ts', () => {
    const cuerpo = [
      '── LinkedIn ──',
      'El 50% de tus casetas, conciliado.',
      '',
      'Cómo lo sostenemos: con $11,600 de casetas el motor devuelve $50 de estímulo.',
      '── Instagram ──',
      'El 50% de tus casetas.',
      '── TikTok ──',
      'El 50%.',
    ].join('\n');
    const bloques = partirCopyPorCanal(cuerpo);
    expect(bloques).not.toBeNull();
    expect(bloques!.map((b) => b.canal)).toEqual(['LinkedIn', 'Instagram', 'TikTok']);
    expect(bloques![0].texto).toContain('El 50% de tus casetas, conciliado.');
    expect(bloques![0].texto).toContain('Cómo lo sostenemos');
    expect(bloques![2].texto).toBe('El 50%.');
  });

  it('un guion o un encargo (sin marcadores de canal) devuelve null — no se inventa un canal "General"', () => {
    const guion = 'GUION SEMANAL — semana del 2026-08-24\n\nTema: algo\n\nESCENAS...';
    expect(partirCopyPorCanal(guion)).toBeNull();
  });

  it('cuerpo vacío también devuelve null, no un arreglo vacío con forma de bloques', () => {
    expect(partirCopyPorCanal('')).toBeNull();
  });
});

describe('AGENTES_ESTUDIO — el recorte a piezas que de verdad se "publican"', () => {
  it('incluye los seis agentes de contenido y excluye los de diagnóstico interno y el de blog-por-PR', () => {
    expect(AGENTES_ESTUDIO).toEqual([
      'guiones', 'noticias_mercado', 'promos_diarias', 'visuales', 'video_demo', 'video_marketing',
    ]);
    expect(AGENTES_ESTUDIO).not.toContain('lead_magnet');
    expect(AGENTES_ESTUDIO).not.toContain('seo_distribucion');
    expect(AGENTES_ESTUDIO).not.toContain('alianzas');
    expect(AGENTES_ESTUDIO).not.toContain('contenido_fiscal');
  });
});

describe('validarFotoReferencia — la puerta ANTES de Storage', () => {
  it('acepta jpg/png/webp bajo el tope', () => {
    for (const mime of MIME_IMAGEN_REFERENCIA) {
      expect(() => validarFotoReferencia(mime, 1024)).not.toThrow();
    }
  });

  it('rechaza un tipo fuera del dominio (ej. svg, riesgo de XSS almacenado en bucket servido)', () => {
    expect(() => validarFotoReferencia('image/svg+xml', 1024)).toThrow(DatoInvalido);
  });

  it('rechaza un archivo por encima del tope, aunque el tipo sea válido', () => {
    expect(() => validarFotoReferencia('image/png', TOPE_IMAGEN_BYTES + 1)).toThrow(DatoInvalido);
  });
});

describe('MIME_VIDEO_HOOK — el dominio espeja el allowed_mime_types de la migración 0266', () => {
  it('acepta mp4/mov/webm/m4v y nada más', () => {
    expect(MIME_VIDEO_HOOK.has('video/mp4')).toBe(true);
    expect(MIME_VIDEO_HOOK.has('video/quicktime')).toBe(true);
    expect(MIME_VIDEO_HOOK.has('video/webm')).toBe(true);
    expect(MIME_VIDEO_HOOK.has('video/x-m4v')).toBe(true);
    expect(MIME_VIDEO_HOOK.has('application/pdf')).toBe(false);
  });
});

describe('esTipoReferencia', () => {
  it('solo personaje y lugar son válidos', () => {
    expect(esTipoReferencia('personaje')).toBe(true);
    expect(esTipoReferencia('lugar')).toBe(true);
    expect(esTipoReferencia('vehiculo')).toBe(false);
    expect(esTipoReferencia('')).toBe(false);
  });
});
