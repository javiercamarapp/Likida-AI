import { describe, it, expect } from 'vitest';
import {
  CONECTORES, porCategoria, conectorPorId, conteoConectores, resumenHonesto,
  loQuePedirle, conectoresProbables,
} from './registro';
import {
  CAPACIDADES, CATEGORIAS, faltantes, nivelDeFuente, probarConGuardas, veredictoHttp,
  type Conector, type Http, type PeticionHttp, type RespuestaHttp,
} from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE ESTAS PRUEBAS PROTEGEN.
//
// No prueban que ninguna integración funcione — no se puede, no hay
// credenciales de ninguna instancia real. Prueban lo único que sí se puede
// probar hoy y que es exactamente donde este catálogo se rompería: que NADIE
// afirme más de lo que puede sostener.
//
// El modo de falla que persiguen tiene nombre y fecha: el demo de Transportes
// Innovativos. Alguien agrega un conector, le pone `api_en_vivo` porque suena
// bien, se le olvida la fuente, y en el demo el "Probar conexión" truena. Estas
// pruebas hacen que ese commit no compile la suite.
// ═══════════════════════════════════════════════════════════════════════════

/** Un transporte de mentiras. Nunca toca la red — ni una sola de estas pruebas. */
function httpFalso(
  responder: (p: PeticionHttp) => RespuestaHttp | Promise<RespuestaHttp>,
  registro?: PeticionHttp[],
): Http {
  return async (p) => {
    registro?.push(p);
    return responder(p);
  };
}

const EXPLOTA: Http = () => {
  throw new Error('la red se cayó');
};

describe('todo conector declara lo que hace falta para conectarlo', () => {
  it('cada uno tiene id, nombre, categoría y una frase de cómo conecta hoy', () => {
    for (const c of CONECTORES) {
      expect(c.id.trim(), c.id).not.toBe('');
      expect(c.nombre.trim(), c.id).not.toBe('');
      expect(CATEGORIAS, c.id).toContain(c.categoria);
      // `comoConectaHoy` es el campo que evita la venta mal entendida: la
      // diferencia entre "subes el archivo cada 10 días" y "nos conectamos
      // solos" es toda la diferencia para quien va a comprar.
      expect(c.comoConectaHoy.trim().length, c.id).toBeGreaterThan(20);
      expect(c.queHace.trim().length, c.id).toBeGreaterThan(20);
    }
  });

  it('ninguno se queda sin capacidades — un conector que no sabe hacer nada no es un conector', () => {
    for (const c of CONECTORES) {
      expect(c.capacidades.length, c.id).toBeGreaterThan(0);
    }
  });

  it('toda capacidad del vocabulario la declara al menos un conector', () => {
    // Sin esto el vocabulario crece con términos que nadie usa, y el primero
    // que los use les dará el significado que se le ocurra.
    for (const cap of CAPACIDADES) {
      const quienes = CONECTORES.filter((c) => c.capacidades.includes(cap));
      expect(quienes.length, `nadie declara «${cap}»`).toBeGreaterThan(0);
    }
  });

  it('ninguna capacidad declarada está fuera del vocabulario', () => {
    for (const c of CONECTORES) {
      for (const cap of c.capacidades) expect(CAPACIDADES, c.id).toContain(cap);
    }
  });

  it('los ids no se repiten', () => {
    // Dos conectores con el mismo id hacen que `conectorPorId` devuelva el
    // primero en silencio, y la pantalla de captura pediría las credenciales
    // del sistema equivocado.
    const vistos = new Set<string>();
    for (const c of CONECTORES) {
      expect(vistos.has(c.id), `id repetido: ${c.id}`).toBe(false);
      vistos.add(c.id);
    }
  });

  it('cada credencial dice cómo se captura y dónde encontrarla', () => {
    for (const c of CONECTORES) {
      const claves = new Set<string>();
      for (const campo of c.credenciales) {
        expect(campo.clave.trim(), `${c.id}.${campo.clave}`).not.toBe('');
        expect(campo.rotulo.trim(), `${c.id}.${campo.clave}`).not.toBe('');
        // Sin la ayuda, el campo se queda vacío para siempre: nadie sabe de
        // dónde sacar "el hash de sesión de Navixy".
        expect(campo.ayuda.trim().length, `${c.id}.${campo.clave}`).toBeGreaterThan(10);
        expect(claves.has(campo.clave), `clave repetida ${c.id}.${campo.clave}`).toBe(false);
        claves.add(campo.clave);
      }
    }
  });

  it('ningún ejemplo se parece a una credencial de verdad', () => {
    // Un ejemplo que parezca un token real acaba copiado a un ticket de
    // soporte, o —peor— capturado tal cual por alguien que cree que es válido.
    for (const c of CONECTORES) {
      for (const campo of c.credenciales) {
        if (campo.ejemplo === undefined) continue;
        expect(campo.ejemplo.length, `${c.id}.${campo.clave}`).toBeLessThan(60);
        if (campo.forma === 'secreto') {
          // Un secreto SOLO puede ejemplificarse describiendo su forma.
          expect(/^[A-Za-z0-9_-]{16,}$/.test(campo.ejemplo), `${c.id}.${campo.clave}`).toBe(false);
        }
      }
    }
  });
});

describe('nadie afirma estar verificado sin fuente', () => {
  it('un conector `api_en_vivo` SIEMPRE cita documentación primaria con fecha', () => {
    // ESTA es la prueba que sostiene el archivo entero. `api_en_vivo` significa
    // "sabemos hablar con este sistema y lo comprobamos contra su fabricante".
    // Sin fuente, esa frase es un endpoint plausible inventado, que se ve
    // idéntico a uno correcto hasta que alguien lo llama en un demo.
    for (const c of CONECTORES.filter((k) => k.formaDeConectar === 'api_en_vivo')) {
      expect(c.fuente, `${c.id} dice api_en_vivo sin fuente`).not.toBeNull();
      expect(c.fuente!.url.startsWith('https://'), c.id).toBe(true);
      expect(c.fuente!.queConfirma.trim().length, c.id).toBeGreaterThan(30);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(c.fuente!.consultadaEn), c.id).toBe(true);
    }
  });

  it('lo que no tiene fuente se declara sin_verificar, no se disimula', () => {
    for (const c of CONECTORES) {
      expect(nivelDeFuente(c)).toBe(c.fuente === null ? 'sin_verificar' : 'verificado');
    }
  });

  it('un conector `api_en_vivo` pide al menos una credencial', () => {
    // Una API en vivo a la que no hay que darle nada no existe. Si aparece,
    // es que alguien marcó verde un renglón sin pensar qué se le pide al cliente.
    for (const c of CONECTORES.filter((k) => k.formaDeConectar === 'api_en_vivo')) {
      expect(c.credenciales.length, c.id).toBeGreaterThan(0);
    }
  });

  it('lo que no está construido no promete estar en su tope', () => {
    for (const c of CONECTORES.filter((k) => k.formaDeConectar !== 'api_en_vivo' && k.formaDeConectar !== 'por_archivo')) {
      expect(c.paraSubirDeEscalon, `${c.id} no dice qué le falta`).not.toBeNull();
    }
  });

  it('toda fuente citada es del fabricante, no de un blog ni de un wrapper', () => {
    // No se puede validar la autoría de una URL desde una prueba, pero sí se
    // puede cerrar la puerta a las fuentes que ya sabemos que no valen.
    const prohibidos = ['medium.com', 'stackoverflow.com', 'github.com', 'npmjs.com', 'blog.', 'wikipedia.org'];
    for (const c of CONECTORES) {
      if (c.fuente === null) continue;
      for (const p of prohibidos) {
        expect(c.fuente.url.includes(p), `${c.id} cita ${p}`).toBe(false);
      }
    }
  });
});

describe('las categorías no quedan vacías', () => {
  it('cada categoría de la lista tiene al menos un conector', () => {
    // Una categoría vacía en pantalla se lee como "esto no lo hacen", que es
    // distinto de "esto entra por archivo".
    const grupos = new Map(porCategoria());
    for (const cat of CATEGORIAS) {
      expect(grupos.get(cat)?.length ?? 0, `categoría vacía: ${cat}`).toBeGreaterThan(0);
    }
  });

  it('el agrupado respeta el orden declarado y no el de los imports', () => {
    expect(porCategoria().map(([c]) => c)).toEqual([...CATEGORIAS]);
  });

  it('no se pierde ni se duplica ningún conector al agrupar', () => {
    const total = porCategoria().reduce((n, [, lista]) => n + lista.length, 0);
    expect(total).toBe(CONECTORES.length);
  });

  it('los conteos se derivan y cuadran con la lista', () => {
    const c = conteoConectores();
    expect(c.total).toBe(CONECTORES.length);
    const porForma = Object.values(c.porForma).reduce((a, b) => a + b, 0);
    const porCat = Object.values(c.porCategoria).reduce((a, b) => a + b, 0);
    const porFuente = Object.values(c.porFuente).reduce((a, b) => a + b, 0);
    expect([porForma, porCat, porFuente]).toEqual([c.total, c.total, c.total]);
  });

  it('el resumen honesto no infla: dice cuántos son de a de veras y cuántos no', () => {
    const c = conteoConectores();
    const r = resumenHonesto();
    expect(r).toContain(`${c.total} sistemas`);
    expect(r).toContain(`${c.porForma.api_en_vivo} con API en vivo`);
    expect(r).toContain(`${c.porForma.requiere_piloto} que necesitan`);
    // La frase que impide leer el catálogo como "ya está conectado".
    expect(r).toMatch(/no tenemos credenciales de ningún cliente/);
  });
});

describe('probar() falla cerrado', () => {
  const conCredenciales = CONECTORES.filter((c) => c.credenciales.some((k) => k.requerida));

  it('sin credenciales NO intenta, no llama a nadie y dice qué falta', async () => {
    const llamadas: PeticionHttp[] = [];
    const http = httpFalso(() => ({ estado: 200, cuerpo: '{}' }), llamadas);
    for (const c of conCredenciales) {
      const r = await c.probar({}, http);
      expect(r.ok, c.id).toBe(false);
      expect(r.verificadoContra, c.id).toBeNull();
      expect((r.falta ?? []).length, c.id).toBeGreaterThan(0);
    }
    // La guarda tiene que morder ANTES de la red: una petición sin token
    // puede recibir un 200 con una página de login, y ese 200 se leería como
    // credencial buena.
    expect(llamadas.length).toBe(0);
  });

  it('un error de red NUNCA se lee como conectado', async () => {
    for (const c of CONECTORES) {
      const r = await c.probar(credencialesDeMentira(c), EXPLOTA);
      expect(r.ok, c.id).toBe(false);
    }
  });

  it('un error de red se distingue de una credencial mala, y se dice', async () => {
    // Fundirlos mandaría al cliente a regenerar un token que estaba bien.
    for (const c of CONECTORES.filter((k) => k.formaDeConectar === 'api_en_vivo')) {
      const r = await c.probar(credencialesDeMentira(c), EXPLOTA);
      expect(r.detalle, c.id).toMatch(/no se pudo comprobar|no se pudo hablar/i);
    }
  });

  it('un 500 del proveedor no acusa a la credencial', async () => {
    const http = httpFalso(() => ({ estado: 503, cuerpo: 'Service Unavailable' }));
    for (const c of CONECTORES.filter((k) => k.formaDeConectar === 'api_en_vivo')) {
      const r = await c.probar(credencialesDeMentira(c), http);
      expect(r.ok, c.id).toBe(false);
      expect(r.detalle, c.id).toMatch(/NO dice nada sobre la credencial/);
    }
  });

  it('un 401 sí acusa a la credencial', async () => {
    const http = httpFalso(() => ({ estado: 401, cuerpo: '' }));
    for (const c of CONECTORES.filter((k) => k.formaDeConectar === 'api_en_vivo')) {
      const r = await c.probar(credencialesDeMentira(c), http);
      expect(r.ok, c.id).toBe(false);
      expect(r.detalle, c.id).toMatch(/rechazó la credencial/);
    }
  });

  it('un 200 con basura adentro NO es una conexión buena', async () => {
    // El bug que esto persigue: Wialon y Geotab contestan 200 con el error
    // dentro del cuerpo. Un adaptador que se quede en `estado === 200`
    // declararía conectada una credencial rechazada.
    const http = httpFalso(() => ({ estado: 200, cuerpo: '<html>Inicia sesión</html>' }));
    for (const c of CONECTORES.filter((k) => k.formaDeConectar === 'api_en_vivo')) {
      const r = await c.probar(credencialesDeMentira(c), http);
      expect(r.ok, `${c.id} tragó una página HTML como si fuera su API`).toBe(false);
    }
  });

  it('los que no tienen API que probar lo dicen, y no llaman a nadie', async () => {
    const llamadas: PeticionHttp[] = [];
    const http = httpFalso(() => ({ estado: 200, cuerpo: '{"ok":true}' }), llamadas);
    for (const c of CONECTORES.filter((k) => k.formaDeConectar === 'por_archivo' || k.formaDeConectar === 'no_construido')) {
      const r = await c.probar(credencialesDeMentira(c), http);
      expect(r.ok, c.id).toBe(false);
      expect(r.verificadoContra, c.id).toBeNull();
      expect(r.detalle.trim().length, c.id).toBeGreaterThan(20);
    }
    expect(llamadas.length).toBe(0);
  });

  it('probar() nunca escribe: solo GET, o el POST de login que documenta el fabricante', async () => {
    // El contrato es de solo lectura. La primera impresión de un contralor al
    // darnos su ERP no puede ser una póliza fantasma.
    const llamadas: PeticionHttp[] = [];
    const http = httpFalso(() => ({ estado: 401, cuerpo: '' }), llamadas);
    for (const c of CONECTORES) await c.probar(credencialesDeMentira(c), http);
    for (const p of llamadas) {
      expect(['GET', 'POST']).toContain(p.metodo);
      // Ninguna prueba puede pedir un método que modifique. Con el tipo ya
      // acotado a GET|POST esto es una red de seguridad por si alguien lo abre.
      expect(p.metodo === 'POST' ? p.url : 'ok').not.toMatch(/create|delete|update|insert|post_/i);
    }
  });

  it('ningún secreto viaja en la dirección que después se guarda y se enseña', async () => {
    // `verificadoContra` acaba en `rastreo_credencial.ultimo_error` y en la
    // pantalla del panel. Un token ahí se filtra a cualquiera que mire.
    const http = httpFalso(() => ({ estado: 401, cuerpo: '' }));
    for (const c of CONECTORES) {
      const v = credencialesDeMentira(c);
      const secretos = c.credenciales.filter((k) => k.forma === 'secreto').map((k) => v[k.clave]!);
      const r = await c.probar(v, http);
      const texto = `${r.detalle} ${r.verificadoContra ?? ''}`;
      for (const s of secretos) {
        expect(texto.includes(s), `${c.id} filtró un secreto en su resultado`).toBe(false);
      }
    }
  });
});

describe('los 200 que traen el error adentro', () => {
  it('Wialon: 200 con {"error":8} es credencial rechazada, no conexión', async () => {
    const c = conectorPorId('wialon')!;
    const http = httpFalso(() => ({ estado: 200, cuerpo: '{"error":8}' }));
    const r = await c.probar(credencialesDeMentira(c), http);
    expect(r.ok).toBe(false);
    expect(r.detalle).toContain('rechazó el token');
  });

  it('Wialon: 200 con eid es conexión, y avisa que la sesión dura 5 minutos', async () => {
    const c = conectorPorId('wialon')!;
    const http = httpFalso(() => ({ estado: 200, cuerpo: '{"eid":"abc123"}' }));
    const r = await c.probar(credencialesDeMentira(c), http);
    expect(r.ok).toBe(true);
    expect(r.detalle).toContain('5 minutos');
  });

  it('Wialon: el token va en el cuerpo, nunca en la dirección', async () => {
    // Un token en la URL acaba en el log de acceso del proveedor y en el de
    // cualquier proxy en medio.
    const c = conectorPorId('wialon')!;
    const llamadas: PeticionHttp[] = [];
    const v = credencialesDeMentira(c);
    await c.probar(v, httpFalso(() => ({ estado: 200, cuerpo: '{"eid":"x"}' }), llamadas));
    expect(llamadas[0].url).not.toContain(v.token);
    expect(llamadas[0].cuerpo).toContain(encodeURIComponent(v.token));
  });

  it('Geotab: JSON-RPC devuelve su error con estado 200 y NO se lee como conectado', async () => {
    const c = conectorPorId('geotab')!;
    const http = httpFalso(() => ({ estado: 200, cuerpo: '{"error":{"name":"InvalidUserException"}}' }));
    const r = await c.probar(credencialesDeMentira(c), http);
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/rechazó las credenciales/);
  });

  it('Geotab: si la base vive en otro servidor, el resultado lo DICE', async () => {
    // Es la trampa que rompe las integraciones con Geotab: autenticar en
    // my.geotab.com y luego seguir pegándole ahí.
    const c = conectorPorId('geotab')!;
    const http = httpFalso(() => ({
      estado: 200,
      cuerpo: '{"result":{"path":"https://my3.geotab.com","credentials":{"sessionId":"s"}}}',
    }));
    const r = await c.probar(credencialesDeMentira(c), http);
    expect(r.ok).toBe(true);
    expect(r.detalle).toContain('my3.geotab.com');
  });

  it('Navixy: sin `success` no se da por conectado', async () => {
    const c = conectorPorId('navixy')!;
    const http = httpFalso(() => ({ estado: 200, cuerpo: '{"success":false,"status":{"code":3}}' }));
    const r = await c.probar(credencialesDeMentira(c), http);
    expect(r.ok).toBe(false);
  });
});

describe('SAP Business One', () => {
  it('un 200 sin SessionId NO es una sesión', async () => {
    const c = conectorPorId('sap_b1')!;
    const http = httpFalso(() => ({ estado: 200, cuerpo: '{"odata.metadata":"algo"}' }));
    const r = await c.probar(credencialesDeMentira(c), http);
    expect(r.ok).toBe(false);
  });

  it('cierra la sesión que abrió — el Service Layer tiene tope de sesiones', async () => {
    const c = conectorPorId('sap_b1')!;
    const llamadas: PeticionHttp[] = [];
    const http = httpFalso(() => ({ estado: 200, cuerpo: '{"SessionId":"sesion-de-mentira"}' }), llamadas);
    const r = await c.probar(credencialesDeMentira(c), http);
    expect(r.ok).toBe(true);
    expect(llamadas.map((p) => p.url.split('/').pop())).toEqual(['Login', 'Logout']);
  });

  it('si el Logout falla, la credencial SIGUE verificada', async () => {
    // Cerrar es cortesía; lo que se comprobó ya se comprobó. Invertirlo haría
    // que un cliente con un balanceador raro viera "no conecta" con todo bien.
    const c = conectorPorId('sap_b1')!;
    let n = 0;
    const http = httpFalso(() => {
      n += 1;
      if (n === 1) return { estado: 200, cuerpo: '{"SessionId":"s"}' };
      throw new Error('el logout tronó');
    });
    const r = await c.probar(credencialesDeMentira(c), http);
    expect(r.ok).toBe(true);
  });
});

describe('el orden y los estados salen de la evidencia, no del prestigio', () => {
  it('el archivo va primero: es lo que usan 723 de las 1,987 flotas del censo', () => {
    // Si algún día alguien reordena esto poniendo SAP arriba, que sea a
    // sabiendas: la lista ordenada por fama de marca describe otro mercado.
    const [primeraCategoria, primeros] = porCategoria()[0];
    expect(primeraCategoria).toBe('Hoja de cálculo y archivo');
    expect(primeros[0].id).toBe('archivo_contable');
    expect(primeros[0].formaDeConectar).toBe('por_archivo');
    // Y está en su tope: no promete un escalón siguiente que no existe.
    expect(primeros[0].paraSubirDeEscalon).toBeNull();
  });

  it('el GPS genérico va antes que las marcas: ninguna marca domina', () => {
    const gps = new Map(porCategoria()).get('Rastreo GPS')!;
    expect(gps[0].id).toBe('gps_generico');
  });

  it('ningún TAG de casetas afirma tener API en vivo: ninguno la publica', () => {
    // El día que uno saque API, esta prueba falla y obliga a traer su URL.
    for (const id of ['iave', 'pase', 'televia', 'peaje_generico', 'monedero_diesel']) {
      const c = conectorPorId(id)!;
      expect(c.formaDeConectar, id).not.toBe('api_en_vivo');
      // Y ninguno pide credenciales, porque no hay a quién dárselas: pedir un
      // usuario y contraseña "por si acaso" entrena a la flota a entregarnos
      // accesos que no vamos a usar.
      expect(c.credenciales.length, id).toBe(0);
    }
  });

  it('PowerGAS tiene API documentada y AUN ASÍ no se marca en vivo', () => {
    // Su documentación pública solo publica el host de demostración. Marcarlo
    // `api_en_vivo` obligaría a cablear una dirección de producción que nadie
    // publicó — o sea, a inventarla.
    const c = conectorPorId('powergas')!;
    expect(c.formaDeConectar).toBe('requiere_piloto');
    expect(c.fuente).not.toBeNull();
    // Y su dirección se pide, no se supone: no hay valor por omisión posible.
    const url = c.credenciales.find((k) => k.clave === 'base_url')!;
    expect(url.requerida).toBe(true);
    expect(url.ejemplo).toBeUndefined();
  });

  it('el monedero de diésel está en su tope: ECC12 ya da la granularidad', () => {
    const m = conectorPorId('monedero_diesel')!;
    expect(m.formaDeConectar).toBe('por_archivo');
    expect(m.paraSubirDeEscalon).toBeNull();
    expect(m.comoConectaHoy).toContain('ECC12');
  });

  it('CONTPAQi y Aspel siguen sin construirse — igual que en ajustes_operativos', () => {
    // Si aquí dijeran "disponible", esta pantalla contradiría al selector de
    // formato de export, donde `contpaqi_txt` y `aspel_xls` están marcados
    // `implementado: false`.
    for (const id of ['contpaqi', 'aspel_coi']) {
      expect(conectorPorId(id)!.formaDeConectar, id).toBe('no_construido');
    }
  });
});

describe('las utilidades del contrato', () => {
  it('faltantes() solo cuenta lo requerido', () => {
    const falso = {
      credenciales: [
        { clave: 'a', rotulo: 'A', forma: 'texto' as const, requerida: true, ayuda: 'la a de siempre' },
        { clave: 'b', rotulo: 'B', forma: 'texto' as const, requerida: false, ayuda: 'la b opcional' },
      ],
    };
    expect(faltantes(falso, {})).toEqual(['A']);
    // Espacios en blanco NO cuentan como capturado: un campo con un espacio
    // pasaría la guarda y produciría una petición sin credencial.
    expect(faltantes(falso, { a: '   ' })).toEqual(['A']);
    expect(faltantes(falso, { a: 'x' })).toEqual([]);
  });

  it('probarConGuardas() convierte una excepción en ok:false, nunca en ok:true', async () => {
    const c = { nombre: 'X', credenciales: [] };
    const r = await probarConGuardas(c, {}, () => {
      throw new Error('boom');
    });
    expect(r.ok).toBe(false);
    expect(r.detalle).toContain('boom');
    expect(r.verificadoContra).toBeNull();
  });

  it('veredictoHttp() separa "credencial mala" de "proveedor caído"', () => {
    expect(veredictoHttp({ estado: 200, cuerpo: '' }, '/x', 'X').ok).toBe(true);
    expect(veredictoHttp({ estado: 401, cuerpo: '' }, '/x', 'X').detalle).toMatch(/rechazó/);
    expect(veredictoHttp({ estado: 500, cuerpo: '' }, '/x', 'X').detalle).toMatch(/NO dice nada sobre la credencial/);
    // Un 404 no confirma nada: no se puede afirmar que la credencial sirva.
    expect(veredictoHttp({ estado: 404, cuerpo: '' }, '/x', 'X').ok).toBe(false);
  });

  it('loQuePedirle() arma la lista sin olvidar campos y marca los secretos', () => {
    const conSecreto = CONECTORES.find((c) => c.credenciales.some((k) => k.forma === 'secreto'))!;
    const lineas = loQuePedirle([conSecreto.id]).join('\n');
    for (const campo of conSecreto.credenciales) expect(lineas).toContain(campo.rotulo);
    expect(lineas).toContain('SECRETO');
  });

  it('loQuePedirle() no se traga un id inventado en silencio', () => {
    // Una lista corta que se ve completa hace que el cliente mande accesos a
    // medias y que nadie se entere hasta el día del arranque.
    expect(loQuePedirle(['no_existe']).join('\n')).toContain('no está en el catálogo');
  });

  it('conectorPorId() devuelve null y no lanza', () => {
    expect(conectorPorId('no_existe')).toBeNull();
    expect(conectorPorId(CONECTORES[0].id)?.id).toBe(CONECTORES[0].id);
  });

  it('conectoresProbables() no incluye lo que no está construido', () => {
    for (const c of conectoresProbables()) {
      expect(c.formaDeConectar, c.id).not.toBe('no_construido');
      expect(c.credenciales.length, c.id).toBeGreaterThan(0);
    }
  });
});

/**
 * Valores de mentira con la forma correcta, para poder ejercitar `probar()`.
 *
 * Deliberadamente reconocibles y deliberadamente distintos entre campos: así,
 * si uno se filtra a un mensaje, la prueba de secretos sabe cuál fue.
 */
function credencialesDeMentira(c: Conector): Record<string, string> {
  const v: Record<string, string> = {};
  for (const campo of c.credenciales) {
    v[campo.clave] = campo.forma === 'url'
      ? 'https://ejemplo.invalido/api'
      : campo.forma === 'correo'
        ? 'prueba@ejemplo.invalido'
        : `valor-de-mentira-${campo.clave}`;
  }
  // El genérico de GPS exige un vocabulario cerrado en `patron`; sin esto se
  // iría por su rama de "no reconozco la forma" y no ejercitaría la red.
  if ('patron' in v) v.patron = 'bearer';
  return v;
}
