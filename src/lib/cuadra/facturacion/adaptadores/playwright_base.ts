import { logger } from '@/lib/logger';
import type { AdaptadorPortal, ModoAgente, ResultadoAgente } from '../agente';
import type { CampoListo } from '../pendientes';
import type { ClaveCampo } from '../comercios';

// ═══════════════════════════════════════════════════════════════════════════
// LA BASE DE LA QUE CUELGA CADA ADAPTADOR DE PORTAL.
//
// Un portal de autofacturación —e-facpos, facturamos.com.mx, el de cada
// cadena— recibe folio, monto, fecha, Web ID y sucursal, y devuelve un CFDI.
// Lo que cambia entre uno y otro son los SELECTORES, no el procedimiento. Este
// archivo es el procedimiento; el adaptador de cada portal aporta su mapeo.
//
// ── POR QUÉ ENSAYO ES EL DEFAULT ─────────────────────────────────────────
//
// Apretar el botón de emitir CREA UN CFDI REAL ante el SAT y no se deshace:
// cancelar uno fuera de plazo se le queda al cliente en su contabilidad. Un
// selector equivocado en modo `emitir` factura el ticket con el dato de otro
// campo. En `ensayo` ese mismo error se ve en la captura y no cuesta nada.
//
// Por eso `facturar` normaliza el modo con `=== 'emitir'` y no al revés: si a
// alguien le llega `undefined`, una cadena vacía o un valor que venía de un
// JSON mal parseado, el resultado es ENSAYO. Para emitir hay que pedirlo con
// la palabra exacta.
//
// ── POR QUÉ NO ESTÁ PLAYWRIGHT AQUÍ ──────────────────────────────────────
//
// La lógica que importa —qué se llena, en qué orden, cuándo se aborta, cuándo
// NO se reintenta— no necesita un navegador para probarse, y con navegador se
// probaría lento, con red y contra un portal real que emitiría CFDI de verdad.
// Así que la base habla contra `PaginaPortal`, cinco métodos. La prueba la
// implementa con un doble; el adaptador real la implementará con Playwright el
// día que se agregue la dependencia. Nada de este archivo cambia ese día.
//
// ── LA REGLA QUE NO SE NEGOCIA: NO SE REINTENTA EN `emitir` ───────────────
//
// Tras un fallo AMBIGUO —¿se envió el formulario antes de que reventara?— un
// reintento es la forma de acabar con dos CFDI por el mismo ticket. Y el fallo
// casi siempre es ambiguo: el navegador no distingue "el botón no existe" de
// "el botón se apretó y la navegación tardó de más". Aquí el reintento no está
// prohibido por comentario, está IMPEDIDO por el código: el número de intentos
// se calcula desde el modo, y en `emitir` vale 1 aunque se hayan configurado
// veinte.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lo mínimo que la base necesita de una página para operar un portal.
 *
 * El contrato de errores es la parte importante, porque de él sale el
 * diagnóstico cuando un portal cambia:
 *
 *  · `escribir` y `hacerClic` LANZAN si el selector no está en la página. La
 *    base atrapa y dice QUÉ selector faltó — es lo que permite arreglar el
 *    adaptador sin abrir el portal a mano.
 *  · `leerTexto` NO lanza: devuelve `null` cuando el selector no está. Se usa
 *    para leer cosas que legítimamente pueden no existir todavía (el cuadro de
 *    error del portal, el UUID antes de emitir); si lanzara, la ausencia de un
 *    error se leería como un fallo.
 */
export interface PaginaPortal {
  abrir(url: string): Promise<void>;
  escribir(selector: string, valor: string): Promise<void>;
  hacerClic(selector: string): Promise<void>;
  /** `null` cuando el selector no existe. Nunca lanza. */
  leerTexto(selector: string): Promise<string | null>;
  /** Devuelve la ruta o el data-uri de la captura. Para poder MIRAR qué pasó. */
  captura(): Promise<string>;
  /**
   * OPCIONAL. Si la implementación la ofrece, la base verifica TODOS los
   * selectores ANTES de escribir el primero y reporta los que falten JUNTOS.
   * Sin esto se descubre uno por corrida: se arregla el primero, se vuelve a
   * correr, aparece el segundo. Con un portal que acaba de cambiar de plantilla
   * eso son cinco vueltas.
   */
  existe?(selector: string): Promise<boolean>;
  /**
   * OPCIONAL. Un Chromium por ticket que nadie cierra son 21 navegadores vivos
   * por viaje. Si falla al cerrar no se tumba el resultado: el CFDI ya se
   * decidió antes.
   */
  cerrar?(): Promise<void>;
}

export type FabricaDePagina = () => Promise<PaginaPortal>;

/**
 * Cuánto se le da a un portal para enseñar el UUID DESPUÉS de apretar emitir.
 *
 * 20 s, y el número sale de lo que pasa detrás del botón: estos portales no
 * imprimen un folio propio, mandan el comprobante a timbrar a un PAC y esperan
 * su respuesta. No está medido contra ninguno de verdad —no se puede medir sin
 * emitir un CFDI real— así que se elige por el lado seguro: quedarse corto aquí
 * no cuesta un timbrado de más, cuesta que una emisión BUENA se reporte como
 * "puede que el CFDI ya exista" y mande a una persona a revisar algo que salió
 * bien. Son 20 de los 300 s del cron, y solo los paga el ticket que sí emitió.
 */
export const ESPERA_UUID_MS = 20_000;

/** Cada cuánto se vuelve a mirar mientras se espera el UUID. */
export const INTERVALO_UUID_MS = 250;

/**
 * Dónde vive cada cosa EN ESTE portal.
 *
 * Va todo junto —campos, botón, UUID y cuadro de error— a propósito: cuando un
 * portal se rediseña se cambian los cuatro a la vez, y tenerlos repartidos en
 * cuatro métodos es cómo se queda uno viejo sin que nadie lo note.
 */
export interface MapeoPortal {
  /** Selector de cada campo del ticket. Parcial: ningún portal pide todos. */
  campos: Partial<Record<ClaveCampo, string>>;
  /**
   * El botón que EMITE. Obligatorio aunque el ensayo no lo apriete: el ensayo
   * existe para probar el camino de emitir menos el clic, y un ensayo que pasa
   * con un botón que ya no existe da confianza falsa sobre lo único que no se
   * puede deshacer.
   */
  botonEmitir: string;
  /** Dónde queda el UUID del CFDI una vez emitido, si el portal lo muestra. */
  uuid?: string;
  /** Dónde escribe el portal su propio mensaje de rechazo, si lo tiene. */
  error?: string;
}

export interface OpcionesAdaptador {
  /** Cómo se consigue una página. En pruebas, un doble; en producción, Playwright. */
  abrirPagina: FabricaDePagina;
  /**
   * Cuántas veces se puede repetir un intento FALLIDO en modo `ensayo`, donde
   * repetir no cuesta nada porque nunca se aprieta el botón. En `emitir` este
   * número se ignora: ahí siempre es un intento y nada más.
   */
  reintentosEnEnsayo?: number;
  /** TOPE de espera al UUID tras apretar emitir. Ver `ESPERA_UUID_MS`. */
  esperaUuidMs?: number;
  /** Cada cuánto se vuelve a mirar mientras se espera. */
  intervaloMs?: number;
  /** Reloj inyectable: la prueba no espera de verdad. */
  dormir?: (ms: number) => Promise<void>;
  /**
   * Reloj inyectable para el tope POR TIEMPO del UUID.
   *
   * Hace falta además de `dormir` porque en producción el que gasta el
   * presupuesto no es la pausa: es cada `leerTexto`, que contra un selector
   * ausente tarda su propio tope (3 s por default en `pagina_playwright.ts`).
   * Contando solo vueltas, el sondeo duraría vueltas × 3 s.
   */
  ahora?: () => number;
}

/** Fallo con mensaje ya escrito para una persona. Se distingue del inesperado. */
class FalloDePortal extends Error {}

const texto = (e: unknown) => (e instanceof Error ? e.message : String(e));

export abstract class AdaptadorPlaywrightBase implements AdaptadorPortal {
  /** Clave del comercio en el registro (`comercios.ts`). */
  abstract readonly comercio: string;
  /** URL contra la que corre. */
  abstract readonly portal: string;
  /** Qué selector corresponde a cada campo de ESTE portal. */
  abstract mapeoDeCampos(): MapeoPortal;

  protected readonly abrirPagina: FabricaDePagina;
  private readonly reintentosEnEnsayo: number;
  /** Protegidos: el adaptador que sobrescribe `facturar` los necesita igual. */
  protected readonly esperaUuidMs: number;
  protected readonly intervaloMs: number;
  protected readonly dormir: (ms: number) => Promise<void>;
  protected readonly ahora: () => number;

  constructor(op: OpcionesAdaptador) {
    this.abrirPagina = op.abrirPagina;
    this.reintentosEnEnsayo = Math.max(0, Math.trunc(op.reintentosEnEnsayo ?? 0));
    this.esperaUuidMs = Math.max(1, op.esperaUuidMs ?? ESPERA_UUID_MS);
    this.intervaloMs = Math.max(1, op.intervaloMs ?? INTERVALO_UUID_MS);
    this.dormir = op.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.ahora = op.ahora ?? (() => Date.now());
  }

  /**
   * `modo` va opcional a propósito. La interfaz lo declara obligatorio y TS lo
   * exige en compilación, pero esto también se llama desde una ruta de API con
   * un cuerpo JSON: ahí el tipo no protege nada y lo que llega puede ser
   * `undefined`. Cualquier cosa que no sea exactamente `'emitir'` es ensayo.
   */
  async facturar(campos: CampoListo[], modo?: ModoAgente): Promise<ResultadoAgente> {
    const m: ModoAgente = modo === 'emitir' ? 'emitir' : 'ensayo';

    // ── Todo lo que se puede rechazar SIN abrir el navegador, se rechaza aquí.
    // Abrir un navegador para llenar un formulario con huecos cuesta segundos y
    // termina en el mismo error, pero con un portal a medio llenar de por medio.
    const vacios = campos.filter((c) => c.requerido && !c.valor);
    if (vacios.length > 0) {
      return this.fallo(m, `Faltan datos que ${this.comercio} exige: ${vacios.map((c) => c.etiqueta).join(', ')}. No se abrió el portal.`);
    }

    const mapeo = this.mapeoDeCampos();
    if (!mapeo.botonEmitir) {
      return this.fallo(m, `El adaptador de "${this.comercio}" no declara el botón de emitir. Sin él ni el ensayo prueba nada.`);
    }

    const sinSelector = campos.filter((c) => c.requerido && !mapeo.campos[c.clave]);
    if (sinSelector.length > 0) {
      return this.fallo(m, `El adaptador de "${this.comercio}" no sabe dónde van estos campos que el portal exige: ${sinSelector.map((c) => `${c.etiqueta} (${c.clave})`).join(', ')}. Falta agregarlos al mapeo.`);
    }

    // En `emitir` es UNO. Siempre. Ver el encabezado del archivo.
    const intentos = m === 'emitir' ? 1 : 1 + this.reintentosEnEnsayo;
    let ultimo: ResultadoAgente = this.fallo(m, 'No se intentó nada.');
    for (let i = 0; i < intentos; i++) {
      ultimo = await this.unIntento(campos, mapeo, m);
      if (ultimo.ok) return ultimo;
    }
    return ultimo;
  }

  private fallo(modo: ModoAgente, error: string, extra: Partial<ResultadoAgente> = {}): ResultadoAgente {
    return { modo, ok: false, capturado: {}, ...extra, error };
  }

  private async unIntento(campos: CampoListo[], mapeo: MapeoPortal, modo: ModoAgente): Promise<ResultadoAgente> {
    // Se devuelve lo escrito HASTA DONDE SE LLEGÓ aunque el intento falle: dice
    // en qué campo se rompió, que es la mitad del diagnóstico.
    const capturado: Record<string, string> = {};
    let pagina: PaginaPortal | undefined;
    let captura: string | undefined;
    // Cuando esto es `true` el CFDI PUEDE existir ya, y eso cambia por completo
    // qué se le puede decir al operador.
    let seApreto = false;

    try {
      pagina = await this.abrirPagina();
      await pagina.abrir(this.portal);

      await this.verificarSelectores(pagina, campos, mapeo);

      for (const c of campos) {
        const sel = mapeo.campos[c.clave];
        // Sin valor no se escribe nada: los requeridos ya se filtraron arriba, y
        // rellenar un opcional vacío sería inventar un dato en un documento
        // fiscal. Sin selector y opcional se omite —el portal no lo pide— pero
        // se deja dicho en el log para que se note que el mapeo está corto.
        if (!c.valor) continue;
        if (!sel) {
          logger.warn('agente.portal.campo_sin_selector', { comercio: this.comercio, clave: c.clave });
          continue;
        }
        try {
          await pagina.escribir(sel, c.valor);
        } catch (e) {
          throw new FalloDePortal(`No se pudo llenar "${c.etiqueta}" en ${this.portal}: el selector \`${sel}\` ya no está en la página (${texto(e)}). Hay que actualizar el mapeo de "${this.comercio}".`);
        }
        // La llave es la CLAVE, no la etiqueta: dos campos pueden llamarse igual
        // en pantalla y uno pisaría al otro sin que nadie lo viera.
        capturado[c.clave] = c.valor;
      }

      // La captura se toma ANTES de mirar si el portal se quejó, para que el
      // rechazo venga con la pantalla que lo produjo: sin ella el mensaje del
      // portal se lee sin saber qué había en los campos.
      captura = await this.capturaSegura(pagina);

      // Muchos portales validan al salir del campo. Si ya se quejaron, se para
      // aquí: en `emitir` esto es lo que separa un rechazo limpio de un CFDI mal
      // hecho.
      const rechazo = await this.leerRechazo(pagina, mapeo);
      if (rechazo) {
        throw new FalloDePortal(`${this.portal} rechazó lo capturado: "${rechazo}".`);
      }

      if (modo === 'ensayo') {
        // AQUÍ SE DETIENE. El formulario queda lleno, la captura tomada y el
        // botón sin tocar.
        return { modo, ok: true, capturado, captura };
      }

      // `seApreto` se marca ANTES del clic, no después: si `hacerClic` revienta
      // no se sabe si el formulario alcanzó a irse. Fallar cerrado aquí es
      // asumir que sí.
      seApreto = true;
      await pagina.hacerClic(mapeo.botonEmitir);

      captura = (await this.capturaSegura(pagina)) ?? captura;

      const rechazoPost = await this.leerRechazo(pagina, mapeo);
      const { uuid, aparecio } = mapeo.uuid
        ? await this.esperarUuid(pagina, mapeo.uuid)
        : { uuid: null, aparecio: false };

      if (!uuid) {
        // NO se vuelve a intentar y se dice por qué. El CFDI puede existir: lo
        // barato es que una persona lo mire en el portal; lo caro es un segundo
        // CFDI que después hay que cancelar.
        //
        // Se separa "no apareció" de "apareció vacío": el primero manda a mirar
        // el mapeo, el segundo a mirar el portal. Con un solo texto, la mitad de
        // las veces se busca en el sitio equivocado.
        const porQue = !mapeo.uuid
          ? 'el adaptador no declara dónde vive el UUID en este portal'
          : aparecio
            ? `el contenedor del UUID (\`${mapeo.uuid}\`) apareció y siguió VACÍO tras ~${this.esperaUuidMs} ms`
            : `el contenedor del UUID (\`${mapeo.uuid}\`) no apareció en ~${this.esperaUuidMs} ms`;
        return this.fallo(modo, `Se apretó emitir en ${this.portal} y no se pudo confirmar el UUID — ${porQue}${rechazoPost ? ` (el portal dice: "${rechazoPost}")` : ''}. PUEDE QUE EL CFDI YA EXISTA: revisar el portal antes de volver a intentar — un segundo intento lo duplicaría.`, { capturado, captura });
      }

      return { modo, ok: true, capturado, captura, cfdiUuid: uuid };
    } catch (e) {
      const detalle = e instanceof FalloDePortal ? e.message : `Falló ${this.portal}: ${texto(e)}`;
      const error = seApreto
        ? `SE APRETÓ EMITIR y después falló. ${detalle} PUEDE QUE EL CFDI YA EXISTA: revisar el portal antes de volver a intentar.`
        : detalle;
      logger.error('agente.portal.fallo', { comercio: this.comercio, modo, seApreto });
      return this.fallo(modo, error, { capturado, captura });
    } finally {
      if (pagina?.cerrar) {
        try {
          await pagina.cerrar();
        } catch (e) {
          // Cerrar el navegador no puede cambiar el resultado: para cuando esto
          // corre, el CFDI ya se emitió o ya no.
          logger.warn('agente.portal.cerrar_fallo', { comercio: this.comercio, error: texto(e) });
        }
      }
    }
  }

  /**
   * Pre-vuelo: los selectores que se van a usar, verificados de golpe.
   *
   * Incluye el botón de emitir A PROPÓSITO aunque el ensayo no lo apriete —es
   * el único selector cuyo fallo no se puede probar de otra forma sin emitir— y
   * deja fuera el del UUID y el del cuadro de error, que legítimamente no
   * existen todavía cuando el formulario está en blanco.
   */
  private async verificarSelectores(pagina: PaginaPortal, campos: CampoListo[], mapeo: MapeoPortal): Promise<void> {
    const existe = pagina.existe;
    // Sin pre-vuelo no se falla: se descubre al escribir, con el mismo mensaje.
    if (!existe) return;

    const revisar: Array<{ que: string; sel: string }> = [];
    for (const c of campos) {
      const sel = mapeo.campos[c.clave];
      if (sel && c.valor) revisar.push({ que: `el campo "${c.etiqueta}"`, sel });
    }
    revisar.push({ que: 'el botón de emitir', sel: mapeo.botonEmitir });

    const faltan: string[] = [];
    for (const r of revisar) {
      if (!(await existe.call(pagina, r.sel))) faltan.push(`${r.que} → \`${r.sel}\``);
    }
    if (faltan.length > 0) {
      throw new FalloDePortal(`${this.portal} ya no tiene estos selectores: ${faltan.join('; ')}. Hay que actualizar el mapeo de "${this.comercio}".`);
    }
  }

  /**
   * EL UUID, SONDEADO. No una lectura y ya.
   *
   * Esto leía el selector UNA vez, justo después del clic, y ahí el folio no
   * está: el portal manda el comprobante a timbrar a un PAC y pinta el resultado
   * cuando vuelve. El modo de fallo peor no era esperar poco, era el portal que
   * PRE-PINTA el contenedor vacío —cualquier plantilla que declare
   * `<span class="uuid"></span>` lo hace—: `leerTexto` devuelve `''`, `''` es
   * falsy, y una emisión EXITOSA se reportaba como "PUEDE QUE EL CFDI YA
   * EXISTA". Eso manda a revisar a mano algo que salió bien e invita a
   * reintentar una emisión que ya ocurrió.
   *
   * DOS TOPES: por vueltas (para la prueba, donde `dormir` no duerme) y por
   * tiempo (para producción, donde lo caro es cada `leerTexto` contra un
   * selector ausente). Devuelve además si el contenedor llegó a existir.
   */
  protected async esperarUuid(pagina: PaginaPortal, selector: string): Promise<{ uuid: string | null; aparecio: boolean }> {
    const limite = this.ahora() + this.esperaUuidMs;
    const vueltas = Math.max(1, Math.ceil(this.esperaUuidMs / this.intervaloMs));
    let aparecio = false;

    for (let i = 0; i < vueltas; i++) {
      // `leerTexto` distingue `null` (el selector no resuelve) de `''` (existe y
      // está vacío) — y esa diferencia es justo la que aquí no se puede aplanar.
      const bruto = await pagina.leerTexto(selector);
      if (bruto !== null) {
        aparecio = true;
        const v = bruto.trim();
        if (v) return { uuid: v, aparecio: true };
      }
      if (i === vueltas - 1 || this.ahora() >= limite) break;
      await this.dormir(this.intervaloMs);
    }

    logger.warn('agente.portal.uuid_sin_confirmar', { comercio: this.comercio, aparecio, esperaMs: this.esperaUuidMs });
    return { uuid: null, aparecio };
  }

  /** Lo que el portal dice de lo capturado. Vacío o ausente = no dijo nada. */
  private async leerRechazo(pagina: PaginaPortal, mapeo: MapeoPortal): Promise<string | null> {
    if (!mapeo.error) return null;
    try {
      const t = await pagina.leerTexto(mapeo.error);
      return t && t.trim() ? t.trim() : null;
    } catch {
      // Que no se pueda leer el cuadro de error NO es un rechazo. Tratarlo como
      // tal convertiría cada portal sin cuadro de error en un fallo permanente.
      return null;
    }
  }

  /** Una captura que falla no puede tumbar un intento: es evidencia, no paso. */
  private async capturaSegura(pagina: PaginaPortal): Promise<string | undefined> {
    try {
      return await pagina.captura();
    } catch (e) {
      logger.warn('agente.portal.captura_fallo', { comercio: this.comercio, error: texto(e) });
      return undefined;
    }
  }
}
