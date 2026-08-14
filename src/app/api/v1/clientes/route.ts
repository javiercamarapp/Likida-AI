// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/clientes — a quién le factura la flota, cuánto le debe y cuánto de
// eso ya está vencido.
//
// Sale de `getPanelClientes`, el mismo motor que alimenta la pantalla de
// Clientes y tarifas. No se reimplementa la consulta aquí: si el saldo de la
// API y el saldo del panel salieran de dos consultas distintas, el día que una
// cambie el contralor va a ver dos cifras del mismo dinero — y dos cifras del
// mismo dinero se leen como dos cálculos.
//
// ── LOS DOS `null` QUE HAY QUE RESPETAR ──────────────────────────────────
//
//  · `saldoPorCobrar` / `vencido` en `null` = ese cliente NO TIENE FACTURAS
//    REGISTRADAS. No es que deba $0.00. Un cliente que pagó todo y uno al que
//    nunca se le facturó se ven idénticos en cero, y la decisión que se toma
//    con ese número —a quién le hablo hoy— es distinta en cada caso.
//  · `concentracion` en `null` = no hay ingreso capturado contra el cual medir.
//    Un 0% afirmaría que ningún cliente pesa, que es una medición.
//
// ── LO QUE `ingreso` NO ES ───────────────────────────────────────────────
//
// Es la suma de `viaje.ingreso_flete` DE LOS VIAJES QUE LO TIENEN CAPTURADO.
// No es la facturación del cliente ni una estimación de ella. Por eso viaja
// pegado a `viajesSinIngreso`: el tamaño del hueco va junto al número, para que
// nadie construya un reporte sobre una suma a medio capturar sin verlo.
//
// Área `dinero`: aquí sí hay pesos, y el jefe de tráfico no ve finanzas.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { getPanelClientes, type ClienteConMetricas } from '@/lib/likida/clientes';
import { abrir, leerPagina, rebanar, sobre, fallo } from '../_comun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ClienteApi {
  id: string;
  nombre: string;
  rfc: string | null;
  /** Días de crédito pactados. `null` = no hay condiciones pactadas, que no es
   *  lo mismo que "paga de contado". */
  diasCredito: number | null;
  activo: boolean;
  contacto: string | null;
  correo: string | null;
  telefono: string | null;
  viajes: number;
  /** De esos viajes, cuántos NO traen ingreso capturado. El hueco de `ingreso`. */
  viajesSinIngreso: number;
  /** Suma de `viaje.ingreso_flete` capturado. Ver la nota del encabezado. */
  ingreso: number;
  /** `null` = el cliente no tiene facturas registradas. NUNCA 0 por defecto. */
  saldoPorCobrar: number | null;
  /** Del saldo, lo que ya pasó su fecha pactada. `null` por lo mismo. */
  vencido: number | null;
  facturas: number;
  /** Tarifas capturadas para este cliente, vigentes o no. */
  tarifas: number;
}

function aClienteApi(c: ClienteConMetricas): ClienteApi {
  return {
    id: c.id,
    nombre: c.nombre,
    rfc: c.rfc,
    diasCredito: c.diasCredito,
    activo: c.activo,
    contacto: c.contacto,
    correo: c.correo,
    telefono: c.telefono,
    viajes: c.viajes,
    viajesSinIngreso: c.viajesSinIngreso,
    ingreso: c.ingreso,
    saldoPorCobrar: c.saldoPorCobrar,
    vencido: c.vencido,
    facturas: c.facturas,
    tarifas: c.tarifas,
  };
}

export async function GET(req: Request) {
  const acceso = await abrir(req, 'dinero');
  if (!acceso.ok) return acceso.respuesta;

  const pag = leerPagina(req.url);
  if (!pag.ok) return pag.respuesta;

  try {
    // `getPanelClientes` no lleva catch por dentro a propósito: un fallo de
    // lectura sube en vez de devolver "esta flota no tiene clientes". Aquí se
    // convierte en un 500 con código, no en una lista vacía con 200.
    const panel = await getPanelClientes(acceso.tenantId);

    return NextResponse.json({
      ...sobre(rebanar(panel.clientes, pag.pagina).map(aClienteApi), pag.pagina, panel.clientes.length),
      // De la CARTERA ENTERA, no de la página: la concentración de una página
      // no significa nada, y es justo la cifra con la que se decide si la flota
      // depende de un solo cliente.
      resumen: {
        ingresoTotal: panel.ingresoTotal,
        /** % del ingreso que depende del cliente más grande. `null` sin ingreso
         *  capturado — no hay contra qué medir. */
        concentracion: panel.concentracion,
        /** Viajes sin cliente asignado en toda la flota: cuánto del ingreso no
         *  se le puede atribuir a nadie. */
        viajesSinCliente: panel.viajesSinCliente,
        /** Viajes que SÍ traen ingreso capturado — el denominador honesto de
         *  `ingresoTotal`. */
        conIngreso: panel.conIngreso,
        /** Viajes sin ingreso capturado en toda la flota. */
        sinIngresoTotal: panel.sinIngresoTotal,
        tarifasCapturadas: panel.tarifas.length,
        /** El día (America/Mexico_City) contra el que se juzgó la vigencia de
         *  las tarifas y el vencimiento de las facturas. Viaja en la respuesta
         *  para que el integrador no compare contra el reloj de SU servidor. */
        hoy: panel.hoy,
      },
    });
  } catch (e) {
    return fallo('v1.clientes', e, { tenant: acceso.tenantId });
  }
}
