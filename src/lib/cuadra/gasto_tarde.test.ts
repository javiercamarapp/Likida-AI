import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { violaIndice, llegoTarde, GASTO_TARDE, UNIQUE_VIOLATION } from './pg_errores';
import { sinComentarios } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// EL ÚLTIMO CRÍTICO DE CÓDIGO DE LAS SIETE RONDAS.
//
// El texto de WhatsApp y el PDF de la misma respuesta salían de dos lecturas
// distintas de la base, con segundos entre medias y la tabla `gasto` abierta:
//
//   T1  guardar_liquidacion → 5 gastos, $4,850 → PDF "Sobró $150.00"
//   T2  guardiaCifras       → 6 gastos, $5,650 → chat "Pusiste $650.00"
//
// El operador recibía las dos seguidas, con $800 de diferencia y DE SIGNO
// CONTRARIO, y el sexto gasto quedaba huérfano de por vida.
//
// El arreglo vive en la base (0036) porque en TypeScript sería comprobar y
// luego escribir, con la carrera justo en medio. Aquí se fija lo que le toca a
// este lado: distinguir ese error de los benignos y decírselo al operador.
// ═══════════════════════════════════════════════════════════════════════════

describe('llegar tarde no es lo mismo que estar repetido', () => {
  const tarde = { code: GASTO_TARDE, message: 'el viaje ya tiene liquidación emitida' };
  const dupFoto = { code: UNIQUE_VIOLATION, message: 'duplicate key ... "uq_gasto_img_hash"' };

  it('el gasto tardío se reconoce por su código propio', () => {
    expect(llegoTarde(tarde)).toBe(true);
  });

  it('y NO se confunde con un duplicado, que sí es benigno', () => {
    // La distinción es la que decide si el operador se entera. Un duplicado se
    // ignora en silencio porque el gasto YA está registrado; el tardío no está
    // en ningún lado, y callárselo le quita el dinero sin avisarle.
    expect(llegoTarde(dupFoto)).toBe(false);
    expect(violaIndice(tarde, 'uq_gasto_img_hash')).toBe(false);
  });

  it('ni con un error cualquiera, que tiene que seguir subiendo', () => {
    expect(llegoTarde({ code: '42P01', message: 'relation does not exist' })).toBe(false);
    expect(llegoTarde(new Error('boom'))).toBe(false);
    expect(llegoTarde(null)).toBe(false);
    expect(llegoTarde('CU001')).toBe(false);   // una cadena no es un error
  });
});

describe('el processor se lo dice al operador', () => {
  const P = sinComentarios(readFileSync('src/lib/cuadra/processor.ts', 'utf8'));

  it('manda un mensaje en vez de tragárselo', () => {
    // El `return` silencioso es correcto para los dos duplicados de arriba y
    // sería el error entero aquí: el gasto no quedó en ningún lado.
    const i = P.indexOf('llegoTarde(e)');
    expect(i, 'el processor no distingue el gasto tardío').toBeGreaterThan(0);
    const rama = P.slice(i, i + 700);
    expect(rama, 'no le avisa al operador').toContain('sendText');
    expect(rama).toMatch(/llegó después|llegó tarde|NO entró/i);
  });

  it('le dice qué HACER, no solo que falló', () => {
    // Un aviso sin salida es una mala noticia; con salida es una instrucción.
    const rama = P.slice(P.indexOf('llegoTarde(e)'), P.indexOf('llegoTarde(e)') + 700);
    expect(rama).toMatch(/siguiente viaje|la oficina/i);
  });

  it('y el monto va en el mensaje, formateado por `formato.ts`', () => {
    const rama = P.slice(P.indexOf('llegoTarde(e)'), P.indexOf('llegoTarde(e)') + 700);
    expect(rama).toContain('mxn(gasto.monto)');
  });
});
