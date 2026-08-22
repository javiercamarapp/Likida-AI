// ═══════════════════════════════════════════════════════════════════════════
// FACTURACIÓN EMITIDA Y PAGOS — la captura que le faltaba al lado del ingreso.
//
// La 0049 creó `factura_emitida`, `factura_viaje` y `pago_recibido` y dejó
// escrito el contrato: "Likida NO timbra (no es PAC), así que este dato
// [`cfdi_uuid`] llega de fuera". Desde entonces las tres tablas tuvieron
// lectores (`facturacion_clientes.ts`, `comercial.ts`, `libro_viaje.ts`) y
// ningún escritor: `/dashboard/facturacion` era un EstadoVacío permanente, no
// por falta de clientes sino porque no había dónde teclear (hallazgo A1,
// auditoría 4). `pago_recibido` ni siquiera aparecía en código ejecutable (A2).
//
// ESTE MÓDULO ES ESA CAPTURA, y respeta el contrato de la 0049:
//
//  · La factura NACE EN BORRADOR si no trae UUID, y EMITIDA si lo trae. El
//    constraint `factura_borrador_sin_uuid` vigila la mitad de esa verdad
//    desde la base; la otra mitad (emitida sin UUID) se rechaza aquí, porque
//    "emitida" significa "el SAT la conoce" y sin UUID nadie puede cruzarla.
//  · EL TOTAL NO SE TECLEA: se calcula subtotal + IVA. El constraint
//    `factura_total_cuadra` lo vigilaría de todas formas, pero pedirle a una
//    persona que teclee tres números que deben cuadrar entre sí es fabricar el
//    descuadre de centavos que el contralor persigue media tarde.
//  · `vence_en` SALE DE `cliente.dias_credito`, nunca de un default. Sin días
//    pactados la factura nace sin vencimiento y la cartera dice "sin
//    condiciones registradas" — ponerle 30 días pintaría de rojo lo que nadie
//    pactó (es el comentario de la propia 0049).
//  · EL SALDO NO SE GUARDA: lo deriva la vista `factura_saldo`. Aquí solo se
//    decide el ESTATUS, y `pagada` se escribe únicamente cuando la suma de
//    pagos cubre el total.
//
// El `tenant_id` viene SIEMPRE por argumento desde la sesión del servidor, y
// toda escritura sobre fila existente se ancla con `.eq('tenant_id', …)` Y
// comprueba filas afectadas — las mismas tres reglas de `clientes.ts`.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { anotarBitacora, type EntidadBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';
import { mxn } from '@/lib/formato';
import { DatoInvalido } from './errores';
import { esUuidValido } from './intake/cfdi';
import { acotada } from './presupuesto';

// ── Validación (pura, sin base) ────────────────────────────────────────────

export interface FacturaCruda {
  clienteId: string;
  /** `YYYY-MM-DD`, como la teclea el `<input type="date">`. */
  fecha: string;
  subtotal: string;
  iva: string;
  folio: string;
  cfdiUuid: string;
  viajeIds: string[];
}

export interface FacturaValida {
  clienteId: string;
  fecha: string;
  subtotal: number;
  iva: number;
  total: number;
  folio: string | null;
  cfdiUuid: string | null;
  estatus: 'borrador' | 'emitida';
  viajeIds: string[];
}

/** `2026-02-30` cumple el regex y no es un día. Mismo criterio que la API v1. */
function fechaValida(t: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return false;
  const [a, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, mes - 1, dia));
  return d.getUTCFullYear() === a && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/**
 * Un monto tecleado, con la misma limpieza que `ingreso_viaje.ts`: coma
 * decimal como se teclea en México, separador de millares pegado de un Excel.
 * MÁS DE DOS DECIMALES SE RECHAZAN en vez de redondearse: `numeric(12,2)`
 * redondearía en silencio y la factura guardada diría otra cifra que la
 * tecleada — el descuadre exacto que esta pantalla existe para evitar.
 */
function montoTecleado(crudo: string, campo: string, opciones: { obligatorio: boolean }): number | null {
  const t = crudo.trim();
  if (t === '') {
    if (opciones.obligatorio) throw new DatoInvalido(`${campo} es obligatorio.`);
    return null;
  }
  const limpio = t.replace(/[$\s]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(limpio)) throw new DatoInvalido(`${campo} tiene que ser un número (sin letras ni signos).`);
  const n = Number(limpio);
  if (!Number.isFinite(n)) throw new DatoInvalido(`${campo} tiene que ser un número.`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw new DatoInvalido(`${campo} no puede traer más de dos decimales: la base guarda centavos y redondear en silencio descuadraría la factura.`);
  }
  if (n > 999_999_999) throw new DatoInvalido(`${campo} no cabe en una factura: revisa si sobra un cero.`);
  return n;
}

export function validarFactura(c: FacturaCruda): FacturaValida {
  if (!esUuidValido(c.clienteId)) {
    throw new DatoInvalido('Elige el cliente de la lista. Si no aparece, dalo de alta primero en Clientes.');
  }
  const fecha = c.fecha.trim();
  if (!fechaValida(fecha)) throw new DatoInvalido('La fecha de la factura tiene que ser un día real (AAAA-MM-DD).');

  const subtotal = montoTecleado(c.subtotal, 'El subtotal', { obligatorio: true }) as number;
  // El IVA vacío NO se inventa: sin teclear no hay factura. Un CFDI real
  // siempre declara su IVA, aunque sea $0 (tasa 0% o exento) — y ese $0
  // tecleado es una medición, no un relleno.
  const iva = montoTecleado(c.iva, 'El IVA', { obligatorio: true }) as number;
  // Redondeo a centavos ANTES de sumar: 0.1 + 0.2 en binario no es 0.30, y el
  // constraint `factura_total_cuadra` tolera un centavo, no una cola binaria.
  const total = Math.round((subtotal + iva) * 100) / 100;

  const folio = c.folio.trim() === '' ? null : c.folio.trim();
  if (folio !== null && folio.length > 40) throw new DatoInvalido('El folio no puede pasar de 40 caracteres.');

  let cfdiUuid: string | null = null;
  if (c.cfdiUuid.trim() !== '') {
    const u = c.cfdiUuid.trim().toLowerCase();
    if (!esUuidValido(u)) {
      throw new DatoInvalido(
        'El folio fiscal (UUID) no tiene la forma de un UUID del SAT (8-4-4-4-12 caracteres hexadecimales). ' +
        'Cópialo del XML o del PDF del CFDI, o déjalo vacío para registrar la factura como borrador.',
      );
    }
    cfdiUuid = u;
  }

  const viajeIds: string[] = [];
  for (const v of c.viajeIds) {
    const id = v.trim();
    if (id === '') continue;
    if (!esUuidValido(id)) throw new DatoInvalido('Uno de los viajes marcados no se reconoce. Recarga la pantalla.');
    if (!viajeIds.includes(id)) viajeIds.push(id);
  }

  return { clienteId: c.clienteId, fecha, subtotal, iva, total, folio, cfdiUuid, estatus: cfdiUuid ? 'emitida' : 'borrador', viajeIds };
}

export interface PagoCrudo {
  facturaId: string;
  fecha: string;
  monto: string;
  metodo: string;
  referencia: string;
}

export interface PagoValido {
  facturaId: string;
  fecha: string;
  monto: number;
  metodo: string | null;
  referencia: string | null;
}

export function validarPago(c: PagoCrudo): PagoValido {
  if (!esUuidValido(c.facturaId)) throw new DatoInvalido('No se reconoce esa factura. Recarga la pantalla.');
  const fecha = c.fecha.trim();
  if (!fechaValida(fecha)) throw new DatoInvalido('La fecha del pago tiene que ser un día real (AAAA-MM-DD).');
  const monto = montoTecleado(c.monto, 'El monto del pago', { obligatorio: true }) as number;
  if (monto <= 0) throw new DatoInvalido('Un pago tiene que ser mayor que cero. Para corregir una factura, cancélala y captúrala de nuevo.');
  const metodo = c.metodo.trim() === '' ? null : c.metodo.trim().slice(0, 40);
  const referencia = c.referencia.trim() === '' ? null : c.referencia.trim();
  if (referencia !== null && referencia.length > 80) throw new DatoInvalido('La referencia no puede pasar de 80 caracteres.');
  return { facturaId: c.facturaId, fecha, monto, metodo, referencia };
}

/**
 * La decisión de dinero de un abono, PURA para que se pueda probar sin base:
 * a qué facturas se les puede abonar, cuánto cabe, y cuándo el abono la salda.
 *
 * `sumarDias` y esto son las dos reglas que el contralor va a cruzar contra su
 * papel; el resto de `registrarPago` es plomería.
 */
export function evaluarAbono(
  f: { estatus: string; total: number; pagado: number },
  monto: number,
): { rechazo: string | null; saldo: number; quedaSaldada: boolean } {
  // El `+ 0` mata el `-0` que deja la resta binaria: un saldo de "-$0.00" en
  // un mensaje es la clase de cifra que hace dudar de todas las demás.
  const saldo = Math.round((f.total - f.pagado) * 100) / 100 + 0;
  if (f.estatus === 'cancelada') {
    return { rechazo: 'Esa factura está cancelada: no se le abonan pagos.', saldo, quedaSaldada: false };
  }
  if (f.estatus === 'borrador') {
    return {
      rechazo: 'Esa factura sigue en borrador. Márcala como emitida (con su UUID) antes de registrarle pagos: un cobro sin CFDI es lo que el contralor no puede cruzar.',
      saldo, quedaSaldada: false,
    };
  }
  if (f.estatus === 'pagada') {
    return { rechazo: 'Esa factura ya está saldada. Si el cliente pagó de más, eso se aclara con él, no capturándolo aquí.', saldo, quedaSaldada: false };
  }
  if (monto > saldo + 0.005) {
    return {
      rechazo:
        `Ese pago (${mxn(monto)}) rebasa el saldo de la factura (${mxn(saldo)}). ` +
        'Revisa el monto; si el cliente de verdad pagó de más, se aclara con una nota de crédito, no capturando de más aquí.',
      saldo, quedaSaldada: false,
    };
  }
  return { rechazo: null, saldo, quedaSaldada: monto >= saldo - 0.005 };
}

// ── Escrituras ─────────────────────────────────────────────────────────────

/** Constancia best-effort, igual que `clientes.ts`: si la bitácora falla, la
 *  escritura YA ocurrió y tirarla dejaría el sistema peor que sin registro. */
async function anotar(
  tenantId: string, accion: string, entidad: EntidadBitacora, entidadId: string,
  detalle: Record<string, unknown>, actor?: { id?: string; email?: string },
): Promise<void> {
  await anotarBitacora(
    { tenantId, actor: actor ?? {}, accion, entidad, entidadId, detalle },
    { evento: 'facturacion.bitacora_no_escribio' },
  );
}

/** Los índices únicos de la 0049, dichos en palabras de quien capturó. */
function traducirChoque(mensaje: string): DatoInvalido | null {
  if (mensaje.includes('factura_cfdi_unico')) {
    return new DatoInvalido('Ese folio fiscal (UUID) ya está registrado en otra factura tuya. El mismo CFDI no se registra dos veces: el saldo del cliente saldría al doble.');
  }
  if (mensaje.includes('factura_folio_unico')) {
    // ── RES-22 (auditoría prod): ESTE ÍNDICE ES MÁS ESTRECHO QUE EL SAT ────
    //
    // `factura_folio_unico` (mig. 0049:69) es `(tenant_id, folio) where folio
    // is not null`: SIN serie y SIN ejercicio. Pero un CFDI se identifica por
    // SERIE + FOLIO, y el folio se reinicia — por serie, y muy comúnmente cada
    // año. O sea que hoy, para una misma flota:
    //
    //   · la factura A-1 de 2025 y la B-1 de 2026 chocan;
    //   · el folio 1 de enero de 2026 choca con el 1 de enero de 2025.
    //
    // En los dos casos son facturas DISTINTAS y legítimas, y la base rechaza
    // la segunda. A una flota al año le pasa una vez; a 50k tickets/mes y con
    // varias flotas capturando su cobranza, deja de ser anecdótico.
    //
    // NO SE ARREGLA AQUÍ, y por eso esto es un comentario y no un cambio de
    // esquema: `factura_emitida` no tiene columna `serie` en ninguna migración
    // (verificado), así que arreglarlo de verdad es esquema + captura + UI, no
    // un índice. LA MIGRACIÓN PROPUESTA, para cuando se decida:
    //
    //   alter table public.factura_emitida add column if not exists serie text;
    //   drop index if exists factura_folio_unico;
    //   create unique index if not exists factura_folio_unico
    //     on public.factura_emitida
    //        (tenant_id, coalesce(serie, ''), folio, extract(year from fecha))
    //     where folio is not null;
    //
    // Se puede aplicar SIN limpiar nada: el índice nuevo AFLOJA el viejo (le
    // agrega dimensiones), así que toda fila que hoy convive lo sigue
    // cumpliendo. Lo que NO se puede hacer sin producto es capturar la serie:
    // mientras `serie` viaje en NULL, `coalesce(serie,'')` deja el
    // comportamiento de hoy salvo por el año, que es la mitad del problema.
    //
    // Mientras tanto, el mensaje dice la verdad sobre el alcance del choque en
    // vez de mandar a buscar una factura que puede no ser la misma.
    return new DatoInvalido('Ya tienes registrada una factura con ese folio. El folio se compara sin serie ni año, así que si ésta es de otra serie o de otro ejercicio, repórtalo: hoy la base no las distingue.');
  }
  return null;
}

/** `fecha` + `dias` en calendario, sin zonas horarias de por medio. Exportada
 *  porque de aquí sale `vence_en`, y un vencimiento corrido un día pinta de
 *  rojo (o de verde) una factura que no lo está. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + dias));
  return f.toISOString().slice(0, 10);
}

/**
 * Registra la factura que la flota emitió (o empezó a emitir) a su cliente.
 *
 * `vence_en` se deriva de `cliente.dias_credito` EN ESTE MOMENTO y queda
 * congelado en la fila: si mañana renegocian los días de crédito, las facturas
 * ya emitidas conservan el vencimiento con el que nacieron, que es como
 * funciona el papel.
 */
export async function crearFactura(
  tenantId: string,
  f: FacturaValida,
  actor?: { id?: string; email?: string },
): Promise<string> {
  // ── El cliente es de esta flota, y de paso sus días de crédito ───────────
  const { data: cli, error: errCli } = await acotada(
    supabaseAdmin().from('cliente').select('id, dias_credito')
      .eq('id', f.clienteId).eq('tenant_id', tenantId).maybeSingle(),
    'crearFactura.cliente',
  );
  if (errCli) throw new Error(`crearFactura: no se pudo leer el cliente: ${errCli.message}`);
  if (!cli) throw new DatoInvalido('Ese cliente no está en tu flota. Recarga la pantalla y vuelve a elegirlo.');
  const diasCredito = (cli as { dias_credito: number | null }).dias_credito;
  const venceEn = diasCredito === null ? null : sumarDias(f.fecha, diasCredito);

  // ── Los viajes amparados son de esta flota ───────────────────────────────
  if (f.viajeIds.length > 0) {
    const { data: viajes, error: errV } = await acotada(
      supabaseAdmin().from('viaje').select('id').eq('tenant_id', tenantId).in('id', f.viajeIds),
      'crearFactura.viajes',
    );
    if (errV) throw new Error(`crearFactura: no se pudieron verificar los viajes: ${errV.message}`);
    const propios = new Set((viajes ?? []).map((v) => String((v as { id: unknown }).id)));
    if (propios.size !== f.viajeIds.length) {
      throw new DatoInvalido('Uno de los viajes marcados ya no está en tu flota. Recarga la pantalla.');
    }
  }

  const { data, error } = await acotada(supabaseAdmin().from('factura_emitida').insert({
    // El tenant viene por argumento desde la sesión, NUNCA del formulario.
    tenant_id: tenantId,
    cliente_id: f.clienteId,
    // La liga fina vive en `factura_viaje`; la columna directa solo se llena
    // cuando la factura ampara EXACTAMENTE un viaje (el caso común y el que
    // `libro_viaje.ts:599` lee directo).
    viaje_id: f.viajeIds.length === 1 ? f.viajeIds[0] : null,
    folio: f.folio,
    cfdi_uuid: f.cfdiUuid,
    fecha: f.fecha,
    subtotal: f.subtotal,
    iva: f.iva,
    total: f.total,
    moneda: 'MXN',
    estatus: f.estatus,
    vence_en: venceEn,
  }).select('id').single(), 'crearFactura');

  if (error) {
    const choque = traducirChoque(error.message);
    if (choque) throw choque;
    throw new Error(`crearFactura: ${error.message}`);
  }
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('crearFactura: el insert no devolvió id');
  const facturaId = String(id);

  // ── Las ligas a los viajes ───────────────────────────────────────────────
  // PostgREST no da transacciones: si las ligas fallan, se intenta deshacer el
  // alta y se reporta el fallo COMPLETO. Una factura sin sus ligas contaría el
  // ingreso sin decir de qué viajes salió — peor que pedir que se recapture.
  if (f.viajeIds.length > 0) {
    const { error: errLigas } = await supabaseAdmin().from('factura_viaje')
      .insert(f.viajeIds.map((v) => ({ factura_id: facturaId, viaje_id: v })));
    if (errLigas) {
      const { error: errDeshacer } = await supabaseAdmin().from('factura_emitida')
        .delete().eq('id', facturaId).eq('tenant_id', tenantId);
      if (errDeshacer) {
        logger.error('facturacion.alta_a_medias', {
          tenantId, facturaId,
          msg: `La factura quedó creada SIN sus ligas a viajes y no se pudo deshacer: ${errDeshacer.message}. Revisar a mano.`,
        });
      }
      throw new Error(`crearFactura: no se pudieron ligar los viajes: ${errLigas.message}`);
    }
  }

  await anotar(tenantId, 'factura.creada', 'factura_emitida', facturaId, {
    clienteId: f.clienteId, fecha: f.fecha, total: f.total, estatus: f.estatus,
    folio: f.folio, cfdiUuid: f.cfdiUuid, viajes: f.viajeIds.length,
  }, actor);
  return facturaId;
}

/**
 * Un borrador se vuelve `emitida` cuando llega el UUID del PAC. Es el único
 * tránsito que esta función hace: anclado al estatus para que marcar dos veces
 * (o marcar una cancelada) toque cero filas y LO DIGA.
 */
export async function marcarEmitida(
  tenantId: string,
  facturaId: string,
  sello: { folio: string; cfdiUuid: string },
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(facturaId)) throw new DatoInvalido('No se reconoce esa factura. Recarga la pantalla.');
  const uuid = sello.cfdiUuid.trim().toLowerCase();
  if (!esUuidValido(uuid)) {
    throw new DatoInvalido('El folio fiscal (UUID) no tiene la forma de un UUID del SAT. Cópialo del XML o del PDF del CFDI.');
  }
  const folio = sello.folio.trim() === '' ? undefined : sello.folio.trim();
  if (folio !== undefined && folio.length > 40) throw new DatoInvalido('El folio no puede pasar de 40 caracteres.');

  const { data, error } = await acotada(supabaseAdmin().from('factura_emitida').update({
    cfdi_uuid: uuid,
    estatus: 'emitida',
    ...(folio !== undefined ? { folio } : {}),
  }).eq('id', facturaId).eq('tenant_id', tenantId).eq('estatus', 'borrador').select('id'), 'marcarEmitida');

  if (error) {
    const choque = traducirChoque(error.message);
    if (choque) throw choque;
    throw new Error(`marcarEmitida: ${error.message}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Esa factura no está en borrador en tu flota: puede que ya esté emitida o cancelada. Recarga la pantalla.');
  }
  await anotar(tenantId, 'factura.emitida', 'factura_emitida', facturaId, { cfdiUuid: uuid, folio: folio ?? null }, actor);
}

/**
 * Registra un abono contra una factura EMITIDA.
 *
 * Un pago sobre un borrador se rechaza: sería dinero cobrado contra un CFDI
 * que el SAT no conoce, y la cartera diría "cobrado" sobre papel inexistente.
 * Un pago que rebasa el saldo también: los pagos parciales son la norma, los
 * sobrepagos son casi siempre un dedazo, y el que no lo es se captura cuando
 * exista la nota de crédito que lo explique.
 */
export async function registrarPago(
  tenantId: string,
  p: PagoValido,
  actor?: { id?: string; email?: string },
): Promise<void> {
  const { data: fac, error: errF } = await acotada(
    supabaseAdmin().from('factura_emitida').select('id, total, estatus')
      .eq('id', p.facturaId).eq('tenant_id', tenantId).maybeSingle(),
    'registrarPago.factura',
  );
  if (errF) throw new Error(`registrarPago: no se pudo leer la factura: ${errF.message}`);
  if (!fac) throw new DatoInvalido('Esa factura no está en tu flota. Recarga la pantalla.');
  const factura = fac as { id: string; total: number; estatus: string };

  // La suma de pagos se lee COMPLETA: una factura no acumula miles de abonos,
  // y el tope de PostgREST (1,000 filas) queda lejísimos de cualquier caso real.
  const { data: pagos, error: errP } = await acotada(
    supabaseAdmin().from('pago_recibido').select('monto')
      .eq('factura_id', p.facturaId).eq('tenant_id', tenantId),
    'registrarPago.pagos',
  );
  if (errP) throw new Error(`registrarPago: no se pudieron leer los pagos previos: ${errP.message}`);
  const pagado = (pagos ?? []).reduce((s, r) => s + Number((r as { monto: unknown }).monto ?? 0), 0);

  const abono = evaluarAbono({ estatus: factura.estatus, total: Number(factura.total), pagado }, p.monto);
  if (abono.rechazo) throw new DatoInvalido(abono.rechazo);

  const { data, error } = await acotada(supabaseAdmin().from('pago_recibido').insert({
    tenant_id: tenantId,
    factura_id: p.facturaId,
    fecha: p.fecha,
    monto: p.monto,
    metodo: p.metodo,
    referencia: p.referencia,
  }).select('id').single(), 'registrarPago');
  if (error) throw new Error(`registrarPago: ${error.message}`);
  const pagoId = (data as { id?: unknown } | null)?.id;
  if (!pagoId) throw new Error('registrarPago: el insert no devolvió id');

  // ── El estatus solo alcanza `pagada` cuando el saldo llegó a cero ────────
  // Si este UPDATE falla, el pago YA quedó registrado y la vista de saldo lo
  // suma igual: se avisa fuerte y no se tira el pago.
  if (abono.quedaSaldada) {
    const { data: filas, error: errE } = await supabaseAdmin().from('factura_emitida')
      .update({ estatus: 'pagada' })
      .eq('id', p.facturaId).eq('tenant_id', tenantId).eq('estatus', 'emitida').select('id');
    if (errE || !Array.isArray(filas) || filas.length === 0) {
      logger.error('facturacion.estatus_pagada_no_escribio', {
        tenantId, facturaId: p.facturaId,
        err: errE?.message ?? 'update tocó 0 filas',
        msg: 'El pago quedó registrado pero la factura no pasó a `pagada`. El saldo derivado sale bien; el estatus hay que corregirlo a mano.',
      });
    }
  }

  await anotar(tenantId, 'pago.registrado', 'pago_recibido', String(pagoId), {
    facturaId: p.facturaId, fecha: p.fecha, monto: p.monto, metodo: p.metodo, referencia: p.referencia,
  }, actor);
}

/**
 * Cancela una factura SIN pagos. Con pagos encima no se cancela desde aquí:
 * ese dinero ya contado tiene que aclararse primero (¿se devuelve? ¿se aplica
 * a otra factura?), y esa decisión no es de un botón.
 */
export async function cancelarFactura(
  tenantId: string,
  facturaId: string,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(facturaId)) throw new DatoInvalido('No se reconoce esa factura. Recarga la pantalla.');

  const { count, error: errP } = await supabaseAdmin().from('pago_recibido')
    .select('id', { count: 'exact', head: true })
    .eq('factura_id', facturaId).eq('tenant_id', tenantId);
  if (errP) throw new Error(`cancelarFactura: no se pudieron contar los pagos: ${errP.message}`);
  if ((count ?? 0) > 0) {
    throw new DatoInvalido('Esa factura tiene pagos registrados. Primero aclara ese dinero (con el cliente y con el SAT); cancelarla de un clic dejaría cobros contra nada.');
  }

  const { data, error } = await acotada(supabaseAdmin().from('factura_emitida')
    .update({ estatus: 'cancelada' })
    .eq('id', facturaId).eq('tenant_id', tenantId).in('estatus', ['borrador', 'emitida'])
    .select('id'), 'cancelarFactura');
  if (error) throw new Error(`cancelarFactura: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Esa factura no se pudo cancelar: puede que ya esté cancelada o no sea de tu flota. Recarga la pantalla.');
  }
  await anotar(tenantId, 'factura.cancelada', 'factura_emitida', facturaId, {}, actor);
}
