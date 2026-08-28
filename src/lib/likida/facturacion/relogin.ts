import { logger } from '@/lib/logger';
import { comercio as fichaComercio } from './comercios';
import { conectorDePortal } from '../conectores/portales_facturacion';
import { guardarSesionPortal } from './sesion_portal';
import { anotarVinculo, recortarEstadoAlPortal } from './vinculo_portal';
import { escrituraPermitida, pantallaDeLogin } from './vinculo_senales';
import {
  camposDeEntrada, corteDuro, credencialRechazada, type ClaseDeCorte,
} from './relogin_cortes';
import {
  candadoDeRelogin, contrasenaDePortal, diaMx, permisoDeRelogin,
  registrarIntento, registrarResultado,
} from './relogin_portal';
import type { InventarioPagina, PaginaConInventario } from './adaptadores/playwright_base';

// ════════════════════════════════════════════════════════════════════════════
// EL RE-LOGIN AUTOMÁTICO — la ÚNICA función del sistema que teclea una
// contraseña, y solo cuando la flota lo pidió por escrito.
//
// Encargo de Javier del 27-ago-2026: «si vuelve a pedir contraseña quiero que
// el agente pueda resolverlo». Esto es eso, sin deshacer lo que el #146
// estableció el mismo día.
//
// ── LO QUE NO SE DESHACE ─────────────────────────────────────────────────
//
// El #146 retiró el auto-tecleo porque la contraseña se descifraba en CADA
// ticket, dentro del camino de facturar. Esa separación SIGUE:
//
//   · `facturar` no importa este archivo ni `relogin_portal.ts`, y no tiene
//     ninguna entrada al cofre de contraseñas. Sigue exactamente igual.
//   · Esto corre APARTE del lote, después de que el portal ya nos sacó, y a lo
//     sumo UNA vez por caducidad (el candado de `relogin_portal.ts` lo hace
//     verdad aunque alguien lo llame de más).
//   · La guarda de `type="password"` sigue dura para todos. Esta función pasa
//     `permitirCampoPassword: true` y es la única del repo que lo hace; una
//     prueba lo fija.
//
// ── HIGIENE DEL SECRETO, ESCRITA DONDE SE APLICA ─────────────────────────
//
//   · La contraseña vive en UNA variable local de `reconectarPortal` y muere
//     con la función. No se devuelve, no se guarda, no se pasa a nada que no
//     sea el `escribir()` del campo.
//   · NO se loguea. Ni entera, ni sus últimos caracteres, ni su longitud.
//   · NO entra a ningún mensaje de error, a `ultimo_motivo`, ni a la bitácora:
//     todo lo que sale de aquí cita lo que la PÁGINA dijo, nunca lo que se
//     tecleó.
//   · NO SE TOMA NINGUNA CAPTURA en todo este camino. La captura es evidencia
//     y aquí no hace falta —el inventario dice qué se vio, en texto— y una
//     captura de un formulario de login es una foto de un campo que acaba de
//     recibir un secreto. Aunque el navegador enmascare el campo, la foto
//     viaja dentro de `ResultadoAgente.captura` a un JSON, y ese es un lugar
//     al que la contraseña de nadie tiene por qué acercarse.
//   · El inventario que se lee NO trae valores de campos (ver
//     `CampoInventariado`), así que citarlo es seguro por construcción.
//
// ── LO QUE NO RESUELVE, Y NO VA A RESOLVER ───────────────────────────────
//
// CAPTCHA, segundo factor, pregunta de seguridad, cambio de contraseña
// obligatorio y cuenta bloqueada. Los cinco cortan, sin reintento, con el
// motivo exacto en español y el aviso al contralor. El porqué de cada uno está
// en `relogin_cortes.ts`; el del CAPTCHA se repite aquí porque es el que más
// tienta: NO se resuelve ni se rodea NUNCA — son los términos del portal, y la
// cuenta que se suspende es la del cliente, no la nuestra.
// ════════════════════════════════════════════════════════════════════════════

/** Cuánto se espera a que el portal conteste después de mandar el formulario. */
export const TOPE_ESPERA_RELOGIN_MS = 20_000;

/** Cada cuánto se vuelve a mirar mientras se espera. */
export const INTERVALO_RELOGIN_MS = 1_000;

/** Por qué NO se reconectó. Cada una manda a la persona a algo distinto. */
export type ClaseDeReloginFallido =
  | ClaseDeCorte
  | 'sin_consentimiento'
  | 'detenido'
  | 'tope_dia'
  | 'backoff'
  | 'sin_contrasena'
  | 'sin_campos'
  | 'portal_no_contesto'
  | 'no_se_pudo_leer';

export type ResultadoRelogin =
  | { ok: true; comercio: string; cookies: number; capturadaEn: string }
  | {
      ok: false;
      comercio: string;
      clase: ClaseDeReloginFallido;
      motivo: string;
      /** ¿Se llegó a tocar el portal? `false` = ni se abrió el cofre. */
      intentado: boolean;
      /** ¿Esto lo tiene que resolver una persona AHORA? Va al aviso. */
      pideHumano: boolean;
    };

/** Lo que hace falta para reconectar, sin importar Playwright aquí. */
export interface EntornoRelogin {
  /** Una pestaña del MISMO contexto del lote: las cookies caen donde sirven. */
  pagina: PaginaConInventario;
  /** El `storageState` del contexto, como JSON en string. */
  estadoDeSesion(): Promise<string | null>;
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

/**
 * Vuelve a entrar al portal con la contraseña que la flota autorizó guardar, y
 * deja la sesión nueva guardada cifrada.
 *
 * IDEMPOTENTE en lo que importa: si al abrir el portal resulta que YA estamos
 * dentro (otra corrida reconectó, o la caducidad fue un falso positivo), se
 * guarda la sesión y se sale sin teclear nada — no se abre el cofre para
 * confirmar algo que ya funciona.
 *
 * FALLA CERRADO en todos los bordes: sin consentimiento, sin poder leer el
 * permiso, sin poder anotar el intento, sin campos reconocibles o sin
 * contraseña, NO se toca el portal y se devuelve el motivo para el humano.
 */
export async function reconectarPortal(args: {
  tenantId: string;
  /** Clave del comercio en `comercios.ts`. */
  comercio: string;
  entorno: EntornoRelogin;
  /** OPCIONAL: qué existe solo estando dentro. Ver `pantallaDeLogin`. */
  senaDeAdentro?: string;
  topeMs?: number;
  intervaloMs?: number;
}): Promise<ResultadoRelogin> {
  const { tenantId, comercio } = args;
  const ahora = args.entorno.ahora ?? (() => Date.now());
  const dormir = args.entorno.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tope = args.topeMs ?? TOPE_ESPERA_RELOGIN_MS;
  const intervalo = args.intervaloMs ?? INTERVALO_RELOGIN_MS;

  const ficha = fichaComercio(comercio);
  if (!ficha) {
    return no(comercio, 'no_se_pudo_leer', `"${comercio}" no está en el catálogo de comercios, así que no hay portal al que volver a entrar.`, false, false);
  }

  // ── 1. EL CONSENTIMIENTO, ANTES QUE NADA. Esta comprobación va delante de
  // cualquier lectura del cofre a propósito: es lo que hace VERDAD la promesa
  // de que una flota que no marcó la casilla no tiene su contraseña
  // descifrada nunca, ni siquiera para descubrir que no se puede usar.
  const permiso = await permisoDeRelogin(tenantId, comercio);
  if (permiso === null) {
    // «No pude preguntar» ≠ «no hay permiso». Sin poder leerlo no se intenta:
    // el peor caso es que el contralor entre a mano una vez, y el caro sería
    // gastarle un intento a la cuenta por un timeout de Supabase.
    return no(comercio, 'no_se_pudo_leer', 'No se pudo leer si esta flota autorizó la reconexión automática, así que no se intentó. Reconectar sin poder comprobar el permiso no es una opción.', false, true);
  }

  const hoy = diaMx(new Date(ahora()));
  const veredicto = candadoDeRelogin(permiso, ahora(), hoy);
  if (!veredicto.puede) {
    // `sin_consentimiento` NO es un problema: es el comportamiento de siempre.
    // Los otros tres sí piden que alguien mire.
    return no(comercio, veredicto.clase, veredicto.motivo, false, veredicto.clase !== 'sin_consentimiento');
  }

  // ── 2. SE ANOTA EL INTENTO ANTES DE GASTARLO. Ver `registrarIntento`: si
  // esta función muere a media sesión, el contador ya se movió. No poder
  // contar es no poder frenar, así que si no se pudo anotar, no se intenta.
  const anotado = await registrarIntento({ tenantId, comercio, permiso, hoy, ahora: new Date(ahora()).toISOString() });
  if (!anotado) {
    return no(comercio, 'no_se_pudo_leer', 'No se pudo anotar el intento de reconexión, y sin poder contarlos no hay forma de topar los reintentos. No se intentó.', false, true);
  }

  try {
    return await entrar({ tenantId, comercio, ficha, entorno: args.entorno, senaDeAdentro: args.senaDeAdentro, ahora, dormir, tope, intervalo });
  } catch (e) {
    // Un fallo inesperado NO cuenta como corte duro y NO bloquea: lo que se
    // sabe es que no se pudo terminar, no que la credencial esté mal. El
    // mensaje se cita tal cual porque viene del navegador, no del formulario —
    // ningún valor tecleado pasa por aquí.
    const motivo = `No se pudo completar la reconexión de ${ficha.nombre}: ${e instanceof Error ? e.message : String(e)}`;
    logger.warn('relogin.fallo_inesperado', { tenant: tenantId, comercio });
    await registrarResultado({ tenantId, comercio, ok: false, clase: 'portal_no_contesto', motivo, ahora: new Date(ahora()).toISOString() });
    return no(comercio, 'portal_no_contesto', motivo, true, true);
  }
}

/** El resultado negativo, en un solo sitio para que todos digan lo mismo. */
function no(
  comercio: string,
  clase: ClaseDeReloginFallido,
  motivo: string,
  intentado: boolean,
  pideHumano: boolean,
): ResultadoRelogin {
  return { ok: false, comercio, clase, motivo, intentado, pideHumano };
}

async function entrar(a: {
  tenantId: string;
  comercio: string;
  ficha: { nombre: string; portal: string };
  entorno: EntornoRelogin;
  senaDeAdentro?: string;
  ahora: () => number;
  dormir: (ms: number) => Promise<void>;
  tope: number;
  intervalo: number;
}): Promise<ResultadoRelogin> {
  const { tenantId, comercio, ficha, entorno } = a;
  const sello = () => new Date(a.ahora()).toISOString();

  await entorno.pagina.abrir(ficha.portal);
  let inv = await entorno.pagina.inventario();

  // ── 3. ¿YA ESTAMOS DENTRO? Puede pasar: otra corrida reconectó, o la
  // caducidad fue un falso positivo del pre-cheque de edad. Se guarda lo que
  // hay y se sale SIN abrir el cofre. Es la rama idempotente.
  if (!pantallaDeLogin(inv, a.senaDeAdentro)) {
    logger.info('relogin.ya_dentro', { tenant: tenantId, comercio });
    return await guardar({ tenantId, comercio, ficha, entorno, sello: sello() });
  }

  // ── 4. LOS CORTES DUROS, ANTES DE TECLEAR. Si hay CAPTCHA o segundo factor,
  // no se abre el cofre siquiera: descifrar una contraseña que no se va a
  // poder usar es exponerla para nada.
  const corte = corteDuro(inv);
  if (corte) return await cortar(a, corte);

  // ── 5. QUÉ CAMPOS SON. Si no se identifican los dos con certeza, se para:
  // escribir a ciegas en un formulario que no se entendió es peor que pedirle
  // a una persona que entre.
  const campos = camposDeEntrada(inv);
  if (!campos) {
    const motivo = `${ficha.nombre} enseña la pantalla de entrar pero no se pudo identificar con certeza dónde va el usuario y dónde la contraseña. No se escribió nada — teclear a ciegas en un formulario ajeno no es una opción.`;
    await registrarResultado({ tenantId, comercio, ok: false, clase: 'sin_campos', motivo, ahora: sello() });
    return no(comercio, 'sin_campos', motivo, true, true);
  }

  // ── 6. LA GUARDA, COMPROBADA AQUÍ TAMBIÉN. `escrituraPermitida` es la misma
  // función que rechaza al piloto; este es el ÚNICO llamador del repo que pasa
  // `permitirCampoPassword: true`, y lo pasa después de haber comprobado el
  // consentimiento y el candado. Si el campo que se eligió no fuera de
  // contraseña, o si algún día alguien quitara la puerta, esto se para solo.
  if (!escrituraPermitida(campos.contrasena, inv, { permitirCampoPassword: true })) {
    const motivo = 'La guarda de campos de contraseña rechazó la escritura del re-login autorizado. Esto no debería pasar: se detiene y entra una persona.';
    await registrarResultado({ tenantId, comercio, ok: false, clase: 'sin_campos', motivo, ahora: sello() });
    return no(comercio, 'sin_campos', motivo, true, true);
  }

  // ── 7. EL COFRE. Aquí, y en ningún otro punto del sistema durante una
  // corrida de facturación. Lo que devuelve vive en `acceso` hasta el final de
  // esta función y no sale de ella.
  const acceso = await contrasenaDePortal(tenantId, comercio);
  if (!acceso) {
    const motivo = `No hay una contraseña guardada utilizable para ${ficha.nombre}. La flota autorizó la reconexión, pero falta capturar (o volver a capturar) el acceso en el cofre.`;
    await registrarResultado({ tenantId, comercio, ok: false, clase: 'sin_campos', motivo, ahora: sello() });
    return no(comercio, 'sin_contrasena', motivo, false, true);
  }

  // ── 8. SE TECLEA. Del cofre al `escribir()`, sin escalas. El valor no se
  // asigna a ninguna variable de mayor alcance, no se concatena en ningún
  // mensaje y no pasa por el logger — la línea de abajo dice el HECHO, no el
  // dato, y ni siquiera su longitud.
  logger.info('relogin.tecleando', { tenant: tenantId, comercio, campo: campos.contrasena });
  await entorno.pagina.escribir(campos.usuario, acceso.usuario);
  await entorno.pagina.escribir(campos.contrasena, acceso.contrasena);

  if (campos.boton) await entorno.pagina.hacerClic(campos.boton);
  else {
    // Sin botón identificable no se inventa un clic: se dice y se para. Un
    // clic a ciegas en un formulario de login puede caer en «registrarme».
    const motivo = `${ficha.nombre} no enseña un botón de entrar que se pueda identificar. Se llenó el formulario y no se apretó nada — un clic adivinado en una pantalla de acceso puede acabar dando de alta una cuenta.`;
    await registrarResultado({ tenantId, comercio, ok: false, clase: 'sin_campos', motivo, ahora: sello() });
    return no(comercio, 'sin_campos', motivo, true, true);
  }

  // ── 9. QUÉ CONTESTÓ. Se sondea hasta el tope: estos portales redirigen.
  const arranque = a.ahora();
  for (;;) {
    await a.dormir(a.intervalo);
    try {
      inv = await entorno.pagina.inventario();
    } catch {
      // Mirar es diagnóstico: un inventario que revienta a media navegación
      // no puede cancelar una reconexión en curso.
      if (a.ahora() - arranque >= a.tope) break;
      continue;
    }

    // EL CANDADO INNEGOCIABLE, primero: si el portal dijo que la credencial no
    // sirve, se detiene AQUÍ y para siempre. `registrarResultado` marca
    // `bloqueado` para esta clase, y ni el tope diario ni el backoff dan otra
    // oportunidad hasta que una persona guarde la contraseña buena.
    const rechazo = credencialRechazada(inv);
    if (rechazo) return await cortar(a, rechazo);

    // Y los cinco muros otra vez: el segundo factor casi siempre aparece
    // DESPUÉS de que el portal aceptó la contraseña, que es justo aquí.
    const despues = corteDuro(inv);
    if (despues) return await cortar(a, despues);

    if (!pantallaDeLogin(inv, a.senaDeAdentro)) {
      logger.info('relogin.dentro', { tenant: tenantId, comercio });
      return await guardar({ tenantId, comercio, ficha, entorno, sello: sello() });
    }

    if (a.ahora() - arranque >= a.tope) break;
  }

  // Se agotó el tope y seguimos en la pantalla de entrar, sin que el portal
  // dijera qué pasó. NO se bloquea (no consta que la credencial esté mal) pero
  // tampoco se reintenta ahora: el backoff se encarga.
  const motivo = `Se mandó el formulario de entrada de ${ficha.nombre} y a los ${Math.round(a.tope / 1000)} s la pantalla seguía siendo la de entrar, sin decir por qué. No se reintenta en esta corrida.`;
  await registrarResultado({ tenantId, comercio, ok: false, clase: 'portal_no_contesto', motivo, ahora: sello() });
  return no(comercio, 'portal_no_contesto', motivo, true, true);
}

/** Un corte duro: se anota, NO se reintenta, y el humano recibe el motivo. */
async function cortar(
  a: { tenantId: string; comercio: string; ficha: { nombre: string }; ahora: () => number },
  corte: { clase: ClaseDeCorte; motivo: string },
): Promise<ResultadoRelogin> {
  const motivo = `${a.ficha.nombre}: ${corte.motivo}`;
  logger.info('relogin.corte', { tenant: a.tenantId, comercio: a.comercio, clase: corte.clase });
  await registrarResultado({
    tenantId: a.tenantId, comercio: a.comercio, ok: false,
    clase: corte.clase, motivo, ahora: new Date(a.ahora()).toISOString(),
  });
  return no(a.comercio, corte.clase, motivo, true, true);
}

/**
 * ESTAMOS DENTRO: se exporta la sesión, se RECORTA al dominio del portal y se
 * guarda cifrada, igual que en la vinculación asistida. El estado pasa a
 * `vinculado` para que la pantalla deje de pedir que alguien entre.
 */
async function guardar(a: {
  tenantId: string;
  comercio: string;
  ficha: { nombre: string; portal: string };
  entorno: EntornoRelogin;
  sello: string;
}): Promise<ResultadoRelogin> {
  const completo = await a.entorno.estadoDeSesion();
  if (!completo) {
    const motivo = `Se entró a ${a.ficha.nombre} pero el navegador no devolvió la sesión. No hay nada que guardar, así que la corrida siguiente volvería a encontrarse el login.`;
    await registrarResultado({ tenantId: a.tenantId, comercio: a.comercio, ok: false, clase: 'portal_no_contesto', motivo, ahora: a.sello });
    return no(a.comercio, 'portal_no_contesto', motivo, true, true);
  }

  const recortado = recortarEstadoAlPortal(completo, a.ficha.portal);
  if (!recortado) {
    const motivo = `Se entró a ${a.ficha.nombre} pero el portal no dejó ni una cookie suya. Sin cookies no hay sesión que guardar, y guardar una bolsa vacía diría «vinculado» sobre algo que no funciona.`;
    await registrarResultado({ tenantId: a.tenantId, comercio: a.comercio, ok: false, clase: 'portal_no_contesto', motivo, ahora: a.sello });
    return no(a.comercio, 'portal_no_contesto', motivo, true, true);
  }

  await guardarSesionPortal(a.tenantId, conectorDePortal(a.comercio), {
    storageState: recortado, capturadaEn: a.sello,
  });
  await anotarVinculo({
    tenantId: a.tenantId, comercio: a.comercio, estado: 'vinculado',
    motivo: 'Likida volvió a entrar sola con la contraseña que la flota autorizó guardar.',
    ahora: a.sello,
  });
  await registrarResultado({
    tenantId: a.tenantId, comercio: a.comercio, ok: true, clase: 'reconectado',
    motivo: null, ahora: a.sello,
  });

  const cookies = (JSON.parse(recortado) as { cookies: unknown[] }).cookies.length;
  logger.info('relogin.ok', { tenant: a.tenantId, comercio: a.comercio, cookies });
  return { ok: true, comercio: a.comercio, cookies, capturadaEn: a.sello };
}

/** Lo que este módulo necesita saber de un inventario, para las pruebas. */
export type { InventarioPagina };
