import { describe, it, expect } from 'vitest';
import {
  generarTokenPortal, hashDeToken, prefijoDeToken, diasDeVigencia, expiracionDesde,
  estadoLiga, validarPropuesta, normalizarReferencia, esCarnada, esMetodoPortal,
  identificaFactura, textoDelRep, montoTecleado, METODOS_PORTAL,
  PREFIJO_TOKEN, DIAS_VIGENCIA_DEFAULT, TEXTO_LIGA_NO_VALIDA,
  type PropuestaCruda, type ContextoFactura,
} from './portal_pago';
import { TOLERANCIA_ABONO_MXN, round2 } from '@/lib/formato';
import { DatoInvalido } from './errores';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE DECIDE EL PORTAL, SIN BASE DE DATOS.
//
// Se prueba la parte que decide DINERO y ACCESO: qué token vale, qué pago se
// admite contra el saldo real, y qué se le dice a quien llega con un enlace
// muerto. Las escrituras no se prueban contra un mock de Supabase — eso
// demostraría que el mock funciona (mismo criterio que
// `facturacion_escritura.test.ts`). Lo que la base garantiza —el índice único
// de la propuesta, el CHECK del hash, la FK compuesta— lo demuestra el bloque
// 181 de `verificaciones.sql`, contra Postgres real.
// ═══════════════════════════════════════════════════════════════════════════

describe('generarTokenPortal — el token en claro no se puede reconstruir', () => {
  it('el hash es SHA-256 en hex, 64 caracteres', () => {
    // El CHECK `portal_pago_liga_hash_forma` (0228) exige exactamente esa
    // forma: si alguien escribiera el token en claro, el insert falla en vez
    // de guardarlo.
    expect(generarTokenPortal().hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el prefijo NO alcanza para reconstruir el token', () => {
    const t = generarTokenPortal();
    expect(t.enClaro.startsWith(t.prefijo)).toBe(true);
    expect(t.enClaro.length).toBeGreaterThan(t.prefijo.length + 30);
  });

  it('lleva prefijo reconocible, para cacharlo en un log o un pegado', () => {
    expect(generarTokenPortal().enClaro.startsWith(PREFIJO_TOKEN)).toBe(true);
  });

  it('100 tokens seguidos, 100 distintos', () => {
    const set = new Set(Array.from({ length: 100 }, () => generarTokenPortal().enClaro));
    expect(set.size).toBe(100);
  });

  it('el hash del token coincide con el que se guardaría', () => {
    const t = generarTokenPortal();
    expect(hashDeToken(t.enClaro)).toBe(t.hash);
  });

  it('el cuerpo es base64url: nada que tenga que escaparse en una URL', () => {
    const t = generarTokenPortal();
    expect(t.enClaro.slice(PREFIJO_TOKEN.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(t.enClaro)).toBe(t.enClaro);
  });
});

describe('prefijoDeToken — sin la forma correcta ni se consulta la base', () => {
  it('basura, vacío y un token ajeno devuelven null', () => {
    expect(prefijoDeToken('hola')).toBeNull();
    expect(prefijoDeToken('')).toBeNull();
    expect(prefijoDeToken('lk_live_abcdefgh')).toBeNull();
  });

  it('el prefijo correcto pero truncado tampoco pasa', () => {
    expect(prefijoDeToken(`${PREFIJO_TOKEN}ab`)).toBeNull();
  });

  it('un cuerpo con caracteres que no son base64url se rechaza', () => {
    // `/`, `+` y `%` no salen del generador: dejarlos pasar sería mandar a la
    // base lo que un atacante quiera escribir.
    expect(prefijoDeToken(`${PREFIJO_TOKEN}abcd/efg`)).toBeNull();
    expect(prefijoDeToken(`${PREFIJO_TOKEN}abcd%2fef`)).toBeNull();
    expect(prefijoDeToken(`${PREFIJO_TOKEN}abcd efg`)).toBeNull();
  });

  it('un token real da su prefijo, y aguanta espacios alrededor', () => {
    const t = generarTokenPortal();
    expect(prefijoDeToken(t.enClaro)).toBe(t.prefijo);
    expect(prefijoDeToken(`  ${t.enClaro}  `)).toBe(t.prefijo);
  });
});

describe('diasDeVigencia — nunca "para siempre", nunca "muerto al nacer"', () => {
  it('sin configurar, 90 días', () => {
    expect(diasDeVigencia(undefined)).toBe(DIAS_VIGENCIA_DEFAULT);
    expect(DIAS_VIGENCIA_DEFAULT).toBe(90);
  });

  it('un valor sano se respeta', () => {
    expect(diasDeVigencia('30')).toBe(30);
    expect(diasDeVigencia('365')).toBe(365);
    expect(diasDeVigencia('1')).toBe(1);
  });

  it('cero, negativo y absurdo caen al default en vez de aplicarse', () => {
    // `0` dejaría cada enlace muerto al nacer; `999999` es "para siempre"
    // escrito de otra forma, que es lo que la caducidad existe para impedir.
    expect(diasDeVigencia('0')).toBe(DIAS_VIGENCIA_DEFAULT);
    expect(diasDeVigencia('-5')).toBe(DIAS_VIGENCIA_DEFAULT);
    expect(diasDeVigencia('999999')).toBe(DIAS_VIGENCIA_DEFAULT);
    expect(diasDeVigencia('366')).toBe(DIAS_VIGENCIA_DEFAULT);
  });

  it('lo ilegible cae al default, no lanza', () => {
    expect(diasDeVigencia('noventa')).toBe(DIAS_VIGENCIA_DEFAULT);
    expect(diasDeVigencia('')).toBe(DIAS_VIGENCIA_DEFAULT);
    expect(diasDeVigencia('30.5')).toBe(DIAS_VIGENCIA_DEFAULT);
  });
});

describe('expiracionDesde — la caducidad es una fecha, no una promesa', () => {
  it('90 días después del instante que se le da', () => {
    const ahora = new Date('2026-08-27T12:00:00.000Z');
    expect(expiracionDesde(ahora, 90)).toBe('2026-11-25T12:00:00.000Z');
  });
});

describe('estadoLiga — y por qué el orden importa', () => {
  const futuro = new Date('2026-12-31T00:00:00Z').toISOString();
  const pasado = new Date('2026-01-01T00:00:00Z').toISOString();
  const ahora = new Date('2026-08-27T00:00:00Z');

  it('vigente cuando no está revocada y no ha caducado', () => {
    expect(estadoLiga({ expira_en: futuro, revocada_en: null }, ahora)).toBe('vigente');
  });

  it('expirada cuando la fecha ya pasó', () => {
    expect(estadoLiga({ expira_en: pasado, revocada_en: null }, ahora)).toBe('expirada');
  });

  it('revocada GANA sobre expirada: eso es lo que un humano decidió', () => {
    expect(estadoLiga({ expira_en: pasado, revocada_en: pasado }, ahora)).toBe('revocada');
    expect(estadoLiga({ expira_en: futuro, revocada_en: pasado }, ahora)).toBe('revocada');
  });

  it('una fecha ilegible se trata como CADUCADA — falla cerrado', () => {
    // El modo de falla contrario abriría una factura por un dato corrupto.
    expect(estadoLiga({ expira_en: 'no-es-fecha', revocada_en: null }, ahora)).toBe('expirada');
  });

  it('el instante exacto de la caducidad ya NO vale', () => {
    expect(estadoLiga({ expira_en: ahora.toISOString(), revocada_en: null }, ahora)).toBe('expirada');
  });
});

describe('TEXTO_LIGA_NO_VALIDA — un solo texto para las cuatro razones', () => {
  it('no nombra ninguna de las cuatro causas por separado', () => {
    // "Este enlace expiró" le confirma a quien prueba tokens que acertó uno.
    expect(TEXTO_LIGA_NO_VALIDA).not.toMatch(/revocad|no existe|inválid/i);
  });
});

// ── EL FORMULARIO ──────────────────────────────────────────────────────────

const BASE: PropuestaCruda = {
  fecha: '2026-08-20',
  monto: '1160',
  referencia: 'REF-8891',
  metodo: 'transferencia',
};
const CTX: ContextoFactura = { fechaFactura: '2026-08-14', saldo: 1160, hoy: '2026-08-27' };

describe('validarPropuesta — falla cerrado cuando no sabe el saldo', () => {
  it('con saldo null NO se acepta nada, y se dice por qué', () => {
    // Sin saldo tampoco se puede decir en pantalla cuánto debe: el cliente
    // estaría tecleando a ciegas contra una cifra que nadie verificó.
    expect(() => validarPropuesta(BASE, { ...CTX, saldo: null })).toThrow(DatoInvalido);
    expect(() => validarPropuesta(BASE, { ...CTX, saldo: null })).toThrow(/saldo/i);
  });

  it('un saldo de CERO no es lo mismo que un saldo desconocido', () => {
    // Con saldo 0 sí se sabe: se rechaza por exceder, no por ignorancia.
    expect(() => validarPropuesta(BASE, { ...CTX, saldo: 0 })).toThrow(/saldo pendiente/i);
  });
});

describe('validarPropuesta — la fecha', () => {
  it('acepta la de hoy y la de la factura', () => {
    expect(validarPropuesta({ ...BASE, fecha: '2026-08-27' }, CTX).fecha).toBe('2026-08-27');
    expect(validarPropuesta({ ...BASE, fecha: '2026-08-14' }, CTX).fecha).toBe('2026-08-14');
  });

  it('rechaza el futuro', () => {
    expect(() => validarPropuesta({ ...BASE, fecha: '2026-08-28' }, CTX)).toThrow(/posterior a hoy/i);
  });

  it('rechaza pagar ANTES de que existiera la factura', () => {
    expect(() => validarPropuesta({ ...BASE, fecha: '2026-08-13' }, CTX)).toThrow(/anterior a la de la factura/i);
  });

  it('rechaza una fecha que no existe y una ilegible', () => {
    expect(() => validarPropuesta({ ...BASE, fecha: '2026-02-30' }, CTX)).toThrow(DatoInvalido);
    expect(() => validarPropuesta({ ...BASE, fecha: '20/08/2026' }, CTX)).toThrow(DatoInvalido);
    expect(() => validarPropuesta({ ...BASE, fecha: '' }, CTX)).toThrow(DatoInvalido);
  });
});

describe('validarPropuesta — el monto', () => {
  it('acepta lo que se pega desde un estado de cuenta', () => {
    expect(validarPropuesta({ ...BASE, monto: '$1,160.00' }, CTX).monto).toBe(1160);
    expect(validarPropuesta({ ...BASE, monto: ' 1160 ' }, CTX).monto).toBe(1160);
    expect(validarPropuesta({ ...BASE, monto: '1,160' }, CTX).monto).toBe(1160);
  });

  it('redondea a centavos con `round2`, no a mano', () => {
    expect(validarPropuesta({ ...BASE, monto: '0.1' }, CTX).monto).toBe(0.1);
    expect(validarPropuesta({ ...BASE, monto: '0.05' }, CTX).monto).toBe(0.05);
  });

  it('c7-33 · el redondeo de la casa sigue puesto donde SÍ se puede llegar', () => {
    // ESTA PRUEBA CAMBIÓ DE FORMA AL REBASAR, y vale la pena decir por qué.
    //
    // Nació para cubrir `c7-33` con la familia de los `.005` que
    // `Math.round(n*100)/100` tira hacia abajo (`1.005` → `1`, no `1.01`,
    // porque 1.005 se guarda como 1.00499999…). La prueba vieja de arriba
    // probaba `100.005` y PASABA incluso con el redondeo a mano, porque
    // `100.005*100` da exactamente `10000.5`: había elegido, sin saberlo, el
    // único valor de la familia que no falla.
    //
    // Pero `c7-14` (#156) llegó después y cerró la puerta ANTES del redondeo:
    // tres decimales ya no son un monto, son una duda, y se rechazan diciendo
    // cómo escribirlo (ver «más de dos decimales se rechaza» más abajo). O sea
    // que la familia `.005` ya no es alcanzable desde el formulario, y una
    // prueba que la exigiera contradiría al filtro. Lo que sí sigue siendo
    // cierto —y es lo que se fija aquí— es que el importe que sale es
    // EXACTO en centavos: `round2` normaliza la representación flotante en
    // lugar de arrastrarla hasta la base.
    for (const [tecleado, esperado] of [['1160.10', 1160.1], ['0.07', 0.07], ['1,234.56', 1234.56]] as const) {
      const monto = validarPropuesta({ ...BASE, monto: tecleado }, { ...CTX, saldo: 10_000 }).monto;
      expect(monto, `un centavo de más o de menos es un centavo que nadie concilia (${tecleado})`).toBe(esperado);
      expect(round2(monto), 'el importe ya viene redondeado: `round2` es idempotente sobre él').toBe(monto);
    }
  });

  it('cero y negativo se rechazan', () => {
    expect(() => validarPropuesta({ ...BASE, monto: '0' }, CTX)).toThrow(DatoInvalido);
    expect(() => validarPropuesta({ ...BASE, monto: '-100' }, CTX)).toThrow(DatoInvalido);
  });

  it('vacío e ilegible se rechazan con instrucción', () => {
    expect(() => validarPropuesta({ ...BASE, monto: '' }, CTX)).toThrow(/Escribe el monto/i);
    expect(() => validarPropuesta({ ...BASE, monto: 'mil pesos' }, CTX)).toThrow(/1234.50/);
  });

  // ── `c7-14`: LA CIFRA AMBIGUA SE PREGUNTA, NO SE ADIVINA ────────────────
  it('«1.234,50» se RECHAZA en vez de registrarse como $1.23', () => {
    // El hallazgo, textual: la regex barría las comas, quedaba "1.23450", y
    // `Number` leía el punto de millares como decimal. Un depósito de
    // $1,234.50 entraba a la bandeja del contralor como $1.23 sin una sola
    // advertencia, y el cliente salía creyendo que había registrado su pago.
    expect(() => validarPropuesta({ ...BASE, monto: '1.234,50' }, CTX)).toThrow(DatoInvalido);
    expect(() => validarPropuesta({ ...BASE, monto: '1.234,50' }, CTX)).toThrow(/1234.50/);
  });

  it('«1.234» —punto de millares sin decimales— tampoco pasa', () => {
    expect(() => validarPropuesta({ ...BASE, monto: '1.234' }, CTX)).toThrow(DatoInvalido);
  });

  it('la notación que nadie teclea en pesos no se interpreta', () => {
    // `Number('1e4')` es 10000 y `Number('0x10')` es 16. Ninguna de las dos
    // sale del teclado de una persona mirando su banca.
    expect(() => validarPropuesta({ ...BASE, monto: '1e4' }, CTX)).toThrow(DatoInvalido);
    expect(() => validarPropuesta({ ...BASE, monto: '0x10' }, CTX)).toThrow(DatoInvalido);
    expect(() => validarPropuesta({ ...BASE, monto: 'Infinity' }, CTX)).toThrow(DatoInvalido);
  });

  it('una coma de millares mal puesta se rechaza en vez de "corregirse"', () => {
    expect(() => validarPropuesta({ ...BASE, monto: '1,16' }, CTX)).toThrow(DatoInvalido);
    expect(() => validarPropuesta({ ...BASE, monto: '11,60.00' }, CTX)).toThrow(DatoInvalido);
  });

  it('más de dos decimales se rechaza: los centavos son dos dígitos', () => {
    expect(() => validarPropuesta({ ...BASE, monto: '100.005' }, CTX)).toThrow(DatoInvalido);
  });

  it('por encima del saldo se rechaza, y manda a hablar con la flota', () => {
    // El portal es de UNA factura: un depósito que cubre varias no se puede
    // repartir desde aquí, y fingir que sí dejaría un dicho imposible de cuadrar.
    expect(() => validarPropuesta({ ...BASE, monto: '1200' }, CTX)).toThrow(/saldo pendiente/i);
  });

  // ── `c7-6`: LA TOLERANCIA ES LA DE LA BASE, MEDIO CENTAVO ───────────────
  it('la tolerancia del portal es EXACTAMENTE la de `registrar_pago_tx`', () => {
    // Antes esto aceptaba `saldo + 0.01` y la RPC rechaza a partir de
    // `saldo + 0.005`: con saldo $1,160.00, un tecleo de $1,160.01 entraba a la
    // bandeja y luego era IMPOSIBLE de conciliar (CU011 motivo=sobrepago), para
    // siempre, con el dinero ya depositado. La constante ahora se importa de un
    // solo sitio y esta prueba fija el valor.
    expect(TOLERANCIA_ABONO_MXN).toBe(0.005);
    expect(() => validarPropuesta({ ...BASE, monto: '1160.01' }, CTX)).toThrow(/saldo pendiente/i);
    expect(validarPropuesta({ ...BASE, monto: '1160.00' }, CTX).monto).toBe(1160);
  });

  it('un pago PARCIAL entra sin problema: es la norma, no la excepción', () => {
    expect(validarPropuesta({ ...BASE, monto: '500' }, CTX).monto).toBe(500);
  });
});

describe('montoTecleado — el mismo lector para el portal y para el REP', () => {
  it('el mensaje del campo vacío nombra QUÉ falta', () => {
    // `registrarRepEmitido` lo usa con su propia etiqueta: un contralor que
    // deja vacío el importe del complemento no puede leer «escribe el monto
    // que pagaste», que es el texto del cliente.
    expect(() => montoTecleado('', 'el importe pagado del complemento'))
      .toThrow(/importe pagado del complemento/);
  });

  it('acepta las dos ortografías buenas y ninguna más', () => {
    expect(montoTecleado('11,600.00')).toBe(11600);
    expect(montoTecleado('$ 11600.5')).toBe(11600.5);
    expect(() => montoTecleado('11.600,00')).toThrow(DatoInvalido);
  });
});

describe('validarPropuesta — la referencia y el método', () => {
  it('la referencia es obligatoria y se explica para qué sirve', () => {
    expect(() => validarPropuesta({ ...BASE, referencia: '' }, CTX)).toThrow(/referencia bancaria/i);
    expect(() => validarPropuesta({ ...BASE, referencia: 'ab' }, CTX)).toThrow(DatoInvalido);
  });

  it('se recorta, para que cuadre con el CHECK de la 0228', () => {
    expect(validarPropuesta({ ...BASE, referencia: '  REF-8891  ' }, CTX).referencia).toBe('REF-8891');
  });

  it('más de 80 caracteres se rechaza en vez de truncarse en silencio', () => {
    expect(() => validarPropuesta({ ...BASE, referencia: 'x'.repeat(81) }, CTX)).toThrow(/80/);
    expect(validarPropuesta({ ...BASE, referencia: 'x'.repeat(80) }, CTX).referencia).toHaveLength(80);
  });

  it('el método es una lista cerrada: nada de texto libre de un tercero', () => {
    expect(() => validarPropuesta({ ...BASE, metodo: 'bitcoin' }, CTX)).toThrow(/Elige cómo pagaste/i);
    expect(() => validarPropuesta({ ...BASE, metodo: '' }, CTX)).toThrow(DatoInvalido);
    for (const m of METODOS_PORTAL) {
      expect(validarPropuesta({ ...BASE, metodo: m.id }, CTX).metodo).toBe(m.id);
    }
  });

  it('esMetodoPortal reconoce la lista y nada más', () => {
    expect(esMetodoPortal('cheque')).toBe(true);
    expect(esMetodoPortal('paypal')).toBe(false);
  });
});

describe('normalizarReferencia — espeja el índice único de la 0228', () => {
  it('mayúsculas y orillas: el mismo movimiento bancario', () => {
    // El índice es `upper(btrim(referencia))`. Esta función es la explicación,
    // no el candado — pero si divergiera, el mensaje de "ya lo registraste"
    // diría una cosa y la base haría otra.
    expect(normalizarReferencia(' ref-8891 ')).toBe('REF-8891');
    expect(normalizarReferencia('REF-8891')).toBe(normalizarReferencia('ref-8891'));
  });
});

describe('esCarnada — el honeypot descarta en silencio', () => {
  it('vacío, espacios y ausente NO son carnada', () => {
    expect(esCarnada('')).toBe(false);
    expect(esCarnada('   ')).toBe(false);
    expect(esCarnada(undefined)).toBe(false);
    expect(esCarnada(null)).toBe(false);
    expect(esCarnada(123)).toBe(false);
  });

  it('cualquier texto es carnada', () => {
    expect(esCarnada('https://spam.example')).toBe(true);
  });
});

describe('identificaFactura — «sin folio» es la verdad, no un guion', () => {
  it('serie y folio juntos cuando hay serie', () => {
    expect(identificaFactura({ serie: 'A', folio: '123', cfdiUuid: null })).toBe('A-123');
  });

  it('folio solo cuando no hay serie', () => {
    expect(identificaFactura({ serie: null, folio: '123', cfdiUuid: null })).toBe('123');
  });

  it('el UUID es el respaldo cuando no hay folio', () => {
    expect(identificaFactura({ serie: null, folio: null, cfdiUuid: 'abc-123' })).toBe('abc-123');
  });

  it('sin nada, lo dice con palabras', () => {
    // Un guion en una pantalla de cobranza se lee como un dato que no cargó.
    expect(identificaFactura({ serie: null, folio: null, cfdiUuid: null })).toBe('sin folio');
  });
});

describe('textoDelRep — cuatro estados, y ninguno se disfraza del otro', () => {
  it('sin REP dice que aparecerá cuando lo haya', () => {
    expect(textoDelRep([])).toMatch(/aparecerá aquí/i);
  });

  it('con XML ofrece la descarga', () => {
    expect(textoDelRep([{ cfdi_uuid: 'abc', tieneXml: true }])).toMatch(/descargar/i);
  });

  it('sin XML da el UUID citable y NO ofrece descarga', () => {
    // Un botón que no baja nada es peor que no ofrecerlo.
    const t = textoDelRep([{ cfdi_uuid: 'abc-999', tieneXml: false }]);
    expect(t).toContain('abc-999');
    expect(t).not.toMatch(/descarg/i);
    expect(t).toMatch(/pídeselo/i);
  });

  // ── `c7-16`: CON PARCIALIDADES SON VARIOS, Y SE DICEN EN PLURAL ─────────
  it('con tres complementos NO dice «tu complemento» en singular', () => {
    // La página afirmaba «Tu complemento de pago ya está listo» sobre una
    // factura con tres, y solo entregaba el más reciente: los otros dos —los
    // que el contador del cliente necesita para acreditar el IVA de esos
    // meses— no tenían ni ruta ni mención.
    const t = textoDelRep([
      { cfdi_uuid: 'a', tieneXml: true },
      { cfdi_uuid: 'b', tieneXml: true },
      { cfdi_uuid: 'c', tieneXml: true },
    ]);
    expect(t).toContain('3 complementos');
    expect(t).toMatch(/cada uno/i);
  });

  it('con varios y solo algunos con archivo, lo dice sin prometer de más', () => {
    const t = textoDelRep([
      { cfdi_uuid: 'a', tieneXml: true },
      { cfdi_uuid: 'b', tieneXml: false },
    ]);
    expect(t).toContain('2 complementos');
    expect(t).toMatch(/De 1 hay XML/);
  });

  it('con varios y ninguno con archivo, no ofrece ninguna descarga', () => {
    const t = textoDelRep([
      { cfdi_uuid: 'a', tieneXml: false },
      { cfdi_uuid: 'b', tieneXml: false },
    ]);
    expect(t).toMatch(/pídeselos/i);
    expect(t).not.toMatch(/puedes descargar/i);
  });
});
