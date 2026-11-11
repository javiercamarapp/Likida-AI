/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes del propio repo */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// F16 (revisión del portafolio, 10-nov-2026): el historial de la conversación
// llega del NAVEGADOR. Si sus turnos con rol 'asistente' alimentan el respaldo
// de la guardia de cifras, cualquiera que fabrique un turno «del asistente» con
// una cifra la hace pasar como respaldada — exactamente lo que la guardia existe
// para impedir. El respaldo acepta tools, calendario, adjuntos y SOLO lo que el
// usuario escribió. Esta prueba lee el fuente porque el armado del respaldo vive
// dentro del ciclo del modelo (sin LLM no se ejercita de otra forma).
// ═══════════════════════════════════════════════════════════════════════════

const fuente = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe.each(['analista.ts', 'copiloto.ts'])('%s: respaldo de la guardia', (archivo) => {
  const s = fuente(archivo);
  it('los mensajes del historial solo respaldan si son del usuario', () => {
    expect(s).toContain("opts.mensajes.filter((m) => m.rol === 'usuario').map((m) => m.texto).join(' '), respaldo");
  });
  it('ningún armado del respaldo toma el historial completo sin filtrar por rol', () => {
    expect(s).not.toContain("extraerNumeros(opts.mensajes.map((m) => m.texto)");
  });
});
