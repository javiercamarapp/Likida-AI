import { describe, it, expect } from 'vitest';
import { avisoIntegral } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · cumplimiento legal — cuatro cosas que el sistema HACE y el
// aviso NO decía. Es la misma falla cuatro veces: el documento del art. 15
// describe un sistema distinto del que corre.
//
// LEG-C2 (CRÍTICO) es el peor porque es AFIRMATIVO, no omisivo: el aviso jura
// «No se piden ni se conservan datos sensibles. Ni salud…» mientras el circuito
// de asistencia guarda `incidencia.hay_lesionados` (columna propia, migración
// 0198) ligada a `operador_id`, y el texto crudo del accidente que el chofer
// escribe (`asistencia_wa.ts:524`). La salud es dato sensible (LFPDPPP art. 3
// fr. VI) y el art. 59 fr. IV agrava la sanción hasta el doble.
//
// LEG-A1 (ALTO): la nota de voz viaja íntegra a OpenRouter y no está enumerada
// ni como dato (fr. II) ni como salida (art. 35).
// LEG-A2 (ALTO): el RFC y el número de licencia del operador salen hacia el PAC
// dentro del Carta Porte, y no están en ninguna de las dos listas.
// LEG-A3 (ALTO): la jornada laboral se DERIVA de las posiciones GPS. Es una
// finalidad nueva (fr. III), y el propio aviso declara que toda finalidad no
// escrita exige pedir permiso otra vez.
// ═══════════════════════════════════════════════════════════════════════════

const FLOTA = {
  razonSocial: 'Transportes Prueba SA de CV',
  domicilio: 'Av. Siempre Viva 1, Escobedo, NL',
  urlAvisoIntegral: 'https://app.likida.ai/aviso/11111111-1111-1111-1111-111111111111',
  contactoPrivacidad: null,
};

const seccion = (fundamento: string) =>
  avisoIntegral(FLOTA).find((x) => x.fundamento === fundamento)!;
const texto = (fundamento: string) => seccion(fundamento).parrafos.join('\n');

describe('LEG-C2: el aviso deja de jurar que no hay datos de salud', () => {
  const datos = () => texto('LFPDPPP art. 15 fr. II');

  it('ya NO afirma la negativa absoluta que el código contradice', () => {
    // Lo que rompía, literal: «No se piden ni se conservan datos sensibles. Ni
    // salud, …». `incidencia.hay_lesionados` y el texto del accidente lo niegan.
    expect(datos()).not.toContain('No se piden ni se conservan datos sensibles');
  });

  it('enumera el dato de salud que sí se trata, y para qué', () => {
    const t = datos();
    expect(t).toMatch(/lesionad/i);
    expect(t).toMatch(/emergencia|accidente|incidente/i);
  });

  it('conserva la promesa que sí es cierta: las demás categorías sensibles', () => {
    const t = datos();
    expect(t).toMatch(/origen racial|creencias|afiliación sindical|biométricos/i);
  });
});

describe('LEG-A1: la nota de voz se declara como dato y como salida', () => {
  it('está enumerada entre los datos que se tratan', () => {
    expect(texto('LFPDPPP art. 15 fr. II')).toMatch(/nota[s]? de voz|mensaje[s]? de voz|audio/i);
  });

  it('y se dice que sale hacia el proveedor que la transcribe', () => {
    expect(texto('LFPDPPP art. 35')).toMatch(/voz|audio/i);
  });
});

describe('LEG-A2: el RFC y la licencia del operador se declaran', () => {
  it('están enumerados entre los datos que se tratan', () => {
    const t = texto('LFPDPPP art. 15 fr. II');
    expect(t).toMatch(/RFC/);
    expect(t).toMatch(/licencia/i);
  });

  it('y se dice que salen hacia el PAC dentro del Carta Porte', () => {
    const t = texto('LFPDPPP art. 35');
    expect(t).toMatch(/carta porte/i);
    expect(t).toMatch(/certificaci[óo]n|PAC/i);
  });
});

describe('LEG-A3: la jornada derivada del GPS es una finalidad declarada', () => {
  it('aparece entre las finalidades, no escondida en el seguimiento del viaje', () => {
    const t = texto('LFPDPPP art. 15 fr. III');
    expect(t).toMatch(/jornada/i);
  });

  it('y va entre las NO necesarias: la liquidación cierra igual sin ella', () => {
    const t = texto('LFPDPPP art. 15 fr. III');
    const iNecesarias = t.indexOf('Finalidades que NO son necesarias');
    const iJornada = t.search(/jornada/i);
    expect(iNecesarias).toBeGreaterThan(-1);
    expect(iJornada).toBeGreaterThan(iNecesarias);
  });
});
