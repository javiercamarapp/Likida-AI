import { Inbox } from 'lucide-react';
import type { HuerfanoDeFlota, MotivoHuerfano } from '@/lib/likida/repo';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { FilaAcciones, type AccionHuerfano } from './acciones';
import type { BuscarViaje } from './combo-viaje';
import { EstadoVacio, MarcoPagina, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import './huerfanos.css';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';

/** Por qué quedó suelto, en palabras de oficina. Un motivo nuevo cae al
 *  crudo en gris — visible, no roto. */
const MOTIVO: Record<MotivoHuerfano, 'hf.motivo.sin_viaje' | 'hf.motivo.tras_liquidar' | 'hf.motivo.fallo_ocr'> = {
  sin_viaje: 'hf.motivo.sin_viaje',
  tras_liquidar: 'hf.motivo.tras_liquidar',
  fallo_ocr: 'hf.motivo.fallo_ocr',
};

/**
 * La bandeja de comprobantes sin viaje (F2). Cada fila trae lo que el humano
 * necesita para decidir — fecha del papel, operador, concepto y monto — y
 * las dos salidas reales: adjuntar a un viaje VIVO o descartar. La foto no
 * se enseña (candado del 2-ago); el dato extraído sí.
 */
export function VistaHuerfanos({ tr = TR_OPERACION_ES, pendientes, hayViajesVivos, buscarViaje, totalPendientes, acciones }: { tr?: TrOperacion;
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
  const { t, idioma } = tr;
  // El tope real de `getHuerfanosDeFlota`. Si la página viene llena Y el
  // conteo dice que hay más, se declara — "N de M", nunca "M" a secas.
  const hayMas = totalPendientes !== null && totalPendientes > pendientes.length;
  const columnas: ColumnaBase<HuerfanoDeFlota>[] = [
    { id: 'recibido', titulo: t('hf.col.recibido'), celda: (h) => fechaCorta(h.creadoEn, idioma) },
    { id: 'operador', titulo: t('hf.col.operador'), celda: (h) => h.operadorNombre ?? t('hf.sinnombre') },
    {
      id: 'comprobante', titulo: t('hf.col.comprobante'), principal: true,
      celda: (h) => (
        <>
          {etiquetaConcepto(h.concepto)}
          {h.fecha && <span className="rv-hf__tenue">{t('hf.del')} {fechaCorta(h.fecha, idioma)}</span>}
        </>
      ),
    },
    {
      id: 'monto', titulo: t('hf.col.monto'), alinear: 'der',
      // Un $0.00 aquí sería una cifra que nadie midió (el OCR no pudo leerla) — se dice, no se pinta.
      celda: (h) => (h.monto > 0 ? <span className="rv-hf__mono">{mxn(h.monto, idioma)}</span> : <span className="rv-hf__tenue">{t('hf.sinmonto.celda')}</span>),
    },
    { id: 'motivo', titulo: t('hf.col.motivo'), celda: (h) => (MOTIVO[h.motivo] ? t(MOTIVO[h.motivo]) : h.motivo) },
    {
      id: 'resolver', titulo: t('hf.col.resolver'), alinear: 'der',
      celda: (h) => (
        <FilaAcciones huerfanoId={h.id} hayViajesVivos={hayViajesVivos}
          sinMonto={h.monto <= 0} buscarViaje={buscarViaje}
          adjuntar={acciones.adjuntar} descartar={acciones.descartar} />
      ),
    },
  ];
  return (
    <MarcoPagina titulo={t('hf.titulo')} apoyo={t('hf.apoyo')}>
      <Tarjeta
        titulo={pendientes.length > 0
          ? t('hf.tarjeta.espera.n', { cifra: hayMas ? t('hf.de', { a: numero(pendientes.length, idioma), b: numero(totalPendientes!, idioma) }) : numero(pendientes.length, idioma) })
          : t('hf.tarjeta.espera')}
        info="huerfanos.bandeja">
        <p className="rv-hf__nota">
          {t('hf.nota')}
          {hayMas && t('hf.nota.mas')}
        </p>
        {pendientes.length === 0 ? (
          <EstadoVacio contenido icono={Inbox} titulo={t('hf.vacio.titulo')}>
            {t('hf.vacio')}
          </EstadoVacio>
        ) : (
          <TablaBase<HuerfanoDeFlota> etiqueta={t('hf.tabla.etiqueta')} columnas={columnas} filas={pendientes} idFila={(h) => h.id} tarjetaMovil />
        )}
      </Tarjeta>
    </MarcoPagina>
  );
}
