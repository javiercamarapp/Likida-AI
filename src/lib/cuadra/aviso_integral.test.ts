import { describe, it, expect } from 'vitest';
import { avisoIntegral, avisoSimplificado, revisarAvisoIntegral, versionAviso } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO INTEGRAL FALTABA ENTERO. 31-jul-2026.
//
// `tenant.url_aviso_privacidad` apuntaba a `transportesinnovativos.mx`, que
// responde NXDOMAIN. El art. 16 fr. II obliga a "señalar el sitio donde se podrá
// consultar el aviso integral", y no había sitio: el operador recibía una liga
// muerta y la respuesta a *PRIVACIDAD* tenía que confesar que no había a dónde
// mandarlo.
//
// Seis de los once elementos del checklist (docs/conocimiento/11-datos-
// personales.md §5.4) viven SOLO en el integral, así que no existían en ningún
// lado: ARCO (15 fr. V), cambios al aviso (15 fr. VI), transferencias (35),
// revocación (7 último párr.), contacto (29) y oposición al tratamiento
// automatizado (26 fr. II).
//
// Esta prueba mide el CONTENIDO contra ese checklist, que es la única forma de
// que "está completo" signifique algo. Por eso `avisoIntegral` devuelve
// secciones y no HTML.
// ═══════════════════════════════════════════════════════════════════════════

const FLOTA = {
  razonSocial: 'TRANSPORTES INNOVATIVOS SA DE CV',
  domicilio: 'Carretera Silao-Romita Km 4.5, 36100 Silao, Guanajuato',
  urlAvisoIntegral: 'https://cuadra.mx/aviso/11111111-1111-1111-1111-111111111111',
};

const todo = (r = FLOTA) => avisoIntegral(r).flatMap((s) => [s.titulo, ...s.parrafos]).join('\n');
const fundamentos = (r = FLOTA) => avisoIntegral(r).map((s) => s.fundamento).join(' | ');

describe('los once elementos del checklist §5.4', () => {
  // La tabla del checklist, tal cual, con el fundamento que la ancla. Si mañana
  // alguien reordena o borra una sección, esto dice CUÁL se perdió — no "el
  // texto cambió".
  const ELEMENTOS: Array<[string, string, RegExp]> = [
    ['1  identidad y domicilio del responsable', 'art. 15 fr. I', /responsable de tus datos personales/i],
    ['2  catálogo de datos, marcando sensibles', 'art. 15 fr. II', /No se tratan datos sensibles/i],
    ['3  finalidades, separando las necesarias', 'art. 15 fr. III', /Finalidades necesarias/i],
    ['4  opciones para limitar uso o divulgación', 'art. 15 fr. IV', /Cómo limitar el uso/i],
    ['5  mecanismos y procedimiento ARCO', 'art. 15 fr. V', /20 días hábiles/i],
    ['6  cómo se comunican los cambios', 'art. 15 fr. VI', /recibes el aviso nuevo por el mismo WhatsApp/i],
    ['7  cláusula de transferencias', 'art. 35', /no se venden/i],
    ['8  revocación del consentimiento', 'art. 7 último párrafo', /retirar tu consentimiento/i],
    ['10 contacto de datos personales', 'art. 29', /dirigirte en la empresa/i],
    ['11 oposición al tratamiento automatizado', 'art. 26 fr. II', /sin que una persona la mire antes/i],
  ];

  it.each(ELEMENTOS)('%s está en el texto', (_elemento, fundamento, marca) => {
    expect(todo()).toMatch(marca);
    expect(fundamentos()).toContain(fundamento);
  });

  it('el 9 (liga al integral) vive en el SIMPLIFICADO, no aquí', () => {
    // Es el único de los once que NO va en el integral: sería una liga a sí
    // mismo. Se comprueba donde sí va, para que la tabla quede cubierta entera.
    const simple = avisoSimplificado(FLOTA);
    expect(simple).toContain(FLOTA.urlAvisoIntegral);
  });
});

describe('lo que el aviso NO puede inventar', () => {
  it('sin contacto capturado lo DICE, en vez de rellenarlo con el chat', () => {
    // El criterio que ya rige a la liga rota: decirle la verdad al titular
    // cumple más que un contacto que no existe. Y deja el hueco visible.
    const s = avisoIntegral(FLOTA).find((x) => x.fundamento === 'LFPDPPP art. 29')!;
    expect(s.pendiente).toBe(true);
    expect(s.parrafos.join(' ')).toMatch(/todavía no ha designado/i);
  });

  it('con contacto capturado, lo pone y deja de estar pendiente', () => {
    const s = avisoIntegral({ ...FLOTA, contactoPrivacidad: 'Datos Personales · datos@innovativos.mx · 477 100 2000' })
      .find((x) => x.fundamento === 'LFPDPPP art. 29')!;
    expect(s.pendiente).toBeFalsy();
    expect(s.parrafos[0]).toContain('datos@innovativos.mx');
  });

  it('ninguna otra sección nace pendiente: solo el art. 29 depende de un dato de la flota', () => {
    const pendientes = avisoIntegral(FLOTA).filter((s) => s.pendiente).map((s) => s.fundamento);
    expect(pendientes).toEqual(['LFPDPPP art. 29']);
  });

  it('la razón social y el domicilio salen de los datos, no de una plantilla', () => {
    const otra = avisoIntegral({ ...FLOTA, razonSocial: 'FLETES DEL BAJÍO SA', domicilio: 'Calle 5, León' });
    const texto = otra.flatMap((s) => s.parrafos).join('\n');
    expect(texto).toContain('FLETES DEL BAJÍO SA');
    expect(texto).toContain('Calle 5, León');
    expect(texto).not.toContain('INNOVATIVOS');
  });
});

describe('lo que este producto sí hace, dicho sin adornos', () => {
  it('nombra la conservación de cinco años del CFF 30 como límite de la revocación', () => {
    // El titular tiene que saber ANTES que revocar no borra los comprobantes ya
    // usados. Prometer un borrado que la ley impide es la clase de promesa que
    // se descubre justo cuando alguien la ejerce.
    const s = avisoIntegral(FLOTA).find((x) => x.fundamento.includes('art. 7'))!;
    expect(s.parrafos.join(' ')).toMatch(/cinco años/);
    expect(s.parrafos.join(' ')).toMatch(/CFF art\. 30|art\. 30/);
  });

  it('dice que los modelos de lenguaje leen las fotos, y con retención cero', () => {
    // Esconderlo detrás de "proveedores tecnológicos" sería cierto y useless.
    expect(todo()).toMatch(/modelos de lenguaje/i);
    expect(todo()).toMatch(/retención cero/i);
  });

  it('separa encargados de transferencias, que es la distinción del art. 2 fr. XX', () => {
    const s = avisoIntegral(FLOTA).find((x) => x.fundamento === 'LFPDPPP art. 35')!;
    expect(s.parrafos.join(' ')).toMatch(/no es una transferencia/i);
    expect(s.parrafos.join(' ')).toMatch(/art\. 2 fr\. XX/);
  });

  it('el silencio NO cuenta como aceptar una transferencia futura', () => {
    const s = avisoIntegral(FLOTA).find((x) => x.fundamento === 'LFPDPPP art. 35')!;
    expect(s.parrafos.join(' ')).toMatch(/No hacer nada al leer esto no cuenta/i);
  });

  it('oponerse a la revisión automática no detiene la liquidación, y lo dice', () => {
    const s = avisoIntegral(FLOTA).find((x) => x.fundamento === 'LFPDPPP art. 26 fr. II')!;
    expect(s.parrafos.join(' ')).toMatch(/no detiene tu liquidación/i);
  });

  it('deja claro quién responde: la flota, no Likida', () => {
    const s = avisoIntegral(FLOTA)[0];
    expect(s.parrafos.join(' ')).toMatch(/persona encargada/i);
    expect(s.parrafos.join(' ')).toMatch(/eso no cambia quién responde/i);
  });
});

describe('la liga que se le manda al operador ya resuelve', () => {
  it('la del integral servido por la app pasa la revisión de forma', () => {
    // Era el fallo entero: `transportesinnovativos.mx` responde NXDOMAIN, así
    // que el simplificado salía degradado y ARCO no tenía a dónde mandar.
    expect(revisarAvisoIntegral(FLOTA.urlAvisoIntegral)).toBe('ok');
  });

  it('y la vieja seguiría pasando la de FORMA — por eso hacía falta una que EXISTA', () => {
    // Deja escrito el límite de `revisarAvisoIntegral`: revisa la forma, no la
    // existencia. Una prueba verde sobre la URL muerta habría dado por bueno el
    // estado anterior; lo que lo arregla es que ahora hay una página detrás.
    expect(revisarAvisoIntegral('https://transportesinnovativos.mx/aviso-de-privacidad')).toBe('ok');
  });

  it('en localhost se degrada a propósito: en dev no hay integral público', () => {
    expect(revisarAvisoIntegral('http://localhost:3000/aviso/11111111-1111-1111-1111-111111111111')).toBe('inservible');
  });

  it('cambiar la liga cambia la versión, así que el aviso bueno se reenvía solo', () => {
    // Art. 15 fr. VI. Es lo que hace que las flotas ya avisadas con la liga rota
    // reciban el aviso nuevo sin que nadie corra un script.
    const viejo = avisoSimplificado({ ...FLOTA, urlAvisoIntegral: 'https://transportesinnovativos.mx/aviso-de-privacidad' })!;
    const nuevo = avisoSimplificado(FLOTA)!;
    expect(versionAviso(viejo)).not.toBe(versionAviso(nuevo));
  });
});
