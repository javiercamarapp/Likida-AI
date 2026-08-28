// ═══════════════════════════════════════════════════════════════════════════
// RELOJ DE CADUCIDAD — cuánto le queda a un ticket para poder facturarse.
//
// El plazo es el riesgo que no se ve. Medido el 27-jul-2026 sobre 60 guías de
// comercios: las gasolineras dan 7–15 días y la mayoría no factura pasado el
// mes natural de la compra.
//
// Para una flota que liquida por quincena eso es una trampa silenciosa: el
// ticket de diésel del día 2 puede estar VENCIDO cuando la oficina cierra el
// día 16. Y un gasto sin CFDI no es deducible — el dinero ya salió y el IVA se
// pierde. Por eso esto no es un adorno del panel: es lo que permite avisar
// ANTES, cuando todavía se puede hacer algo.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuánto tiempo da el comercio para facturar.
 *
 *  `{ horas }` existe porque los tickets lo imprimen así y no en días: Boston's
 *  dice "solo 72 horas para emitir su factura" y una ferretería de Mérida "plazo
 *  máximo de 24 hrs". Convertirlo a días redondeando hacia arriba habría dado
 *  un día de más justo en los plazos más cortos, que son los únicos donde la
 *  diferencia decide si se alcanza o no. */
export type Plazo =
  | { dias: number }
  | { horas: number }
  | 'mes_natural'
  | 'mes_siguiente'
  /**
   * EL MES DE LA COMPRA **MÁS** UNA COLA CORTA. Lo dicen dos portales por
   * escrito y ninguna de las cuatro variantes de arriba lo expresa:
   *
   *   · ADO: «durante el mes que los compraste y como máximo 07 días del
   *     siguiente mes para obtener tu factura electrónica en el portal. Una vez
   *     concluido el plazo ya no será posible obtenerla.»
   *   · Primera Plus: «La factura se puede generar durante todo el mes de
   *     compra, hasta 72 hrs. posterior al cierre de mes de compra.»
   *
   * SE AÑADIÓ EN VEZ DE FORZARLO AL VALOR MÁS PARECIDO, y el porqué es lo único
   * que importa aquí. Los dos errores disponibles no son igual de malos:
   *
   *   · `'mes_natural'` se queda CORTO —7 días en ADO, 3 en Primera Plus— y
   *     avisaría «vencido» sobre un ticket que todavía se puede facturar. Se
   *     pierde una factura que se podía emitir.
   *   · `'mes_siguiente'` se PASA —hasta 23 días en ADO, ~28 en Primera Plus— y
   *     haría que el sistema JURE que un ticket está vigente cuando ya murió.
   *     Eso es exactamente lo que `plazoVerificado` existe para evitar: la
   *     oficina deja de revisarlo porque el panel dice que hay tiempo.
   *
   * La cola va como `{ dias }` o `{ horas }` porque los dos portales la dicen en
   * unidades distintas y convertir 72 h a «3 días» a mano es precisamente la
   * clase de redondeo silencioso que `{ horas }` se añadió para no hacer.
   */
  | { mesDeCompraMas: { dias: number } | { horas: number } };

export interface Caducidad {
  /** Último día en que el comercio acepta facturar (ISO, inclusive). */
  fechaLimite?: string;
  /** Días que faltan; 0 el mismo día del vencimiento. */
  diasRestantes: number;
  vencido: boolean;
  /** Quedan 2 días o menos: hay que empujarlo ya. */
  urgente: boolean;
  /** Sin fecha de ticket confiable: no se afirma nada. */
  desconocido: boolean;
}

const DIA_MS = 86_400_000;
const UMBRAL_URGENTE = 2;

/** Convierte 'YYYY-MM-DD' a UTC medianoche, para restar sin líos de zona horaria. */
function aUtc(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * UNA COLA EN DÍAS, venga dicha en días o en horas.
 *
 * Trunca hacia abajo (`floor`) y NO redondea hacia arriba, por lo mismo que el
 * plazo en horas suelto: con `ceil`, 12 h se volverían un día completo y el
 * aviso prometería una tarde que ya no existe.
 */
function colaEnDias(cola: { dias: number } | { horas: number }): number {
  return 'horas' in cola ? Math.floor(cola.horas / 24) : cola.dias;
}

/**
 * El último día en que el comercio acepta facturar, en ms UTC.
 *
 * Está fuera de `calcularCaducidad` porque con cinco variantes de `Plazo` el
 * ternario encadenado dejaba de leerse, y esta es justo la función donde un
 * error se lee como «vigente» sin que nadie lo note.
 */
function fechaLimiteMs(compra: number, plazo: Plazo): number {
  const c = new Date(compra);

  // Día 0 del mes siguiente = último día de este mes; cubre 28, 30 y 31.
  const finDelMesDeCompra = Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 0);

  if (plazo === 'mes_natural') return finDelMesDeCompra;

  if (plazo === 'mes_siguiente') {
    // Último día del mes SIGUIENTE al de la compra. No es lo mismo que el mes
    // natural y la diferencia es de semanas: el ticket de Office Depot del
    // 25-jul dice "solicitarla a más tardar dentro del mes siguiente a la fecha
    // de emisión", así que vence el 31-AGO, no el 31-jul. Avisarle "te quedan 3
    // días" habría sido falso.
    return Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 2, 0);
  }

  if ('mesDeCompraMas' in plazo) {
    // EL MES ENTERO **Y DESPUÉS** LA COLA. La cola se cuenta desde el CIERRE
    // DEL MES, no desde la compra: eso es lo que dicen los dos portales, y es
    // lo que hace que un boleto del día 2 y uno del día 30 venzan el MISMO día.
    //
    // El propio portal de Primera Plus publica el caso de borde ya resuelto —
    // «Si tu compra se realiza el último día del mes, solo tendrás hasta el día
    // 3 del mes siguiente»—, así que esta línea tiene un oráculo externo: con
    // 72 h de cola, una compra del 31-ago debe dar el 3-sep. Está en la prueba.
    return finDelMesDeCompra + colaEnDias(plazo.mesDeCompraMas) * DIA_MS;
  }

  if ('horas' in plazo) {
    // HORAS → DÍA LÍMITE. El OCR guarda la FECHA del ticket, no la hora, así
    // que el instante exacto de vencimiento no se puede reconstruir: 24 h desde
    // el 19 a las 12:44 vencen el 20 a las 12:44, y aquí solo se puede decir
    // "el 20".
    //
    // El último día puede ser PARCIAL y eso no se oculta: el mensaje del motor
    // ya cierra con que la ventana del comercio puede ser menor. Lo que importa
    // es que el orden de magnitud sea el del papel —24 h, no doce días—, que es
    // justo lo que fallaba.
    return compra + colaEnDias(plazo) * DIA_MS;
  }

  return compra + plazo.dias * DIA_MS;
}

export function calcularCaducidad(args: {
  fechaTicket: string | undefined;
  plazo: Plazo;
  /** Se inyecta para que la prueba no dependa del reloj de la máquina. */
  hoy: string;
}): Caducidad {
  // El OCR falla en fechas —se le vio devolver 2023 en un ticket de 2026—, y
  // afirmar "vigente" sobre una fecha inventada es peor que no decir nada: la
  // oficina dejaría de revisarlo.
  if (!args.fechaTicket) {
    return { diasRestantes: 0, vencido: false, urgente: false, desconocido: true };
  }

  const compra = aUtc(args.fechaTicket);
  const limite = fechaLimiteMs(compra, args.plazo);

  const hoyMs = aUtc(args.hoy);
  // El plazo vence al FINAL del día límite: el mismo día todavía se puede facturar.
  const restantes = Math.round((limite - hoyMs) / DIA_MS);

  return {
    fechaLimite: iso(limite),
    diasRestantes: Math.max(0, restantes),
    vencido: restantes < 0,
    urgente: restantes >= 0 && restantes <= UMBRAL_URGENTE,
    desconocido: false,
  };
}
