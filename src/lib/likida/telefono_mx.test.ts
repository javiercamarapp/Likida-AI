import { describe, it, expect } from 'vitest';
import { variantesTelefono } from './conv';

// EL FALLO QUE ESTO EVITA — detectado antes de la primera prueba real por
// WhatsApp (28-jul-2026), no después.
//
// La búsqueda del operador es una igualdad exacta contra `operador.telefono`.
// México arrastra el "1" entre la lada de país y el celular: el mismo número
// llega como 529993700779 o 5219993700779 según por dónde entre. Con una sola
// forma capturada, la otra responde "no te tengo registrado" — una frase que
// suena a dato mal capturado, con el webhook devolviendo 200 y sin un solo
// error en los logs. Es de los fallos más caros de diagnosticar en una demo.

describe('variantes de teléfono mexicano', () => {
  it('un número con el 1 también se busca sin el 1', () => {
    expect(variantesTelefono('5219993700779')).toContain('529993700779');
  });

  it('un número sin el 1 también se busca con el 1', () => {
    expect(variantesTelefono('529993700779')).toContain('5219993700779');
  });

  it('siempre incluye lo que mandó Meta, tal cual', () => {
    expect(variantesTelefono('529993700779')).toContain('529993700779');
  });

  it('acepta el formato con + y separadores que se captura a mano', () => {
    const v = variantesTelefono('+52 999 370 0779');
    expect(v).toContain('529993700779');
    expect(v).toContain('5219993700779');
  });

  it('no repite variantes', () => {
    const v = variantesTelefono('529993700779');
    expect(new Set(v).size).toBe(v.length);
  });

  // EL CASO DE LA SEMILLA DEL DEMO. Los operadores están guardados con "+" y
  // Meta manda el wa_id sin él. Con igualdad exacta, ninguno resolvía.
  it('encuentra al operador guardado con "+" aunque Meta mande sin él', () => {
    expect(variantesTelefono('521111111101')).toContain('+521111111101');
  });

  it('y al revés: guardado sin "+", recibido con "+"', () => {
    expect(variantesTelefono('+529993700779')).toContain('529993700779');
  });

  // El límite: esto es una regla de México, no una licencia para quitar dígitos
  // de cualquier país. De otra lada solo se prueban las dos formas del signo.
  it('no inventa variantes de dígitos para números que no son mexicanos', () => {
    expect(variantesTelefono('15556596430').sort()).toEqual(['+15556596430', '15556596430']);
    expect(variantesTelefono('34600123456').sort()).toEqual(['+34600123456', '34600123456']);
  });

  it('no inventa variantes cuando la longitud no cuadra', () => {
    expect(variantesTelefono('52999').sort()).toEqual(['+52999', '52999']);
  });
});
