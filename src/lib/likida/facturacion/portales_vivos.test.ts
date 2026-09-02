import { describe, it, expect } from 'vitest';
import {
  camposVisiblesEn, pareceSpa, revisarPortal, vigilarPortales,
  portalesVigilables, redactarParte, estaRoto, type Traer,
} from './portales_vivos';
import type { Comercio } from './comercios';

// ═══════════════════════════════════════════════════════════════════════════
// EL VIGILANTE SE PRUEBA CONTRA LOS DOS CASOS QUE LO OBLIGARON A EXISTIR, Y
// LOS DOS SON HTML REAL COPIADO DEL RECON DEL 28-ago-2026:
//
//   · La URL de OXXO que respondía 200 con el JSF sin procesar. Si el vigilante
//     no la caza, no sirve para nada: es exactamente la falla que un chequeo por
//     código HTTP da por sana.
//   · El portal de Circle K, que sirve 1.9 KB y dibuja su formulario con
//     JavaScript. Si el vigilante lo acusa, tampoco sirve: al tercer correo en
//     falso nadie lo lee.
//
// Los dos se ven casi iguales por HTML crudo. Distinguirlos es el trabajo.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que servía la URL rota de OXXO, literal (RECON-PORTALES-17.md §2.5). */
const OXXO_ROTO =
  '<f:view xmlns:h="http://java.sun.com/jsf/html"><html><h:head></h:head>' +
  '<h:body>Pagina inicio</h:body></html></f:view>';

/** El esqueleto de la SPA de Circle K (RECON-PORTALES-20.md §2.3). */
const CIRCLE_K_SPA =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<script type="module" crossorigin src="/assets/index-BTbyAnH-.js"></script>' +
  '</head><body><div id="root"></div></body></html>';

/** Una página con formulario de verdad. */
const CON_FORMULARIO =
  '<html><body><form id="form1">' +
  '<input type="hidden" name="__VIEWSTATE" value="x">' +
  '<input type="text" id="txSucursal"><input type="text" id="txNota">' +
  '<select id="ddlUsoCDFI"></select>' +
  '</form></body></html>';

const respuesta = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

describe('camposVisiblesEn', () => {
  it('cuenta los campos donde de verdad se puede teclear', () => {
    // Tres visibles (2 inputs + 1 select). El hidden NO cuenta.
    expect(camposVisiblesEn(CON_FORMULARIO)).toBe(3);
  });

  it('los inputs ocultos del framework NO cuentan como formulario', () => {
    // MEDIDO: la app WEBDEV de Grupo Centra sirve CINCO inputs y los cinco son
    // `hidden` y del framework. Contarlos daría «vivo con 5 campos» sobre una
    // pantalla donde no hay ni un sitio donde escribir — que es justo la clase
    // de verde falso que este módulo existe para no producir.
    const webdev =
      '<form name="PAGE_INICIO">' +
      '<input type="hidden" name="WD_BUTTON_CLICK_"><input type="hidden" name="WD_ACTION_">' +
      '<input type="hidden" name="M3"><input type="hidden" name="M3_DEB">' +
      '<input type="hidden" name="_M3_OCC"></form>';
    expect(camposVisiblesEn(webdev)).toBe(0);
  });

  it('la página rota de OXXO no tiene ni un campo', () => {
    expect(camposVisiblesEn(OXXO_ROTO)).toBe(0);
  });
});

describe('pareceSpa — la distinción que evita el correo en falso', () => {
  it('el esqueleto de Circle K trae su bundle', () => {
    expect(pareceSpa(CIRCLE_K_SPA)).toBe(true);
  });

  it('la página rota de OXXO no trae nada que dibuje un formulario', () => {
    expect(pareceSpa(OXXO_ROTO)).toBe(false);
  });

  it('reconoce Angular por su marcado, no solo por el nombre del bundle', () => {
    // `libramientos_meta` es AngularJS y `office_depot` Angular: su formulario
    // tampoco está en el HTML inicial, y su bundle no siempre vive en /assets.
    expect(pareceSpa('<html ng-app="factura"><body><div ng-controller="x"></div></body></html>')).toBe(true);
    expect(pareceSpa('<html><body><app-root></app-root></body></html>')).toBe(true);
  });
});

describe('revisarPortal', () => {
  const traerQueDevuelve = (status: number, body: string): Traer => async () => respuesta(status, body);

  it('con formulario a la vista: vivo', async () => {
    const r = await revisarPortal('arco_chihuahua', 'https://x', traerQueDevuelve(200, CON_FORMULARIO));
    expect(r.estado).toBe('vivo');
    expect(r.campos).toBe(3);
  });

  it('EL CASO OXXO: 200 y ni un campo es «sin_formulario», no «vivo»', async () => {
    // Esta es LA prueba del módulo. Con un chequeo por código HTTP este portal
    // habría salido sano indefinidamente mientras mandaba al contralor a una
    // página en blanco.
    const r = await revisarPortal('oxxo', 'https://x', traerQueDevuelve(200, OXXO_ROTO));
    expect(r.estado).toBe('sin_formulario');
    expect(r.http).toBe(200);
    expect(estaRoto(r)).toBe(true);
    expect(r.evidencia).toContain('0 campos');
  });

  it('EL CASO CIRCLE K: una SPA vacía NO se acusa', async () => {
    // El contrapeso. Sin esta rama, el vigilante acusaría a todos los portales
    // modernos del catálogo y se apagaría solo por ruido.
    const r = await revisarPortal('circle_k', 'https://x', traerQueDevuelve(200, CIRCLE_K_SPA));
    expect(r.estado).toBe('sin_confirmar');
    expect(estaRoto(r), 'una SPA no confirmable NO es un portal roto').toBe(false);
    expect(r.evidencia).toContain('JavaScript');
  });

  it('un 502 es no_responde, y lleva el código en la evidencia', async () => {
    // El estado real de `petro_7` en el 443 cuando se hizo el recon.
    const r = await revisarPortal('petro_7', 'https://x', traerQueDevuelve(502, ''));
    expect(r.estado).toBe('no_responde');
    expect(r.http).toBe(502);
    expect(r.evidencia).toContain('502');
  });

  it('DNS muerto se distingue de todo lo demás', async () => {
    // Tres portales del catálogo murieron exactamente así.
    const traer: Traer = async () => {
      const e = new Error('getaddrinfo ENOTFOUND facturacion.rea.com.mx');
      (e as unknown as { cause: { code: string } }).cause = { code: 'ENOTFOUND' };
      throw e;
    };
    const r = await revisarPortal('red_estatal_autopistas', 'https://x', traer);
    expect(r.estado).toBe('sin_dns');
    expect(r.http).toBeNull();
    expect(r.campos, 'no se midió: null, no 0').toBeNull();
  });

  it('un fallo NUESTRO es no_medido, y NO acusa al portal', async () => {
    // Sin esta rama, un tropiezo de red de la función serverless manda un
    // correo diciendo que TODO el catálogo está muerto.
    const traer: Traer = async () => { throw new Error('socket hang up'); };
    const r = await revisarPortal('gogas', 'https://x', traer);
    expect(r.estado).toBe('no_medido');
    expect(estaRoto(r), 'no medido NO es roto').toBe(false);
    expect(r.evidencia).toContain('de nuestro lado');
  });

  it('nunca lanza: un portal que revienta no puede parar la pasada', async () => {
    const traer: Traer = async () => { throw { raro: true }; };
    await expect(revisarPortal('x', 'https://x', traer)).resolves.toBeTruthy();
  });
});

// ── La pasada completa ────────────────────────────────────────────────────

const ficha = (clave: string, portal: string, extra: Partial<Comercio> = {}): Comercio => ({
  clave, nombre: clave, portal, requiereCuenta: false,
  plazo: 'mes_natural', plazoVerificado: false, campos: [], camposPendientes: true,
  reconocer: { texto: [clave.toUpperCase()] }, ...extra,
});

describe('portalesVigilables — a quién NO se le toca la puerta', () => {
  it('los que no tienen portal quedan fuera', () => {
    const lista = portalesVigilables([
      ficha('bueno', 'https://a'),
      ficha('pendiente', '', { portalPendiente: true }),
    ]);
    expect(lista.map((c) => c.clave)).toEqual(['bueno']);
  });

  it('a los que tienen muro anti-bot NO se les golpea', () => {
    // El vigilante no puede ser el que provoque el problema que vino a
    // detectar: PASE bloquea por IP, y una visita semanal automatizada es
    // exactamente el patrón que Radware castiga.
    const lista = portalesVigilables([
      ficha('bueno', 'https://a'),
      ficha('autozone', 'https://b', {
        noAutomatizable: { razon: 'muro_anti_bot', nota: '403 en tres intentos' },
      }),
    ]);
    expect(lista.map((c) => c.clave)).toEqual(['bueno']);
  });

  it('pero los que no facturan por ticket SÍ se vigilan: su página sigue existiendo', () => {
    // TeleVía no se automatiza, pero su URL es la que se le enseña a una
    // persona. Si se muere, hay que enterarse igual.
    const lista = portalesVigilables([
      ficha('televia', 'https://a', {
        noAutomatizable: { razon: 'factura_mensual_por_cuenta', nota: 'mensual' },
      }),
    ]);
    expect(lista.map((c) => c.clave)).toEqual(['televia']);
  });
});

describe('vigilarPortales', () => {
  it('un roto se confirma en DOS intentos antes de sostenerlo', async () => {
    // La regla del PR #183 aplicada aquí: sin escenario verificado, no hay
    // hallazgo. Un 502 puede ser un despliegue del portal a media pasada.
    let n = 0;
    const traer: Traer = async () => { n++; return respuesta(502, ''); };
    const r = await vigilarPortales({ traer, comercios: [ficha('x', 'https://x')] });

    expect(n, 'se miró dos veces').toBe(2);
    expect(r.rotos).toHaveLength(1);
    expect(r.rotos[0].evidencia).toContain('confirmado en dos intentos');
  });

  it('un tropiezo que NO se repite se descarta, y queda dicho', async () => {
    // El agente se refuta a sí mismo. Sin esto, cada despliegue de cada portal
    // sería un correo «Urgente».
    let n = 0;
    const traer: Traer = async () => (++n === 1 ? respuesta(502, '') : respuesta(200, CON_FORMULARIO));
    const r = await vigilarPortales({ traer, comercios: [ficha('x', 'https://x')] });

    expect(r.rotos, 'no se sostuvo: no se acusa').toHaveLength(0);
    expect(r.revisiones[0].estado).toBe('vivo');
    // Pero el tropiezo NO se borra: un portal que parpadea semana tras semana
    // se tiene que poder ver sin que haya mandado un correo cada vez.
    expect(r.revisiones[0].evidencia).toContain('no se sostiene');
  });

  it('el DNS muerto NO se reintenta: si no resuelve, no resuelve', async () => {
    let n = 0;
    const traer: Traer = async () => {
      n++;
      const e = new Error('getaddrinfo ENOTFOUND x');
      (e as unknown as { cause: { code: string } }).cause = { code: 'ENOTFOUND' };
      throw e;
    };
    const r = await vigilarPortales({ traer, comercios: [ficha('x', 'https://x')] });
    expect(n, 'una sola consulta basta').toBe(1);
    expect(r.rotos).toHaveLength(1);
  });

  it('EL RELOJ: los que se quedan sin turno se DICEN por su nombre', async () => {
    // El patrón de `conRelojDuro` (PR #152): se consulta antes de cada portal,
    // no una vez al principio. Un vigilante que revisó 1 de 3 y reporta «todo
    // bien» está mintiendo sobre los otros dos.
    let t = 1000;
    const traer: Traer = async () => { t += 100; return respuesta(200, CON_FORMULARIO); };
    const r = await vigilarPortales({
      traer,
      comercios: [ficha('a', 'https://a'), ficha('b', 'https://b'), ficha('c', 'https://c')],
      ahora: () => t,
      // El reloj se acaba después de mirar el primero: cada visita cuesta 100.
      venceEn: 1050,
    });

    expect(r.revisiones.map((x) => x.clave)).toEqual(['a']);
    expect(r.sinTurno).toEqual(['b', 'c']);
  });

  it('los no medidos no se cuentan como sanos', async () => {
    const traer: Traer = async () => { throw new Error('socket hang up'); };
    const r = await vigilarPortales({ traer, comercios: [ficha('x', 'https://x')] });
    expect(r.noMedidos).toBe(1);
    expect(r.rotos).toHaveLength(0);
  });
});

describe('redactarParte', () => {
  it('dice los no medidos y los sin turno aunque no haya rotos', async () => {
    // «Los 30 están bien» y «miré 1, 1 no se dejó medir y 1 se quedó sin turno»
    // son partes muy distintos, y el segundo es el verdadero.
    let t = 1000;
    let n = 0;
    const traer: Traer = async () => {
      t += 100;
      if (++n === 1) throw new Error('socket hang up');
      return respuesta(200, CON_FORMULARIO);
    };
    const r = await vigilarPortales({
      traer,
      comercios: [ficha('a', 'https://a'), ficha('b', 'https://b')],
      ahora: () => t,
      venceEn: 1050,
    });
    const parte = redactarParte(r);

    expect(parte).toContain('NO MEDIDOS');
    expect(parte).toContain('SIN TURNO');
    expect(parte).toContain('b');
  });

  it('explica cómo leer «sin_formulario» y «sin_confirmar»', async () => {
    // El parte lo lee una persona que no escribió este módulo. Sin la
    // explicación, «sin_confirmar» parece un fallo y «sin_formulario» parece
    // un tecnicismo — y son lo contrario.
    const traer: Traer = async () => respuesta(200, OXXO_ROTO);
    const r = await vigilarPortales({ traer, comercios: [ficha('oxxo', 'https://x')] });
    const parte = redactarParte(r);

    expect(parte).toContain('ROTOS');
    expect(parte).toContain('oxxo');
    expect(parte).toContain('CÓMO LEER ESTO');
  });
});
