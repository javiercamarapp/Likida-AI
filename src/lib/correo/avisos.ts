import { appUrl } from '@/lib/env';
import type { Correo } from './plantilla';
import { trCorreo, marcoIdioma, type TrCorreo } from './tr';

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
function porQue(tr: TrCorreo, flota: string | null, que: Parameters<TrCorreo['t']>[0]): string {
  const donde = flota ? tr.t('av.porque.flota', { flota }) : tr.t('av.porque.tu_flota');
  return tr.t('av.porque', { que: tr.t(que), donde });
}

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
export function avisoVigencias(d: DatosVigencias, idioma?: unknown): Correo {
  const tr = trCorreo(idioma);
  const { t, tp } = tr;
  const pendientes = d.vencidos + d.porVencer;
  const urgente = d.vencidos > 0;

  const titulo = urgente ? tp('vig.titulo.vencidas', d.vencidos) : tp('vig.titulo.porvencer', d.porVencer);

  const parrafos = [urgente ? t('vig.p.urgente') : t('vig.p.margen')];
  if (d.enRegla > 0 && d.total > 0) {
    parrafos.push(t('vig.p.resto', { enRegla: d.enRegla, total: d.total }));
  }

  return {
    asunto: tp('vig.asunto', pendientes),
    avance: d.detalle[0] ? `${d.detalle[0].unidad}: ${d.detalle[0].estado}` : titulo,
    titulo,
    parrafos,
    datos: d.detalle.map(({ unidad, estado }) => [unidad, estado] as [string, string]),
    boton: { texto: t('vig.boton'), href: `${APP}/dashboard/unidades` },
    tono: urgente ? 'urgente' : 'atencion',
    porQueLoRecibes: porQue(tr, d.flota, 'av.que.unidades'),
    ...marcoIdioma(tr),
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
export function avisoCorridaFallida(d: DatosCorridaFallida, idioma?: unknown): Correo {
  const tr = trCorreo(idioma);
  const { t } = tr;
  const repetido = d.seguidas > 1;

  // EL FALLO ES DE LIKIDA Y EL CORREO LO DICE (B8). La variante de siempre
  // deja entender que hay algo del lado del cliente que mirar; cuando lo que
  // falló es la plataforma, eso manda a 20 flotas a buscar en SUS datos un
  // problema que es nuestro. Aquí el `motivo` crudo no viaja a propósito
  // («Executable doesn't exist…» no le dice al contralor qué hacer): queda en
  // los logs del sistema, no en su bandeja. Y el tono no es urgente porque no
  // hay nada que el cliente pueda hacer — la urgencia es de Likida.
  const v = { agente: d.agente, seguidas: d.seguidas };
  if (d.plataforma) {
    return {
      asunto: repetido ? t('cf.plat.asunto.repetido', v) : t('cf.plat.asunto', v),
      avance: t('cf.plat.avance'),
      titulo: repetido ? t('cf.plat.titulo.repetido') : t('cf.plat.titulo'),
      parrafos: [repetido ? t('cf.plat.p.repetido', v) : t('cf.plat.p')],
      datos: [
        [t('cf.dato.agente'), d.agente],
        [t('cf.dato.cuando'), d.cuando],
        [t('cf.dato.que'), t('cf.plat.que')],
      ],
      boton: { texto: t('cf.boton', v), href: `${APP}${d.href}` },
      tono: repetido ? 'atencion' : 'neutral',
      porQueLoRecibes: porQue(tr, d.flota, 'av.que.agentes'),
      ...marcoIdioma(tr),
    };
  }

  return {
    asunto: repetido ? t('cf.asunto.repetido', v) : t('cf.asunto', v),
    avance: d.motivo,
    titulo: repetido ? t('cf.titulo.repetido', v) : t('cf.titulo', v),
    parrafos: [repetido ? t('cf.p.repetido', v) : t('cf.p')],
    datos: [
      [t('cf.dato.agente'), d.agente],
      [t('cf.dato.cuando'), d.cuando],
      [t('cf.dato.que'), d.motivo],
    ],
    boton: { texto: t('cf.boton', v), href: `${APP}${d.href}` },
    tono: repetido ? 'urgente' : 'atencion',
    porQueLoRecibes: porQue(tr, d.flota, 'av.que.agentes'),
    ...marcoIdioma(tr),
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
export function avisoHuerfanos(d: DatosHuerfanos, idioma?: unknown): Correo {
  const tr = trCorreo(idioma);
  const { t, tp } = tr;
  const viejo = d.diasDelMasViejo !== null && d.diasDelMasViejo >= 7;
  return {
    asunto: tp('hu.asunto', d.cuantos),
    avance: t('hu.avance'),
    titulo: tp('hu.titulo', d.cuantos),
    parrafos: [
      t('hu.p1'),
      ...(viejo ? [t('hu.p.viejo', { dias: d.diasDelMasViejo ?? 0 })] : []),
    ],
    boton: { texto: t('hu.boton'), href: `${APP}/dashboard/huerfanos` },
    tono: viejo ? 'atencion' : 'neutral',
    porQueLoRecibes: porQue(tr, d.flota, 'av.que.comprobantes'),
    ...marcoIdioma(tr),
  };
}

// ── 4. Viajes que el agente escaló ─────────────────────────────────────────

export interface DatosEscalados {
  flota: string | null;
  cuantos: number;
  folios: string[];
}

export function avisoEscalados(d: DatosEscalados, idioma?: unknown): Correo {
  const tr = trCorreo(idioma);
  const { t, tp } = tr;
  return {
    asunto: tp('es.asunto', d.cuantos),
    avance: t('es.avance'),
    titulo: tp('es.titulo', d.cuantos),
    parrafos: [t('es.p')],
    datos: d.folios.slice(0, 8).map((f) => [t('es.dato.viaje'), f] as [string, string]),
    boton: { texto: t('es.boton'), href: `${APP}/dashboard/viajes` },
    tono: 'atencion',
    porQueLoRecibes: porQue(tr, d.flota, 'av.que.viajes'),
    ...marcoIdioma(tr),
  };
}

// ── 4b. Una tarea que el asistente del panel dejó para una persona ────────

export interface DatosEscalacionAsistente {
  flota: string | null;
  /** «la mesa de control», «el equipo de liquidación»…: a quién le toca decidir. */
  destino: string;
  /** El motivo en palabras de persona («Posible emergencia»). */
  motivo: string;
  /** Folio del viaje si la tarea trae uno. */
  folio: string | null;
  /** Una frase ya limpia (sin teléfonos, correos ni ligas). */
  resumen: string;
  /** La tarea va dirigida al contador: el botón abre su panel, no el tablero de viajes en vivo. */
  alContador?: boolean;
  /** Si el motivo exige actuar de inmediato (emergencia): tono urgente. */
  urgente: boolean;
}

/**
 * El asistente del panel NO decide temas delicados: deja una tarea y, si la flota lo encendió, esto es el aviso a la
 * persona. Dice qué pasó y a quién le toca; no afirma culpables y no trae datos personales (el resumen ya viene limpio).
 */
export function avisoEscalacionAsistente(d: DatosEscalacionAsistente, idioma?: unknown): Correo {
  const tr = trCorreo(idioma);
  const { t } = tr;
  return {
    asunto: d.folio ? t('ea.asunto.folio', { motivo: d.motivo, folio: d.folio }) : t('ea.asunto', { motivo: d.motivo }),
    avance: t('ea.avance'),
    titulo: t('ea.titulo', { motivo: d.motivo, destino: d.destino }),
    parrafos: [t('ea.p1'), d.resumen],
    datos: [
      [t('ea.dato.motivo'), d.motivo],
      [t('ea.dato.toca'), d.destino],
      ...(d.folio ? ([[t('es.dato.viaje'), d.folio]] as Array<[string, string]>) : []),
    ],
    // La tarea dirigida al contador se abre desde SU panel (el tablero de viajes en vivo no es de su área y lo rebotaría).
    boton: d.alContador
      ? { texto: t('ea.boton.contador'), href: `${APP}/dashboard/contador` }
      : { texto: t('ea.boton'), href: `${APP}/dashboard/viajes-en-vivo` },
    tono: d.urgente ? 'urgente' : 'atencion',
    porQueLoRecibes: porQue(tr, d.flota, 'av.que.operacion'),
    ...marcoIdioma(tr),
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
export function avisoColaAtorada(d: DatosColaAtorada, idioma?: unknown): Correo {
  const tr = trCorreo(idioma);
  const { t, tp } = tr;
  const viejo = d.diasSinBajar !== null && d.diasSinBajar >= 3;
  return {
    asunto: tp('co.asunto', d.cuantos, { agente: d.agente }),
    avance: t('co.avance'),
    titulo: t('co.titulo', { agente: d.agente }),
    parrafos: [
      t('co.p1'),
      ...(viejo ? [t('co.p.viejo', { dias: d.diasSinBajar ?? 0 })] : []),
    ],
    datos: [
      [t('cf.dato.agente'), d.agente],
      [t('co.dato.pendientes'), String(d.cuantos)],
      ...(d.diasSinBajar !== null
        ? ([[t('co.dato.desde'), tp('co.dias', d.diasSinBajar)]] as Array<[string, string]>)
        : []),
    ],
    boton: { texto: t('cf.boton', { agente: d.agente }), href: `${APP}${d.href}` },
    tono: viejo ? 'urgente' : 'atencion',
    porQueLoRecibes: porQue(tr, d.flota, 'av.que.agentes'),
    ...marcoIdioma(tr),
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
export function avisoInvitacion(d: DatosInvitacion, idioma?: unknown): Correo {
  const tr = trCorreo(idioma);
  const { t } = tr;
  const quien = d.invitaNombre?.trim();
  const flota = d.flota ?? t('inv.flota_por_omision');
  const v = { flota, rol: d.rol };
  return {
    asunto: t('inv.asunto', v),
    avance: t('inv.avance', v),
    titulo: t('inv.titulo', v),
    parrafos: [
      quien ? t('inv.p.quien', { ...v, quien }) : t('inv.p.sinquien', v),
      t('inv.p2'),
    ],
    boton: { texto: t('inv.boton'), href: `${APP}/login` },
    tono: 'neutral',
    // No lleva "puedes apagarlo": no es un aviso recurrente, es un acceso.
    porQueLoRecibes: t('inv.porque', { flota }),
    ...marcoIdioma(tr),
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
export function avisoDePrueba(d: DatosPrueba, idioma?: unknown): Correo {
  const tr = trCorreo(idioma);
  const { t } = tr;
  return {
    asunto: t('pr.asunto', { agente: d.agente }),
    avance: t('pr.avance'),
    titulo: t('pr.titulo', { agente: d.agente }),
    parrafos: [t('pr.p1', { agente: d.agente }), t('pr.p2')],
    tono: 'neutral',
    // El pie de siempre («Recibes este… porque…»), pero sin el "puedes
    // apagarlo" de los recurrentes: esta prueba llega solo cuando se pide.
    porQueLoRecibes: d.flota ? t('pr.porque.flota', { agente: d.agente, flota: d.flota }) : t('pr.porque', { agente: d.agente }),
    ...marcoIdioma(tr),
  };
}
