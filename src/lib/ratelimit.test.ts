import { describe, it, expect, afterEach, vi } from 'vitest';
import { rateLimit, bodyExcede, reiniciarLimites } from './ratelimit';

afterEach(() => { reiniciarLimites(); vi.useRealTimers(); });

describe('rateLimit', () => {
  it('permite hasta el límite y luego bloquea', () => {
    const k = 'unit-key-A';
    for (let i = 0; i < 3; i++) expect(rateLimit(k, 3, 60_000)).toBe(true);
    expect(rateLimit(k, 3, 60_000)).toBe(false); // 4to → bloqueado
  });
  it('llaves distintas no interfieren', () => {
    expect(rateLimit('unit-key-B', 1, 60_000)).toBe(true);
    expect(rateLimit('unit-key-C', 1, 60_000)).toBe(true);
    expect(rateLimit('unit-key-B', 1, 60_000)).toBe(false);
  });
  it('la ventana se desliza: pasado el minuto vuelve a permitir', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    expect(rateLimit('unit-key-D', 1, 60_000)).toBe(true);
    expect(rateLimit('unit-key-D', 1, 60_000)).toBe(false);
    vi.setSystemTime(60_001);
    expect(rateLimit('unit-key-D', 1, 60_000)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL BACKSTOP DE MEMORIA BORRABA BLOQUEOS VIVOS.
//
// La poda recorría el Map y borraba «el primer cuarto», y un Map conserva el
// orden de INSERCIÓN (un `set` sobre una llave existente no la mueve al final).
// O sea: borraba las llaves que se vieron primero, vivas o muertas. Quien
// estuviera bloqueado desde el principio recuperaba sus intentos por el simple
// hecho de que llegara tráfico nuevo.
// ═══════════════════════════════════════════════════════════════════════════
describe('poda del backstop de memoria', () => {
  it('un bloqueo vivo sobrevive a la avalancha de llaves que ya caducaron', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    // La víctima: primera llave insertada, bloqueada, con ventana larga.
    expect(rateLimit('acceso:1.2.3.4', 1, 60_000)).toBe(true);
    expect(rateLimit('acceso:1.2.3.4', 1, 60_000)).toBe(false);

    // 5 200 llaves de ventana corta: pasan de MAX_KEYS y disparan la poda.
    vi.setSystemTime(5_000);
    for (let i = 0; i < 5_200; i++) rateLimit(`ruido:${i}`, 1, 1_000);

    // Con la poda por orden de alta, la víctima era la PRIMERA en caer y esto
    // devolvía true. Con la poda por caducidad, sigue bloqueada.
    expect(rateLimit('acceso:1.2.3.4', 1, 60_000)).toBe(false);
  });
});

describe('bodyExcede', () => {
  it('detecta cuerpo grande por content-length', () => {
    const big = new Request('http://x', { method: 'POST', headers: { 'content-length': '999999' } });
    const small = new Request('http://x', { method: 'POST', headers: { 'content-length': '100' } });
    expect(bodyExcede(big, 1000)).toBe(true);
    expect(bodyExcede(small, 1000)).toBe(false);
  });
});
