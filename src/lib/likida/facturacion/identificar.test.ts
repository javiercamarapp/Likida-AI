import { describe, it, expect } from 'vitest';
import { identificarComercio } from './identificar';
import { COMERCIOS, comercio } from './comercios';

// De qué comercio es el ticket. Es el primer paso de todo: sin comercio no se
// sabe qué campos pedirle al OCR ni a qué portal ir.
//
// Regla dura: si no hay una respuesta ÚNICA no se adivina. Mandar un ticket al
// portal equivocado no falla de forma visible — falla pidiéndole a la oficina
// datos que ese ticket no tiene, y nadie entiende por qué.
describe('identificarComercio', () => {
  it('la liga del QR manda: es el dato que no pasó por OCR', () => {
    const c = identificarComercio({ urlFacturacion: 'https://facturacion.oxxogas.com/#/inicio' });
    expect(c?.clave).toBe('oxxo_gas');
  });

  it('reconoce por RFC del emisor', () => {
    // El RFC lo valida el dígito verificador (cfdi.ts), así que cuando pasa esa
    // prueba es una llave sólida.
    const c = identificarComercio({ rfcEmisor: 'CPU970326PZ4' });
    expect(c?.clave).toBe('capufe');
  });

  it('reconoce por el texto impreso cuando no hay liga ni RFC', () => {
    const c = identificarComercio({ textoTicket: 'CAMINOS Y PUENTES FEDERALES  CASETA 042  CUOTA $310.00' });
    expect(c?.clave).toBe('capufe');
  });

  it('la liga gana sobre un texto que apunta a otro lado', () => {
    // Un ticket de gasolinera puede traer impresa publicidad de otra marca. La
    // liga del QR viene del emisor y no se lee con visión: gana siempre.
    const c = identificarComercio({
      urlFacturacion: 'https://facturacion.oxxogas.com/',
      textoTicket: 'GRACIAS POR SU COMPRA EN CAPUFE',
    });
    expect(c?.clave).toBe('oxxo_gas');
  });

  it('si nada casa devuelve null en vez de inventar', () => {
    expect(identificarComercio({ textoTicket: 'ABARROTES DOÑA MARY' })).toBeNull();
  });

  // Ticket real de Tim Hortons (2-ago-2026): el emisor impreso es "OPERADORA
  // DE CAFE PENINSULAR", y "OPERADORA" contiene la subcadena "ADO" — el token
  // de reconocimiento de ADO (autobuses). Con matching por substring esto
  // identificaba el café como la línea de camiones y mandaba al operador a
  // pedir "número de boleto" a un ticket que nunca lo tuvo.
  it('un token corto no casa dentro de otra palabra', () => {
    expect(identificarComercio({ textoTicket: 'OPERADORA DE CAFE PENINSULAR' })).toBeNull();
  });

  it('sin ninguna señal devuelve null', () => {
    expect(identificarComercio({})).toBeNull();
  });
});

describe('registro de comercios', () => {
  it('toda clave es única', () => {
    const claves = COMERCIOS.map((c) => c.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('todo comercio declara al menos una forma de reconocerse', () => {
    for (const c of COMERCIOS) {
      const señales = (c.reconocer.dominios?.length ?? 0) + (c.reconocer.rfc?.length ?? 0) + (c.reconocer.texto?.length ?? 0);
      expect(señales, `${c.clave} no se puede reconocer`).toBeGreaterThan(0);
    }
  });

  // El invariante se mantiene, pero "todavía no lo sé" pasa a ser una declaración
  // explícita en vez de un array vacío indistinguible de un descuido. Un comercio
  // con `camposPendientes` avisa a qué portal ir y NO enumera campos: las
  // etiquetas se le enseñan a un contralor y de memoria saldrían inventadas.
  it('todo comercio declara sus campos, o declara que están pendientes', () => {
    for (const c of COMERCIOS) {
      const declara = c.campos.length > 0;
      expect(declara !== !!c.camposPendientes, `${c.clave}: campos y camposPendientes se contradicen`).toBe(true);
    }
  });

  // MISMO INVARIANTE QUE ANTES, con la excepción DECLARADA que trajo el banco
  // de tickets reales: un comercio o tiene portal, o lleva `portalPendiente` y
  // entonces `enrutar` lo devuelve como incompleto sin mandar a nadie a una
  // liga en blanco. Lo que sigue prohibido —y es lo que esta prueba cuida— es
  // un portal vacío SIN la marca. Los dos sentidos del ⟺ y la lista cerrada de
  // pendientes están en el bloque del final del archivo.
  it('ningún comercio se anuncia sin portal a dónde mandar al operador', () => {
    for (const c of COMERCIOS) {
      if (c.portalPendiente) continue;
      expect(c.portal, `${c.clave} no tiene portal`).toMatch(/^https?:\/\//);
    }
  });

  it('CAPUFE y Enerser no exigen cuenta: son el arranque sin custodiar contraseñas', () => {
    expect(comercio('capufe')?.requiereCuenta).toBe(false);
    expect(comercio('enerser')?.requiereCuenta).toBe(false);
  });

  // CORREGIDA CONTRA EL PORTAL REAL, 29-jul-2026. Esta prueba afirmaba que G500
  // "pide Folio Y Web ID — los dos, no uno", con el comentario "el portal no
  // acepta uno solo". Se escribió desde una suposición razonable —el ticket
  // imprime los dos— y NADIE la había comprobado.
  //
  // Facturando un ticket de verdad (G500 MEGASUR, folio 1000724, WebID
  // 5480061000724), el formulario de megasur.com.mx:8029 tiene UN campo,
  // "Autorización/WebID", y con el WebID solo trajo estación, litros, producto,
  // precio, importe y forma de pago ya resueltos.
  //
  // Pedirle al operador un dato que el portal no necesita es fricción inventada,
  // y en carretera con el celular la fricción es lo que hace que no facture.
  // ⚠️ ESTA PRUEBA CAMBIÓ DE SUJETO EL 28-ago-2026, y el porqué es el bug.
  //
  // Lo de arriba se midió facturando un ticket de G500 MEGASUR, o sea del
  // SURESTE — y se asentó en la ficha `g500`, la de la RED. El recon visitó las
  // dos fichas por separado con contexto limpio y devolvieron LA MISMA PÁGINA:
  // `g500` seguía apuntando a `megasur.com.mx:8029` aunque su propio comentario
  // ya dijera que esa entrada era para la red. La prueba estaba certificando
  // sobre `g500` un hecho que solo es cierto de `megasur`.
  //
  // Así que la afirmación se muda a la ficha que sí se facturó, y `g500` pasa a
  // afirmar lo único que se sabe de la red: que NO se sabe.
  it('a MEGASUR le basta el Web ID: lo demás lo resuelve el portal', () => {
    const requeridos = comercio('megasur')!.campos.filter((x) => x.requerido).map((x) => x.clave);
    expect(requeridos).toEqual(['webId']);
  });

  it('pero el folio se conserva como opcional, para que el operador coteje', () => {
    // El portal devuelve el folio DENTRO de la descripción de la línea
    // ("1000724 - GASOLINA CONTENIDO MIN. 91 OCTANOS"), así que sirve para
    // confirmar que la línea que trajo es la del ticket que tiene en la mano.
    const opcionales = comercio('megasur')!.campos.filter((x) => !x.requerido).map((x) => x.clave);
    expect(opcionales).toContain('folio');
  });

  it('G500 (la red) NO hereda ni el portal ni los campos del sureste', () => {
    // La regresión exacta que se arregló: mientras `portal` apuntara a
    // `megasur.com.mx:8029`, cualquier ticket G500 de otra región mandaba al
    // operador a Mérida, donde su WebID no existe. Y las dos fichas declaraban
    // `requiereCuenta` OPUESTO para la misma página.
    const red = comercio('g500')!;
    const sureste = comercio('megasur')!;
    expect(red.portal).not.toBe(sureste.portal);
    expect(red.portal).not.toContain('megasur');
    // Del portal de la red solo se comprobó que responde: ni se abrió ni se
    // leyó. `camposPendientes` es la forma honesta de decirlo.
    expect(red.campos).toEqual([]);
    expect(red.camposPendientes).toBe(true);
    // Y el plazo verificado era del SURESTE: sostenerlo aquí sería heredar la
    // prueba de otra página, que es justo lo que creó el bug.
    expect(red.plazoVerificado).toBe(false);
  });

  it('el ITU de Office Depot trae su restricción de largo', () => {
    // Verificado en el HTML del portal: maxlength="30" uppercase.
    const itu = comercio('office_depot')!.campos.find((x) => x.clave === 'numeroTicket');
    expect(itu?.restriccion?.largoMax).toBe(30);
    expect(itu?.restriccion?.mayusculas).toBe(true);
  });
});

// ── AMPLIACIÓN DEL 29-JUL-2026: 13 → 33 portales ───────────────────────────
//
// Al añadir `megasur` (la ficha verificada del sureste) quedaron DOS comercios
// reclamando `megasur.com.mx` y el texto `MEGASUR`, porque esos dominios se
// habían puesto en `g500` esa misma mañana. Una ambigüedad aquí no es cosmética:
// `identificarComercio` devuelve UN comercio, así que la colisión manda al
// operador al portal equivocado — y el portal equivocado es exactamente el error
// que esta ampliación venía a corregir.
describe('el reconocimiento no puede ser ambiguo', () => {
  it('ningún dominio lo reclaman dos comercios', () => {
    const de = new Map<string, string[]>();
    for (const c of COMERCIOS) {
      for (const d of c.reconocer.dominios ?? []) {
        de.set(d, [...(de.get(d) ?? []), c.clave]);
      }
    }
    const choques = [...de].filter(([, cs]) => cs.length > 1);
    expect(choques, `dominios ambiguos: ${choques.map(([d, cs]) => `${d} → ${cs.join('/')}`).join(', ')}`).toEqual([]);
  });

  it('ningún texto impreso lo reclaman dos comercios', () => {
    const de = new Map<string, string[]>();
    for (const c of COMERCIOS) {
      for (const t of c.reconocer.texto ?? []) {
        const k = t.toUpperCase().trim();
        de.set(k, [...(de.get(k) ?? []), c.clave]);
      }
    }
    const choques = [...de].filter(([, cs]) => cs.length > 1);
    expect(choques, `textos ambiguos: ${choques.map(([t, cs]) => `"${t}" → ${cs.join('/')}`).join(', ')}`).toEqual([]);
  });

  // ESTA INVARIANTE DABA FALSA CONFIANZA. La de arriba compara tokens
  // IDÉNTICOS, y en tiempo de ejecución el emparejamiento es `\b…\b` sobre el
  // texto del ticket: «G500» casa DENTRO de «G500 MEGASUR» sin ser igual a él.
  // Por eso pasaba en verde mientras el ticket verificado de Mérida se iba a
  // `null`. Un token anidado no es un error —la red y su franquicia—, pero
  // tiene que estar DECLARADO, que es lo que esto fija.
  it('un token contenido en otro solo se permite entre la red y su franquicia', () => {
    const ANIDADOS_ESPERADOS = [['G500', 'G500 MEGASUR']];
    const todos = COMERCIOS.flatMap((c) => (c.reconocer.texto ?? []).map((t) => ({ clave: c.clave, t: t.toUpperCase().trim() })));
    const anidados: string[][] = [];
    for (const a of todos) {
      for (const b of todos) {
        if (a.clave === b.clave || a.t === b.t) continue;
        // Palabra completa, igual que `identificarComercio`.
        if (new RegExp(`\\b${a.t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(b.t)) anidados.push([a.t, b.t]);
      }
    }
    expect(anidados.sort(), 'hay un token que casa dentro de otro y no está declarado').toEqual(ANIDADOS_ESPERADOS.sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL TICKET DE MÉRIDA QUE SE IBA AL PORTAL EQUIVOCADO — 20-ago-2026.
//
// Medido con un ticket real de G500 Sureste en la mano (Mérida, 18-ago-2026,
// $1,022.70, WebID 5498441008183). El papel trae DOS señales:
//
//   · `www.g500network.com`   marca de agua, repetida por todo el ticket
//   · `…g500sureste.com.mx`   el pie, una sola vez
//
// La primera es la que el OCR lee con más probabilidad, y mandaba el ticket a
// `g500` —la RED—, que declara `requiereCuenta: true` y cuyo propio comentario
// dice que ahí NO se factura este papel. El operador acababa pidiendo cuenta en
// un portal que no le sirve.
//
// Y por texto era peor: el emisor literal «G500 MEGASUR» —el MISMO que el
// catálogo cita como verificado, timbrado el 29-jul-2026— casaba con las dos
// entradas y se iba a `null`. Sin portal, a que lo facture una persona,
// teniendo la ficha correcta escrita al lado.
// ═══════════════════════════════════════════════════════════════════════════
describe('la red y su franquicia no son dos marcas', () => {
  it('con los dos dominios impresos gana el ESPECÍFICO, no el que esté antes en la lista', () => {
    const c = identificarComercio({ urlFacturacion: 'www.g500network.com g500sureste.com.mx' });
    expect(c?.clave, 'la marca de agua de la red no puede ganarle al pie de la franquicia').toBe('megasur');
    expect(c?.requiereCuenta, 'y el de Mérida entra con el RFC y nada más').toBe(false);
  });

  it('«G500 MEGASUR» identifica a la franquicia, no se va a null', () => {
    expect(identificarComercio({ textoTicket: 'G500 MEGASUR ESTACIONES DE SERVICIO' })?.clave).toBe('megasur');
  });

  it('pero «G500» a secas sigue siendo la RED: hay estaciones fuera del sureste', () => {
    expect(identificarComercio({ textoTicket: 'G500 ESTACIONES DE SERVICIO' })?.clave).toBe('g500');
  });

  it('CONTROL — dos marcas DE VERDAD siguen sin respuesta única', () => {
    // Lo que el desempate NO puede romper: tokens que no están uno dentro del
    // otro son dos comercios distintos, y ahí adivinar es mandar al operador a
    // pedir un dato que su ticket nunca tuvo.
    expect(identificarComercio({ textoTicket: 'OXXO GAS y PETROMAX en el mismo papel' })).toBeNull();
  });
});

describe('lo verificado se distingue de la hipótesis', () => {
  // La ampliación metió 20 portales de INVESTIGACIÓN. `plazoVerificado` es lo
  // que impide que el producto jure que un ticket está vigente cuando nadie lo
  // comprobó, así que la lista de verificados es cerrada y esta prueba la fija:
  // meter uno nuevo obliga a pasar por aquí, y a decir cómo se verificó.
  //
  // Y hay TRES grados de "verificado", que conviene no confundir:
  //   · FACTURANDO — megasur y la_gas: se timbró un CFDI real.
  //   · LEYENDO EL PORTAL — office_depot (maxlength del campo) y g500 (el plazo
  //     impreso en el ticket). Es evidencia de primera mano, pero no probó que
  //     el portal acepte el ticket de punta a punta.
  //   · LEYENDO EL TICKET REAL (27-ago-2026) — home_depot, tim_hortons,
  //     conekta360 y bptgroup: el plazo viene IMPRESO en el comprobante que un
  //     chofer fotografió, y se leyó mirando la foto. Es el grado más débil de
  //     los tres —no dice nada de si el portal lo respeta— pero es más fuerte
  //     que el default 'mes_natural', que no lo dice NADIE.
  //
  //     Y no es un matiz cosmético: los cuatro contradicen ese default. Home
  //     Depot da 60 DÍAS (el default lo habría dado por vencido semanas antes),
  //     y Boston's y la ferretería de Conekta 360 dan 72 y 24 HORAS (el default
  //     habría jurado que seguían vigentes cuando ya no). Un plazo supuesto
  //     falla en las dos direcciones, y las dos cuestan dinero.
  //
  //     Los otros 14 comercios que entraron en esa misma tanda NO están aquí:
  //     sus tickets no imprimen plazo, y no imprimirlo no es dar un mes.
  //   · LEYENDO EL PLAZO EN LA PÁGINA DEL PORTAL (28-ago-2026) — la tanda que
  //     trajo el reconocimiento de campo. Hasta ese día este catálogo no tenía
  //     NI UNO de este grado: los plazos "verificados" salían de un ticket de
  //     papel o del HTML de un campo, nunca de que el portal dijera su plazo con
  //     sus propias palabras. Ahora hay diez, cada uno con su cita literal en la
  //     ficha:
  //       enerser · sevafusa · arco_chihuahua («mes en curso o últimas 72 h»)
  //       tag_pase · circuito_exterior (30 días) · redviacorta (año fiscal)
  //       grupo_centra (3 DÍAS — el más corto del catálogo)
  //       ado y primera_plus (mes de compra + cola; obligaron a ampliar `Plazo`)
  //       los_taquitos_pm (24 HRS, recon 29-ago-2026 al resolver su portal
  //       pendiente — mismo plazo que conekta360, pero leído en la página del
  //       portal y no en un ticket)
  //
  //     Y CONTRADICEN EL DEFAULT EN LAS DOS DIRECCIONES, igual que la tanda de
  //     tickets: Grupo Centra da 3 días donde suponíamos un mes, y Circuito
  //     Exterior da 30 donde habríamos avisado "vence el 31".
  //
  // ⚠️ `g500` SALIÓ DE ESTA LISTA. Su `plazoVerificado: true` venía de leer el
  // plazo del portal DEL SURESTE, que ya no es el suyo — la ficha apuntaba al
  // portal equivocado. La prueba lo heredaba sin notarlo.
  const VERIFICADOS = [
    'la_gas', 'megasur', 'office_depot',
    'home_depot', 'tim_hortons', 'conekta360', 'bptgroup',
    // Leídos en la página del portal, recon del 28-ago-2026.
    'enerser', 'sevafusa', 'arco_chihuahua', 'tag_pase',
    'circuito_exterior', 'redviacorta', 'grupo_centra', 'ado', 'primera_plus',
    // Leído en la página del portal al resolver su `portalPendiente`, 29-ago-2026.
    'los_taquitos_pm',
  ];
  const FACTURADOS = ['la_gas', 'megasur'];
  /** Los que se verificaron mirando la foto de un ticket real, no el portal. */
  const VERIFICADOS_EN_TICKET = ['bptgroup', 'conekta360', 'home_depot', 'tim_hortons'];

  it('la lista de verificados es exactamente ésta', () => {
    const conPlazo = COMERCIOS.filter((c) => c.plazoVerificado).map((c) => c.clave).sort();
    expect(conPlazo).toEqual([...VERIFICADOS].sort());
  });

  it('todos los demás NO se anuncian como verificados', () => {
    const sin = COMERCIOS.filter((c) => !c.plazoVerificado);
    expect(sin.length).toBe(COMERCIOS.length - VERIFICADOS.length);
    for (const c of sin) expect(c.plazoVerificado, c.clave).toBe(false);
  });

  // TRES DE LOS CUATRO CONTRADICEN EL DEFAULT, y ése es el hallazgo: el
  // catálogo venía suponiendo 'mes_natural' para todos, y en cuanto se leyeron
  // comprobantes de verdad resultó falso en tres de cuatro casos — y falso en
  // las DOS direcciones, que es lo caro. Home Depot da 60 días: con el default
  // el sistema habría dado por vencido semanas antes un ticket todavía
  // facturable. Boston's da 72 horas y la ferretería de Conekta 360 da 24: con
  // el default habría jurado que seguían vigentes cuando ya no.
  //
  // Esta prueba fija esa asimetría para que nadie "normalice" estas entradas de
  // vuelta al default dejándoles la marca de verificadas puesta.
  const CONTRADICEN_EL_DEFAULT = ['home_depot', 'conekta360', 'bptgroup'];

  it('lo leído en un ticket real desmiente el default en tres de cuatro', () => {
    for (const k of CONTRADICEN_EL_DEFAULT) {
      const c = comercio(k);
      expect(c, `${k} no está en el catálogo`).toBeDefined();
      expect(c!.plazoVerificado, k).toBe(true);
      expect(c!.plazo, `${k}: se marcó verificado pero quedó con el default`).not.toBe('mes_natural');
    }
    // El cuarto es el caso contrario y por eso vale la pena nombrarlo aparte:
    // el ticket de Tim Hortons dice "podrá facturarse hasta el último día del
    // mes", o sea CONFIRMA 'mes_natural'. Es la primera vez que el default de
    // este catálogo aparece respaldado por un papel en vez de supuesto — y un
    // default confirmado y un default supuesto valen distinto aunque el valor
    // que guardan sea idéntico. Eso es justo lo que `plazoVerificado` distingue.
    expect(comercio('tim_hortons')!.plazo).toBe('mes_natural');
    expect(comercio('tim_hortons')!.plazoVerificado).toBe(true);
    expect(VERIFICADOS_EN_TICKET).toEqual([...CONTRADICEN_EL_DEFAULT, 'tim_hortons'].sort());
  });

  // Dos de los cuatro se miden en HORAS, y ése es el caso por el que
  // `caducidad.ts` admite `{ horas }`: redondear 24 h a "un día" da por vigente
  // un ticket que ya venció. `los_taquitos_pm` se sumó el 29-ago-2026 al
  // resolver su `portalPendiente`: mismas 24 horas que conekta360, pero leídas
  // en la página del portal en vez de en un ticket de papel.
  it('hay plazos en HORAS, y salieron de un comprobante o del portal en la mano', () => {
    const enHoras = COMERCIOS.filter((c) => typeof c.plazo === 'object' && 'horas' in c.plazo);
    expect(enHoras.map((c) => c.clave).sort()).toEqual(['bptgroup', 'conekta360', 'los_taquitos_pm']);
    for (const c of enHoras) expect(c.plazoVerificado, c.clave).toBe(true);
  });

  it('los facturados de verdad son dos, y hay que poder nombrarlos', () => {
    for (const k of FACTURADOS) expect(comercio(k)?.plazoVerificado, k).toBe(true);
  });

  it('megasur: le basta el WebID, y eso se comprobó timbrando', () => {
    const m = comercio('megasur')!;
    expect(m.requiereCuenta).toBe(false);
    expect(m.campos.filter((x) => x.requerido).map((x) => x.clave)).toEqual(['webId']);
  });

  it('la_gas: exige cuenta, y es el límite de la automatización', () => {
    // Correo + teléfono + contraseña. Mientras eso siga así, Likida no puede
    // facturar por el operador sin custodiar credenciales del cliente.
    expect(comercio('la_gas')!.requiereCuenta).toBe(true);
  });

  it('PINFRA declara los siete campos de una caseta', () => {
    // Una caseta pide máquina y consecutivo, que ningún otro comercio pide. Si
    // alguien "simplifica" esta lista, 17 autopistas dejan de facturar.
    const p = comercio('pinfra')!;
    const cs = p.campos.map((x) => x.clave);
    for (const k of ['sucursal', 'fecha', 'hora', 'referencia', 'caja', 'transaccion', 'monto']) {
      expect(cs, `PINFRA sin ${k}`).toContain(k);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL PORTAL QUE NO SE HA VERIFICADO SE DECLARA, NO SE INVENTA
//
// `portal` se usa para ABRIR una página: `vinculacion_asistida.ts` hace
// `pagina.abrir(ficha.portal)` y `mensajeParaEncargado` la manda por WhatsApp
// para que una persona la teclee. Una URL supuesta no falla de forma visible —
// lleva a alguien a un sitio que nadie comprobó.
//
// Por eso el catálogo admite exactamente dos estados, y esta prueba fija que no
// haya un tercero: o el comercio tiene una URL de verdad, o lleva
// `portalPendiente: true` y `portal` vacío. Lo que NO puede existir es un
// portal en blanco sin la marca (un descuido que se leería como "no hay
// portal") ni la marca con una URL puesta (que diría dos cosas contrarias a la
// vez).
// ═══════════════════════════════════════════════════════════════════════════
describe('el portal sin verificar se declara con portalPendiente', () => {
  it('portal vacío ⟺ portalPendiente, en los dos sentidos', () => {
    for (const c of COMERCIOS) {
      if (c.portalPendiente) {
        expect(c.portal, `${c.clave}: lleva portalPendiente y además una URL — di una sola cosa`).toBe('');
      } else {
        expect(c.portal, `${c.clave}: portal vacío sin portalPendiente`).not.toBe('');
        expect(c.portal.startsWith('https://') || c.portal.startsWith('http://'), `${c.clave}: ${c.portal} no es una URL`).toBe(true);
      }
    }
  });

  // La lista es CERRADA a propósito: meter un comercio sin portal obliga a
  // pasar por aquí y a decir por qué no se pudo verificar, en vez de que el
  // hueco crezca callado.
  //
  // ── HAY DOS CAUSAS DISTINTAS, Y CONVIENE NO MEZCLARLAS ────────────────────
  //
  // 1. EL TICKET NO IMPRIME LIGA. No hay dominio que reconocer porque el papel
  //    no lo trae, así que estos NO pueden tener `reconocer.dominios`: un
  //    dominio aquí sería la URL inventada entrando por la puerta de atrás.
  //
  //    Del banco de 91 fotos entraron TRES así: `walmart` salió de esta lista
  //    el 29-ago-2026 —se investigó y se MIDIÓ con Chrome headless su portal
  //    centralizado real, que no viene impreso en ningún ticket pero SÍ se
  //    verificó navegándolo— y quedan dos, `amg_hospitality` y
  //    `vaquero_montejo`, donde la búsqueda del 29-ago-2026 NO encontró nada
  //    lo bastante confiable para escribir (ver la nota de cada uno: un correo
  //    real mandado por AMG, y un sitio de nombre parecido pero RFC sin
  //    confirmar para Vaquero Montejo).
  //
  // 2. LA LIGA EXISTE PERO NO LLEVA A UN PORTAL (recon del 28-ago-2026, y
  //    revisitado el 29-ago-2026). Aquí el dominio SÍ está impreso y SÍ sirve
  //    para reconocer al emisor —es lo único verificado de ellos— pero no hay
  //    URL honesta que guardar en `portal`:
  //      · `facturacion_estacion` — el apex sigue siendo una página de
  //        aparcamiento de GoDaddy (revisitado 29-ago-2026, sin cambio). La
  //        plataforma existe, pero solo por subdominio de comercio, así que la
  //        entrada correcta es un PATRÓN, no una URL.
  //      · `mobil` — sigue sin ser un portal: hoy es un buscador de estaciones
  //        por mapa que redirige a un operador distinto según dónde se cargó
  //        (revisitado 29-ago-2026 con Chrome headless: ya no da 403 de Akamai,
  //        pero el flujo real —"busca tu estación en el mapa, da clic en
  //        Obtener factura"— sigue sin resolverse a una URL única).
  //      · `pemex_franquicia` — el sitio se REDISEÑÓ (29-ago-2026): el 403 de
  //        SiteGround ya no aplica, pero las dos rutas de facturar que ofrece
  //        hoy (`cargogas.dyndns.ws:8080` y el nuevo
  //        `factura.cargogas.warelan.com`) siguen siendo HTTP puro, medido con
  //        Chrome headless — mismo motivo de fondo, evidencia fresca.
  //
  //    Guardar cualquiera de esas URLs mandaba al robot —o a una persona— a una
  //    página de venta de dominios, a un directorio sin resolver o a un
  //    formulario sin TLS. Vaciarla y marcar el pendiente dice la verdad y
  //    conserva la capacidad de NOMBRAR al emisor.
  // 3. LA LIGA ESTÁ IMPRESA PERO NADIE HABÍA ABIERTO SU FORMULARIO (corrida de
  //    producción del 28-ago-2026, 90 fotos). Los detectó el OCR leyendo el
  //    dominio del propio ticket, así que el dominio SÍ está verificado — lo que
  //    faltaba era visitar la página. Es el estado más temprano de una ficha: se
  //    sabe a quién nombrar y no a dónde mandarlo.
  //
  //    `los_taquitos_pm` salió de esta lista el 29-ago-2026: el dominio del
  //    catálogo (`lostaquitosdelpm.com`) resultó ser un typo que NUNCA iba a
  //    reconocer un ticket real —NXDOMAIN, cero historial en la Wayback
  //    Machine—, y el correcto (`lostaquitosdepm.com`) sí se abrió y se midió
  //    con Chrome headless. Queda `gasolineria_mallorca`: su dominio impreso
  //    (`facturascas.com`) también da NXDOMAIN, y el candidato más parecido que
  //    arrojó la búsqueda (`facturasgas.com`) es una plataforma multi-comercio
  //    sin nada que confirme que esta razón social factura ahí — se anotó como
  //    hipótesis, no se escribió como dato.
  const SIN_LIGA_EN_EL_TICKET = ['amg_hospitality', 'vaquero_montejo'];
  const LIGA_QUE_NO_ES_PORTAL = ['facturacion_estacion', 'mobil', 'pemex_franquicia'];
  const LIGA_IMPRESA_SIN_VISITAR = ['gasolineria_mallorca'];

  it('son exactamente estos seis, y ninguno finge tener campos leídos', () => {
    const pendientes = COMERCIOS.filter((c) => c.portalPendiente).map((c) => c.clave).sort();
    expect(pendientes).toEqual(
      [...SIN_LIGA_EN_EL_TICKET, ...LIGA_QUE_NO_ES_PORTAL, ...LIGA_IMPRESA_SIN_VISITAR].sort(),
    );
    for (const k of pendientes) {
      const c = comercio(k)!;
      // Sin portal no se pudo leer el formulario: `campos` vacío y la marca
      // puesta. Un campo declarado aquí estaría inventado por definición.
      expect(c.campos, `${k}`).toEqual([]);
      expect(c.camposPendientes, `${k}`).toBe(true);
      expect(c.plazoVerificado, `${k}: sin portal no hay plazo verificado`).toBe(false);
    }
  });

  // ── NINGÚN `portal` PUEDE SER LA URL DE UN LOGIN ──────────────────────────
  //
  // Regresión REAL, cazada el 28-ago-2026 al actualizar el catálogo con el
  // recon. Se cambió `la_gas` de la raíz a `…/auth/login` con la lógica de "es
  // la URL final, así no dependemos del redirect" — y rompió la vinculación
  // asistida en silencio.
  //
  // El mecanismo: `pantallaDeLogin` decide si la persona YA ENTRÓ comparando la
  // URL contra `RUTAS_DE_LOGIN`. Con `/auth/login` guardado en la ficha, la
  // condición «seguimos en la pantalla de entrar» se vuelve permanentemente
  // verdadera: el contralor inicia sesión de verdad, el sistema no lo reconoce,
  // la vinculación expira y la sesión no se guarda. Nadie habría sabido por qué.
  //
  // La regla general: `portal` es la página donde se quiere TERMINAR, no la
  // puerta. Los portales con cuenta ya redirigen solos al login cuando hace
  // falta; guardarlo a mano solo rompe la señal de "ya entré".
  it('ningún portal apunta a una pantalla de entrar', () => {
    // El mismo patrón que usa `vinculo_senales.ts`. Se repite en vez de
    // importarlo a propósito: si allá lo relajan, esta prueba tiene que seguir
    // midiendo lo que hoy sabemos que rompe.
    const RUTAS_DE_LOGIN = /\/(account\/login|login|signin|sign-in|iniciar-?sesion|inicio-?sesion|acceso|autenticar)(\/|\?|#|$)/i;
    const culpables = COMERCIOS
      .filter((c) => c.portal && RUTAS_DE_LOGIN.test(c.portal))
      .map((c) => `${c.clave} → ${c.portal}`);
    expect(culpables, 'un portal que apunta al login hace que "ya entré" nunca sea cierto').toEqual([]);
  });

  it('los que SÍ imprimen liga la conservan como dominio, que es lo verificado', () => {
    // El complemento de la prueba de abajo, y lo que hace que `portalPendiente`
    // no sea "borrar la ficha": de estos comercios se conoce el dominio impreso
    // —es como se detectaron— aunque no se conozca su formulario. Perderlo
    // convertiría un emisor identificable en "emisor desconocido".
    for (const k of [...LIGA_QUE_NO_ES_PORTAL, ...LIGA_IMPRESA_SIN_VISITAR]) {
      const c = comercio(k)!;
      expect(c.reconocer.dominios?.length, `${k}: su liga está impresa y verificada`).toBeGreaterThan(0);
    }
  });

  it('los que no imprimen liga tampoco pueden declarar un dominio', () => {
    for (const k of SIN_LIGA_EN_EL_TICKET) {
      const c = comercio(k)!;
      expect(c.reconocer.dominios, `${k}: no imprime liga, no puede tener dominio`).toBeUndefined();
    }
  });

  it('el emisor más fotografiado del banco va en UNA entrada, no en tres', () => {
    // Walmart, Sam's Club y Bodega Aurrera son marcas del MISMO contribuyente
    // (NWM9709244W4). Tres entradas con el mismo RFC serían tres candidatos
    // empatados para el mismo ticket, y `identificarComercio` no adivina ante
    // un empate: los once tickets se quedarían sin comercio.
    const porRfc = COMERCIOS.filter((c) => c.reconocer.rfc?.includes('NWM9709244W4'));
    expect(porRfc.map((c) => c.clave)).toEqual(['walmart']);
    expect(identificarComercio({ rfcEmisor: 'NWM9709244W4' })?.clave).toBe('walmart');
  });
});
