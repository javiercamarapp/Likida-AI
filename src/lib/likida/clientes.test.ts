import { describe, it, expect } from 'vitest';
import {
  validarCliente, validarTarifa, normalizarPlaza, tarifaSugerida, esModoTarifa,
  type ClienteCrudo, type TarifaCruda, type TarifaRow,
} from './clientes';
import { DatoInvalido } from './errores';

// ═══════════════════════════════════════════════════════════════════════════
// SOLO LO PURO. Nada de aquí toca Supabase: lo que se prueba es la parte que
// decide DINERO —qué tarifa aplica y cuánto sale— y la que decide si un dato
// capturado es un dato o un hueco. Las escrituras (`crearCliente`,
// `crearTarifa`) no se prueban aquí: probarlas contra un mock del cliente de
// Supabase demostraría que el mock funciona.
// ═══════════════════════════════════════════════════════════════════════════

const CLIENTE_OK: ClienteCrudo = {
  nombre: 'Transportes del Bajío',
  rfc: '',
  contacto: '',
  correo: '',
  telefono: '',
  diasCredito: '',
  activo: true,
};

// RFC real en forma y con dígito verificador correcto (persona moral, 12).
const RFC_BUENO = 'TME960204P56';
// Misma forma, dígito verificador equivocado — es el caso que el regex deja pasar.
const RFC_FORMA_BUENA_DIGITO_MALO = 'ABC010101AA1';

describe('validarCliente — un hueco no se guarda como cero', () => {
  it('días de crédito vacío queda en null, NO en 0', () => {
    // `Number('')` es 0, y ese 0 significaría "contado": la cobranza le
    // pondría vencimiento el mismo día a cada factura y pintaría de rojo una
    // cartera que nadie pactó a contado.
    expect(validarCliente(CLIENTE_OK).diasCredito).toBeNull();
  });

  it('un 0 tecleado SÍ es cero: contado', () => {
    expect(validarCliente({ ...CLIENTE_OK, diasCredito: '0' }).diasCredito).toBe(0);
  });

  it('los días de crédito viven entre 0 y 365, como el constraint de la 0048', () => {
    expect(() => validarCliente({ ...CLIENTE_OK, diasCredito: '400' })).toThrow(DatoInvalido);
    expect(() => validarCliente({ ...CLIENTE_OK, diasCredito: '-5' })).toThrow(DatoInvalido);
  });

  it('medio día de crédito no existe', () => {
    expect(() => validarCliente({ ...CLIENTE_OK, diasCredito: '15.5' })).toThrow(DatoInvalido);
  });

  it('los opcionales vacíos quedan en null, no en cadena vacía', () => {
    const c = validarCliente(CLIENTE_OK);
    expect(c.rfc).toBeNull();
    expect(c.correo).toBeNull();
    expect(c.telefono).toBeNull();
    expect(c.contacto).toBeNull();
  });
});

describe('validarCliente — el RFC del receptor', () => {
  it('se normaliza a mayúsculas y sin separadores', () => {
    expect(validarCliente({ ...CLIENTE_OK, rfc: ' tme-960204-p56 ' }).rfc).toBe(RFC_BUENO);
  });

  it('un RFC con la forma correcta y el dígito verificador mal se rechaza', () => {
    // El regex de forma acepta cualquier cosa con la pinta correcta. Sin el
    // dígito verificador, el error se descubre cuando el PAC rebota el CFDI —
    // con el viaje entregado y el cobro detenido.
    expect(() => validarCliente({ ...CLIENTE_OK, rfc: RFC_FORMA_BUENA_DIGITO_MALO }))
      .toThrow(DatoInvalido);
  });

  it('sin RFC se puede dar de alta: es opcional en el alta', () => {
    expect(validarCliente({ ...CLIENTE_OK, rfc: '   ' }).rfc).toBeNull();
  });
});

describe('validarCliente — nombre, correo y teléfono', () => {
  it('un nombre de dos letras no identifica a nadie en la lista', () => {
    expect(() => validarCliente({ ...CLIENTE_OK, nombre: 'AB' })).toThrow(DatoInvalido);
  });

  it('el nombre se recorta', () => {
    expect(validarCliente({ ...CLIENTE_OK, nombre: '  Cementos Fuerte  ' }).nombre).toBe('Cementos Fuerte');
  });

  it('un correo sin arroba se rechaza', () => {
    expect(() => validarCliente({ ...CLIENTE_OK, correo: 'compras.empresa.com' })).toThrow(DatoInvalido);
  });

  it('un correo bien escrito pasa', () => {
    expect(validarCliente({ ...CLIENTE_OK, correo: 'compras@empresa.com' }).correo).toBe('compras@empresa.com');
  });

  it('un teléfono de 7 dígitos no alcanza para marcarle a nadie', () => {
    expect(() => validarCliente({ ...CLIENTE_OK, telefono: '1234567' })).toThrow(DatoInvalido);
  });

  it('el teléfono se guarda COMO SE TECLEÓ, con extensión y todo', () => {
    // A diferencia de `operador.telefono` —que es la identidad de WhatsApp y
    // sí se normaliza—, éste es un contacto de cobranza: aplanarlo a dígitos
    // borraría la extensión, que es justo lo que hace que alguien conteste.
    const t = '55 1234 5678 ext. 210';
    expect(validarCliente({ ...CLIENTE_OK, telefono: t }).telefono).toBe(t);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

const TARIFA_OK: TarifaCruda = {
  clienteId: '',
  origen: 'Silao',
  destino: 'Monterrey',
  modo: 'por_viaje',
  precio: '28500',
  moneda: 'MXN',
  vigenteDesde: '2026-01-01',
  vigenteHasta: '',
  activa: true,
};

describe('validarTarifa — los constraints de la 0048, dichos en palabras', () => {
  it('un modo fuera del dominio se rechaza antes de llegar a Postgres', () => {
    expect(() => validarTarifa({ ...TARIFA_OK, modo: 'por_caja' })).toThrow(DatoInvalido);
    expect(esModoTarifa('por_caja')).toBe(false);
    expect(esModoTarifa('por_tonelada')).toBe(true);
  });

  it('un precio de cero no es una tarifa barata: es una que cotiza gratis', () => {
    expect(() => validarTarifa({ ...TARIFA_OK, precio: '0' })).toThrow(DatoInvalido);
    expect(() => validarTarifa({ ...TARIFA_OK, precio: '-100' })).toThrow(DatoInvalido);
  });

  it('acepta la coma decimal y el separador de millares — así se pega desde Excel', () => {
    expect(validarTarifa({ ...TARIFA_OK, precio: '28,500.50' }).precio).toBe(28500.5);
    expect(validarTarifa({ ...TARIFA_OK, precio: '28,500' }).precio).toBe(28500);
    expect(validarTarifa({ ...TARIFA_OK, modo: 'por_km', precio: '28,5' }).precio).toBe(28.5);
  });

  it('el tope es POR MODO: $5,000 por viaje es normal, por kilómetro es un dedazo', () => {
    expect(validarTarifa({ ...TARIFA_OK, precio: '5000' }).precio).toBe(5000);
    expect(() => validarTarifa({ ...TARIFA_OK, modo: 'por_km', precio: '5000' })).toThrow(DatoInvalido);
  });

  it('una vigencia al revés se rechaza: dejaría la tarifa fuera de todo rango', () => {
    expect(() => validarTarifa({
      ...TARIFA_OK, vigenteDesde: '2026-08-01', vigenteHasta: '2026-07-01',
    })).toThrow(DatoInvalido);
  });

  it('sin fecha de fin la tarifa es abierta, no inválida', () => {
    expect(validarTarifa(TARIFA_OK).vigenteHasta).toBeNull();
  });

  it('una fecha que no existe se rechaza en vez de rodar al mes siguiente', () => {
    // `new Date('2026-02-31')` no truena: da el 3 de marzo. La tarifa entraría
    // en vigor tres días después de lo que alguien tecleó, sin avisar.
    expect(() => validarTarifa({ ...TARIFA_OK, vigenteDesde: '2026-02-31' })).toThrow(DatoInvalido);
  });

  it('por ahora solo pesos: mezclar dólares daría un ingreso que no es de nadie', () => {
    expect(() => validarTarifa({ ...TARIFA_OK, moneda: 'USD' })).toThrow(DatoInvalido);
    expect(validarTarifa({ ...TARIFA_OK, moneda: '' }).moneda).toBe('MXN');
  });

  it('un cliente que no es un uuid se rechaza aquí, no con un error de Postgres', () => {
    expect(() => validarTarifa({ ...TARIFA_OK, clienteId: 'el-de-siempre' })).toThrow(DatoInvalido);
  });

  it('sin cliente es tarifa de lista, y eso es válido', () => {
    expect(validarTarifa(TARIFA_OK).clienteId).toBeNull();
  });

  it('origen y destino vacíos quedan en null: la tarifa aplica a cualquier ruta', () => {
    const t = validarTarifa({ ...TARIFA_OK, origen: '  ', destino: '' });
    expect(t.origen).toBeNull();
    expect(t.destino).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('normalizarPlaza', () => {
  it('acentos y mayúsculas no hacen dos plazas de una', () => {
    expect(normalizarPlaza('León')).toBe(normalizarPlaza('LEON'));
    expect(normalizarPlaza('  San Luis   Potosí ')).toBe('san luis potosi');
  });

  it('vacío y ausente son lo mismo: sin plaza', () => {
    expect(normalizarPlaza('   ')).toBeNull();
    expect(normalizarPlaza(null)).toBeNull();
    expect(normalizarPlaza(undefined)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════

const HOY = '2026-08-14';
const CLIENTE_A = '11111111-1111-4111-8111-111111111111';
const CLIENTE_B = '22222222-2222-4222-8222-222222222222';

function tarifa(p: Partial<TarifaRow> = {}): TarifaRow {
  return {
    id: 't-1',
    clienteId: null,
    clienteNombre: null,
    origen: null,
    destino: null,
    modo: 'por_viaje',
    precio: 10_000,
    moneda: 'MXN',
    vigenteDesde: '2026-01-01',
    vigenteHasta: null,
    activa: true,
    creadaEn: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

const VIAJE = { clienteId: CLIENTE_A, origen: 'Silao', destino: 'Monterrey', fecha: HOY };

describe('tarifaSugerida — cuándo NINGUNA aplica', () => {
  it('sin catálogo no se sugiere nada (y no se inventa un precio)', () => {
    expect(tarifaSugerida([], VIAJE)).toBeNull();
  });

  it('una tarifa inactiva no aplica', () => {
    expect(tarifaSugerida([tarifa({ activa: false })], VIAJE)).toBeNull();
  });

  it('una tarifa vencida no es "la única que había": es inaplicable', () => {
    expect(tarifaSugerida([tarifa({ vigenteHasta: '2026-08-13' })], VIAJE)).toBeNull();
  });

  it('una tarifa que todavía no entra en vigor tampoco', () => {
    expect(tarifaSugerida([tarifa({ vigenteDesde: '2026-08-15' })], VIAJE)).toBeNull();
  });

  it('una tarifa de otra ruta no se estira para cubrir ésta', () => {
    // Con `includes` en vez de igualdad, "Monterrey" cotizaría un viaje a
    // "Nuevo Monterrey" al mismo precio.
    expect(tarifaSugerida([tarifa({ origen: 'Silao', destino: 'Nuevo Monterrey' })], VIAJE)).toBeNull();
  });

  it('una tarifa negociada con OTRO cliente no es una tarifa de lista', () => {
    expect(tarifaSugerida([tarifa({ clienteId: CLIENTE_B })], VIAJE)).toBeNull();
  });

  it('un viaje sin cliente no hereda la tarifa negociada de nadie', () => {
    expect(tarifaSugerida([tarifa({ clienteId: CLIENTE_A })], { ...VIAJE, clienteId: null })).toBeNull();
  });
});

describe('tarifaSugerida — los bordes de la vigencia son inclusivos', () => {
  it('el día en que entra en vigor, ya rige', () => {
    expect(tarifaSugerida([tarifa({ vigenteDesde: HOY })], VIAJE)).not.toBeNull();
  });

  it('el último día pactado, todavía rige', () => {
    expect(tarifaSugerida([tarifa({ vigenteHasta: HOY })], VIAJE)).not.toBeNull();
  });
});

describe('tarifaSugerida — cuál gana', () => {
  it('la negociada con el cliente le gana a la de lista, aunque la de lista describa la ruta', () => {
    const lista = tarifa({ id: 'lista', origen: 'Silao', destino: 'Monterrey', precio: 30_000 });
    const negociada = tarifa({ id: 'negociada', clienteId: CLIENTE_A, precio: 26_000 });
    const s = tarifaSugerida([lista, negociada], VIAJE)!;
    expect(s.tarifa.id).toBe('negociada');
    expect(s.monto).toBe(26_000);
    expect(s.desplazadas).toBe(1);
  });

  it('entre dos de lista gana la de ruta exacta', () => {
    const generica = tarifa({ id: 'generica', precio: 30_000 });
    const exacta = tarifa({ id: 'exacta', origen: 'Silao', destino: 'Monterrey', precio: 27_000 });
    const s = tarifaSugerida([generica, exacta], VIAJE)!;
    expect(s.tarifa.id).toBe('exacta');
    expect(s.porque).toContain('ruta exacta');
  });

  it('la ruta se compara sin acentos ni mayúsculas', () => {
    const s = tarifaSugerida(
      [tarifa({ id: 'leon', origen: 'LEON', destino: 'Monterrey' })],
      { ...VIAJE, origen: 'León' },
    );
    expect(s?.tarifa.id).toBe('leon');
  });

  it('a igual especificidad, el precio que entró en vigor DESPUÉS reemplaza al viejo', () => {
    const vieja = tarifa({ id: 'vieja', vigenteDesde: '2026-01-01', precio: 25_000 });
    const nueva = tarifa({ id: 'nueva', vigenteDesde: '2026-07-01', precio: 31_000 });
    const s = tarifaSugerida([vieja, nueva], VIAJE)!;
    expect(s.tarifa.id).toBe('nueva');
    expect(s.ambigua).toBe(false);
  });
});

describe('tarifaSugerida — el empate se DICE, no se esconde', () => {
  it('dos igual de específicas y vigentes con precios distintos salen marcadas', () => {
    const a = tarifa({ id: 'a', origen: 'Silao', precio: 25_000 });
    const b = tarifa({ id: 'b', destino: 'Monterrey', precio: 31_000 });
    const s = tarifaSugerida([a, b], VIAJE)!;
    // Se elige una para poder enseñar algo, pero el catálogo tiene dos
    // verdades y cotizar en silencio sería cotizar a suerte.
    expect(s.ambigua).toBe(true);
    expect(s.desplazadas).toBe(1);
  });

  it('si el empate es al MISMO precio no hay nada que advertir', () => {
    const a = tarifa({ id: 'a', origen: 'Silao', precio: 25_000 });
    const b = tarifa({ id: 'b', destino: 'Monterrey', precio: 25_000 });
    expect(tarifaSugerida([a, b], VIAJE)!.ambigua).toBe(false);
  });

  it('el desempate es determinista: la misma cotización dos veces da lo mismo', () => {
    const a = tarifa({ id: 'a', origen: 'Silao', precio: 25_000, creadaEn: '2026-03-01T00:00:00.000Z' });
    const b = tarifa({ id: 'b', destino: 'Monterrey', precio: 31_000, creadaEn: '2026-05-01T00:00:00.000Z' });
    // Gana la capturada al último: sin esta regla, el precio cambia entre dos
    // cargas de la página según cómo devuelva las filas Postgres.
    expect(tarifaSugerida([a, b], VIAJE)!.tarifa.id).toBe('b');
    expect(tarifaSugerida([b, a], VIAJE)!.tarifa.id).toBe('b');
  });
});

describe('tarifaSugerida — el monto solo sale si el dato existe', () => {
  it('por viaje: el precio es el monto', () => {
    const s = tarifaSugerida([tarifa({ modo: 'por_viaje', precio: 28_500 })], VIAJE)!;
    expect(s.monto).toBe(28_500);
    expect(s.falta).toBeNull();
  });

  it('por km CON kilómetros: precio × km', () => {
    const s = tarifaSugerida([tarifa({ modo: 'por_km', precio: 28.5 })], { ...VIAJE, km: 912 })!;
    expect(s.monto).toBe(25_992);
  });

  it('por km SIN kilómetros: no cotiza $0, no cotiza', () => {
    // Un $0.00 aquí se leería como "este flete no vale nada", que es una
    // medición; lo que hay es un dato que nadie capturó.
    const s = tarifaSugerida([tarifa({ modo: 'por_km', precio: 28.5 })], VIAJE)!;
    expect(s.monto).toBeNull();
    expect(s.falta).toBe('km');
    // La tarifa SÍ se identifica: se sabe cuál aplica, solo falta el dato.
    expect(s.tarifa.modo).toBe('por_km');
  });

  it('cero kilómetros se trata como no capturado, no como cero', () => {
    const s = tarifaSugerida([tarifa({ modo: 'por_km', precio: 28.5 })], { ...VIAJE, km: 0 })!;
    expect(s.monto).toBeNull();
    expect(s.falta).toBe('km');
  });

  it('por tonelada: el esquema NO guarda el tonelaje, así que sin teclearlo no hay monto', () => {
    const s = tarifaSugerida([tarifa({ modo: 'por_tonelada', precio: 900 })], VIAJE)!;
    expect(s.monto).toBeNull();
    expect(s.falta).toBe('toneladas');
  });

  it('por tonelada con el tonelaje tecleado sí cotiza', () => {
    const s = tarifaSugerida([tarifa({ modo: 'por_tonelada', precio: 900 })], { ...VIAJE, toneladas: 28 })!;
    expect(s.monto).toBe(25_200);
  });

  it('el monto sale a centavos, sin la cola binaria de multiplicar', () => {
    // 28.5 × 3.1 en punto flotante es 88.35000000000001, y esa cola se
    // imprimiría tal cual junto a un signo de pesos. `round2` vive en
    // formato.ts y se importa, no se reimplementa.
    const s = tarifaSugerida([tarifa({ modo: 'por_km', precio: 28.5 })], { ...VIAJE, km: 3.1 })!;
    expect(s.monto).toBe(88.35);
  });
});
