// ═══════════════════════════════════════════════════════════════════════════
// MEDIR EL OCR CONTRA LA VERDAD-DE-TERRENO — funciones PURAS.
//
// Aquí no se llama a nadie: no hay red, ni base, ni reloj. Entra lo que la
// persona etiquetó (`VerdadTerreno`, qa-tipos.ts) y lo que el OCR real leyó, y
// sale un veredicto por campo. Es puro a propósito, porque es la pieza cuya
// respuesta se convierte en un porcentaje que alguien va a citar: si midiera
// dentro de la ruta, no habría forma de probarla sin gastar dinero de modelo.
//
// LAS TRES DECISIONES QUE HACEN QUE EL NÚMERO SIGNIFIQUE ALGO
//
//  1. `no_medido` NO ES `mal`, y tampoco es `ok`. Un campo que el humano marcó
//     ilegible no tiene contra qué medirse. Contarlo como acierto premiaría al
//     OCR por adivinar; contarlo como error lo castigaría por una foto quemada.
//     Sale del denominador, y el panel dice cuántos salieron.
//
//  2. UN CAMPO QUE EL PAPEL NO IMPRIME Y EL OCR "LEE" ES UNA ALUCINACIÓN, y
//     cuenta como error. Es el fallo más caro de todos —un RFC inventado manda
//     a la oficina a facturar contra un contribuyente que no existe— y el que
//     una medición ingenua no ve, porque no hay valor esperado con el que
//     chocar. Por eso `noAplica` se mide, no se salta.
//
//  3. `null` ESPERADO JAMÁS SE VUELVE 0 NI "". La comparación se hace sobre
//     `null` como valor propio; convertirlo haría que un OCR que devuelve 0
//     "acierte" contra un ticket cuyo monto no se lee.
// ═══════════════════════════════════════════════════════════════════════════

import { CLAVES_VERDAD, type ClaseComprobante, type ClaveVerdad, type VerdadTerreno } from './qa-tipos';

export type VeredictoCampo = 'ok' | 'mal' | 'no_medido';

/** Lo que el OCR real leyó, aplanado a las mismas 7 claves que la etiqueta.
 *  Es un tipo aparte de `Gasto` a propósito: `Gasto` trae 40 campos y la mitad
 *  no se etiquetan a mano. Quien traduce `Gasto` → esto es la ruta
 *  (`fotos/ocr/route.ts`), y así esta capa no depende del intake. */
export interface OcrLeido {
  emisor: string | null;
  rfcEmisor: string | null;
  folio: string | null;
  monto: number | null;
  fecha: string | null;
  sucursal: string | null;
  dominioFacturacion: string | null;
}

export interface MedicionCampo {
  clave: ClaveVerdad;
  /** Tal cual lo etiquetó la persona — sin normalizar, para que la pantalla
   *  enseñe lo que está impreso y no lo que el comparador vio. */
  esperado: string | number | null;
  leido: string | number | null;
  veredicto: VeredictoCampo;
  /** Por qué salió así. Siempre puesto cuando NO es `ok`: un `mal` sin motivo
   *  obliga a abrir la foto para entender qué pasó. */
  motivo: string | null;
}

export interface Medicion {
  campos: MedicionCampo[];
  camposOk: number;
  camposMal: number;
  camposNoMedidos: number;
}

const VACIO: OcrLeido = {
  emisor: null, rfcEmisor: null, folio: null, monto: null,
  fecha: null, sucursal: null, dominioFacturacion: null,
};

/**
 * Texto comparable: solo letras y dígitos, sin acentos y en mayúsculas.
 *
 * Los tres casos reales que obligan a cada paso, medidos sobre los tickets de
 * campo: "S.A. DE C.V." vs "SA DE CV" (puntuación), "ESTACIÓN" vs "ESTACION"
 * (el OCR pierde el acento en térmico moteado) y "OXXO  GAS" con el doble
 * espacio del renglón centrado. Ninguno de los tres es un error de lectura, y
 * sin normalizar los tres contaban como fallo e inflaban el error del modelo.
 *
 * LOS SEPARADORES SE QUITAN, NO SE COLAPSAN, y ese detalle es el que hace pasar
 * el primer caso: colapsando, "S.A. DE C.V." queda "S A DE C V" y "SA DE CV"
 * queda "SA DE CV" — dos cadenas distintas por culpa del punto, que es
 * exactamente lo que se venía a arreglar. Quitándolos, las dos son "SADECV".
 *
 * Lo que NO se hace: quitar PALABRAS ("S.A.", "SUC."). Eso ya sería interpretar,
 * y una normalización que interpreta puede hacer coincidir dos emisores
 * distintos. Quitar separadores no junta nada que no estuviera junto: "OXXO
 * GAS" sigue siendo distinto de "OXXO".
 */
export function normalizarTextoVerdad(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // los diacríticos, ya separados por NFD
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
  return t === '' ? null : t;
}

/**
 * RFC comparable. Se trata APARTE del texto genérico porque la normalización
 * genérica DESTRUYE dos caracteres que en un RFC del SAT son válidos y
 * significativos (auditoría adversarial tandas 21-24, hallazgo 2):
 *
 *   · la `Ñ` — NFD la descompone en N + tilde y el filtro tira la tilde:
 *     "AÑB123456XY0" y "ANB123456XY0" quedaban iguales y son DOS
 *     contribuyentes distintos.
 *   · el `&` — `[^A-Z0-9]` lo elimina: "J&B840101XX1" y "JB840101XX1"
 *     quedaban iguales. El SAT usa `&` en razones sociales reales.
 *
 * El propio archivo llama a esto el fallo más caro (decisión 2 de la
 * cabecera): un RFC mal dado por bueno manda a facturar contra un
 * contribuyente que no existe — y el porcentaje del campo salía inflado
 * JUSTO en los casos difíciles.
 *
 * Lo que se quita es LA DECORACIÓN IMPRESA, con el charset del propio RFC:
 * espacios, guiones, puntos y paréntesis — el prompt del extractor cita
 * literal el caso "(AAA-860523-1N4)" pegado a la razón social, y el saneador
 * del intake canonicaliza con el MISMO `[^A-ZÑ&0-9]` (ocr.ts), así que las
 * dos puntas comparan la misma forma. `NFC` primero recompone la Ñ que
 * llegue descompuesta (NFD): la MISMA letra en dos codificaciones no puede
 * contar como error. `Ñ` y `&` se QUEDAN — un carácter distinto es la llave
 * fiscal de un tercero.
 *
 * (Esta versión FUNDE las dos que el merge del 28-ago dejó enfrente: la de
 * master traía el NFC y ésta el charset completo de decoración; quedó UNA,
 * con las dos correcciones y las dos tandas de pruebas en verde.)
 */
export function normalizarRfcVerdad(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.normalize('NFC').toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
  return t === '' ? null : t;
}

/**
 * Dominio comparable. Se trata aparte del texto porque un dominio tiene partes
 * que NO son contenido: el esquema y el `www.` son decoración, y el camino
 * (`/facturacion`) cambia de un ticket a otro del mismo comercio.
 *
 * El ticket imprime `www.factura.oxxo.com/`, el QR entrega
 * `https://factura.oxxo.com/portal` y la persona etiqueta `factura.oxxo.com`.
 * Los tres son EL MISMO dominio, y compararlos como texto crudo daría dos
 * fallos de tres sin que el OCR se haya equivocado en nada.
 */
export function normalizarDominio(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  let t = v.trim().toLowerCase();
  if (t === '') return null;
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');  // esquema
  t = t.split(/[/?#]/)[0];                        // camino, query, fragmento
  t = t.replace(/^www\./, '');
  t = t.replace(/\.+$/, '');                      // el punto final del renglón
  return t === '' ? null : t;
}

/**
 * Variantes comparables del EMISOR esperado.
 *
 * El caso MEDIDO que la obliga (primera medición real, corrida 46ad99ca,
 * 28-ago-2026): la etiqueta del banco anota el nombre comercial entre
 * paréntesis — "NUEVA WAL MART DE MEXICO S DE RL DE CV (WALMART)" — y el OCR
 * leyó la razón social EXACTA. Comparar contra la etiqueta completa contaba
 * como error ~20 lecturas perfectas de 42 "fallos" de emisor: una medición
 * falseada en la otra dirección, igual de inservible que una inflada.
 *
 * Se acepta la etiqueta completa o la etiqueta SIN sus paréntesis. Lo que NO
 * se acepta es el alias solo: un OCR que devuelve "WALMART" a secas no
 * demostró haber leído la razón social, y la razón social es lo que casa con
 * el RFC y con el portal de facturación.
 */
export function variantesEmisorEsperado(esperado: string): string[] {
  const completa = normalizarTextoVerdad(esperado);
  const sinParentesis = normalizarTextoVerdad(esperado.replace(/\([^)]*\)/g, ' '));
  const variantes = [completa, sinParentesis].filter((v): v is string => v !== null);
  return [...new Set(variantes)];
}

/** Fecha comparable en `yyyy-mm-dd`. NO adivina formatos raros: la
 *  verdad-de-terreno ya viene validada en ISO, y del lado del OCR es
 *  `normalizarFecha` (intake/fecha.ts) quien ya normalizó. Aquí solo se recorta
 *  a los 10 primeros caracteres de un ISO con hora. */
export function normalizarFechaVerdad(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Igualdad de dinero: exacta a dos decimales, tolerancia CERO. No es un
 *  cuadre —donde medio centavo se perdona—: es una medición de si el modelo
 *  leyó bien un número impreso, y ahí $1,234.50 vs $1,234.05 es un error. */
export function montosIguales(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}

function leidoDe(clave: ClaveVerdad, leido: OcrLeido): string | number | null {
  return leido[clave];
}

/** Compara UN campo. Exportada porque cada rama es un caso que se prueba solo. */
export function compararCampo(clave: ClaveVerdad, verdad: VerdadTerreno, leido: OcrLeido): MedicionCampo {
  const esperado = verdad[clave];
  const crudoLeido = leidoDe(clave, leido);

  // 1) Ilegible: no hay contra qué medir. Ni acierto ni error — y se dice.
  if (verdad.ilegibles.includes(clave)) {
    return {
      clave, esperado: null, leido: crudoLeido, veredicto: 'no_medido',
      motivo: 'la persona no pudo leerlo en la foto: no hay valor esperado contra el que medir',
    };
  }

  // 2) El papel no lo imprime. Que el OCR lea algo aquí es una alucinación.
  if (verdad.noAplica.includes(clave)) {
    if (crudoLeido === null || crudoLeido === undefined || crudoLeido === '') {
      return { clave, esperado: null, leido: null, veredicto: 'ok', motivo: null };
    }
    return {
      clave, esperado: null, leido: crudoLeido, veredicto: 'mal',
      motivo: 'el comprobante NO imprime este campo y el OCR devolvió un valor — alucinación',
    };
  }

  // 3) Hay valor esperado. Un `null` leído es un fallo de lectura, no un empate.
  if (crudoLeido === null || crudoLeido === undefined || crudoLeido === '') {
    return {
      clave, esperado, leido: null, veredicto: 'mal',
      motivo: 'el comprobante SÍ lo imprime y el OCR no leyó nada',
    };
  }

  if (clave === 'monto') {
    const iguales = montosIguales(esperado as number | null, typeof crudoLeido === 'number' ? crudoLeido : Number(crudoLeido));
    return {
      clave, esperado, leido: crudoLeido,
      veredicto: iguales ? 'ok' : 'mal',
      motivo: iguales ? null : 'el monto leído no coincide a dos decimales (tolerancia cero)',
    };
  }

  if (clave === 'fecha') {
    const a = normalizarFechaVerdad(esperado as string | null);
    const b = normalizarFechaVerdad(String(crudoLeido));
    const iguales = a !== null && a === b;
    return {
      clave, esperado, leido: crudoLeido,
      veredicto: iguales ? 'ok' : 'mal',
      motivo: iguales ? null : b === null ? 'lo leído no es una fecha yyyy-mm-dd' : 'la fecha leída no coincide',
    };
  }

  if (clave === 'rfcEmisor') {
    // Comparador DEDICADO: `Ñ` y `&` son parte del RFC y distinguen
    // contribuyentes — la rama genérica los borraba y daba `ok` a llaves
    // fiscales de terceros (ver `normalizarRfcVerdad`).
    const a = normalizarRfcVerdad(esperado as string | null);
    const b = normalizarRfcVerdad(String(crudoLeido));
    const iguales = a !== null && a === b;
    return {
      clave, esperado, leido: crudoLeido,
      veredicto: iguales ? 'ok' : 'mal',
      motivo: iguales ? null : 'el RFC no coincide carácter por carácter (Ñ y & cuentan: un carácter distinto es la llave fiscal de un tercero)',
    };
  }

  if (clave === 'emisor' || clave === 'sucursal') {
    // Emisor Y sucursal aceptan la etiqueta con o sin su anotación entre
    // paréntesis — ver `variantesEmisorEsperado` para el caso medido del
    // emisor. La sucursal entró con la MISMA evidencia, en la primera pasada
    // en que el extractor la pidió (28-ago-2026): la etiqueta anota contexto
    // entre paréntesis — «LAGAS NOVIA DEL MAR (CAMPECHE)», «SODZIL (No. E.S.
    // 4147, SIIC 0000116652)», «CHUBURNA (CALLE 20 POR 25 …)» — y el modelo
    // leyó EXACTO el nombre impreso; contarlo error castiga la anotación del
    // auditor, no la lectura. El leído NO recibe el mismo trato: la anotación
    // sola no demuestra el nombre.
    const variantes = variantesEmisorEsperado(String(esperado ?? ''));
    const b = normalizarTextoVerdad(String(crudoLeido));
    const iguales = b !== null && variantes.includes(b);
    return {
      clave, esperado, leido: crudoLeido,
      veredicto: iguales ? 'ok' : 'mal',
      motivo: iguales ? null : 'no coincide con lo etiquetado (comparado sin acentos, mayúsculas ni puntuación, con o sin la anotación entre paréntesis)',
    };
  }

  const normalizar = clave === 'dominioFacturacion' ? normalizarDominio : normalizarTextoVerdad;
  const a = normalizar(esperado as string | null);
  const b = normalizar(String(crudoLeido));
  const iguales = a !== null && a === b;
  return {
    clave, esperado, leido: crudoLeido,
    veredicto: iguales ? 'ok' : 'mal',
    motivo: iguales ? null : 'no coincide con lo etiquetado (comparado sin acentos, mayúsculas y sin puntuación)',
  };
}

/** La medición completa de una foto: las 7 claves, en el orden de la pantalla. */
export function medir(verdad: VerdadTerreno, leido: OcrLeido): Medicion {
  const campos = CLAVES_VERDAD.map((c) => compararCampo(c, verdad, leido));
  return {
    campos,
    camposOk: campos.filter((c) => c.veredicto === 'ok').length,
    camposMal: campos.filter((c) => c.veredicto === 'mal').length,
    camposNoMedidos: campos.filter((c) => c.veredicto === 'no_medido').length,
  };
}

/**
 * La medición de una corrida que NO llegó a leer nada — el proveedor devolvió
 * 5xx, la llamada se abortó por presupuesto, la imagen no se pudo bajar.
 *
 * Existe para que ese caso quede ESCRITO como lo que es (siete campos sin
 * medir, con el motivo técnico) en vez de como siete errores. Un fallo de
 * infraestructura contado como fallo de lectura hundiría la exactitud del
 * modelo sin que el modelo haya visto la foto — es exactamente la clase de
 * cifra inventada que la casa no admite.
 */
export function medicionSinLeer(motivo: string): Medicion {
  const campos: MedicionCampo[] = CLAVES_VERDAD.map((clave) => ({
    clave, esperado: null, leido: null, veredicto: 'no_medido' as const, motivo,
  }));
  return { campos, camposOk: 0, camposMal: 0, camposNoMedidos: campos.length };
}

/**
 * La medición de una foto que la corrida procesó y el pipeline NO persistió
 * como gasto (ni como huérfano) — la "lectura de punta a punta" de esa foto
 * fue: nada entró al sistema.
 *
 * Aquí el denominador se decide por la CLASE del papel, porque "no persistió"
 * significa cosas opuestas según qué papel era:
 *
 *  · `no_comprobante` — RECHAZAR era el veredicto correcto. Nada entró, nada
 *    se inventó: cada campo en `noAplica` cuenta `ok`. Este es el caso que
 *    más vale del banco: un OCR que ve una credencial de elector y NO fabrica
 *    un gasto es exactamente lo que se quiere medir.
 *
 *  · `voucher_bancario` — producción lo reconoce y lo rechaza POR DISEÑO
 *    (`solo_pago`, intake/ocr.ts): su ticket fiscal ya representa el mismo
 *    gasto. Los valores que el modelo haya leído no se persisten, así que los
 *    campos CON valor esperado no tienen contra qué medirse → `no_medido`,
 *    dicho. Contarlos `mal` castigaría el comportamiento diseñado; contarlos
 *    `ok` premiaría una lectura que nadie verificó. Los `noAplica` sí cuentan
 *    `ok`: nada inventado entró al sistema.
 *
 *  · `ticket` / `cfdi_impreso` — el papel es un comprobante de verdad y de
 *    punta a punta no quedó NADA leído: cada campo con valor esperado es
 *    `mal`. Es la opción estricta a propósito (regla de la casa: en la duda,
 *    estricto y dicho): quizá el modelo leyó bien y el pipeline lo tiró por
 *    `ilegible`, pero el resultado medible es que el gasto no existe — y eso
 *    es un fallo del carril completo de lectura, que es lo que se mide.
 *
 * Los `ilegibles` salen del denominador siempre, como en `medir`.
 */
export function medirSinGasto(verdad: VerdadTerreno): Medicion {
  const rechazoPorDiseno = verdad.clase === 'voucher_bancario';
  const campos: MedicionCampo[] = CLAVES_VERDAD.map((clave) => {
    if (verdad.ilegibles.includes(clave)) {
      return {
        clave, esperado: null, leido: null, veredicto: 'no_medido' as const,
        motivo: 'la persona no pudo leerlo en la foto: no hay valor esperado contra el que medir',
      };
    }
    if (verdad.noAplica.includes(clave)) {
      // Nada persistido = nada inventado. Para el papel que no imprime el
      // campo, el silencio del pipeline es el acierto.
      return { clave, esperado: null, leido: null, veredicto: 'ok' as const, motivo: null };
    }
    if (rechazoPorDiseno) {
      return {
        clave, esperado: verdad[clave], leido: null, veredicto: 'no_medido' as const,
        motivo: 'el pipeline reconoce el voucher y lo rechaza por diseño (solo_pago): lo que el modelo leyó no se persiste y no hay contra qué medirlo',
      };
    }
    return {
      clave, esperado: verdad[clave], leido: null, veredicto: 'mal' as const,
      motivo: 'el comprobante SÍ imprime este campo y de punta a punta no quedó ningún gasto: la foto se rechazó o la lectura se perdió',
    };
  });
  return {
    campos,
    camposOk: campos.filter((c) => c.veredicto === 'ok').length,
    camposMal: campos.filter((c) => c.veredicto === 'mal').length,
    camposNoMedidos: campos.filter((c) => c.veredicto === 'no_medido').length,
  };
}

/** ¿Este campo es una ALUCINACIÓN? — el papel no lo imprime (`esperado` null
 *  con veredicto, o sea estaba en `noAplica`) y aun así salió `mal`: el OCR
 *  devolvió un valor donde no había nada que leer. Se identifica desde la
 *  medición GUARDADA (sin necesitar la etiqueta), porque los `ilegibles`
 *  jamás salen `mal` — salen `no_medido`. */
export function esAlucinacion(c: MedicionCampo): boolean {
  return c.esperado === null && c.veredicto === 'mal';
}

/** Cuántos campos alucinados hay en un conjunto de mediciones. */
export function contarAlucinaciones(mediciones: Array<Pick<Medicion, 'campos'>>): number {
  return mediciones.reduce((s, m) => s + m.campos.filter(esAlucinacion).length, 0);
}

export interface AgregadoPorCampo extends Agregado {
  clave: ClaveVerdad;
}

/**
 * El desglose POR CAMPO: cuál se lee peor. Este número vale más que el
 * global — "94% global" esconde un folio que falla una de cada tres veces, y
 * el folio es lo que el portal de facturación exige. Mismo contrato que
 * `agregar`: `exactitud` null cuando ese campo no tiene ni una medición, que
 * la pantalla dice "sin medir" y JAMÁS pinta como 0%.
 */
export function agregarPorCampo(mediciones: Array<Pick<Medicion, 'campos'>>): AgregadoPorCampo[] {
  return CLAVES_VERDAD.map((clave) => {
    let ok = 0, mal = 0, noMedidos = 0;
    for (const m of mediciones) {
      for (const c of m.campos) {
        if (c.clave !== clave) continue;
        if (c.veredicto === 'ok') ok += 1;
        else if (c.veredicto === 'mal') mal += 1;
        else noMedidos += 1;
      }
    }
    const medidos = ok + mal;
    return { clave, ok, mal, noMedidos, medidos, exactitud: medidos === 0 ? null : ok / medidos };
  });
}

export interface Agregado {
  ok: number;
  mal: number;
  noMedidos: number;
  /** El DENOMINADOR de verdad: ok + mal. Los no medidos no están aquí. */
  medidos: number;
  /** `null` cuando `medidos === 0`. Jamás 0% ni 100% sobre una medición que no
   *  existe: sin campos medidos no hay exactitud que reportar, y la pantalla
   *  dice "sin medir". */
  exactitud: number | null;
}

/** Suma varias mediciones para el número de arriba del panel. */
export function agregar(mediciones: Array<Pick<Medicion, 'camposOk' | 'camposMal' | 'camposNoMedidos'>>): Agregado {
  let ok = 0, mal = 0, noMedidos = 0;
  for (const m of mediciones) {
    ok += m.camposOk;
    mal += m.camposMal;
    noMedidos += m.camposNoMedidos;
  }
  const medidos = ok + mal;
  return { ok, mal, noMedidos, medidos, exactitud: medidos === 0 ? null : ok / medidos };
}

/** El `OcrLeido` de una lectura que no leyó nada. Útil para la fila que sí se
 *  escribe cuando el OCR falló técnicamente. */
export function ocrVacio(): OcrLeido {
  return { ...VACIO };
}

// ── El resumen de precisión de UNA corrida (lo que la pantalla pinta) ───────

/** La medición de una foto de la corrida, con lo que la pantalla necesita
 *  para llegar del número a la foto concreta que lo bajó. */
export interface MedicionFotoResumen {
  fotoId: string;
  etiqueta: string;
  /** null = la foto no tiene verdad-de-terreno (o salió del banco). */
  clase: ClaseComprobante | null;
  medicion: Medicion;
  modelo: string;
  motivo: string | null;
  costoUsd: number;
}

/**
 * LA PONDERACIÓN DECLARADA: fiscales vs descriptivos. No es cosmética y no
 * cambia la vara — cada campo se sigue midiendo igual de estricto y el global
 * sigue contando los 7. Lo que cambia es que la pantalla enseña LOS DOS
 * números por separado, porque no fallan igual de caro:
 *
 *  · FISCALES — rfcEmisor, folio, monto, fecha: entran a la liquidación, a la
 *    deducción y al timbrado en el portal. Un fallo aquí es un intento de
 *    factura fallido o una cifra fiscal equivocada.
 *  · DESCRIPTIVOS — emisor, sucursal, dominioFacturacion: ubican y enrutan el
 *    gasto. La sucursal esperada, en particular, mezcla nombre+número+ciudad
 *    («ARCO 8039, CIUDAD JUAREZ, CHIHUAHUA») y aun leyéndose bien rara vez
 *    casa exacta — su techo de coincidencia textual es estructuralmente más
 *    bajo, y promediarla con el monto escondería a los dos.
 *
 * Esconder un campo del denominador en silencio sería maquillar; partir el
 * número EN LA PANTALLA, con las dos cifras a la vista, es decir la verdad
 * con más resolución.
 */
export const CAMPOS_FISCALES: readonly ClaveVerdad[] = ['rfcEmisor', 'folio', 'monto', 'fecha'];
export const CAMPOS_DESCRIPTIVOS: readonly ClaveVerdad[] = ['emisor', 'sucursal', 'dominioFacturacion'];

/** Agrega solo los campos de `claves` — para el par fiscales/descriptivos. */
export function agregarClaves(mediciones: Array<Pick<Medicion, 'campos'>>, claves: readonly ClaveVerdad[]): Agregado {
  let ok = 0, mal = 0, noMedidos = 0;
  for (const m of mediciones) {
    for (const c of m.campos) {
      if (!claves.includes(c.clave)) continue;
      if (c.veredicto === 'ok') ok += 1;
      else if (c.veredicto === 'mal') mal += 1;
      else noMedidos += 1;
    }
  }
  const medidos = ok + mal;
  return { ok, mal, noMedidos, medidos, exactitud: medidos === 0 ? null : ok / medidos };
}

export interface ResumenPrecisionCorrida {
  global: Agregado;
  /** Los campos que facturan (rfc, folio, monto, fecha) — el número que más
   *  cuesta cuando falla. Misma vara, más resolución. */
  fiscales: Agregado;
  /** Los campos que describen (emisor, sucursal, dominio). */
  descriptivos: Agregado;
  /** El desglose por campo — cuál se lee peor vale más que el global. */
  porCampo: AgregadoPorCampo[];
  /** Los CASOS NEGATIVOS del banco (clase `no_comprobante`), aparte y con
   *  nombre propio: lo único que pueden medir es si el OCR INVENTA un gasto
   *  donde no hay comprobante, y diluir eso entre 90 fotos lo esconde. */
  negativos: {
    fotos: number;
    /** Cuántos negativos dejaron al menos un campo alucinado. 0 = el
     *  pipeline los RECHAZÓ todos, que es el veredicto correcto. */
    conAlucinacion: number;
    camposAlucinados: number;
  };
  /** Alucinaciones en TODA la corrida (campo que el papel no imprime y el
   *  OCR "leyó" — `esperado` null con veredicto `mal`). */
  alucinaciones: number;
  /** Los campos que salieron del denominador, agrupados por su razón — un
   *  "no medido" sin razón es un número que no se puede defender. */
  noMedidosPorMotivo: Array<{ motivo: string; campos: number }>;
  fotos: MedicionFotoResumen[];
}

/** Arma el resumen entero a partir de las mediciones de la corrida. Pura —
 *  el servidor lo calcula, la pantalla solo lo pinta. */
export function resumenPrecision(fotos: MedicionFotoResumen[]): ResumenPrecisionCorrida {
  const mediciones = fotos.map((f) => f.medicion);
  const negativos = fotos.filter((f) => f.clase === 'no_comprobante');
  const porMotivo = new Map<string, number>();
  for (const m of mediciones) {
    for (const c of m.campos) {
      if (c.veredicto !== 'no_medido') continue;
      const motivo = c.motivo ?? 'sin motivo registrado';
      porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1);
    }
  }
  return {
    global: agregar(mediciones),
    fiscales: agregarClaves(mediciones, CAMPOS_FISCALES),
    descriptivos: agregarClaves(mediciones, CAMPOS_DESCRIPTIVOS),
    porCampo: agregarPorCampo(mediciones),
    negativos: {
      fotos: negativos.length,
      conAlucinacion: negativos.filter((f) => f.medicion.campos.some(esAlucinacion)).length,
      camposAlucinados: contarAlucinaciones(negativos.map((f) => f.medicion)),
    },
    alucinaciones: contarAlucinaciones(mediciones),
    noMedidosPorMotivo: [...porMotivo.entries()]
      .map(([motivo, campos]) => ({ motivo, campos }))
      .sort((a, b) => b.campos - a.campos),
    fotos,
  };
}

// ── El puente con el `Gasto` de producción ─────────────────────────────────

/**
 * Traduce el `Gasto` que devuelve `extraerComprobante` a las 7 claves medibles.
 *
 * Vive aquí y no en la ruta por dos motivos: es puro (se prueba sin gastar un
 * centavo de modelo) y porque Next 16 no admite exportar ayudantes desde un
 * `route.ts`. `Gasto` usa `undefined` para "no vino"; aquí se normaliza a
 * `null`, que es lo que usa la etiqueta. La conversión va SOLO en este sentido:
 * un `null` esperado jamás se vuelve 0 ni cadena vacía.
 */
export function ocrLeidoDeGasto(gasto: {
  monto?: number; fecha?: string; folio?: string; rfcEmisor?: string;
  ocrExtra?: Record<string, unknown>;
}): OcrLeido {
  const extra = gasto.ocrExtra ?? {};
  const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  return {
    // La razón social vive en `ocrExtra.emisor`: es la tercera señal con la que
    // `identificarComercio` reconoce el comercio, detrás del dominio y del RFC.
    emisor: texto(extra.emisor),
    rfcEmisor: texto(gasto.rfcEmisor),
    // El folio CRUDO, no `folioNorm`: la persona etiqueta lo que está impreso,
    // ceros a la izquierda incluidos, y el normalizado se los quita.
    folio: texto(gasto.folio),
    // Un `monto` de 0 es lo que el camino de `fallo_tecnico` deja puesto. Como
    // valor LEÍDO significa "no leyó nada", no "leyó cero pesos" — y un
    // comprobante de $0 no existe, así que la ambigüedad no cuesta nada.
    monto: typeof gasto.monto === 'number' && Number.isFinite(gasto.monto) && gasto.monto > 0 ? gasto.monto : null,
    fecha: texto(gasto.fecha),
    // La sucursal general primero (el extractor la pide para todo comercio
    // desde la subida de precisión); `estacion` queda de respaldo para
    // lecturas viejas y gasolineras que solo llenaron ese campo.
    sucursal: texto(extra.sucursal) ?? texto(extra.estacion),
    dominioFacturacion: texto(extra.urlFacturacion),
  };
}

// ── La forma de la respuesta de /api/admin/qa/fotos/ocr ────────────────────

/** `no_medida` NUNCA cuenta como acierto: es una foto sin vara con la que
 *  medirse. `fallo` es la corrida que no llegó a leer. */
export type EstadoLecturaFoto = 'medida' | 'no_medida' | 'fallo';

export interface ResultadoFotoOcr {
  fotoId: string;
  etiqueta: string;
  estado: EstadoLecturaFoto;
  /** Por qué salió así, siempre que no sea una medición limpia. Nunca en
   *  silencio. */
  motivo: string | null;
  modelo: string | null;
  costoUsd: number;
  medicion: Medicion | null;
  ocrLeido: OcrLeido | null;
  /** La fila escrita en `qa_foto_lectura`, o `null` si no se pudo escribir — y
   *  entonces `motivo` lo dice: la medición se hizo pero no quedó guardada. */
  lecturaId: string | null;
}

export interface RespuestaOcrBanco {
  resultados: ResultadoFotoOcr[];
  /** Las fotos que se quedaron SIN TURNO porque el reloj de la invocación se
   *  agotó. Van por su nombre: el corte mudo es lo que mató al runner de
   *  producción dos veces. Se vuelven a mandar en otra tanda. */
  sinTurno: string[];
  resumen: Agregado;
  costoUsdTotal: number;
}
