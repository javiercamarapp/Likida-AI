import { appUrl } from '@/lib/env';
import type { Correo } from './plantilla';

// ═══════════════════════════════════════════════════════════════════════════
// LOS AVISOS — el catálogo completo de correos que Likida manda.
//
// Uno por cada cosa que de verdad pide a una persona. Todos son FUNCIONES
// PURAS de sus datos a un `Correo`: no leen la base, no mandan nada, no
// dependen de la hora. Por eso se pueden probar por su TEXTO, que es lo único
// que el cliente va a juzgar.
//
// LAS TRES REGLAS QUE HEREDAN DEL PRODUCTO:
//
//  1. **Nunca una cifra inventada.** Si el motor devolvió `null`, el aviso lo
//     dice; no se rellena con un cero. Un correo que afirma "0 pendientes"
//     estando ciego es peor que no mandarlo.
//  2. **Siempre lleva a la pantalla donde se resuelve.** Un aviso sin botón es
//     un regaño. Los `href` apuntan a la ruta exacta, no al Inicio.
//  3. **El asunto dice el HECHO, no la categoría.** "Papeles por vencer en 2
//     unidades" se decide en la bandeja; "Notificación de Likida" obliga a
//     abrirlo para saber si importa, y a la tercera vez ya no se abre.
//
// Y una que es de tono: el correo NUNCA acusa a una persona. Dice qué pasó y
// qué falta. La misma razón por la que las alertas del panel no usan las
// palabras "fraude" ni "robo" (LFPDPPP 26-II: el agente prepara y marca, el
// humano decide).
// ═══════════════════════════════════════════════════════════════════════════

const APP = appUrl();

/** El pie de "por qué te llegó", parametrizado por flota. Todos lo usan. */
function porQue(flota: string | null, que: string): string {
  const donde = flota ? `la flota ${flota}` : 'tu flota';
  return `Recibes este aviso porque ${que} de ${donde} en Likida. Puedes apagarlo en la pestaña Notificaciones del agente.`;
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

// ── 1. Papeles de unidades por vencer ──────────────────────────────────────

export interface DatosVigencias {
  flota: string | null;
  vencidos: number;
  porVencer: number;
  enRegla: number;
  total: number;
  /** Los renglones a enseñar, ya redactados por `clasificarVigencia`. */
  detalle: Array<{ unidad: string; estado: string }>;
}

/**
 * El aviso de vigencias. Es el que más veces se va a mandar, así que es el que
 * más rápido enseña a ignorarlo si se manda mal.
 *
 * Por eso NO se manda cuando no hay nada: quien llama comprueba
 * `vencidos + porVencer > 0`. Y por eso el asunto lleva el conteo — con dos
 * unidades vencidas se abre; con "Resumen semanal de tu flota", no.
 */
export function avisoVigencias(d: DatosVigencias): Correo {
  const pendientes = d.vencidos + d.porVencer;
  const urgente = d.vencidos > 0;

  const titulo = urgente
    ? `${d.vencidos} ${plural(d.vencidos, 'unidad tiene un papel vencido', 'unidades tienen papeles vencidos')}`
    : `${d.porVencer} ${plural(d.porVencer, 'unidad tiene un papel por vencer', 'unidades tienen papeles por vencer')}`;

  const parrafos = [
    urgente
      ? 'Una unidad con la verificación o el permiso vencidos no tiene un pendiente administrativo: tiene riesgo de multa, de detención y de un seguro que podría no responder.'
      : 'Renovar una verificación o una póliza toma días hábiles —cita, taller, pago, emisión—, así que este aviso llega con margen.',
  ];
  if (d.enRegla > 0 && d.total > 0) {
    parrafos.push(`El resto de tu flota está al día: ${d.enRegla} de ${d.total} unidades en regla.`);
  }

  return {
    asunto: `${pendientes} ${plural(pendientes, 'unidad necesita papeles', 'unidades necesitan papeles')}`,
    avance: d.detalle[0] ? `${d.detalle[0].unidad}: ${d.detalle[0].estado}` : titulo,
    titulo,
    parrafos,
    datos: d.detalle.map(({ unidad, estado }) => [unidad, estado] as [string, string]),
    boton: { texto: 'Ver mis unidades', href: `${APP}/dashboard/unidades` },
    tono: urgente ? 'urgente' : 'atencion',
    porQueLoRecibes: porQue(d.flota, 'administras las unidades'),
  };
}

// ── 2. Una corrida de agente que falló ─────────────────────────────────────

export interface DatosCorridaFallida {
  flota: string | null;
  agente: string;
  /** La ruta de la página de ESE agente. */
  href: string;
  cuando: string;
  /** El motivo en palabras de persona, ya traducido. NUNCA un stack trace. */
  motivo: string;
  /** Cuántas veces seguidas ha fallado. 1 = la primera. */
  seguidas: number;
  /**
   * `true` cuando el fallo fue de la PLATAFORMA de Likida —el navegador de
   * facturación que no arranca, infraestructura caída—, no de los datos de la
   * flota (B8, auditoría 4). Cambia la redacción entera: el cliente no tiene
   * nada que revisar ni corregir, el reintento es nuestro, y el `motivo` crudo
   * NO viaja — un error de infraestructura en su bandeja no le dice qué hacer
   * y sí le dice que el producto está roto.
   */
  plataforma?: boolean;
}

/**
 * El agente dejó de trabajar y nadie se enteró — el modo de falla más caro de
 * un producto de agentes, porque su síntoma es que NO pasa nada.
 *
 * El motivo llega ya traducido: un stack trace en el correo del contralor no
 * le dice qué hacer y sí le dice que el producto está roto.
 */
export function avisoCorridaFallida(d: DatosCorridaFallida): Correo {
  const repetido = d.seguidas > 1;

  // EL FALLO ES DE LIKIDA Y EL CORREO LO DICE (B8). La variante de siempre
  // deja entender que hay algo del lado del cliente que mirar; cuando lo que
  // falló es la plataforma, eso manda a 20 flotas a buscar en SUS datos un
  // problema que es nuestro. Aquí el `motivo` crudo no viaja a propósito
  // («Executable doesn't exist…» no le dice al contralor qué hacer): queda en
  // los logs del sistema, no en su bandeja. Y el tono no es urgente porque no
  // hay nada que el cliente pueda hacer — la urgencia es de Likida.
  if (d.plataforma) {
    return {
      asunto: repetido
        ? `${d.agente}: ${d.seguidas} corridas detenidas por un problema de Likida`
        : `${d.agente} no corrió por un problema de Likida`,
      avance: 'Tu información está bien y no tienes nada que corregir.',
      titulo: repetido
        ? 'La plataforma de Likida sigue con un problema'
        : 'La plataforma de Likida tuvo un problema',
      parrafos: [
        repetido
          ? `Van ${d.seguidas} corridas sin poder completarse por un problema de la plataforma de Likida — no de tu información. Tus datos están bien y no tienes nada que corregir: seguimos reintentando solos, y de nuestro lado ya quedó registrado.`
          : 'La corrida no se pudo completar por un problema de la plataforma de Likida — no de tu información. Tus datos están bien y no tienes nada que corregir: reintentamos solos en la siguiente corrida.',
      ],
      datos: [
        ['Agente', d.agente],
        ['Cuándo', d.cuando],
        ['Qué pasó', 'Un problema interno de Likida. Tu información está bien.'],
      ],
      boton: { texto: `Ver ${d.agente}`, href: `${APP}${d.href}` },
      tono: repetido ? 'atencion' : 'neutral',
      porQueLoRecibes: porQue(d.flota, 'administras los agentes'),
    };
  }

  return {
    asunto: repetido
      ? `${d.agente} lleva ${d.seguidas} corridas sin completarse`
      : `${d.agente} no pudo completar su corrida`,
    avance: d.motivo,
    titulo: repetido
      ? `${d.agente} no ha podido trabajar`
      : `${d.agente} se detuvo a medio camino`,
    parrafos: [
      repetido
        ? `Van ${d.seguidas} corridas seguidas sin completarse. Mientras tanto, lo que este agente hace no se está haciendo — y eso no genera errores en tu panel, simplemente no aparece trabajo nuevo.`
        : 'La corrida se detuvo antes de terminar. Lo que alcanzó a hacer quedó guardado; lo que faltaba se reintenta en la siguiente.',
    ],
    datos: [
      ['Agente', d.agente],
      ['Cuándo', d.cuando],
      ['Qué pasó', d.motivo],
    ],
    boton: { texto: `Ver ${d.agente}`, href: `${APP}${d.href}` },
    tono: repetido ? 'urgente' : 'atencion',
    porQueLoRecibes: porQue(d.flota, 'administras los agentes'),
  };
}

// ── 3. Comprobantes que llegaron sin viaje ─────────────────────────────────

export interface DatosHuerfanos {
  flota: string | null;
  cuantos: number;
  /** El más viejo, en días. Es lo que vuelve urgente el renglón. */
  diasDelMasViejo: number | null;
}

/**
 * Dinero que ya se gastó y no está en ninguna liquidación.
 *
 * El monto NO va en el asunto ni en el cuerpo a propósito: el correo puede
 * reenviarse y acabar en una bandeja que no debería ver el gasto de la flota.
 * El conteo alcanza para que alguien entre a resolverlo.
 */
export function avisoHuerfanos(d: DatosHuerfanos): Correo {
  const viejo = d.diasDelMasViejo !== null && d.diasDelMasViejo >= 7;
  return {
    asunto: `${d.cuantos} ${plural(d.cuantos, 'comprobante sin viaje', 'comprobantes sin viaje')}`,
    avance: 'Son gastos que hoy no están en ninguna liquidación.',
    titulo: `${d.cuantos} ${plural(d.cuantos, 'comprobante llegó', 'comprobantes llegaron')} sin viaje al cual pegarse`,
    parrafos: [
      'Cada uno es un gasto que ya salió de la caja y que hoy no está en ninguna liquidación. Desde la bandeja puedes asignarlos al viaje que les toca.',
      ...(viejo
        ? [`El más antiguo lleva ${d.diasDelMasViejo} días esperando. Entre más tiempo pasa, más difícil es que alguien recuerde de qué viaje era.`]
        : []),
    ],
    boton: { texto: 'Abrir la bandeja', href: `${APP}/dashboard/huerfanos` },
    tono: viejo ? 'atencion' : 'neutral',
    porQueLoRecibes: porQue(d.flota, 'revisas los comprobantes'),
  };
}

// ── 4. Viajes que el agente escaló ─────────────────────────────────────────

export interface DatosEscalados {
  flota: string | null;
  cuantos: number;
  folios: string[];
}

export function avisoEscalados(d: DatosEscalados): Correo {
  return {
    asunto: `${d.cuantos} ${plural(d.cuantos, 'viaje escalado', 'viajes escalados')}`,
    avance: 'El agente dejó de avanzar y esperan a una persona.',
    titulo: `${d.cuantos} ${plural(d.cuantos, 'viaje necesita', 'viajes necesitan')} que alguien intervenga`,
    parrafos: [
      'El agente hizo lo que pudo y se detuvo: o el operador no respondió, o falta un comprobante que solo una persona puede conseguir. Están esperando, no avanzando.',
    ],
    datos: d.folios.slice(0, 8).map((f) => ['Viaje', f] as [string, string]),
    boton: { texto: 'Ver los viajes', href: `${APP}/dashboard/viajes` },
    tono: 'atencion',
    porQueLoRecibes: porQue(d.flota, 'das seguimiento a los viajes'),
  };
}

// ── 5. La cola de un agente que dejó de bajar ──────────────────────────────

export interface DatosColaAtorada {
  flota: string | null;
  agente: string;
  href: string;
  /** Cuántos elementos lleva parados. */
  cuantos: number;
  /** Desde cuándo no baja, en días. `null` = no se pudo medir. */
  diasSinBajar: number | null;
}

/**
 * El agente SÍ está corriendo, pero su cola no baja.
 *
 * Es distinto de una corrida fallida y más difícil de notar: no hay error en
 * ningún log, las corridas salen "bien", y el trabajo simplemente se acumula.
 * El síntoma típico es que el agente hace todo lo que puede solo y lo que
 * queda necesita a una persona — que no sabe que la necesitan.
 */
export function avisoColaAtorada(d: DatosColaAtorada): Correo {
  const viejo = d.diasSinBajar !== null && d.diasSinBajar >= 3;
  return {
    asunto: `${d.agente}: ${d.cuantos} ${plural(d.cuantos, 'pendiente sin avanzar', 'pendientes sin avanzar')}`,
    avance: 'El agente corre bien, pero su cola no baja.',
    titulo: `La cola de ${d.agente} no está bajando`,
    parrafos: [
      'El agente está corriendo sin errores — por eso esto no aparece como una falla. Lo que pasa es que hizo todo lo que podía solo, y lo que queda necesita que alguien decida.',
      ...(viejo
        ? [`Llevan ${d.diasSinBajar} días sin moverse. Entre más esperan, más difícil es reconstruir el contexto de cada uno.`]
        : []),
    ],
    datos: [
      ['Agente', d.agente],
      ['Pendientes', String(d.cuantos)],
      ...(d.diasSinBajar !== null
        ? ([['Sin avanzar desde hace', `${d.diasSinBajar} ${plural(d.diasSinBajar, 'día', 'días')}`]] as Array<[string, string]>)
        : []),
    ],
    boton: { texto: `Ver ${d.agente}`, href: `${APP}${d.href}` },
    tono: viejo ? 'urgente' : 'atencion',
    porQueLoRecibes: porQue(d.flota, 'administras los agentes'),
  };
}

// ── 6. Bienvenida al invitar a alguien ─────────────────────────────────────

export interface DatosInvitacion {
  flota: string | null;
  /** Cómo se llama quien invita — el correo lo firma una persona, no un robot. */
  invitaNombre: string | null;
  rol: string;
}

/**
 * El único correo que NO es una alerta.
 *
 * Lo firma una persona porque lo es: alguien de la empresa le está dando
 * acceso a otro. Un "El equipo de Likida te ha invitado" sería falso — Likida
 * no invitó a nadie.
 */
export function avisoInvitacion(d: DatosInvitacion): Correo {
  const quien = d.invitaNombre?.trim();
  const flota = d.flota ?? 'una flota';
  return {
    asunto: `Ya tienes acceso a ${flota} en Likida`,
    avance: `Entras como ${d.rol}.`,
    titulo: `Te dieron acceso a ${flota}`,
    parrafos: [
      quien
        ? `${quien} te dio acceso al panel de ${flota} en Likida, con el rol de ${d.rol}.`
        : `Te dieron acceso al panel de ${flota} en Likida, con el rol de ${d.rol}.`,
      'Entras con este mismo correo: en la pantalla de acceso pides tu enlace y llega aquí. No hay contraseña que recordar ni que perder.',
    ],
    boton: { texto: 'Entrar a Likida', href: `${APP}/login` },
    tono: 'neutral',
    // No lleva "puedes apagarlo": no es un aviso recurrente, es un acceso.
    porQueLoRecibes: `Recibes este correo porque alguien de ${flota} te dio acceso a su panel en Likida.`,
  };
}

// ── 7. La prueba de avisos — «¿me llega a MÍ?» ─────────────────────────────

export interface DatosPrueba {
  flota: string | null;
  /** El nombre del agente cuya pestaña disparó la prueba. */
  agente: string;
}

/**
 * El único correo del catálogo que confirma que NO pasa nada.
 *
 * Existe porque hasta hoy el cliente no podía comprobar que los avisos le
 * llegan sin esperar a que algo se rompiera de verdad (auditoría 4, B5). Lo
 * pide él mismo con el botón «Mándate una prueba» de la pestaña
 * Notificaciones, y le llega SOLO a él.
 *
 * Rompe dos reglas de la casa A PROPÓSITO, y lo declara:
 *   · No trae botón. Quien lo lee acaba de apretar el que lo mandó, con la
 *     pestaña abierta enfrente: una liga de vuelta a donde ya está es
 *     decoración, no una pantalla donde algo se resuelva.
 *   · No pide nada. Los demás avisos existen porque piden algo a una persona;
 *     éste dice con todas sus letras que no hay ningún problema, para que
 *     nadie salga corriendo a buscar uno.
 *
 * SIN cifras y sin datos de la flota más allá del nombre: puede reenviarse
 * («mira, sí llega») y no debe cargar nada que no sea suyo.
 */
export function avisoDePrueba(d: DatosPrueba): Correo {
  return {
    asunto: `[Likida] Prueba de avisos — ${d.agente}`,
    avance: 'Todo en orden: es la prueba que pediste, no un incidente.',
    titulo: `Los avisos del ${d.agente} sí te llegan`,
    parrafos: [
      `Este correo confirma que los avisos del ${d.agente} llegan a esta dirección. No hay ningún problema real: pediste la prueba con el botón «Mándate una prueba», y comprobar la entrega es todo lo que hace.`,
      'Cuando este agente tenga algo de verdad que avisarte, el correo va a entrar por este mismo camino.',
    ],
    tono: 'neutral',
    // El pie de siempre («Recibes este… porque…»), pero sin el "puedes
    // apagarlo" de los recurrentes: esta prueba llega solo cuando se pide.
    porQueLoRecibes: `Recibes este correo porque pediste una prueba de los avisos del ${d.agente}${d.flota ? ` de la flota ${d.flota}` : ''} en Likida. No es recurrente: llega solo cuando tú la pides.`,
  };
}
