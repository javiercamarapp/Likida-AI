import { logger } from '@/lib/logger';
import { comercio as fichaComercio } from './comercios';
import { conectorDePortal } from '../conectores/portales_facturacion';
import { guardarSesionPortal } from './sesion_portal';
import { anotarVinculo, recortarEstadoAlPortal } from './vinculo_portal';
import { pantallaDeLogin } from './vinculo_senales';
import type { InventarioPagina, PaginaConInventario } from './adaptadores/playwright_base';

// ════════════════════════════════════════════════════════════════════════════
// LA SESIÓN ASISTIDA — el único momento en que alguien teclea una contraseña,
// y ese alguien es el contralor.
//
// Es la otra mitad del retiro de contraseñas en claro. `piloto_vision.ts` ya no
// las escribe; para que el portal siga siendo operable hace falta que exista un
// camino por donde la persona abra la puerta UNA vez. Esto es ese camino:
//
//   1. Se abre el portal en un navegador que la persona PUEDE VER
//      (`headless: false`) y en el que ella entra con su cuenta.
//   2. Este código NO teclea, NO lee el formulario y NO toca el teclado: mira
//      el inventario cada tanto y espera a que la pantalla de entrar
//      desaparezca. Un CAPTCHA en ese login lo resuelve la persona, que es
//      exactamente el modelo de la casa.
//   3. En cuanto está dentro, se exporta el `storageState`, se RECORTA a las
//      cookies de ese portal y se guarda CIFRADO (`sesion_portal.ts`).
//   4. Se anota `vinculado` en `portal_estado` para que la pantalla lo diga.
//
// ── POR QUÉ ESTO NO ES UN BOTÓN DEL PANEL (y se dice en vez de fingirlo) ────
//
// Un servidor de Vercel no tiene pantalla ni teclado: no puede enseñarle a
// nadie un Chromium para que teclee en él. El botón «Vincular ahora» del panel
// lleva al portal para que el contralor entre por su lado; lo que produce la
// SESIÓN GUARDADA es esta rutina, corriendo en una máquina con pantalla
// (`scripts/vincular-portal.mjs`, acompañado). Mientras la vinculación remota
// no exista, la pantalla dice exactamente eso y no promete un botón mágico.
//
// La pieza está escrita de forma que el día que haya un navegador remoto con
// vista (Browserbase y compañía) lo único que cambie sea de dónde sale la
// página: todo lo de aquí abajo recibe una `PaginaConInventario` y un
// exportador de estado, y no sabe si hay una Mac o un contenedor detrás.
// ════════════════════════════════════════════════════════════════════════════

/** Cada cuánto se vuelve a mirar si la persona ya entró. */
export const INTERVALO_VINCULACION_MS = 2_000;

/**
 * Cuánto se espera a que la persona termine de entrar. Cinco minutos: da para
 * buscar la contraseña en el gestor, resolver un reCAPTCHA de imágenes y
 * teclear un código de dos pasos, que es lo que de verdad tarda. Más que eso es
 * un navegador abierto que nadie está mirando.
 */
export const TOPE_VINCULACION_MS = 5 * 60 * 1000;

export type ResultadoVinculacion =
  | { ok: true; comercio: string; cookies: number; capturadaEn: string }
  | { ok: false; comercio: string; motivo: string };

/** Lo que hace falta para capturar la sesión, sin importar Playwright aquí. */
export interface EntornoVinculacion {
  /** La pestaña donde la persona va a entrar. */
  pagina: PaginaConInventario;
  /** El `storageState` del contexto, como JSON en string. */
  estadoDeSesion(): Promise<string | null>;
  /** Reloj y espera inyectables: la prueba no espera cinco minutos de verdad. */
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

/**
 * Abre el portal, ESPERA a que la persona entre, y guarda la sesión cifrada.
 *
 * FALLA CERRADO: si al agotarse el tope la pantalla sigue siendo la de entrar,
 * no se guarda NADA. Guardar la bolsa de cookies de un login a medias dejaría
 * `portal_estado` diciendo «vinculado» sobre una sesión que el portal no
 * reconoce, y el contralor sabría que no funciona hasta la corrida siguiente.
 */
export async function vincularPortalAsistido(args: {
  tenantId: string;
  /** Clave del comercio en `comercios.ts`. */
  comercio: string;
  entorno: EntornoVinculacion;
  /** OPCIONAL: qué existe solo estando dentro. Ver `pantallaDeLogin`. */
  senaDeAdentro?: string;
  topeMs?: number;
  intervaloMs?: number;
}): Promise<ResultadoVinculacion> {
  const ficha = fichaComercio(args.comercio);
  if (!ficha) {
    return { ok: false, comercio: args.comercio, motivo: `"${args.comercio}" no está en el catálogo de comercios, así que no hay portal que abrir.` };
  }

  const ahora = args.entorno.ahora ?? (() => Date.now());
  const dormir = args.entorno.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tope = args.topeMs ?? TOPE_VINCULACION_MS;
  const intervalo = args.intervaloMs ?? INTERVALO_VINCULACION_MS;

  const arranque = ahora();
  await args.entorno.pagina.abrir(ficha.portal);

  let ultimaEvidencia = 'no se alcanzó a mirar la pantalla';
  let dentro = false;
  // Se mira SIEMPRE al menos una vez: un portal donde la sesión del sistema
  // operativo ya estaba viva no enseña login nunca, y esperar el intervalo
  // completo antes del primer vistazo lo haría parecer un fallo.
  for (;;) {
    let inv: InventarioPagina;
    try {
      inv = await args.entorno.pagina.inventario();
    } catch (e) {
      // Mirar es diagnóstico: un inventario que revienta a media navegación
      // (el portal recargando) no puede cancelar una vinculación en curso.
      ultimaEvidencia = e instanceof Error ? e.message : String(e);
      if (ahora() - arranque >= tope) break;
      await dormir(intervalo);
      continue;
    }

    const login = pantallaDeLogin(inv, args.senaDeAdentro);
    if (!login) { dentro = true; break; }
    ultimaEvidencia = login;
    if (ahora() - arranque >= tope) break;
    await dormir(intervalo);
  }

  if (!dentro) {
    return {
      ok: false, comercio: args.comercio,
      motivo: `Se agotaron los ${Math.round(tope / 1000)} s y el portal seguía en la pantalla de entrar (${ultimaEvidencia}). No se guardó ninguna sesión — una sesión a medias diría «vinculado» sobre algo que no funciona.`,
    };
  }

  const completo = await args.entorno.estadoDeSesion();
  if (!completo) {
    return { ok: false, comercio: args.comercio, motivo: 'La persona entró pero el navegador no devolvió la sesión (`storageState`). No hay nada que guardar.' };
  }

  const recortado = recortarEstadoAlPortal(completo, ficha.portal);
  if (!recortado) {
    return {
      ok: false, comercio: args.comercio,
      motivo: `La persona entró pero el portal no dejó ni una cookie de ${new URL(ficha.portal).hostname}. Sin cookies no hay sesión que guardar, y guardar una bolsa vacía sería mentir en la pantalla.`,
    };
  }

  const capturadaEn = new Date(ahora()).toISOString();
  await guardarSesionPortal(args.tenantId, conectorDePortal(args.comercio), {
    storageState: recortado, capturadaEn,
  });
  await anotarVinculo({
    tenantId: args.tenantId, comercio: args.comercio, estado: 'vinculado',
    motivo: null, ahora: capturadaEn,
  });

  const cookies = (JSON.parse(recortado) as { cookies: unknown[] }).cookies.length;
  logger.info('vinculacion.asistida.ok', { tenant: args.tenantId, comercio: args.comercio, cookies });
  return { ok: true, comercio: args.comercio, cookies, capturadaEn };
}
