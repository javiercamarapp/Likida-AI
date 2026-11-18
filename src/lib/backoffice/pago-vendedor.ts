// PAGO A VENDEDORES: registrar el CFDI de honorarios → autorizar → marcar pagado. Máquina de estados borrador → autorizado → pagado.
// El sistema calcula y REGISTRA lo que un humano decide: NUNCA genera una orden de transferencia ni escribe al vendedor. Sin CFDI de
// honorarios el pago no se autoriza (la figura legal exacta del CFDI está pendiente de abogado). Un saldo negativo se arrastra: jamás se
// pide dinero de vuelta.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { esUuidValido } from '@/lib/likida/intake/cfdi';
import { hoyMx } from '@/lib/formato';
import { aPago, leerMovimientosComision, leerPagosVendedor, listoParaAutorizar, saldoVendedor, type FaltaParaAutorizar, type PagoVendedor, type SaldoVendedor } from './comisiones';
import { esTablaAusente } from './lectura';
import { centavos, errBo, esPeriodoValido, pesos, referenciaValida } from './utiles-c';
import { leerMovimiento } from './tesoreria';

const RE_FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const COL_PAGO = 'id, vendedor_id, periodo, monto_autorizado, cfdi_honorarios_uuid, cfdi_honorarios_recibido_en, estado, autorizado_en, pagado_en, referencia_banco';

/** Clave del diccionario para cada cosa que puede faltar antes de autorizar. */
export const CLAVE_FALTA: Readonly<Record<FaltaParaAutorizar, string>> = {
  cfdi_honorarios: 'vend_pago.err_sin_cfdi',
  saldo_no_positivo: 'vend_pago.err_saldo_no_positivo',
  monto_invalido: 'vend_pago.err_monto',
  monto_excede_saldo: 'vend_pago.err_excede_saldo',
};

/** El saldo del vendedor leído de la base (todo su historial). LANZA si algo no se pudo leer: no se autoriza sobre un saldo parcial. */
export async function leerSaldoDeVendedor(vendedorId: string): Promise<SaldoVendedor> {
  const [movs, pagos] = await Promise.all([leerMovimientosComision(), leerPagosVendedor()]);
  if (movs.estado === 'no_disponible' || pagos.estado === 'no_disponible') throw errBo('comis.err_no_disponible');
  if (movs.estado === 'error') throw new Error(`leerSaldoDeVendedor.movs: ${movs.mensaje}`);
  if (pagos.estado === 'error') throw new Error(`leerSaldoDeVendedor.pagos: ${pagos.mensaje}`);
  return saldoVendedor(
    movs.dato.filter((m) => m.vendedorId === vendedorId),
    pagos.dato.filter((p) => p.vendedorId === vendedorId),
  );
}

async function leerPago(pagoId: string): Promise<PagoVendedor> {
  const { data, error } = await supabaseAdmin().from('bo_pago_vendedor').select(COL_PAGO).eq('id', pagoId).maybeSingle();
  if (error) throw new Error(`leerPago: ${error.message}`);
  if (!data) throw errBo('vend_pago.err_no_existe');
  return aPago(data as Record<string, unknown>);
}

/**
 * Registra el CFDI de honorarios del vendedor para el periodo. Crea (o actualiza, si sigue en borrador) el pago con el saldo POR PAGAR actual.
 * Exige saldo positivo: con saldo negativo o cero no hay nada que pagar y el negativo se arrastra.
 */
export async function registrarCfdiHonorarios(
  p: { vendedorId: string; periodo: string; cfdiUuid: string; recibidoEn: string },
  actorId: string,
): Promise<{ pagoId: string; montoCent: number }> {
  if (!p.vendedorId) throw errBo('vend_pago.err_vendedor');
  if (!esPeriodoValido(p.periodo)) throw errBo('comis.err_periodo');
  const uuid = (p.cfdiUuid ?? '').trim();
  if (!esUuidValido(uuid)) throw errBo('vend_pago.err_uuid');
  if (!RE_FECHA.test(p.recibidoEn ?? '')) throw errBo('vend_pago.err_fecha');
  if (p.recibidoEn > hoyMx()) throw errBo('vend_pago.err_fecha_futura');

  const saldo = await leerSaldoDeVendedor(p.vendedorId);
  if (saldo.porPagarCent <= 0) throw errBo('vend_pago.err_saldo_no_positivo');

  const admin = supabaseAdmin();
  const { data: previo, error: errP } = await admin.from('bo_pago_vendedor').select(COL_PAGO).eq('vendedor_id', p.vendedorId).eq('periodo', p.periodo).maybeSingle();
  if (errP) throw new Error(`registrarCfdiHonorarios.previo: ${errP.message}`);
  if (previo) {
    const pago = aPago(previo as Record<string, unknown>);
    if (pago.estado !== 'borrador') throw errBo('vend_pago.err_ya_autorizado');
    const { data: tocadas, error } = await admin.from('bo_pago_vendedor')
      .update({ cfdi_honorarios_uuid: uuid.toLowerCase(), cfdi_honorarios_recibido_en: p.recibidoEn, monto_autorizado: pesos(saldo.porPagarCent) })
      .eq('id', pago.id).eq('estado', 'borrador').select('id');
    if (error) throw new Error(`registrarCfdiHonorarios.update: ${error.message}`);
    if ((tocadas ?? []).length === 0) throw errBo('vend_pago.err_ya_autorizado');
    return { pagoId: pago.id, montoCent: saldo.porPagarCent };
  }
  const { data, error } = await admin.from('bo_pago_vendedor').insert({
    vendedor_id: p.vendedorId, periodo: p.periodo, monto_autorizado: pesos(saldo.porPagarCent), cfdi_honorarios_uuid: uuid.toLowerCase(),
    cfdi_honorarios_recibido_en: p.recibidoEn, estado: 'borrador', creado_por: actorId,
  }).select('id').single();
  if (error) {
    if (error.code === '23505') throw errBo('vend_pago.err_ya_autorizado');
    throw new Error(`registrarCfdiHonorarios.insert: ${error.message}`);
  }
  return { pagoId: String((data as { id: string }).id), montoCent: saldo.porPagarCent };
}

/**
 * Autoriza un pago. BLOQUEADO sin CFDI de honorarios, sin saldo positivo o con un monto mayor al saldo. `montoPesos` opcional: pagar menos
 * que el saldo es válido; más, no. Compare-and-set sobre el estado.
 */
export async function autorizarPago(pagoId: string, montoPesos: number | null, actorId: string): Promise<{ montoCent: number }> {
  const pago = await leerPago(pagoId);
  if (pago.estado !== 'borrador') throw errBo('vend_pago.err_ya_autorizado');
  const saldo = await leerSaldoDeVendedor(pago.vendedorId);
  const montoCent = montoPesos === null ? pago.montoCent : centavos(montoPesos);
  const v = listoParaAutorizar({ saldoCent: saldo.saldoCent, montoCent, cfdiHonorariosUuid: pago.cfdiUuid });
  if (!v.listo) throw errBo(CLAVE_FALTA[v.falta[0]], { monto: (saldo.saldoCent / 100).toFixed(2) });
  const { data: tocadas, error } = await supabaseAdmin().from('bo_pago_vendedor')
    .update({ estado: 'autorizado', autorizado_por: actorId, autorizado_en: new Date().toISOString(), monto_autorizado: pesos(montoCent) })
    .eq('id', pagoId).eq('estado', 'borrador').select('id');
  if (error) throw new Error(`autorizarPago: ${error.message}`);
  if ((tocadas ?? []).length === 0) throw errBo('vend_pago.err_ya_autorizado');
  return { montoCent };
}

/** Marca un pago autorizado como pagado: exige la referencia bancaria (o un movimiento de tesorería) y la fecha del pago. Solo registra, no paga. */
export async function marcarPagado(
  pagoId: string,
  p: { referenciaBanco?: string | null; pagadoEn: string; tesoreriaMovId?: string | null },
  _actorId: string,
): Promise<void> {
  void _actorId;
  if (!RE_FECHA.test(p.pagadoEn ?? '')) throw errBo('vend_pago.err_fecha');
  if (p.pagadoEn > hoyMx()) throw errBo('vend_pago.err_fecha_futura');
  let referencia = (p.referenciaBanco ?? '').trim();
  const movId = (p.tesoreriaMovId ?? '').trim() || null;
  if (movId) {
    const mov = await leerMovimiento(movId);
    if (mov.estado === 'no_disponible') throw errBo('tesor.err_no_disponible');
    if (mov.estado === 'error') throw new Error(`marcarPagado.mov: ${mov.mensaje}`);
    if (!mov.dato) throw errBo('tesor.err_mov_no_existe');
    const base = `${mov.dato.fecha} · ${mov.dato.cuentaNombre ?? mov.dato.cuentaId.slice(0, 8)} · ${mov.dato.id.slice(0, 8)}`;
    referencia = referencia ? `${referencia} (${base})` : base;
  }
  if (!referenciaValida(referencia)) throw errBo('vend_pago.err_referencia');

  const pago = await leerPago(pagoId);
  if (pago.estado === 'pagado') throw errBo('vend_pago.err_ya_pagado');
  if (pago.estado !== 'autorizado') throw errBo('vend_pago.err_no_autorizado');
  const admin = supabaseAdmin();
  const cambios = { estado: 'pagado', pagado_en: p.pagadoEn, referencia_banco: referencia };
  const actualizar = (c: Record<string, unknown>) => admin.from('bo_pago_vendedor').update(c).eq('id', pagoId).eq('estado', 'autorizado').select('id');
  // El enlace al movimiento de tesorería viaja en la MISMA escritura (un pago pagado ya no se modifica). Si la columna de la 1015 aún no
  // existe, se paga igual sin el enlace: la referencia ya quedó escrita.
  let r = await actualizar(movId ? { ...cambios, tesoreria_mov_id: movId } : cambios);
  if (r.error && movId && esTablaAusente(r.error)) r = await actualizar(cambios);
  if (r.error) throw new Error(`marcarPagado: ${r.error.message}`);
  if ((r.data ?? []).length === 0) throw errBo('vend_pago.err_ya_pagado');
}
