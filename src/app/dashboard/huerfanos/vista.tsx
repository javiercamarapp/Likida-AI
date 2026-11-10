import { Inbox } from 'lucide-react';
import type { HuerfanoDeFlota, MotivoHuerfano } from '@/lib/likida/repo';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { FilaAcciones, type AccionHuerfano } from './acciones';
import type { BuscarViaje } from './combo-viaje';
import { EstadoVacio, MarcoPagina, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import './huerfanos.css';

/** Por qué quedó suelto, en palabras de oficina. Un motivo nuevo cae al
 *  crudo en gris — visible, no roto. */
const MOTIVO: Record<MotivoHuerfano, string> = {
  sin_viaje: 'Llegó sin viaje abierto',
  tras_liquidar: 'Llegó después de liquidar',
  fallo_ocr: 'La foto no se pudo leer completa',
};

/**
 * La bandeja de comprobantes sin viaje (F2). Cada fila trae lo que el humano
 * necesita para decidir — fecha del papel, operador, concepto y monto — y
 * las dos salidas reales: adjuntar a un viaje VIVO o descartar. La foto no
 * se enseña (candado del 2-ago); el dato extraído sí.
 */
export function VistaHuerfanos({ pendientes, hayViajesVivos, buscarViaje, totalPendientes, acciones }: {
  pendientes: HuerfanoDeFlota[];
  /** FE-3: ya no se manda la lista completa de viajes vivos — el combo
   *  pregunta al servidor (`buscarViaje`), como en Despacho (FE-2). */
  hayViajesVivos: boolean;
  buscarViaje: BuscarViaje;
  /** FE-13: cuántos comprobantes sueltos hay DE VERDAD (`count exact`), no
   *  cuántos cupieron en la página. `getHuerfanosDeFlota` trae 200 como tope,
   *  y enseñar "200" a secas se lee como el total de la bandeja. `null` = no
   *  se pudo contar, y entonces no se enseña ninguna cifra total. */
  totalPendientes: number | null;
  acciones: { adjuntar: AccionHuerfano; descartar: AccionHuerfano };
}) {
  // El tope real de `getHuerfanosDeFlota`. Si la página viene llena Y el
  // conteo dice que hay más, se declara — "N de M", nunca "M" a secas.
  const hayMas = totalPendientes !== null && totalPendientes > pendientes.length;
  const columnas: ColumnaBase<HuerfanoDeFlota>[] = [
    { id: 'recibido', titulo: 'Recibido', celda: (h) => fechaCorta(h.creadoEn) },
    { id: 'operador', titulo: 'Operador', celda: (h) => h.operadorNombre ?? 'Sin nombre' },
    {
      id: 'comprobante', titulo: 'Comprobante', principal: true,
      celda: (h) => (
        <>
          {etiquetaConcepto(h.concepto)}
          {h.fecha && <span className="rv-hf__tenue">del {fechaCorta(h.fecha)}</span>}
        </>
      ),
    },
    {
      id: 'monto', titulo: 'Monto', alinear: 'der',
      // Un $0.00 aquí sería una cifra que nadie midió (el OCR no pudo leerla) — se dice, no se pinta.
      celda: (h) => (h.monto > 0 ? <span className="rv-hf__mono">{mxn(h.monto)}</span> : <span className="rv-hf__tenue">sin monto legible</span>),
    },
    { id: 'motivo', titulo: 'Por qué está aquí', celda: (h) => MOTIVO[h.motivo] ?? h.motivo },
    {
      id: 'resolver', titulo: 'Resolver', alinear: 'der',
      celda: (h) => (
        <FilaAcciones huerfanoId={h.id} hayViajesVivos={hayViajesVivos}
          sinMonto={h.monto <= 0} buscarViaje={buscarViaje}
          adjuntar={acciones.adjuntar} descartar={acciones.descartar} />
      ),
    },
  ];
  return (
    <MarcoPagina titulo="Comprobantes sin viaje" apoyo="Las fotos y comprobantes que llegaron sin viaje se guardan aquí hasta que alguien los acomode. Nada se rechaza.">
      <Tarjeta
        titulo={pendientes.length > 0
          ? `Esperan que alguien los acomode · ${hayMas ? `${numero(pendientes.length)} de ${numero(totalPendientes!)}` : numero(pendientes.length)}`
          : 'Esperan que alguien los acomode'}
        info="huerfanos.bandeja">
        <p className="rv-hf__nota">
          Una foto nunca se rechaza: lo que llega sin viaje se guarda aquí. Al chofer también
          se le ofrece adjuntarlos por WhatsApp — quien llegue primero.
          {hayMas && ' Se listan los más antiguos primero: resuélvelos y aparecen los siguientes.'}
        </p>
        {pendientes.length === 0 ? (
          <EstadoVacio contenido icono={Inbox} titulo="Sin comprobantes sueltos">
            Todo lo que ha llegado tiene su viaje.
          </EstadoVacio>
        ) : (
          <TablaBase<HuerfanoDeFlota> etiqueta="Mensajes recibidos sin viaje asociado" columnas={columnas} filas={pendientes} idFila={(h) => h.id} tarjetaMovil />
        )}
      </Tarjeta>
    </MarcoPagina>
  );
}
