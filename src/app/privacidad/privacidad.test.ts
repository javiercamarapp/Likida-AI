import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// LA POLÍTICA DE LIKIDA NO ES EL AVISO DE LA FLOTA.
//
// Son dos documentos, dos responsables y dos conjuntos de titulares:
//
//   /aviso/[tenant]  la FLOTA responde por los datos de SUS operadores.
//                    Likida es persona encargada (art. 2 fr. XX).
//   /privacidad      LIKIDA responde por los datos de quien CONTRATA el
//                    servicio: el contralor, el administrador.
//
// Servir uno como el otro dejaría a un grupo entero sin aviso, y es fácil de
// hacer sin querer: los dos hablan de privacidad y los dos citan la LFPDPPP.
// Esta prueba fija que digan cosas distintas y que cada uno nombre al otro.
//
// Nace porque la app de Meta está en `dev_mode` con `privacy_policy_url: null`,
// y Meta exige una para pasarla a producción.
// ═══════════════════════════════════════════════════════════════════════════

const P = readFileSync('src/app/privacidad/page.tsx', 'utf8');

describe('la política de Likida', () => {
  it('deja claro que los datos del OPERADOR son de su flota, no de Likida', () => {
    // Es la confusión que importa. Si esta página se leyera como el aviso del
    // operador, su empresa quedaría sin cumplir el art. 16 creyendo que sí.
    expect(P).toMatch(/responsable de esos datos es \*\*su empresa\*\*/);
    expect(P).toMatch(/persona encargada/);
  });

  it('y le dice al operador dónde SÍ está el suyo', () => {
    // Un documento que solo dice "esto no es para ti" deja a alguien sin salida.
    expect(P).toMatch(/PRIVACIDAD/);
    expect(P).toMatch(/lo publica tu\s*\n?\s*empresa|el tuyo lo publica su|lo publica su propia flota/);
  });

  it('trae lo que Meta exige para pasar la app a producción', () => {
    // Borrado de cuenta es requisito propio de Meta, aparte de la LFPDPPP.
    expect(P).toMatch(/Borrar mi cuenta/);
    expect(P).toMatch(/Requisito de Meta/);
  });

  it('nombra el límite de cinco años del CFF 30 en vez de prometer un borrado que la ley impide', () => {
    expect(P).toMatch(/cinco años/);
    expect(P).toMatch(/art\. 30/);
  });

  it('no inventa la razón social: si está, se PINTA; si falta, lo dice al titular', () => {
    // Mismo criterio que el aviso integral con el contacto del art. 29. Una
    // razón social inventada en una política de privacidad es peor que una que
    // falta, porque la que falta se nota.
    //
    // AUDITORÍA 19-c2 (A1/A6): antes bastaba con que el env llegara a
    // LEGAL_CONFIG — el dato no se pintaba en ninguna sección y el banner era
    // una nota interna de despliegue («PRODUCCIÓN BLOQUEADA») publicada al
    // titular. Ahora la fr. I interpola la identidad en el primer párrafo, la
    // rama sin dato lo dice con palabras dirigidas al lector, y el banner
    // dispara solo por identidad (faltantesEntidad), no por el SLA.
    expect(P).toMatch(/RESPONSABLE\.razonSocial && RESPONSABLE\.domicilio/);
    expect(P).toMatch(/con domicilio en \$\{RESPONSABLE\.domicilio\}/);
    expect(P).toMatch(/aún no están capturados/);
    expect(P).toMatch(/faltantesEntidad/);
    expect(P).not.toMatch(/PRODUCCIÓN BLOQUEADA/);
  });

  it('el silencio no cuenta como aceptar una transferencia futura', () => {
    expect(P).toMatch(/No hacer nada al leer esto no cuenta/);
  });
});

describe('AUDITORÍA 18 (M8) · el correo de acceso está dicho', () => {
  // Por el proveedor de correo pasa la dirección de una persona identificada
  // más el enlace de un solo uso que abre su sesión. "Envío de correo para los
  // avisos del panel" no alcanzaba a esa clase de dato.
  it('la cláusula de encargados (art. 35) nombra el correo con el que se entra', () => {
    expect(P).toMatch(/el correo con el que entras/);
    expect(P).toMatch(/enlace de un solo uso que abre tu sesión/);
  });
  it('y el enlace de acceso aparece entre los datos tratados (art. 15 fr. II)', () => {
    expect(P).toMatch(/enlace de acceso de un solo uso/);
  });
});

describe('AUDITORÍA 21 (legal C1) · el piloto de facturación está dicho', () => {
  // El piloto de visión manda al modelo los datos fiscales del receptor y una
  // captura del portal del comercio en cada paso. La correspondencia exacta
  // prompt↔aviso la vigila piloto_vision_aviso.test.ts (junto al piloto);
  // aquí se fija lo mínimo: que esta página no vuelva a callarlo.
  it('la cláusula de encargados (art. 35) nombra los datos fiscales y la captura del portal', () => {
    expect(P).toMatch(/capturas de pantalla del portal de facturación del comercio/);
    expect(P).toMatch(/RFC, razón social, código postal, régimen fiscal, uso CFDI y el correo de recepción/);
  });
  it('y la fr. II ya no dice solo "validar": los datos fiscales también facturan tickets', () => {
    expect(P).toMatch(/facturar tus tickets en los portales de los comercios/);
  });
});
