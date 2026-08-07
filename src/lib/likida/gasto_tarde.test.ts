import { describe, it, expect } from 'vitest';
import { violaIndice, llegoTarde, GASTO_TARDE, UNIQUE_VIOLATION } from './pg_errores';

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
//
// AUDITORÍA 8, ALTO (pruebas): este archivo tenía un segundo describe,
// "el processor se lo dice al operador", que probaba el TEXTO fuente de
// `processor.ts` (`P.slice(...).toContain('sendText')`) en vez de ejecutarlo.
// Un `if (llegoTarde(e))` mudo a `if (false && llegoTarde(e))` dejaba el
// texto vecino intacto y esas tres pruebas seguían verdes — verificado
// aplicando ese mutante exacto. Se reemplazó por `foto_llego_tarde.test.ts`,
// que corre `processInbound` de verdad con `addGasto` lanzando el CU001 real
// y verifica la RESPUESTA, no el código fuente. Aquí solo quedan las
// funciones puras.
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

// El comportamiento real —"manda un mensaje en vez de tragárselo", "dice qué
// HACER", "el monto va formateado"— vive ahora en foto_llego_tarde.test.ts
// (imagen) y xml_llego_tarde.test.ts (documento/XML), corriendo
// `processInbound` de verdad. Ver la nota de arriba.
