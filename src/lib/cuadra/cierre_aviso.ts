import { mxn } from '@/lib/formato';
import type { TipoDiferencia } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE CIERRE. DOS MENSAJES, DOS PERSONAS, DOS CRITERIOS DISTINTOS.
//
// Hoy el chofer escribe "listo", el motor cuadra y el PDF sale hacia SU
// teléfono. Al jefe de flota nadie le avisa: se entera entrando al panel, o no
// se entera.
//
// ── POR QUÉ NO ES EL MISMO TEXTO REENVIADO ───────────────────────────────
//
// El chofer no puede resolver nada de lo que sale en un cuadre: no elige el
// proveedor, no timbra el CFDI, no fija la política. Lo único que le toca es
// saber si le deben o debe, y qué comprobante suyo no entró en la cuenta.
//
// El jefe es el contrario: no le importa el saldo si cuadró, le importa lo que
// alguien tiene que resolver. Mandarle el mismo resumen del chofer lo obliga a
// leer cifras correctas para descubrir que no había nada que hacer.
//
// ── LA REGLA QUE MANDA: NO SE AVISA DE LO QUE SALIÓ BIEN ──────────────────
//
// Una flota de veinte unidades cierra veinte viajes al día. Veinte mensajes de
// "todo cuadró" enseñan a ignorar el canal, y el día que llegue el viaje con
// $8,000 sin comprobar va a caer en la misma pila que los otros diecinueve.
// Es el mismo criterio que ya fija `facturacion/avisar.ts` para los plazos.
//
// Por eso estas funciones NO MANDAN NADA: arman el texto y devuelven
// `requiereDecision`. Quien llame decide si sale ahora por WhatsApp o si se
// acumula para el resumen del día.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Una diferencia del cuadre, reducida a lo que hace falta para redactar.
 *
 * `tipo` es el vocabulario del motor (`TipoDiferencia`) a propósito, no un
 * string libre: es lo que permite que el mapa de abajo sea exhaustivo y que
 * agregar un veredicto nuevo al motor ROMPA la compilación aquí en vez de caer
 * en silencio en la rama de "no le avises a nadie".
 */
export interface DiferenciaResumen {
  tipo: TipoDiferencia;
  /**
   * El concepto YA en palabras ("Diésel", "Alimentación"), tal como lo nombró
   * el cuadre con `etiquetaConcepto`. No se traduce aquí: una segunda tabla de
   * etiquetas termina diciendo en WhatsApp algo distinto de lo que dice el PDF,
   * y el contralor lee los dos.
   */
  concepto: string;
  /** Impacto en pesos (+ a favor de la empresa). Puede ser 0 en los veredictos fiscales. */
  monto: number;
  /** La explicación legible que ya escribió quien detectó la diferencia. */
  nota: string;
}

/** Lo mínimo para redactar el cierre. No trae gastos, ni cubetas, ni acreditables. */
export interface ResumenLiquidacion {
  folio: string;
  operador: string;
  /**
   * ATENCIÓN AL CERO. Un `0` aquí NO prueba que la flota no dio anticipo:
   * prueba que no hay anticipo registrado, que es otra cosa. Los dos casos se
   * tratan igual —se dice que no hay anticipo y se manda a revisar—, porque
   * decir "cuadró perfecto" sobre un cero de captura es exactamente la cifra
   * inventada que este producto no puede permitirse.
   */
  anticipo: number;
  totalComprobado: number;
  /** Misma convención que `Liquidacion`: + a favor de la empresa, − a favor del operador. */
  diferencia: number;
  diferencias: DiferenciaResumen[];
}

/**
 * Centavos por debajo de los cuales el viaje se declara cuadrado.
 *
 * Es el MISMO umbral con el que el motor decide si levanta la diferencia de
 * anticipo (`engine.ts`, `Math.abs(diferencia) >= 0.5`). Con un umbral distinto
 * el aviso diría "hay diferencia" de un viaje que el panel enseña cuadrado.
 */
export const TOLERANCIA_MXN = 0.5;

/** A dónde va cada veredicto: a interrumpir al jefe, o a esperarlo en el panel. */
export type RutaDeAviso = 'decision' | 'panel';

/**
 * QUÉ MERECE INTERRUMPIR AL JEFE.
 *
 * `decision` = hay dinero en juego y alguien con autoridad tiene que resolver.
 * `panel` = es cierto, se guarda, se ve en la pantalla, pero no justifica un
 * mensaje. Tres razones distintas para mandar algo al panel, y las tres
 * importan porque son las que evitan que el canal se queme:
 *
 *   1. LA MÁQUINA YA LO RESOLVIÓ (`duplicado`): el comprobante repetido ya se
 *      contó una sola vez y al chofer ya se le dijo. Avisar de algo que ya está
 *      hecho es justo lo que entrena a ignorar el aviso.
 *   2. LE TOCA A OTRO CANAL (`factura_por_vencer`, `folio_verificar`): el aviso
 *      de plazos ya existe, con su propia plantilla y su propio destinatario
 *      (`facturacion/avisar.ts`). Avisar dos veces quema los dos canales.
 *   3. TODAVÍA NO ES UN HECHO (`cfdi_pendiente`, `cfdi_efos_indeterminado`,
 *      `permiso_cre_no_verificable`): el SAT no respondió o el dato no es
 *      concluyente. Se reintenta; no hay nada que decidir sobre una duda.
 */
export const RUTA_DE_DIFERENCIA: Record<TipoDiferencia, RutaDeAviso> = {
  // ── Política y comprobación: el corazón de lo que el jefe decide ─────────
  sobre_politica: 'decision',
  viatico_excede_fiscal: 'decision',   // el excedente no es deducible: ¿se le descuenta o lo absorbe la flota?
  sin_comprobante: 'decision',
  sin_cfdi: 'decision',
  alimentacion_sin_soporte: 'decision', // LISR 28-V: falta el hospedaje o transporte que la ampare
  monto_invalido: 'decision',          // el comprobante NO entró en el total: la liquidación está incompleta
  monto_discrepante: 'decision',       // el código y el OCR dicen cifras distintas

  // ── Dinero fiscal que se pierde si nadie hace algo ───────────────────────
  cfdi_cancelado: 'decision',
  cfdi_efos: 'decision',
  cfdi_no_encontrado: 'decision',
  comprobante_no_fiscal: 'decision',
  complemento_hidrocarburos: 'decision',
  ieps_no_desglosado: 'decision',      // sin IEPS desglosado se pierde el estímulo: se pide refacturación
  efectivo_sobre_tope: 'decision',
  rfc_receptor: 'decision',            // timbrado a otro RFC: se pide refacturación
  rfc_receptor_no_verificable: 'decision', // el RFC de la propia flota no sirve; eso lo arregla el jefe
  alimentacion_transporte_sin_tarjeta_credito: 'decision',

  // ── Señales de que algo no está bien, no de que algo falló ───────────────
  diesel_desviacion: 'decision',       // consumo fuera de rango: puede ser robo
  fecha_sospechosa: 'decision',        // un ticket de otro viaje cobrado aquí es dinero mal asignado
  texto_sospechoso: 'decision',        // el papel traía texto dirigido al extractor: lo ve una persona

  // ── Al panel, por las tres razones del bloque de arriba ──────────────────
  anticipo: 'panel',                   // la diferencia global ya encabeza el mensaje; repetirla es ruido
  duplicado: 'panel',
  factura_por_vencer: 'panel',
  folio_verificar: 'panel',
  cfdi_pendiente: 'panel',
  cfdi_efos_indeterminado: 'panel',
  permiso_cre_no_verificable: 'panel',
  ocr_baja_confianza: 'panel',         // bandeja de revisión, no decisión de negocio
  viatico_rfc_operador: 'panel',       // hay que confirmar que el nombre es el del operador: se ve, no se decide
  combustible_efectivo: 'panel',       // cuenta contra el 15% del ejercicio (RFA 2026 2.9); no se pierde por viaje
  complemento_no_verificable: 'panel', // lo resuelve el chofer reenviando el XML, no el jefe
};

/**
 * Los veredictos que significan "este comprobante NO entró en tu cuenta".
 *
 * Es una lista corta a propósito, y está verificada contra el motor: en
 * `engine.ts` el total suma todos los gastos salvo los duplicados y los de
 * monto ≤ 0. Todos los demás veredictos —un CFDI cancelado, un EFOS, un pago
 * en efectivo— siguen sumando al comprobado del chofer; le cuestan a la flota
 * la deducción, no a él su dinero.
 *
 * Meterlos aquí sería el rótulo falso más caro del producto: decirle "te
 * rechacé el comprobante" a alguien al que sí se le va a pagar.
 */
const NO_ENTRO_EN_LA_CUENTA: TipoDiferencia[] = ['duplicado', 'monto_invalido'];

/**
 * Máximo de líneas en el cuerpo. El resto se cuenta.
 *
 * Es lo que cabe en una pantalla de teléfono. Mismo criterio que `avisar.ts` y
 * `cuadre/resumen.ts`: listar veinte hace que no se lea ninguna, y el conteo
 * del final impide que el recorte se lea como que eso era todo.
 */
const MAX_LINEAS = 6;

/**
 * Una cifra que se puede imprimir.
 *
 * Un `null` de la base o un `NaN` de una resta no son "cero": `mxn(null)`
 * revienta y `mxn(NaN)` imprime `$NaN` en el teléfono de quien liquida. Se
 * detecta y se dice, que es la misma regla con la que el panel trata una
 * consulta fallida: fallar cerrado y decirlo.
 */
function esCifra(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** `true` si las tres cifras del encabezado son imprimibles y coherentes. */
function cifrasLegibles(l: ResumenLiquidacion): boolean {
  return esCifra(l.anticipo) && l.anticipo >= 0 && esCifra(l.totalComprobado) && esCifra(l.diferencia);
}

/**
 * La línea de una diferencia, en los dos mensajes.
 *
 * El `monto` de una diferencia es su IMPACTO, no el valor del comprobante —en
 * un duplicado de tres copias vale dos copias, no una—, así que NO se imprime
 * junto al concepto: ahí se leería como el precio del ticket. Las cifras que
 * salen son las que ya trae la nota, escritas por quien las calculó.
 *
 * El concepto se antepone solo si la nota no lo dice ya. Las notas del motor
 * empiezan nombrando el gasto ("Comprobante duplicado: Alimentación folio…"),
 * y repetirlo delante se lee como un error del sistema.
 */
function lineaDeDiferencia(d: DiferenciaResumen): string {
  const nota = (d.nota ?? '').trim();
  const concepto = (d.concepto ?? '').trim();
  // Una diferencia sin nota es un dato incompleto, no una línea en blanco: se
  // enseña lo que haya (concepto, o el tipo crudo) para que quede rastro.
  if (!nota) return concepto || d.tipo;
  if (!concepto || nota.toLowerCase().includes(concepto.toLowerCase())) return nota;
  return `${concepto}: ${nota}`;
}

/** Corta a `MAX_LINEAS` diciendo cuántas quedaron fuera. Nunca trunca en silencio. */
function conCorte(notas: string[], donde: string): string[] {
  if (notas.length <= MAX_LINEAS) return notas.map((n) => `• ${n}`);
  const sobran = notas.length - MAX_LINEAS;
  return [...notas.slice(0, MAX_LINEAS).map((n) => `• ${n}`), `• …y ${sobran} ${donde}.`];
}

/**
 * El aviso para el CHOFER: si le deben o debe, y qué comprobante suyo no contó.
 *
 * No lleva veredictos fiscales. Ninguno depende de él, y mandárselos no produce
 * ninguna acción — solo la sensación de que se le está auditando. Ese criterio
 * ya está escrito en `SOLO_CONTRALOR` (`cuadre/resumen.ts`); aquí se aplica por
 * omisión: al operador se le dice su saldo y lo que no le contó, nada más.
 */
export function armarAvisoChofer(l: ResumenLiquidacion): string {
  const lineas: string[] = [`Viaje ${l.folio}`];

  if (!cifrasLegibles(l)) {
    // Ni un peso inventado: no se dice cuánto, se dice que no se pudo.
    lineas.push('No pude cerrar las cifras de este viaje. Ya va con tu jefe para revisarlo.');
  } else if (l.anticipo === 0) {
    // AQUÍ ES DONDE SE ROMPERÍA LA REGLA. Con anticipo 0, `diferencia` vale
    // −comprobado, y decir "te deben $8,400" sería prometerle a un chofer un
    // dinero que nadie autorizó. Lo único cierto es lo que comprobó.
    lineas.push(
      l.totalComprobado > 0
        ? `No hay anticipo registrado en este viaje, así que todavía no se puede decir cuánto te toca. Comprobaste ${mxn(l.totalComprobado)}. Ya va con tu jefe.`
        : 'No hay anticipo registrado ni comprobantes en este viaje. Ya va con tu jefe.',
    );
  } else if (l.diferencia >= TOLERANCIA_MXN) {
    lineas.push(`Debes ${mxn(l.diferencia)}: es lo que sobró del anticipo.`);
  } else if (l.diferencia <= -TOLERANCIA_MXN) {
    lineas.push(`Te deben ${mxn(-l.diferencia)}: pusiste esa cantidad de tu bolsa.`);
  } else {
    lineas.push('Cuadró exacto: no debes nada y no te deben nada.');
  }

  const rechazados = l.diferencias.filter((d) => NO_ENTRO_EN_LA_CUENTA.includes(d.tipo));
  if (rechazados.length > 0) {
    lineas.push(
      '',
      rechazados.length === 1
        ? 'Un comprobante no entró en la cuenta:'
        : `${rechazados.length} comprobantes no entraron en la cuenta:`,
      // "más" a secas y no "más en el panel": el chofer no tiene panel. El
      // conteo del renglón de arriba ya le dice cuántos son en total.
      ...conCorte(rechazados.map(lineaDeDiferencia), 'más'),
    );
  }

  return lineas.join('\n');
}

/**
 * El aviso para el JEFE DE FLOTA, y la decisión de si vale la pena mandarlo.
 *
 * `requiereDecision` es la única salida que importa: en `false` el texto es una
 * línea pensada para apilarse en el resumen del día, no para interrumpir.
 */
export function armarAvisoJefe(l: ResumenLiquidacion): { texto: string; requiereDecision: boolean } {
  const quien = `${l.folio} · ${l.operador}`;
  const legibles = cifrasLegibles(l);

  // La diferencia de anticipo se filtra: ya encabeza el mensaje con su cifra.
  // Es el mismo filtro que hace `cuadre/resumen.ts` con `d.tipo !== 'anticipo'`.
  //
  // El `!== 'panel'` en vez de `=== 'decision'` es la parte que importa: un
  // tipo que la base traiga y el mapa no conozca cae en `undefined` y se va a
  // la decisión. Se falla hacia molestar al jefe de más, nunca hacia callar un
  // veredicto que nadie clasificó.
  const pendientes = l.diferencias
    .filter((d) => d.tipo !== 'anticipo' && RUTA_DE_DIFERENCIA[d.tipo] !== 'panel')
    // Lo caro arriba. Si hay que recortar a seis, lo que se pierde es lo barato.
    .sort((a, b) => (esCifra(b.monto) ? Math.abs(b.monto) : 0) - (esCifra(a.monto) ? Math.abs(a.monto) : 0));

  const sinAnticipo = legibles && l.anticipo === 0;
  const descuadre = legibles && Math.abs(l.diferencia) >= TOLERANCIA_MXN;
  const requiereDecision = !legibles || sinAnticipo || descuadre || pendientes.length > 0;

  if (!requiereDecision) {
    // UNA LÍNEA, Y ES LA QUE NO SE MANDA. Trae folio, operador y las dos cifras
    // porque su destino es una lista de veinte al final del día, donde un
    // "cuadró ✅" suelto no dice de qué viaje habla.
    return {
      texto: `${quien}: cuadró. Anticipo ${mxn(l.anticipo)}, comprobado ${mxn(l.totalComprobado)}.`,
      requiereDecision: false,
    };
  }

  const lineas: string[] = [`${quien} — necesita tu decisión.`];

  if (!legibles) {
    lineas.push('Las cifras de esta liquidación no se pudieron leer (anticipo, comprobado o diferencia). No se calculó nada con ellas.');
  } else if (sinAnticipo) {
    // No se imprime `diferencia` en esta rama, y es deliberado: sin anticipo
    // registrado, "diferencia" no sería la diferencia contra nada — sería el
    // comprobado con el signo cambiado, con un rótulo que miente.
    lineas.push(
      `Sin anticipo registrado. Comprobado ${mxn(l.totalComprobado)}.`,
      'Mientras no se registre el anticipo no hay diferencia que calcular.',
    );
  } else {
    const saldo =
      l.diferencia >= TOLERANCIA_MXN
        ? `Sobró ${mxn(l.diferencia)} del anticipo (a favor de la empresa)`
        : l.diferencia <= -TOLERANCIA_MXN
        ? `El operador puso ${mxn(-l.diferencia)} de su bolsa`
        : 'Cuadra contra el anticipo';
    lineas.push(`Anticipo ${mxn(l.anticipo)} · Comprobado ${mxn(l.totalComprobado)} · ${saldo}`);
  }

  if (pendientes.length > 0) {
    lineas.push('', ...conCorte(pendientes.map(lineaDeDiferencia), 'más en el panel'));
  }

  return { texto: lineas.join('\n'), requiereDecision: true };
}
