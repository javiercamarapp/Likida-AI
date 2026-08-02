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

  it('ningún comercio se anuncia sin portal a dónde mandar al operador', () => {
    for (const c of COMERCIOS) {
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
  it('a G500 le basta el Web ID: lo demás lo resuelve el portal', () => {
    const requeridos = comercio('g500')!.campos.filter((x) => x.requerido).map((x) => x.clave);
    expect(requeridos).toEqual(['webId']);
  });

  it('pero el folio se conserva como opcional, para que el operador coteje', () => {
    // El portal devuelve el folio DENTRO de la descripción de la línea
    // ("1000724 - GASOLINA CONTENIDO MIN. 91 OCTANOS"), así que sirve para
    // confirmar que la línea que trajo es la del ticket que tiene en la mano.
    const opcionales = comercio('g500')!.campos.filter((x) => !x.requerido).map((x) => x.clave);
    expect(opcionales).toContain('folio');
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
});

describe('lo verificado se distingue de la hipótesis', () => {
  // La ampliación metió 20 portales de INVESTIGACIÓN. `plazoVerificado` es lo
  // que impide que el producto jure que un ticket está vigente cuando nadie lo
  // comprobó, así que la lista de verificados es cerrada y esta prueba la fija:
  // meter uno nuevo obliga a pasar por aquí, y a decir cómo se verificó.
  //
  // Y hay dos grados de "verificado", que conviene no confundir:
  //   · FACTURANDO — megasur y la_gas: se timbró un CFDI real.
  //   · LEYENDO EL PORTAL — office_depot (maxlength del campo) y g500 (el plazo
  //     impreso en el ticket). Es evidencia de primera mano, pero no probó que
  //     el portal acepte el ticket de punta a punta.
  const VERIFICADOS = ['g500', 'la_gas', 'megasur', 'office_depot'];
  const FACTURADOS = ['la_gas', 'megasur'];

  it('la lista de verificados es exactamente ésta', () => {
    const conPlazo = COMERCIOS.filter((c) => c.plazoVerificado).map((c) => c.clave).sort();
    expect(conPlazo).toEqual([...VERIFICADOS].sort());
  });

  it('los 29 restantes NO se anuncian como verificados', () => {
    const sin = COMERCIOS.filter((c) => !c.plazoVerificado);
    expect(sin.length).toBe(COMERCIOS.length - VERIFICADOS.length);
    for (const c of sin) expect(c.plazoVerificado, c.clave).toBe(false);
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
