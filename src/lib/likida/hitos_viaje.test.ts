import { describe, it, expect } from 'vitest';
import { interpretarHito, mensajeHito } from './hitos_viaje';

// Solo el motor PURO: el sello (UPDATE ... IS NULL) es el patrón 0058/0087 y
// su atomicidad es de Postgres; el cableado se prueba en processor_hitos.

describe('interpretarHito — las frases reales del chofer', () => {
  it('llegada, con y sin acento, con y sin "ya"', () => {
    expect(interpretarHito('llegué')).toBe('llegada');
    expect(interpretarHito('ya llegue')).toBe('llegada');
    expect(interpretarHito('Ya llegamos')).toBe('llegada');
    expect(interpretarHito('ya estoy aquí')).toBe('llegada');
    expect(interpretarHito('en destino')).toBe('llegada');
  });

  it('descarga y regreso', () => {
    expect(interpretarHito('descargando')).toBe('descarga');
    expect(interpretarHito('Estoy descargando')).toBe('descarga');
    expect(interpretarHito('en descarga')).toBe('descarga');
    expect(interpretarHito('voy de regreso')).toBe('regreso');
    expect(interpretarHito('ya de vuelta')).toBe('regreso');
    expect(interpretarHito('regresando')).toBe('regreso');
  });

  it('la puntuación y los emojis no estorban', () => {
    expect(interpretarHito('¡Ya llegué!')).toBe('llegada');
    expect(interpretarHito('descargando 📦')).toBe('descarga');
  });

  it('una PREGUNTA nunca sella', () => {
    expect(interpretarHito('¿ya llegué?')).toBeNull();
    expect(interpretarHito('ya llegaste?')).toBeNull();
  });

  it('lo que trae más contexto NO es un hito — sigue al agente', () => {
    // "llegué a cargar diésel" no es el destino, y comerse ese mensaje le
    // quitaría al agente un texto que sí necesita.
    expect(interpretarHito('llegué a cargar diésel en Querétaro')).toBeNull();
    expect(interpretarHito('ya llegué a Monterrey y descargué dos tarimas')).toBeNull();
  });

  it('los mensajes del cierre NO se confunden con hitos', () => {
    expect(interpretarHito('listo')).toBeNull();
    expect(interpretarHito('ya')).toBeNull();
    expect(interpretarHito('ya quedó')).toBeNull();
  });

  it('vacío, undefined y textos largos devuelven null', () => {
    expect(interpretarHito(undefined)).toBeNull();
    expect(interpretarHito('')).toBeNull();
    expect(interpretarHito('x'.repeat(41))).toBeNull();
  });
});

describe('mensajeHito — el acuse con la hora de México', () => {
  // 16:32Z = 10:32 en CDMX (UTC-6).
  const ahora = new Date('2026-08-12T16:32:00Z');

  it('sellado: dice la hora anotada y el siguiente paso', () => {
    expect(mensajeHito('llegada', 'sellado', ahora)).toContain('llegaste a las 10:32');
    expect(mensajeHito('descarga', 'sellado', ahora)).toContain('descargando desde las 10:32');
    expect(mensajeHito('regreso', 'sellado', ahora)).toContain('de regreso desde las 10:32');
  });

  it('repetido: no miente con una hora nueva', () => {
    expect(mensajeHito('llegada', 'ya_estaba', ahora)).toBe('Ya lo tenía anotado. 👍');
  });

  it('fallo: se dice, no se finge el sello', () => {
    expect(mensajeHito('descarga', 'fallo', ahora)).toContain('No pude anotarlo');
  });
});
