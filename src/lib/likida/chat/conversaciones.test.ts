import { describe, it, expect } from 'vitest';
import { tituloDeConversacion, MAX_TITULO } from './conversaciones';

// Solo los helpers PUROS: las funciones de base de datos se prueban con el
// arnés manual (pruebas-manuales/) porque necesitan Supabase vivo — un mock
// de la base probaría el mock.
describe('tituloDeConversacion', () => {
  it('la pregunta corta queda tal cual', () => {
    expect(tituloDeConversacion('¿Cuánto llevo comprobado?')).toBe('¿Cuánto llevo comprobado?');
  });

  it('recorta a MAX_TITULO con elipsis — el panel no es lugar para un párrafo', () => {
    const larga = 'x'.repeat(200);
    const t = tituloDeConversacion(larga);
    expect(t.length).toBe(MAX_TITULO);
    expect(t.endsWith('…')).toBe(true);
  });

  it('aplana saltos de línea y espacios repetidos — el rótulo es UNA línea', () => {
    expect(tituloDeConversacion('  hola\n\n  mundo\t ya  ')).toBe('hola mundo ya');
  });

  it('nunca devuelve vacío: un botón sin texto no se puede encontrar', () => {
    expect(tituloDeConversacion('   \n  ')).toBe('Conversación');
  });
});
