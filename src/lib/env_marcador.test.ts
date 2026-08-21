import { describe, it, expect, afterEach } from 'vitest';
import { envPuesta } from './env';
import { modelFor } from './llm/models';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 1, CRÍTICO (Operabilidad) — el 20-ago seis variables de Vercel
// quedaron con el valor literal "[SENSITIVE]" (el enmascarado del dashboard,
// re-guardado). `!!process.env[k]` las daba por puestas; `modelFor` devolvía
// "[SENSITIVE]" como slug y OpenRouter respondía 400 → el OCR facturó cero.
// ═══════════════════════════════════════════════════════════════════════════

const LIMPIAR: string[] = [];
afterEach(() => { for (const k of LIMPIAR) delete process.env[k]; LIMPIAR.length = 0; });
function set(k: string, v: string) { process.env[k] = v; LIMPIAR.push(k); }

describe('envPuesta — rechaza marcadores, no solo la ausencia', () => {
  it('un valor real es puesta', () => {
    set('X_TEST_REAL', 'sk-or-v1-abc123');
    expect(envPuesta('X_TEST_REAL')).toBe(true);
  });
  it('"[SENSITIVE]" NO es puesta (el enmascarado de Vercel)', () => {
    set('X_TEST_MASK', '[SENSITIVE]');
    expect(envPuesta('X_TEST_MASK')).toBe(false);
  });
  it('vacío, espacios y plantillas sin llenar tampoco', () => {
    set('X_A', ''); set('X_B', '   '); set('X_C', '<tu-token>'); set('X_D', 'your-key-here');
    expect(envPuesta('X_A')).toBe(false);
    expect(envPuesta('X_B')).toBe(false);
    expect(envPuesta('X_C')).toBe(false);
    expect(envPuesta('X_D')).toBe(false);
  });
  it('ausente es no-puesta', () => {
    expect(envPuesta('X_NO_EXISTE_XYZ')).toBe(false);
  });
});

describe('modelFor — un override marcador cae al default, no rompe la llamada', () => {
  it('LIKIDA_MODEL_OCR="[SENSITIVE]" usa el slug default, no "[SENSITIVE]"', () => {
    set('LIKIDA_MODEL_OCR', '[SENSITIVE]');
    const m = modelFor('ocr');
    expect(m).not.toBe('[SENSITIVE]');
    expect(m).toContain('/'); // un slug real de OpenRouter (proveedor/modelo)
  });
  it('un override REAL sí se respeta', () => {
    set('LIKIDA_MODEL_OCR', 'google/gemini-3.1-flash-lite');
    expect(modelFor('ocr')).toBe('google/gemini-3.1-flash-lite');
  });
});
