import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// 1-ago-2026 · TRES ACERCAMIENTOS, TRES AVISOS IDÉNTICOS SEGUIDOS.
//
// En el primer ensayo real, tres fotos entraron como `solo_codigo` y el operador
// recibió, una tras otra:
//
//   Ya tengo el código de ese ticket 👍. Mándame también la foto del *ticket
//   completo* para registrar el gasto.
//   Ya tengo el código de ese ticket 👍. Mándame también la foto del *ticket…
//   Ya tengo el código de ese ticket 👍. Mándame también la foto del *ticket…
//
// El operador no necesita que se lo digan tres veces: necesita entender el
// protocolo una vez. Tres mensajes iguales seguidos se leen como un sistema
// atorado — y en la sala del demo, delante de quien decide la compra, eso pesa
// más que el contenido del mensaje.
//
// Es el MISMO problema que ya se había resuelto para el acuse de la ráfaga
// ("Voy recibiendo tus comprobantes"), que se ató al primer comprobante del
// viaje. Aquí faltaba aplicar el mismo criterio.
// ═══════════════════════════════════════════════════════════════════════════

const P = sinComentarios(readFileSync('src/lib/cuadra/processor.ts', 'utf8'));

describe('el aviso del acercamiento sale una vez por viaje', () => {
  it('se condiciona al PRIMER código pendiente', () => {
    const i = P.indexOf("accion === 'pedir_ticket'");
    expect(i, 'no se encontró la rama').toBeGreaterThan(0);
    const rama = P.slice(i, i + 1600);
    expect(rama).toContain('getCodigosPendientes');
    expect(rama).toMatch(/pendientes\.length <= 1/);
  });

  it('y si no se puede contar, se avisa igual', () => {
    // Perder el aviso deja al operador sin instrucción y con una foto que no
    // entró: peor que repetirlo. La degradación va hacia el lado seguro.
    const i = P.indexOf("accion === 'pedir_ticket'");
    const rama = P.slice(i, i + 1600);
    const avisos = [...rama.matchAll(/Ya tengo el código de ese ticket/g)];
    expect(avisos.length, 'falta la rama del catch').toBe(2);
  });

  it('el acuse de la ráfaga sigue atado al primer comprobante', () => {
    // El precedente del que sale este criterio. Si alguien lo cambia, los dos
    // mensajes vuelven a divergir.
    expect(P).toMatch(/registrados\.length === 1/);
    expect(P).toContain('Voy recibiendo tus comprobantes');
  });
});
