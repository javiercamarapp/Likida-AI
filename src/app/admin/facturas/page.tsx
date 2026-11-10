import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { fechaMx, mxn, numero } from '@/lib/formato';
import { listarFacturasSaas, type FacturaSaasFila } from '@/lib/saas/transferencia';
import { Aviso, BarraFiltros, Disclosure, EstadoError, FiltroFecha, FiltroOpciones, MarcoPagina, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { TiraCifras } from '@/app/ui-v2/graficas';
import { BotonExportarFacturas } from './boton-exportar';
import { leerFiltros, rangoAlReves } from './filtros';
import '../dinero.css';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/facturas — Facturación › Facturas. Las mensualidades que Likida emitió a sus flotas: pendientes, pagadas, fallidas y
// canceladas, con la referencia del pago y su CFDI, y la exportación para el contador. Solo LEE (emitir, marcar pagada y timbrar viven
// en Planes y cobro). Todo sale de las filas de `factura_saas`: lo que la fila no tiene se dice («—», «Sin timbrar»), no se rellena.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuántas filas se pintan. Si la base tiene más, la pantalla lo dice y las cifras no suman un total parcial. */
const FILAS_EN_PANTALLA = 500;

const TONO: Record<string, TonoEstado> = { pagada: 'ok', pendiente: 'warn', fallida: 'bad', cancelada: 'muted' };
const ROTULO: Record<string, string> = { pagada: 'Pagada', pendiente: 'Pendiente', fallida: 'Fallida', cancelada: 'Cancelada' };

function celdaCfdi(f: FacturaSaasFila) {
  if (f.cfdiCanceladoEn) return <StatusChip tono="muted">CFDI cancelado</StatusChip>;
  if (f.cfdiUuid) {
    return (
      <>
        <span title={f.cfdiUuid}>{f.cfdiUuid.slice(0, 8)}…</span>
        {f.cfdiVerificacionUrl ? <> <a href={f.cfdiVerificacionUrl} target="_blank" rel="noopener noreferrer">Verificar en el SAT</a></> : null}
      </>
    );
  }
  if (f.estado === 'pagada') return <StatusChip tono="warn">Sin timbrar</StatusChip>;
  return '—';
}

export default async function FacturasPage({ searchParams }: { searchParams: Promise<{ estado?: string; desde?: string; hasta?: string }> }) {
  // A39-S05-01/S06-01: puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  const filtros = leerFiltros((await searchParams) ?? {});
  const alReves = rangoAlReves(filtros);
  let lectura: Awaited<ReturnType<typeof listarFacturasSaas>> | null = null;
  if (!alReves) {
    try { lectura = await listarFacturasSaas({ ...filtros, limite: FILAS_EN_PANTALLA }); } catch (e) { logger.error('admin.facturas', { err: e instanceof Error ? e.message : String(e) }); }
  }
  const filas = lectura?.filas ?? [];
  const recortada = lectura?.truncado ?? false;
  const nFiltros = Object.keys(filtros).length;

  // Sumas sobre lo cargado: solo valen si la lista está completa. Una cancelada no es dinero facturado.
  const suma = (pred: (f: FacturaSaasFila) => boolean) => filas.filter(pred).reduce((s, f) => s + f.monto, 0);
  const cuenta = (pred: (f: FacturaSaasFila) => boolean) => filas.filter(pred).length;
  const completa = lectura !== null && !recortada;
  const errorCifra = (etiqueta: string) => ({ etiqueta, valor: null, estado: 'error' as const, mensaje: recortada ? 'La lista está recortada: no se suma un total parcial.' : 'No se pudo leer las facturas.', reintentar: true });

  return (
    <MarcoPagina
      titulo="Facturación"
      apoyo="Las mensualidades que Likida emitió a sus flotas, su pago y su CFDI, con exportación para el contador."
      acciones={<BotonExportarFacturas estado={filtros.estado} desde={filtros.desde} hasta={filtros.hasta} deshabilitado={alReves || lectura === null || (completa && filas.length === 0)} />}
    >
      {alReves ? <Aviso tono="warn" titulo="El rango está al revés">La fecha «desde» es posterior a «hasta», así que no puede haber facturas. Corrige las fechas.</Aviso> : null}
      {recortada ? (
        <Aviso tono="warn" titulo={`Se muestran ${numero(filas.length)} de ${numero(lectura!.total)} facturas`}>
          La lista está recortada y las más antiguas no aparecen. Acota con las fechas; la exportación se niega a entregar un archivo parcial.
        </Aviso>
      ) : null}

      <BarraFiltros accion="/admin/facturas" enLinea etiqueta="Filtrar facturas" nActivos={nFiltros} limpiarHref="/admin/facturas">
        <FiltroOpciones
          etiqueta="Estado" nombre="estado" valor={filtros.estado ?? ''}
          opciones={[{ valor: 'pendiente', rotulo: 'Pendiente' }, { valor: 'pagada', rotulo: 'Pagada' }, { valor: 'fallida', rotulo: 'Fallida' }, { valor: 'cancelada', rotulo: 'Cancelada' }]}
        />
        <FiltroFecha nombre="desde" etiqueta="Periodo desde" valor={filtros.desde} />
        <FiltroFecha nombre="hasta" etiqueta="Periodo hasta" valor={filtros.hasta} />
      </BarraFiltros>

      <TiraCifras etiqueta="Facturas de la mensualidad" items={[
        completa
          ? { etiqueta: 'Facturado', valor: suma((f) => f.estado !== 'cancelada'), formato: 'mxn', nota: `${numero(cuenta((f) => f.estado !== 'cancelada'))} facturas, sin contar canceladas.` }
          : errorCifra('Facturado'),
        completa
          ? { etiqueta: 'Cobrado', valor: suma((f) => f.estado === 'pagada'), formato: 'mxn', nota: `${numero(cuenta((f) => f.estado === 'pagada'))} pagadas.`, tono: 'ok' }
          : errorCifra('Cobrado'),
        completa
          ? { etiqueta: 'Por cobrar', valor: suma((f) => f.estado === 'pendiente' || f.estado === 'fallida'), formato: 'mxn', nota: `${numero(cuenta((f) => f.estado === 'pendiente' || f.estado === 'fallida'))} pendientes o fallidas.`, tono: cuenta((f) => f.estado === 'pendiente' || f.estado === 'fallida') > 0 ? 'warn' : undefined }
          : errorCifra('Por cobrar'),
        completa
          ? { etiqueta: 'Pagadas sin CFDI', valor: cuenta((f) => f.estado === 'pagada' && !f.cfdiUuid), nota: 'Cobradas pero sin timbrar: es lo primero que preguntará el contador.', tono: cuenta((f) => f.estado === 'pagada' && !f.cfdiUuid) > 0 ? 'warn' : 'ok' }
          : errorCifra('Pagadas sin CFDI'),
      ]} />

      {lectura === null && !alReves ? (
        <EstadoError reintentar>No se pudieron leer las facturas. Esto NO quiere decir que no haya ninguna: quiere decir que no se sabe.</EstadoError>
      ) : (
        <Tarjeta titulo="Facturas" estado={filas.length === 0 ? 'vacio' : 'ok'} mensaje={nFiltros > 0 ? 'Ninguna factura con ese filtro' : 'Aún no hay facturas'}
          detalle={nFiltros > 0 ? 'Quita el filtro o cambia el rango de fechas.' : 'Aparecen aquí en cuanto se emite la primera mensualidad desde Planes y cobro.'}>
          <TablaBase
            etiqueta="Facturas de la mensualidad" idFila={(f) => f.id} tarjetaMovil densa filas={filas}
            columnas={[
              { id: 'flota', titulo: 'Flota', principal: true, celda: (f) => f.tenantNombre },
              { id: 'periodo', titulo: 'Periodo', celda: (f) => `${f.periodoInicio} a ${f.periodoFin}` },
              { id: 'estado', titulo: 'Estado', celda: (f) => <StatusChip tono={TONO[f.estado] ?? 'neutral'}>{ROTULO[f.estado] ?? f.estado}</StatusChip> },
              {
                id: 'total', titulo: 'Total', alinear: 'der',
                celda: (f) => (
                  <>
                    {mxn(f.monto)}
                    <span className="adm-din-sub">{f.subtotal === null || f.iva === null ? 'sin desglose: no se puede timbrar' : `${mxn(f.subtotal)} + IVA ${mxn(f.iva)}`}</span>
                  </>
                ),
              },
              {
                id: 'pago', titulo: 'Pago',
                celda: (f) => (f.pagadaEn
                  ? <>{fechaMx(f.pagadaEn)}<span className="adm-din-sub">{f.referenciaBanco ? `Ref. ${f.referenciaBanco}` : 'sin referencia del banco'}</span></>
                  : <>—<span className="adm-din-sub">{f.referencia ? `Ref. de pago ${f.referencia}` : ''}</span></>),
              },
              { id: 'cfdi', titulo: 'CFDI', celda: celdaCfdi },
            ]}
          />
        </Tarjeta>
      )}

      <Disclosure titulo="Qué incluye y qué falta" resumen="Exportación y XML o PDF">
        <p className="adm-din-nota">
          El archivo del contador trae una fila por factura con el desglose del IVA, la referencia del banco y el UUID del CFDI; un dato que la factura no tiene sale vacío.
          Cada exportación queda asentada en la bitácora con quién la pidió y con qué filtros. Los archivos XML y PDF de cada CFDI se descargan hoy desde el panel del proveedor de
          timbrado: aquí solo se enseña el UUID y la liga de verificación del SAT. Reenviar o cancelar un CFDI desde esta pantalla todavía no existe.
        </p>
      </Disclosure>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Facturas' };
