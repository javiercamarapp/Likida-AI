import { describe, it, expect } from 'vitest';
import { armarEscalacion } from './solicitudes';
import type { HitoFila } from './tipos';
import type { ViajeContexto } from './repo';

// AUDITORÍA 32 · c17 · AGE-C17-A1 (ALTO, REINCIDENTE c14·c15·c16) —
// LA TABLA DE CLAIMS LEÍDA COMO LIBRO DE ENTREGAS.
//
// `viaje_hito_aviso` sirve de DOS cosas: llave de idempotencia (que la escalera
// no mande el mismo aviso dos veces) y evidencia de entrega. `leerAvisosDeHitos`
// no proyectaba `ok`, así que el contador de `ejecutor.ts` sumaba también los
// avisos que NO salieron, y el jefe de tráfico recibía:
//
//   «Juan no ha registrado «su llegada a cargar» del viaje F-1041
//    (sin respuesta a 3 avisos)»
//
// con el teléfono de Juan mal capturado y CERO mensajes entregados. El jefe le
// reclama tres mensajes que nunca existieron. Rompe «un rótulo tiene que ser
// verdad» en el único canal por el que el producto le habla al mando de la flota.
//
// El repo ya tenía la respuesta correcta a un paso: `armarSenalVida`
// (`solicitudes.ts:184`) recibe `avisosEntregados` y su comentario dice
// «un rechazo definitivo no es "se le avisó"». Esta prueba ancla que
// `armarEscalacion` cuenta lo mismo: ENTREGAS.

const HITO = { id: 'h-1', tipo: 'llegada_carga', ciclo: 1 } as unknown as HitoFila;
const VIAJE = { id: 'v-1', folio: 'F-1041', operadorNombre: 'Juan' } as unknown as ViajeContexto;

describe('AGE-C17-A1 — el texto al jefe cuenta avisos ENTREGADOS', () => {
  it('con 0 entregados NO dice «sin respuesta a N avisos»: no se le pudo avisar', () => {
    const m = armarEscalacion(HITO, VIAJE, 1, 'sin_respuesta', 0, 'Monterrey');
    expect(m.texto).not.toMatch(/sin respuesta a \d+ aviso/);
    expect(m.texto).toMatch(/no se le pudo avisar/i);
  });

  it('con 1 y con 3 entregados sí lo dice, en singular y plural', () => {
    expect(armarEscalacion(HITO, VIAJE, 1, 'sin_respuesta', 1, 'MTY').texto).toContain('sin respuesta a 1 aviso)');
    expect(armarEscalacion(HITO, VIAJE, 1, 'sin_respuesta', 3, 'MTY').texto).toContain('sin respuesta a 3 avisos');
  });

  it('los otros dos motivos no dependen del conteo', () => {
    expect(armarEscalacion(HITO, VIAJE, 1, 'problema_reportado', 0, 'MTY').texto).not.toMatch(/sin respuesta|no se le pudo avisar/);
    expect(armarEscalacion(HITO, VIAJE, 1, 'sin_telefono', 0, 'MTY').texto).not.toMatch(/sin respuesta a/);
  });
});
