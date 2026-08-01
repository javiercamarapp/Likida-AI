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

  it('no inventa la razón social: si falta, lo dice', () => {
    // Mismo criterio que el aviso integral con el contacto del art. 29. Una
    // razón social inventada en una política de privacidad es peor que una que
    // falta, porque la que falta se nota.
    expect(P).toMatch(/razonSocial: null/);
    expect(P).toMatch(/Falta capturar la razón social/);
  });

  it('el silencio no cuenta como aceptar una transferencia futura', () => {
    expect(P).toMatch(/No hacer nada al leer esto no cuenta/);
  });
});
