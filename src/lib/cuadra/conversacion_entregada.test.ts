import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// EL AGENTE RECORDABA HABER DICHO COSAS QUE NADIE LEYÓ.
//
// Lo encontró Javier usando el producto, no una prueba: mandó un mensaje y el
// agente "recordó" un saludo anterior que él nunca había recibido.
//
// La cadena completa:
//
//   1. su primer "hola" llegó bien y el pipeline lo procesó,
//   2. la RESPUESTA la rechazó Meta con `131030` (número fuera de la lista
//      permitida, porque la app está en dev_mode),
//   3. `sendText` NO lanza ante eso: devuelve `null`,
//   4. `say()` tiraba ese resultado, así que un mensaje rebotado se trataba
//      igual que uno entregado,
//   5. `saveConversation` guardaba el turno del asistente de todas formas.
//
// Resultado: la base afirmaba una conversación que solo existió de este lado. El
// agente contestaba el siguiente mensaje desde un contexto que el operador nunca
// vio — y en un cierre eso significa dar por avisado algo que no se avisó.
//
// Y de paso se cobraba el costo de un mensaje que no salió, inflando el costo
// por liquidación.
//
// ES LA MISMA FAMILIA que la constancia falsa del aviso de privacidad, cerrada
// esta misma semana: registrar como hecho algo que no ocurrió. Ahí la fila decía
// que un operador recibió su aviso; aquí la conversación dice que se le habló.
// ═══════════════════════════════════════════════════════════════════════════

const P = sinComentarios(readFileSync('src/lib/cuadra/processor.ts', 'utf8'));

describe('la conversación guarda lo que el operador leyó', () => {
  it('`say` devuelve si el mensaje SALIÓ', () => {
    // Sin valor de retorno, quien llama no puede distinguir. `sendText` ya
    // devolvía `null` ante el rechazo; lo que faltaba era mirarlo.
    expect(P).toMatch(/const say = async \(text: string\): Promise<boolean>/);
    expect(P).toMatch(/if \(!id\) return false;/);
  });

  it('y solo cobra lo que salió', () => {
    // El `registrarCostoWhatsApp` tiene que quedar DESPUÉS del `if (!id)`, o se
    // sigue cobrando el mensaje rebotado.
    const i = P.indexOf('const say = async');
    const cuerpo = P.slice(i, i + 400);
    expect(cuerpo.indexOf('if (!id) return false;')).toBeLessThan(cuerpo.indexOf('registrarCostoWhatsApp'));
  });

  it('el turno del asistente NO se guarda si rebotó', () => {
    expect(P).toMatch(/const entregado = await say\(reply\)/);
    expect(P).toMatch(/entregado \? \[\.\.\.turns, \{ role: 'assistant', content: reply \}\] : turns/);
  });

  it('pero los turnos del OPERADOR sí se guardan siempre', () => {
    // Ésos sí ocurrieron. Perderlos borraría lo único que él sí mandó, y el
    // arreglo se habría comido el problema en vez de resolverlo.
    const i = P.indexOf('await saveConversation(');
    expect(P.slice(i, i + 200)).toContain(': turns');
  });

  it('y un rebote deja rastro para que alguien pueda verlo', () => {
    // Sin esto el arreglo es silencioso: el operador no recibe nada y de este
    // lado tampoco hay señal. Ahora sube a Sentry.
    expect(P).toMatch(/wa\.respuesta_no_entregada/);
  });
});
