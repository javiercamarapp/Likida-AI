import { traerTodo, conteo } from '../pg';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { identificarComercio } from './identificar';
import { calcularCaducidad, type Caducidad } from './caducidad';
import type { Comercio, ClaveCampo } from './comercios';

// ═══════════════════════════════════════════════════════════════════════════
// QUÉ TICKETS FALTAN POR FACTURAR, Y CUÁNTO LES QUEDA.
//
// El módulo de facturación llevaba construido desde el 27-jul —60 comercios con
// sus campos, plazos, y el reconocedor— y NINGUNA pantalla lo usaba. Los datos
// se leían del ticket, se guardaban y ahí morían. Esto es el puente.
//
// POR QUÉ IMPORTA MÁS DE LO QUE PARECE: de los 40 gastos que hay hoy en la base,
// 38 NO tienen CFDI. El 95%. Un gasto sin CFDI no es deducible — el dinero ya
// salió del bolsillo de la flota y el IVA se pierde. Y el ticket CADUCA: las
// gasolineras dan 7-15 días y la mayoría no factura pasado el mes natural.
//
// Para una flota que liquida por quincena eso es una trampa silenciosa: el
// ticket del día 2 puede estar vencido cuando la oficina cierra el día 16.
//
// LO QUE ESTA LISTA NO HACE: no factura. Reúne lo que el portal va a pedir y lo
// pone junto con su liga y su plazo, para que una persona lo capture en treinta
// segundos en vez de perseguir el papel. Automatizar los portales es otro
// trabajo — y hoy el 70% de ellos no exige cuenta, así que es viable, pero no
// es esto.
// ═══════════════════════════════════════════════════════════════════════════

/** Un campo que el portal pide, con el valor que ya se leyó del ticket. */
export interface CampoListo {
  clave: ClaveCampo;
  /** Cómo lo llama el portal, literal. Lo que la persona va a buscar en pantalla. */
  etiqueta: string;
  valor: string | null;
  requerido: boolean;
}

export interface TicketPorFacturar {
  gastoId: string;
  concepto: string;
  monto: number;
  fecha: string | null;
  folio: string | null;
  /** Liga leída del ticket o del QR. `null` = no se pudo leer. */
  urlTicket: string | null;
  /** El comercio reconocido, o `null` si no hay respuesta única. */
  comercio: { clave: string; nombre: string; portal: string; requiereCuenta: boolean } | null;
  /** Los campos que ese portal pide, ya con su valor. */
  campos: CampoListo[];
  /** `true` cuando se conoce el portal pero no sus etiquetas todavía. */
  camposPendientes: boolean;
  caducidad: Caducidad;
  /** El plazo del comercio está verificado contra su portal, o es el default. */
  plazoVerificado: boolean;
  /**
   * La máquina se rindió con este ticket A PROPÓSITO, y por eso tiene que
   * hacerlo una persona. `null` = sigue en la cola automática.
   *
   * No es lo mismo que "falló": un fallo se reintenta la hora siguiente. Esto es
   * un CAPTCHA, o una emisión que no se pudo confirmar —donde reintentar
   * duplicaría el CFDI—, o un viaje ya liquidado al que la base no deja pegarle
   * el folio. En los tres, la corrida siguiente daría exactamente lo mismo.
   */
  bloqueo: { motivo: string; desde: string } | null;
}

/**
 * Saca del gasto el valor de cada campo que pide el portal.
 *
 * Devuelve `null` en vez de adivinar. Un campo vacío en pantalla le dice a la
 * persona "esto lo tienes que buscar en el papel"; un valor inventado la manda a
 * teclear algo que el portal va a rechazar, y a dudar del resto.
 */
function valorDe(clave: ClaveCampo, g: FilaGasto): string | null {
  const extra = (g.ocr_extra ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
  switch (clave) {
    case 'folio':
    case 'numeroTicket':
    case 'referencia':
    case 'codigo':
    case 'transaccion':
      return s(g.folio);
    case 'webId': return s(extra.webId);
    case 'sucursal': return s(extra.estacion);
    case 'fecha': return s(g.fecha);
    case 'monto': return g.monto === null ? null : Number(g.monto).toFixed(2);
    // `caja` y `hora` no se extraen todavía del ticket: se dicen vacías en vez
    // de rellenarse con otra cosa que se le parezca.
    case 'caja':
    case 'hora':
      return null;
    default: return null;
  }
}

interface FilaGasto {
  id: string; concepto: string; monto: number; fecha: string | null;
  folio: string | null; rfc_emisor: string | null; cfdi_uuid: string | null;
  ocr_extra: Record<string, unknown> | null;
  // OPCIONALES porque `armar()` la llaman tres sitios con proyecciones
  // distintas —el cron trae su propia consulta— y un campo obligatorio aquí
  // obligaría a las tres a pedir columnas que no todas necesitan. La ausencia se
  // lee como "no está bloqueado", que es lo que era antes de que existieran.
  autofactura_bloqueada_en?: string | null;
  autofactura_bloqueo?: string | null;
}

/**
 * Los gastos de la flota que todavía no tienen CFDI, con lo que hace falta para
 * conseguirlo.
 *
 * `hoy` se inyecta para que la prueba no dependa del reloj de la máquina — el
 * mismo criterio que `calcularCaducidad`.
 */
export async function getPorFacturar(
  tenantId: string,
  hoy: string = new Date().toISOString().slice(0, 10),
): Promise<TicketPorFacturar[]> {
  // AUDITORÍA 13, MEDIO: `.limit(500)` recortaba en silencio la pantalla "por
  // facturar" y el aviso de WhatsApp (506 tickets → "Tienes 500 comprobantes
  // sin factura"). `traerTodo` pagina hasta probar que trajo TODO y lanza
  // LecturaIncompleta si no puede; el llamador muestra el error en vez de una
  // cifra baja.
  const filas = await traerTodo<FilaGasto>(
    (desde, hasta) => supabaseAdmin()
      .from('gasto')
      .select('id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, ocr_extra, autofactura_bloqueada_en, autofactura_bloqueo', conteo(desde))
      .eq('tenant_id', tenantId)
      .is('cfdi_uuid', null)
      .order('fecha', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(desde, hasta),
    'getPorFacturar',
  );
  return filas.map((g) => armar(g, hoy));
}

export function armar(g: FilaGasto, hoy: string): TicketPorFacturar {
  const extra = (g.ocr_extra ?? {}) as Record<string, unknown>;
  const urlTicket = typeof extra.urlFacturacion === 'string' ? extra.urlFacturacion : null;

  const c: Comercio | null = identificarComercio({
    urlFacturacion: urlTicket ?? undefined,
    rfcEmisor: g.rfc_emisor ?? undefined,
    textoTicket: typeof extra.emisor === 'string' ? extra.emisor : undefined,
  });

  // Sin comercio reconocido NO se inventa un plazo: `calcularCaducidad` con
  // fecha ausente ya devuelve `desconocido`, y aquí se usa el default más
  // conservador solo para poder ordenar la lista por urgencia.
  const caducidad = calcularCaducidad({
    fechaTicket: g.fecha ?? undefined,
    plazo: c?.plazo ?? 'mes_natural',
    hoy,
  });

  const campos: CampoListo[] = (c?.campos ?? []).map((campo) => ({
    clave: campo.clave,
    etiqueta: campo.etiquetaPortal,
    valor: valorDe(campo.clave, g),
    requerido: campo.requerido,
  }));

  return {
    gastoId: g.id,
    concepto: g.concepto,
    monto: Number(g.monto),
    fecha: g.fecha,
    folio: g.folio,
    urlTicket,
    comercio: c ? { clave: c.clave, nombre: c.nombre, portal: c.portal, requiereCuenta: c.requiereCuenta } : null,
    campos,
    camposPendientes: Boolean(c?.camposPendientes),
    plazoVerificado: Boolean(c?.plazoVerificado),
    caducidad,
    // Hacen falta LAS DOS columnas: una marca sin motivo dejaría al encargado
    // con un ticket que "lo tiene que hacer usted" y sin saber por qué. La base
    // lo impide con un check, y aquí se vuelve a exigir para que una proyección
    // que solo pida una de las dos no invente un bloqueo mudo.
    bloqueo: g.autofactura_bloqueada_en && g.autofactura_bloqueo
      ? { motivo: g.autofactura_bloqueo, desde: g.autofactura_bloqueada_en }
      : null,
  };
}

/** Cuántos faltan y cuántos urgen — el resumen que va arriba de la lista. */
export function resumen(lista: TicketPorFacturar[]) {
  return {
    total: lista.length,
    vencidos: lista.filter((t) => t.caducidad.vencido).length,
    urgentes: lista.filter((t) => t.caducidad.urgente && !t.caducidad.vencido).length,
    sinComercio: lista.filter((t) => t.comercio === null).length,
    montoTotal: lista.reduce((s, t) => s + t.monto, 0),
    // Lo que se pierde si nadie los factura: el IVA de lo vencido.
    montoVencido: lista.filter((t) => t.caducidad.vencido).reduce((s, t) => s + t.monto, 0),
  };
}
