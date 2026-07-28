import { describe, it, expect } from 'vitest';
import { avisoSimplificado, versionAviso, pideAtencionPrivacidad, respuestaPrivacidad, type DatosResponsable } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// B19 — El aviso de privacidad no existía en ningún punto del flujo.
//
// Quién debe darlo: el RESPONSABLE, que es la FLOTA (LFPDPPP art. 14). Likida
// es persona encargada (art. 2 fr. XII) y trata los datos por cuenta de ella.
// Así que esto NO es el aviso de Likida: es el mecanismo para que la flota
// ponga el SUYO, que sin producto no puede aunque quiera.
//
// Qué exige el canal: los datos entran por WhatsApp, o sea por medio
// electrónico, así que aplica el art. 16 fr. II — modalidad SIMPLIFICADA con al
// menos las fracciones I a IV del art. 15, más dónde consultar el integral. El
// aviso completo NO va en un mensaje de WhatsApp.
// ═══════════════════════════════════════════════════════════════════════════
const flota: DatosResponsable = {
  razonSocial: 'TRANSPORTES DEL SURESTE SA DE CV',
  domicilio: 'Av. Itzáes 500, Mérida, Yucatán',
  urlAvisoIntegral: 'https://transportesdelsureste.mx/privacidad',
};

describe('avisoSimplificado', () => {
  it('trae las cuatro fracciones que exige el art. 16 fr. II', () => {
    const a = avisoSimplificado(flota)!;
    expect(a).toContain(flota.razonSocial);        // fr. I  — identidad
    expect(a).toContain(flota.domicilio);          // fr. I  — domicilio
    expect(a).toMatch(/foto|comprobante|gasto/i);  // fr. II — qué datos
    expect(a).toMatch(/liquid/i);                  // fr. III — para qué
    expect(a).toMatch(/whatsapp|escrib|respond/i); // fr. IV — cómo limitar
  });

  it('señala dónde está el aviso integral', () => {
    expect(avisoSimplificado(flota)).toContain(flota.urlAvisoIntegral);
  });

  it('nombra a la flota como responsable, NO a Likida', () => {
    // Invertir esto le dice al operador que sus datos son de un proveedor que no
    // conoce, y le pone a Likida una obligación que la ley le da a la flota.
    const a = avisoSimplificado(flota)!;
    const iFlota = a.indexOf(flota.razonSocial);
    expect(iFlota).toBeGreaterThanOrEqual(0);
    expect(a).toMatch(/responsable/i);
  });

  it('dice que hay un proveedor que trata los datos por cuenta de la flota', () => {
    // Art. 2 fr. XX: mandarle datos a la persona encargada no es transferencia,
    // pero el operador igual tiene derecho a saber por dónde pasan sus fotos.
    expect(avisoSimplificado(flota)).toMatch(/Likida/);
  });

  it('SIN los datos de la flota devuelve null: no se inventa un responsable', () => {
    // Un aviso con el nombre equivocado es peor que no tenerlo: sale mal el dato
    // de a quién reclamarle, que es justo para lo que sirve el aviso.
    expect(avisoSimplificado({ ...flota, razonSocial: '' })).toBeNull();
    expect(avisoSimplificado({ ...flota, domicilio: '' })).toBeNull();
    expect(avisoSimplificado({ ...flota, urlAvisoIntegral: '' })).toBeNull();
  });

  it('cabe en un mensaje de WhatsApp', () => {
    // El límite de Meta para texto es 4096. Un aviso que se parte en varios
    // mensajes se lee a medias y la constancia queda coja.
    expect(avisoSimplificado(flota)!.length).toBeLessThan(1024);
  });
});

describe('versionAviso', () => {
  it('el mismo texto da la misma versión', () => {
    const a = avisoSimplificado(flota)!;
    expect(versionAviso(a)).toBe(versionAviso(a));
  });

  it('si la flota cambia un dato, la versión cambia y el aviso se reenvía', () => {
    // Art. 15 fr. VI obliga a comunicar los cambios al aviso. Derivar la versión
    // del contenido lo vuelve automático: confiar en que alguien se acuerde de
    // subir un contador es como no comunicarlos.
    const v1 = versionAviso(avisoSimplificado(flota)!);
    const v2 = versionAviso(avisoSimplificado({ ...flota, domicilio: 'Otra calle 1, Mérida' })!);
    expect(v2).not.toBe(v1);
  });

  it('cambiar la liga del aviso integral también cuenta como cambio', () => {
    const v1 = versionAviso(avisoSimplificado(flota)!);
    const v2 = versionAviso(avisoSimplificado({ ...flota, urlAvisoIntegral: 'https://otra.mx/p' })!);
    expect(v2).not.toBe(v1);
  });
});

// El aviso le PROMETE al operador que escribiendo PRIVACIDAD se le atiende. Si
// esa palabra no dispara nada, el medio del art. 15 fr. IV no se ofreció: se
// anunció. Y esto va determinístico, antes del agente — un derecho ARCO no se
// deja a que el LLM decida si el mensaje califica.
describe('pideAtencionPrivacidad', () => {
  it('reconoce la palabra que el propio aviso le dijo que escribiera', () => {
    for (const t of ['PRIVACIDAD', 'privacidad', 'Privacidad porfa', 'quiero privacidad'])
      expect(pideAtencionPrivacidad(t), t).toBe(true);
  });

  it('aguanta cómo se escribe de verdad en WhatsApp', () => {
    for (const t of ['pRiVaCiDaD', 'ARCO', 'mis datos personales', 'quiero dar de baja mis datos'])
      expect(pideAtencionPrivacidad(t), t).toBe(true);
  });

  it('no se dispara con mensajes normales del flujo', () => {
    // Un falso positivo secuestra la liquidación y el operador no entiende nada.
    for (const t of ['listo', 'ya mandé todo', 'cuánto sobró?', 'el diesel fue de 4000', 'arcos de la caseta'])
      expect(pideAtencionPrivacidad(t), t).toBe(false);
  });
});

describe('respuestaPrivacidad', () => {
  it('remite al aviso integral de la FLOTA, que es donde viven los ARCO', () => {
    const r = respuestaPrivacidad(flota);
    expect(r).toContain(flota.urlAvisoIntegral);
    expect(r).toContain(flota.razonSocial);
  });

  it('NO promete que Likida resolvió el ARCO', () => {
    // Likida es persona encargada: actúa por instrucciones del responsable. Decir
    // "ya te dimos de baja" sería mentir sobre quién puede hacerlo.
    const r = respuestaPrivacidad(flota).toLowerCase();
    expect(r).not.toMatch(/ya (te )?(dimos de baja|borramos|eliminamos|cancelamos)/);
  });

  it('tranquiliza sobre la liquidación: preguntar no le cuesta nada', () => {
    expect(respuestaPrivacidad(flota)).toMatch(/no la afecta|sigue igual/i);
  });
});
