import { describe, it, expect } from 'vitest';
import { fundamentarBloques, type Bloque } from './analista';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA FABLE CICLO 3 (c3-1, ALTO) — la guardia de FUNDAMENTO en el panel.
//
// La 0209 afirmaba que "guardiaFundamento sigue siendo el candado" también en
// el chat del panel, y era falso: solo corría en WhatsApp. Con
// `consultar_normas` invitando preguntas legales a este canal, el modelo podía
// citar "el artículo 28 de la LISR" de memoria y salía entero — la fracción no
// es cifra y la única defensa era el prompt. Estas pruebas fijan el candado
// como PROPIEDAD DEL CÓDIGO, sin LLM (el molde de analista_guardia.test.ts).
// ═══════════════════════════════════════════════════════════════════════════

const SIN_HISTORIAL = '';

describe('fundamentarBloques — el candado de citas del panel', () => {
  it('BLOQUEA la cita legal que ninguna tool devolvió en el turno', () => {
    const bloques: Bloque[] = [{
      tipo: 'texto',
      texto: 'No son deducibles los viáticos en efectivo conforme al artículo 28 de la LISR.',
    }];
    const g = fundamentarBloques(bloques, [], SIN_HISTORIAL);
    expect(g.quitadas.length).toBeGreaterThan(0);
    expect(g.bloques[0]).not.toEqual(bloques[0]);           // el texto cambió
    // Lo que la guardia garantiza (mismo contrato que en WhatsApp): el número
    // de artículo tecleado de memoria NO sale hacia el contralor.
    expect((g.bloques[0] as { texto: string }).texto).not.toMatch(/artículo\s*28/i);
  });

  it('deja pasar la cita que la tool SÍ devolvió (consultar_normas)', () => {
    const bloques: Bloque[] = [{
      tipo: 'texto',
      texto: 'El acreditamiento exige requisitos: LIVA art. 5.',
    }];
    // La forma real del resultado de la tool: normas con su norma_id.
    const g = fundamentarBloques(bloques, [{ normas: [{ norma_id: 'liva-art-5', cita: 'LIVA art. 5' }] }], SIN_HISTORIAL);
    expect(g.quitadas).toEqual([]);
    expect((g.bloques[0] as { texto: string }).texto).toContain('LIVA art. 5');
  });

  it('los bloques que no son texto pasan intactos — la guardia es de prosa', () => {
    const bloques: Bloque[] = [
      { tipo: 'cifra', valor: 8340.5, formato: 'mxn' },
      { tipo: 'tabla', filas: [['Diésel', 12_000]] },
    ];
    const g = fundamentarBloques(bloques, [], SIN_HISTORIAL);
    expect(g.bloques).toEqual(bloques);
    expect(g.quitadas).toEqual([]);
  });

  it('la memoria por tema vive: repetir la cita YA entregada en este chat no es alucinar', () => {
    const oracion = 'El acreditamiento del IVA exige requisitos del artículo 5 de la LIVA.';
    const g = fundamentarBloques([{ tipo: 'texto', texto: oracion }], [], oracion);
    expect((g.bloques[0] as { texto: string }).texto).toBe(oracion);
    expect(g.quitadas).toEqual([]);
  });

  it('un bloque que era PURA cita inventada no sale vacío: cae el aviso honesto', () => {
    const g = fundamentarBloques([{ tipo: 'texto', texto: 'LISR 28-XX.' }], [], SIN_HISTORIAL);
    expect(g.bloques.length).toBeGreaterThan(0);
    for (const b of g.bloques) {
      if (b.tipo === 'texto') expect(b.texto.trim()).not.toBe('');
    }
  });
});
