import { describe, it, expect } from 'vitest';
import { revisarAvisoIntegral, pideAtencionPrivacidad } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 6 · los dos ALTOS del rubro legal.
// ═══════════════════════════════════════════════════════════════════════════

describe('el filtro de rellenos no puede apagar dominios reales', () => {
  // `'pendiente'` y `'todo'` se buscaban como SUBSTRING sobre la URL completa, y
  // viven dentro de palabras españolas normales: in-de-PENDIENTE, me-TODO-logía.
  // "Independiente" es exactamente como se anuncia media flota mexicana — el
  // segmento que censó Likida.
  //
  // El coste no era cosmético: al marcar la liga inservible, el aviso salía
  // diciendo que la empresa NO ha publicado su aviso integral (afirmación falsa
  // sobre el cumplimiento del cliente) y el operador se quedaba sin el canal
  // ARCO del art. 15 fr. V teniendo uno publicado.
  const reales = [
    'https://transportistaindependiente.mx/aviso-de-privacidad',
    'https://autotransportesindependientes.com.mx/privacidad',
    'https://operadorindependiente.mx/aviso',
    'https://metodologiatransporte.mx/aviso',
    'https://grupotodovia.mx/aviso',
  ];
  for (const u of reales) {
    it(`pasa: ${u.replace('https://', '').slice(0, 40)}`, () => {
      expect(revisarAvisoIntegral(u)).toBe('ok');
    });
  }

  const rellenos: [string, string][] = [
    ['dominio de plantilla', 'https://example.com/aviso'],
    ['plantilla en español', 'https://ejemplo.mx/x'],
    ['tudominio', 'https://tudominio.com/aviso'],
    ['la palabra suelta en la ruta', 'https://miempresa.mx/aviso-pendiente'],
    ['la palabra suelta en el query', 'https://miempresa.mx/?url=todo'],
    ['marcador de "falta capturar"', 'https://miempresa.mx/cambiar'],
    ['no es público', 'http://localhost:3000/aviso'],
    ['ni siquiera es URL', 'no-es-url'],
  ];
  for (const [etq, u] of rellenos) {
    it(`sigue cayendo — ${etq}`, () => {
      expect(revisarAvisoIntegral(u)).not.toBe('ok');
    });
  }

  it('sin liga es "ausente", que NO es lo mismo que inservible', () => {
    // Ausente = la empresa no lo ha publicado. Inservible = puso algo que no
    // sirve. El aviso dice cosas distintas y por eso no se pueden juntar.
    expect(revisarAvisoIntegral(undefined)).toBe('ausente');
    expect(revisarAvisoIntegral('  ')).toBe('ausente');
  });
});

describe('la oposición del art. 26 fr. II se reconoce como se habla', () => {
  // El detector veía el presente ("me opongo") y el infinitivo con clítico
  // pegado ("oponerme"), y no la PERÍFRASIS, que es la forma natural en español
  // hablado. El clítico va suelto y antes del verbo, así que `\boponerme\b` no
  // podía casarlo, y el derecho se perdía sin dejar rastro.
  const ejercen = [
    'me quiero oponer',
    'no me quiero oponer',          // también es ejercicio del derecho
    'quisiera oponerme',
    'me voy a oponer',
    'me gustaría oponerme a eso',
    'me opongo',
    'oponerme',
    'no quiero que me revisen mis tickets con un programa',
    'quiero que lo revise una persona',
    'PRIVACIDAD',
  ];
  for (const t of ejercen) {
    it(`lo atiende: "${t}"`, () => expect(pideAtencionPrivacidad(t)).toBe(true));
  }

  // Se exige la forma de PETICIÓN para no secuestrar la conversación normal de
  // la caseta. Un falso positivo manda una respuesta que el operador no pidió.
  const noEjercen = [
    'listo',
    'mándame mi liquidación',
    'la persona de la caseta no me dio ticket',
    'me quiero ir a Monterrey',
    'opongo mi camión al muro',
  ];
  for (const t of noEjercen) {
    it(`no lo confunde: "${t}"`, () => expect(pideAtencionPrivacidad(t)).toBe(false));
  }
});
