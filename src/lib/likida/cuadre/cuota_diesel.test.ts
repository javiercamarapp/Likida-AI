// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18, B5 — la cuota semanal del diésel tenía escritor y no tenía
// lector: ni el fail-closed prometido, ni el contrato del archivo vigilado, y
// un campo (`estimulo_por_litro`) que invitaba a multiplicar 2.2× de más.
// Estas pruebas leen el archivo REAL del repo: si la rutina lo escribe mal
// (hueco de un viernes, aritmética que no cierra, nombre viejo del campo),
// fallan aquí antes de que lo descubra un contador.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsearCuotasDiesel, validarCuotasDiesel, cuotaDieselVigente } from './cuota_diesel';

const ARCHIVO = new URL('../../../../normas/datos/cuota-ieps-diesel.yaml', import.meta.url);
const tabla = parsearCuotasDiesel(readFileSync(ARCHIVO, 'utf8'));

describe('el archivo real cumple su contrato', () => {
  // ESTA ES LA PUERTA. No es una prueba más: es el ÚNICO sitio donde el YAML
  // que la rutina del DOF escribe cada viernes se coteja contra su contrato.
  // La rutina no puede hacer push —todo lo fiscal sale por PR, dice su
  // encargo— y ese PR pasa por `npm test`, o sea por aquí.
  //
  // Verificado el 28-ago-2026 rompiendo el archivo a propósito (un sábado
  // cambiado a domingo): esto se pone rojo y nombra el renglón.
  it('tiene semanas y todas cuadran: sábado a viernes, empalmadas, aritmética exacta', () => {
    expect(tabla.semanas.length).toBeGreaterThanOrEqual(4);
    const violaciones = validarCuotasDiesel(tabla);
    // El mensaje dice QUÉ hacer, no sólo qué pasó: quien lo lee suele ser la
    // rutina automática del DOF a las 6 de la mañana, no una persona con el
    // contexto fresco. Un array vacío contra otro no le dice a dónde ir.
    expect(
      violaciones,
      violaciones.length === 0 ? '' :
      `\n\n\`normas/datos/cuota-ieps-diesel.yaml\` no cumple su contrato. Renglones:\n` +
      violaciones.map((v) => `  · ${v}`).join('\n') +
      `\n\nCada vigencia va de SÁBADO a VIERNES, empalma con la anterior sin hueco,\n` +
      `y reducción + disminuida = ${tabla.cuotaCompleta} (la cuota completa de la LIF).\n` +
      `Fuente: acuerdo semanal del DOF, edición VESPERTINA del viernes, con su codNota.\n` +
      `NO se arregla el número para que pase: se vuelve a leer el DOF (skill \`cuota-diesel\`).`,
    ).toEqual([]);
  });

  it('la cuota completa es la de la LIF 2026 / Acuerdo 179/2025', () => {
    expect(tabla.cuotaCompleta).toBe(7.3634);
  });

  it('la semana del 15-21-ago-2026 es la del hallazgo, dígito por dígito (DOF 14-ago, codNota 5796377)', () => {
    const s = cuotaDieselVigente(tabla, '2026-08-18')!;
    expect(s).not.toBeNull();
    expect(s.cuotaDisminuidaPorLitro).toBe(2.276);
    expect(s.reduccionShcpPorLitro).toBe(5.0874);
    expect(s.fuente.codNota).toBe('5796377');
    // El estímulo del transportista sobre 500 L: $1,138.00 — con la DISMINUIDA.
    expect(Math.round(500 * s.cuotaDisminuidaPorLitro * 100) / 100).toBe(1138);
    // La trampa del campo mal llamado: 2.2× de más.
    expect(Math.round(500 * s.reduccionShcpPorLitro * 100) / 100).toBe(2543.7);
  });
});

describe('fail-closed: sin cuota vigente para la fecha no hay cifra', () => {
  it('antes de la primera semana → null (no se toma "la más cercana")', () => {
    expect(cuotaDieselVigente(tabla, '2026-07-24')).toBeNull();
  });

  it('después de la última semana → null (no se cae al último valor conocido)', () => {
    const ultima = tabla.semanas[tabla.semanas.length - 1];
    const d = new Date(`${ultima.hasta}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    expect(cuotaDieselVigente(tabla, d.toISOString().slice(0, 10))).toBeNull();
    expect(cuotaDieselVigente(tabla, '2030-01-01')).toBeNull();
  });

  it('los bordes de una semana sí están cubiertos (sábado y viernes)', () => {
    expect(cuotaDieselVigente(tabla, '2026-08-15')?.cuotaDisminuidaPorLitro).toBe(2.276);
    expect(cuotaDieselVigente(tabla, '2026-08-21')?.cuotaDisminuidaPorLitro).toBe(2.276);
    expect(cuotaDieselVigente(tabla, '2026-08-14')?.cuotaDisminuidaPorLitro).toBe(2.5801);
  });

  it('una fecha con hora se recorta al día; una fecha inválida es null', () => {
    expect(cuotaDieselVigente(tabla, '2026-08-01T23:59:00Z')?.cuotaDisminuidaPorLitro).toBe(1.7747);
    expect(cuotaDieselVigente(tabla, 'ayer')).toBeNull();
  });
});

describe('el validador atrapa lo que la skill pide verificar', () => {
  const base = () => parsearCuotasDiesel(readFileSync(ARCHIVO, 'utf8'));

  it('un viernes perdido (hueco) se reporta', () => {
    const t = base();
    t.semanas.splice(1, 1);
    expect(validarCuotasDiesel(t).join('\n')).toMatch(/no empalma/);
  });

  it('una aritmética que no cierra se reporta', () => {
    const t = base();
    t.semanas[0].cuotaDisminuidaPorLitro += 0.01;
    expect(validarCuotasDiesel(t).join('\n')).toMatch(/reducción \+ disminuida/);
  });

  it('el nombre viejo del campo (`estimulo_por_litro`) no se acepta en silencio', () => {
    const txt = readFileSync(ARCHIVO, 'utf8').replace(/^(\s+)reduccion_shcp_por_litro:/m, '$1estimulo_por_litro:');
    expect(() => parsearCuotasDiesel(txt)).toThrow(/estimulo_por_litro/);
  });

  it('una semana incompleta no se cuela', () => {
    const txt = readFileSync(ARCHIVO, 'utf8') + '\n  - vigencia: 2026-08-22 a 2026-08-28\n    porcentaje_estimulo: 70\n';
    expect(() => parsearCuotasDiesel(txt)).toThrow(/incompleta/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOS SOBREVIVIENTES DE `cuota_diesel.ts` (Stryker, 28-ago-2026 · 86.01%).
//
// EL VALIDADOR NUNCA HABÍA DICHO «NO». Las pruebas de arriba lo corren contra
// el archivo REAL —que está sano— y contra dos averías: el hueco entre semanas
// y la aritmética que no cierra. Las otras CUATRO reglas de su contrato jamás
// se habían disparado, así que Stryker pudo apagarlas una por una y el archivo
// siguió en verde. Varias salieron marcadas SIN COBERTURA, que es la
// confirmación: esas líneas no se ejecutan nunca.
//
// LO QUE **NO** ESTABA EN RIESGO, Y HAY QUE DECIRLO PARA NO ASUSTAR DE MÁS:
// ninguna liquidación reparte dinero con esta cuota. El módulo es HUÉRFANO A
// PROPÓSITO —decisión D2 del roadmap, escrita en la cabecera de
// `cuota_diesel.ts`—: el motor entrega LITROS (`engine.ts`,
// `litrosDieselAcreditables`) y el contador multiplica por la cuota del DOF.
// Imprimir el estímulo en pesos está prohibido hasta que un fiscalista con
// cédula firme cuál de las dos lecturas del texto aplica (íntegra vs
// disminuida, 3.5× entre ellas — `docs/qa/verificacion-ieps-casetas-2026-08-19.md:48`).
//
// Y EL ARCHIVO SÍ ESTÁ VIGILADO HOY. Medido el 28-ago-2026: se corrompió el
// YAML real (un sábado cambiado a domingo) y `npm test` se puso ROJO nombrando
// el renglón —«semana 2026-08-02 a 2026-07-31: no empieza en sábado»—. La
// prueba «el archivo real cumple su contrato» de arriba es esa puerta, y corre
// en cada CI. La rutina del DOF (`scripts/mejora-diaria/encargos/dof-diario.md`)
// no puede hacer push: todo lo fiscal sale por PR, y ese PR pasa por aquí.
//
// LO QUE SÍ ESTABA DESPROTEGIDO ES **EL VALIDADOR MISMO**. Cuatro de sus seis
// reglas podían borrarse o invertirse sin que ninguna prueba fallara, porque
// ninguna las hacía disparar. Con la regla apagada, el archivo malo pasa verde
// y la puerta de arriba se vuelve decorativa: sigue existiendo y ya no vigila.
// Ésa es la segunda capa que cierran estas pruebas.
//
// La otra mitad de los sobrevivientes eran las ANCLAS de dos regex. Un `^`
// perdido en `cuotaDieselVigente` convierte «basura-2026-08-15» en una fecha
// válida; un `\s+` degradado a `\s` en `RE_VIGENCIA` hace que una línea con dos
// espacios deje de parsearse — y el parser, al no reconocerla, se salta la
// semana en silencio.
// ═══════════════════════════════════════════════════════════════════════════
describe('el validador dice «no» — las cuatro reglas que nunca se habían disparado', () => {
  const base = () => parsearCuotasDiesel(readFileSync(ARCHIVO, 'utf8'));

  it('MUTANTE :109 — una tabla SIN SEMANAS se reporta, no pasa por sana', () => {
    // Es el caso más silencioso: sin semanas, `cuotaDieselVigente` devuelve
    // `null` para toda fecha. Hoy nadie lo consume (D2), así que no rompe una
    // liquidación; lo que rompe es la promesa del fail-closed — el módulo
    // existe para poder NEGARSE, y una tabla vacía se niega siempre, que es
    // indistinguible de negarse por la razón correcta.
    const t = base();
    t.semanas = [];
    expect(validarCuotasDiesel(t)).toContain('sin semanas');
  });

  it('MUTANTE :112 — una semana que no empieza en SÁBADO se reporta', () => {
    // La cuota del DOF es semanal de sábado a viernes. Una vigencia corrida un
    // día desplaza a qué semana pertenece cada carga de diésel, y con ella la
    // cuota por litro que se aplica.
    const t = base();
    t.semanas[0].desde = '2026-08-02';   // domingo
    expect(validarCuotasDiesel(t).join('\n')).toMatch(/no empieza en sábado/);
  });

  it('MUTANTE :113 — una semana que no termina en VIERNES se reporta', () => {
    const t = base();
    t.semanas[0].hasta = '2026-08-06';   // jueves
    expect(validarCuotasDiesel(t).join('\n')).toMatch(/no termina en viernes/);
  });

  it('MUTANTES :119/:120 — la cuota disminuida fuera de rango se reporta, por los DOS lados', () => {
    // `0 < x < cuotaCompleta` son dos guardias, y los seis mutantes de esa
    // línea (el `&&` a `||`, los dos `>` a `>=`, la condición entera a
    // true/false) sólo se distinguen probando los dos extremos.
    const cero = base();
    cero.semanas[0].cuotaDisminuidaPorLitro = 0;
    cero.semanas[0].reduccionShcpPorLitro = cero.cuotaCompleta;   // la aritmética sigue cerrando
    expect(validarCuotasDiesel(cero).join('\n')).toMatch(/fuera de rango \(0\)/);

    const completa = base();
    completa.semanas[0].cuotaDisminuidaPorLitro = completa.cuotaCompleta;
    completa.semanas[0].reduccionShcpPorLitro = 0;                // idem
    expect(validarCuotasDiesel(completa).join('\n')).toMatch(/fuera de rango/);

    // Y el caso sano NO se reporta: sin esto, un validador que gritara siempre
    // pasaría las dos afirmaciones de arriba.
    expect(validarCuotasDiesel(base())).toEqual([]);
  });

  it('MUTANTE :115 — el mensaje del hueco cita la semana ANTERIOR, no la siguiente', () => {
    // `t.semanas[i - 1].hasta` mutado a `i + 1`: el error sigue saliendo, pero
    // nombrando la semana equivocada. Quien lo lea va a revisar el renglón que
    // no es — y en el último caso del arreglo, `i + 1` no existe y el mensaje
    // revienta con un TypeError dentro del validador.
    const t = base();
    const anterior = t.semanas[0].hasta;
    t.semanas.splice(1, 1);
    expect(validarCuotasDiesel(t).join('\n')).toContain(`(${anterior})`);
  });
});

describe('las anclas de los regex — un `^` o un `$` que se pierden', () => {
  it('MUTANTE :133 — `cuotaDieselVigente` exige la fecha COMPLETA, no una que la contenga', () => {
    // Sin `^`, cualquier cosa con una fecha dentro pasa el filtro; sin `$`,
    // cualquier sufijo. `.slice(0, 10)` recorta a diez caracteres, así que lo
    // que llega aquí es basura de diez o menos: la validación es lo único que
    // separa una fecha de un texto del mismo largo.
    const t = parsearCuotasDiesel(readFileSync(ARCHIVO, 'utf8'));
    const dentro = t.semanas[0].desde;
    expect(cuotaDieselVigente(t, dentro)).not.toBeNull();
    // Diez caracteres que NO son una fecha: mismo largo, distinto contenido.
    expect(cuotaDieselVigente(t, 'XX26-08-15')).toBeNull();
    expect(cuotaDieselVigente(t, '2026-08-1X')).toBeNull();
    expect(cuotaDieselVigente(t, '')).toBeNull();
  });

  it('MUTANTE :51 — la vigencia se parsea con UNO O MÁS espacios alrededor de la «a»', () => {
    // `\s+` degradado a `\s` deja de reconocer una línea con dos espacios. El
    // parser no lanza: no reconoce el renglón, así que la semana entera se cae
    // del archivo EN SILENCIO y `cuotaDieselVigente` devuelve `null` para esos
    // siete días — el estímulo desaparece una semana sin que nada avise.
    const txt = readFileSync(ARCHIVO, 'utf8');
    const conDosEspacios = txt.replace(/^(\s*-\s*vigencia:\s*\d{4}-\d{2}-\d{2})\s+a\s+/m, '$1  a  ');
    expect(conDosEspacios).not.toBe(txt);   // el fixture de verdad cambió algo
    const t = parsearCuotasDiesel(conDosEspacios);
    expect(t.semanas.length).toBe(parsearCuotasDiesel(txt).semanas.length);
  });
});
