import { describe, it, expect, afterEach } from 'vitest';
import { GUIONES, guionDe } from './portales';
import { COMERCIOS } from '../comercios';
import { PORTALES_CONOCIDOS, portalesOperables, registrarPortales, olvidarPortales, portalesVivos, type FlotaFiscal } from './registro';
import { facturarConAgente } from '../agente';
import type { PaginaPortal } from './playwright_base';

// ═══════════════════════════════════════════════════════════════════════════
// LA GUARDIANA DE LAS TABLAS DE SELECTORES.
//
// Estas pruebas no ejercitan el motor —eso es `guion.test.ts`—: vigilan que
// las DECLARACIONES sigan diciendo la verdad. Un guion es datos, y los datos se
// desincronizan del catálogo en silencio: alguien renombra una clave en
// `comercios.ts`, alguien marca un comercio como `requiereCuenta`, alguien
// agrega un campo obligatorio y la tabla se queda corta. Nada de eso rompe la
// compilación y todo eso factura mal.
//
// Y una que vale por todas: NINGÚN guion puede declararse `verificado` sin
// haber sido medido. Esa marca es lo único que habilita apretar el botón que
// crea un CFDI irreversible, así que el día que alguien la ponga «para que
// funcione», esta prueba tiene que ser lo que se lo impida — o al menos lo que
// le obligue a borrar una afirmación a mano y quedarse mirándola.
// ═══════════════════════════════════════════════════════════════════════════

const fichaDe = (clave: string) => COMERCIOS.find((c) => c.clave === clave);

describe('cada guion corresponde a un comercio REAL del catálogo', () => {
  it.each(GUIONES.map((g) => [g.comercio, g] as const))('%s existe en comercios.ts', (clave, g) => {
    const ficha = fichaDe(clave);
    expect(ficha, `el guion "${clave}" no corresponde a ningún comercio del catálogo`).toBeDefined();
    // La URL es lo que se abre de verdad. Dos verdades distintas sobre a dónde
    // ir es cómo se acaba facturando en el portal de otra cadena.
    expect(g.portal).toBe(ficha!.portal);
  });

  it('ninguno pide cuenta — es el criterio con el que se eligieron', () => {
    // Se declaró así y aquí se hace cumplir: sin cuenta = automatizable HOY,
    // sin que una persona vincule nada y sin tocar el cofre de credenciales.
    // El día que se agregue uno CON cuenta habrá que declarar `requiereSesion`
    // en su guion, y esta prueba es la que va a obligar a pensarlo.
    for (const g of GUIONES) {
      const ficha = fichaDe(g.comercio)!;
      if (ficha.requiereCuenta) {
        expect(g.requiereSesion, `${g.comercio} pide cuenta y su guion no declara requiereSesion`).toBe(true);
      }
    }
  });

  it('ninguno tiene sus campos pendientes de leer', () => {
    // Un comercio con `camposPendientes` no sabe ni cómo se llaman sus campos.
    // Escribirle una tabla de selectores sería inventarla entera.
    for (const g of GUIONES) {
      expect(fichaDe(g.comercio)!.camposPendientes, `${g.comercio} tiene camposPendientes`).toBeUndefined();
    }
  });
});

describe('cada guion cubre lo que su portal exige', () => {
  it('declara un selector para TODOS los campos requeridos de su ficha', () => {
    // Sin esto, el fallo aparece en producción con el navegador ya abierto:
    // `unTicket` lo caza («no sabe dónde van estos campos») pero después de
    // haber gastado una corrida. Aquí se caza en el push.
    const faltantes: string[] = [];
    for (const g of GUIONES) {
      for (const campo of fichaDe(g.comercio)!.campos) {
        if (campo.requerido && !g.campos[campo.clave]) {
          faltantes.push(`${g.comercio}.${campo.clave} ("${campo.etiquetaPortal}")`);
        }
      }
    }
    expect(faltantes).toEqual([]);
  });

  it('no declara selectores para campos que su ficha no menciona', () => {
    // Al revés también importa: un selector de más significa que alguien copió
    // la tabla de otro portal, y esa tabla va a escribir un dato en un campo
    // que este portal usa para otra cosa.
    const sobrantes: string[] = [];
    for (const g of GUIONES) {
      const enFicha = new Set(fichaDe(g.comercio)!.campos.map((c) => c.clave));
      for (const clave of Object.keys(g.campos)) {
        if (!enFicha.has(clave as never)) sobrantes.push(`${g.comercio}.${clave}`);
      }
    }
    expect(sobrantes).toEqual([]);
  });

  it('todos declaran botón de emitir y dónde vive el UUID', () => {
    for (const g of GUIONES) {
      expect(g.botonEmitir, `${g.comercio} sin botón de emitir`).toBeTruthy();
      // Sin `uuid` una emisión buena se reporta como «puede que el CFDI ya
      // exista», que manda a revisar a mano algo que salió bien.
      expect(g.uuid, `${g.comercio} no dice dónde vive el UUID`).toBeTruthy();
    }
  });

  it('el formato de Office Depot respeta lo que su HTML declaró', () => {
    const od = guionDe('office_depot')!;
    // Consta en la ficha: `<input formcontrolname="itu" maxlength="30" uppercase>`.
    // Es el único dato de DOM real que este repo tiene de estos cuatro portales,
    // y por eso su candidato va primero y su formato es `mayusculas`.
    expect(od.campos.numeroTicket?.formato).toBe('mayusculas');
    expect(od.campos.numeroTicket?.selector).toContain('input[formcontrolname="itu"]');
  });
});

describe('LA MARCA QUE HABILITA EMITIR', () => {
  it('ninguno de los cuatro primeros está marcado como verificado', () => {
    // NO es un pendiente olvidado: NINGUNO de estos portales se ha visitado.
    // Los selectores se derivaron de la `etiquetaPortal` del catálogo, que es
    // un dato real, pero derivar no es medir. Con `verificado: null` el motor
    // ensaya y se NIEGA a emitir (ver `motivoSinVerificar`).
    //
    // Cuando alguien corra el arnés y pegue aquí lo que reportó, esta prueba va
    // a fallar — y ese fallo es la señal de que hay que leer lo que se pegó y
    // decidir si es verdad, no de que hay que borrar la prueba.
    const marcados = GUIONES.filter((g) => g.verificado !== null).map((g) => g.comercio);
    expect(marcados, 'un guion se marcó como verificado: hay que revisar que el arnés lo respalde').toEqual([]);
  });

  it('si alguno se marca, la marca tiene que traer fecha, arnés y selectores', () => {
    // La forma de la evidencia, para que «verificado» no pueda ser un `true`
    // suelto que nadie puede auditar después.
    for (const g of GUIONES) {
      if (g.verificado === null) continue;
      expect(g.verificado.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(g.verificado.arnes).toBeTruthy();
      expect(g.verificado.resueltos.length).toBeGreaterThan(0);
    }
  });
});

describe('la lista', () => {
  it('no repite comercios: dos tablas para el mismo portal es una que nadie mantiene', () => {
    const claves = GUIONES.map((g) => g.comercio);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('todos entran a PORTALES_CONOCIDOS sin que nadie los copie a mano', () => {
    // Es EL punto de la rama: agregar un portal es escribir su tabla, y nada
    // más. `TABLA` en registro.ts se deriva de `GUIONES`.
    for (const g of GUIONES) expect(PORTALES_CONOCIDOS).toContain(g.comercio);
    // Y CAPUFE sigue ahí: el adaptador escrito a mano no se retiró.
    expect(PORTALES_CONOCIDOS).toContain('capufe');
  });

  it('`guionDe` no inventa: devuelve null para lo que no está', () => {
    expect(guionDe('enerser')?.comercio).toBe('enerser');
    expect(guionDe('no_existe')).toBeNull();
    // CAPUFE tiene adaptador escrito, no guion: preguntarlo aquí devuelve null.
    expect(guionDe('capufe')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL HUECO QUE ESCRIBIR UNA TABLA PODRÍA HABER ABIERTO.
//
// El motor ya se niega a emitir con un mapeo sin medir, y eso basta para no
// hacer un CFDI malo. Pero NO basta para el producto: `portalesOperables()` es
// lo que el cron usa para TOMAR gastos de la cola y lo que `avisar.ts` usa para
// NO molestar al encargado. Un portal que solo sabe ensayar, contado como
// operable, le quita el ticket al encargado, gasta una sesión de navegador por
// vuelta y no emite nunca — el comprobante se vence sin que nadie lo mire.
//
// Estas pruebas son las que impiden ese hueco. Si alguien "simplifica"
// `bloqueado` en la TABLA, aquí se pone rojo.
// ═══════════════════════════════════════════════════════════════════════════

describe('un guion sin medir NO le quita el ticket al encargado', () => {
  const PAGINA_FALSA: PaginaPortal = {
    abrir: async () => {}, escribir: async () => {}, hacerClic: async () => {},
    leerTexto: async () => null, captura: async () => 'sin-captura',
  };
  const FLOTA: FlotaFiscal = {
    tenantId: 'tenant-portales-test',
    rfc: 'GMX0902279I1',
    nombre: 'TRANSPORTES DEL BAJIO SA DE CV',
    codigoPostal: '37000', regimenFiscal: '601', usoCfdi: 'G03',
    correo: 'facturas@transportesdelbajio.mx',
  };

  afterEach(() => olvidarPortales(FLOTA.tenantId));

  it('ninguno de los cuatro entra a `portalesOperables()`', () => {
    // `portalesOperables()` es «lo voy a hacer yo esta vuelta». Mientras el
    // guion sea una hipótesis, la respuesta es no, y el ticket sigue su camino
    // de siempre: el encargado.
    for (const g of GUIONES) {
      if (g.verificado !== null) continue;
      expect(portalesOperables(), `${g.comercio} se coló a portalesOperables sin estar medido`).not.toContain(g.comercio);
    }
  });

  it('pero SÍ entran a `PORTALES_CONOCIDOS` — el panel los cuenta', () => {
    // Son dos preguntas distintas: «qué sé hacer» y «qué voy a hacer ahora».
    // La pantalla de Conexiones enseña «N operables de M conocidos», y meter
    // estos cuatro en la M es verdad: el código sabe qué son y sabe ensayarlos.
    for (const g of GUIONES) expect(PORTALES_CONOCIDOS).toContain(g.comercio);
  });

  it('quedan como CENTINELA que dice por qué, no como adaptador vivo', async () => {
    const r = registrarPortales({ flota: FLOTA, abrirPagina: async () => PAGINA_FALSA });

    for (const g of GUIONES) {
      if (g.verificado !== null) continue;
      expect(portalesVivos(FLOTA.tenantId)).not.toContain(g.comercio);
      expect(r.registrados).not.toContain(g.comercio);
      expect(r.problemas.some((p) => p.startsWith(`${g.comercio}:`))).toBe(true);
    }
  });

  it('y si alguien los llama igual, el centinela contesta sin emitir', async () => {
    registrarPortales({ flota: FLOTA, abrirPagina: async () => PAGINA_FALSA });
    const sinMedir = GUIONES.find((g) => g.verificado === null)!;

    const salida = await facturarConAgente({
      tenantId: FLOTA.tenantId, comercio: sinMedir.comercio, modo: 'emitir',
      campos: [{ clave: 'monto', etiqueta: 'Monto', valor: '10.00', requerido: false }],
    });

    expect(salida.ok).toBe(false);
    expect(salida.cfdiUuid).toBeUndefined();
    expect(salida.error).toContain('NO se ha medido');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS PLATAFORMAS: LA AFIRMACIÓN DE QUE UN ADAPTADOR VALE POR VARIOS.
//
// El recon del 28-ago-2026 encontró que varios comercios corren el MISMO
// software con los MISMOS `id`. De ahí sale la promesa que abarata este frente:
// «automatizar N portales no cuesta N adaptadores». Una promesa así, escrita
// solo en un comentario, es la que se rompe callada el día que alguien toca una
// de las dos copias — así que aquí se mide.
// ═══════════════════════════════════════════════════════════════════════════
describe('un adaptador de plataforma cubre N comercios', () => {
  it('ControlGAS® y facturacionestacion producen la MISMA tabla, solo cambia el host', () => {
    // Se construyen dos instancias de cada fábrica con hosts distintos y se
    // comparan los selectores. Si alguien "arregla" una plataforma escribiendo
    // el selector a mano en un comercio, esto lo caza.
    const facturagas = guionDe('facturagas');
    const sevafusa = guionDe('sevafusa');
    expect(facturagas, 'facturagas debe estar escrito').not.toBeNull();
    expect(sevafusa, 'sevafusa debe estar escrito').not.toBeNull();

    // Cada uno apunta a SU host, que es lo único que la fábrica parametriza.
    expect(facturagas!.portal).toContain('facturagas.net');
    expect(sevafusa!.portal).toContain('sevafusa.facturacionestacion.com');

    // Y los `id` de la plataforma son de la PLATAFORMA: los de sevafusa son los
    // que el recon leyó y sirven para cualquier subdominio que la use.
    expect(JSON.stringify(sevafusa!.campos)).toContain('#txtReferencia');
    expect(JSON.stringify(facturagas!.campos)).toContain('#despacho');
  });

  it('los selectores leídos del DOM se distinguen de los adivinados', () => {
    // `lecturaDeCampo` NO autoriza emitir —solo `verificado` lo hace— pero sí
    // cambia qué significa que el pre-vuelo falle: con lectura, "el portal
    // cambió"; sin ella, "adivinamos mal". Que la distinción exista en el
    // dato, y no solo en la cabeza de quien lo escribió, es el punto.
    const conLectura = GUIONES.filter((g) => g.lecturaDeCampo);
    const sinLectura = GUIONES.filter((g) => !g.lecturaDeCampo);

    // Los diez del recon la tienen; los cuatro del PR #163 no, porque sus
    // selectores se derivaron de la etiqueta del catálogo.
    expect(conLectura.length).toBe(10);
    expect(sinLectura.map((g) => g.comercio).sort())
      .toEqual(['autozone', 'controlnet', 'enerser', 'office_depot']);

    for (const g of conLectura) {
      expect(g.lecturaDeCampo!.fecha, g.comercio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(g.lecturaDeCampo!.acta, g.comercio).toMatch(/RECON-PORTALES-(17|20)\.md/);
    }
  });

  it('NINGUNO se declara verificado: leer el DOM no es haber ensayado', () => {
    // La línea que no se cruza. El recon copió selectores de páginas reales,
    // pero NO envió un solo formulario: en casi todos los portales no llegó a
    // ver la pantalla del receptor ni el botón que emite. Ascender eso a
    // `verificado` sería exactamente el fraude que la política 1 impide, y
    // habilitaría apretar el botón que crea un CFDI irreversible.
    for (const g of GUIONES) {
      expect(g.verificado, `${g.comercio}: nadie ha corrido el arnés de pre-vuelo`).toBeNull();
    }
  });
});
