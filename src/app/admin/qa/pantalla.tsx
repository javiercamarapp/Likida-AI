import { usdCorto } from './usd-corto';
import { uniformes } from '@/app/admin/cifras-uniformes';
import Link from 'next/link';
import { fechaHoraMx, numero, usd } from '@/lib/formato';
import { Tarjeta, TablaBase, StatusChip, BotonEnlace, type ColumnaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra, CajonVistaRapida } from '@/app/ui-v2/esqueletos';
import { BarraVistas, PanelesVistas, ProveedorVistas, type OpcionVista } from '../aprobaciones/vistas';
import { resumenVeredicto, type CorridaQA, type EstadoCorrida } from '@/lib/admin/qa-tipos';
import { LanzarForm, type FotoConUrl } from './lanzar-form';
import { BancoVerdad, type UltimaLectura } from './banco-verdad';
import './qa.css';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import type { Idioma } from '@/lib/i18n/idioma';

export const pillCorrida = (t: TSistema = T_SISTEMA_ES): Record<EstadoCorrida, { estado: TonoEstado; etiqueta: string }> => ({
  pendiente: { estado: 'neutral', etiqueta: t('trust_safety.pendiente') },
  corriendo: { estado: 'neutral', etiqueta: t('qa_pantalla.corriendo') },
  ok: { estado: 'ok', etiqueta: 'OK' },
  parcial: { estado: 'warn', etiqueta: t('observabilidad.parcial') },
  fallo: { estado: 'bad', etiqueta: t('observabilidad.fallo') },
  abortada: { estado: 'bad', etiqueta: t('qa_pantalla.abortada') },
});
export const PILL_CORRIDA = pillCorrida();

type VistaQa = 'corridas' | 'lanzar' | 'banco';

/**
 * LA PANTALLA de /admin/qa (Calidad › Pruebas reales): fotos reales contra el pipeline real. Presentacional a propósito (la página
 * server le pasa los datos ya leídos): así el preview importa el componente REAL. Errores POR FUENTE dichos: jamás un 0 sobre una
 * lectura que falló. El costo es el REAL de `llm_costo`, nunca estimado.
 */
export function PantallaQa({
  fotos, bancoError, corridas, historialError, gastoHoy, gastoError, topeDiaUsd, topeCorridaUsd,
  lecturasIniciales = {}, lecturasError = null, t = T_SISTEMA_ES, idioma, ver,
}: {
  fotos: FotoConUrl[];
  bancoError: string | null;
  corridas: CorridaQA[];
  historialError: string | null;
  gastoHoy: number | null;
  gastoError: string | null;
  topeDiaUsd: number;
  /** El tope POR corrida ($2, config.qa.ts del ejército). Baja desde el
   *  servidor porque ese módulo trae `node:path` y no puede cruzar a 'use
   *  client'. */
  topeCorridaUsd: number;
  /** La última medición del OCR por foto (mig. 0239). Con default para que el
   *  preview de verificación visual pueda montar la pantalla sin base. */
  lecturasIniciales?: Record<string, UltimaLectura>;
  lecturasError?: string | null; t?: TSistema; idioma?: Idioma;
  /** Id de la corrida abierta en la Vista rápida (`?ver=`). */
  ver?: string;
}) {
  const columnas: ColumnaBase<CorridaQA>[] = [
    { id: 'corrida', titulo: t('qa_pantalla.corrida'), principal: true, celda: (c) => <Link href={`/admin/qa?ver=${c.id}`} scroll={false} className="font-mono">{c.id.slice(0, 8)}</Link> },
    { id: 'escenario', titulo: t('qa_pantalla.escenario'), celda: (c) => (c.escenario === 'demo_guion' ? t('qa_pantalla.guion_del_demo') : t('qa_pantalla.feliz')) },
    { id: 'lanzada', titulo: t('qa_pantalla.lanzada'), celda: (c) => fechaHoraMx(c.creadaEn, idioma) },
    {
      id: 'estado', titulo: t('salud_sistema.estado'),
      celda: (c) => { const pill = pillCorrida(t)[c.estado] ?? { estado: 'neutral' as TonoEstado, etiqueta: c.estado }; return <StatusChip tono={pill.estado}>{pill.etiqueta}</StatusChip>; },
    },
    {
      id: 'veredicto', titulo: t('qa_banco_verdad.veredicto'), alinear: 'der',
      celda: (c) => { const res = resumenVeredicto(c.veredicto); return res ? t('qa_pantalla.veredicto_resumen', { ok: res.ok, sin: res.noVerificado, fallo: res.fallo }) : '—'; },
    },
    { id: 'costo', titulo: t('qa_pantalla.costo_real'), alinear: 'der', celda: (c) => usdCorto(c.costoUsdTotal ?? 0) },
  ];

  const opcionesVistas: readonly OpcionVista<VistaQa>[] = [
    { valor: 'corridas', etiqueta: t('qa_pantalla.vista_corridas'), conteo: historialError === null ? corridas.length : null },
    { valor: 'lanzar', etiqueta: t('qa_pantalla.vista_lanzar') },
    { valor: 'banco', etiqueta: t('qa_pantalla.vista_banco'), conteo: bancoError === null ? fotos.length : null },
  ];
  const posicion = ver ? corridas.findIndex((c) => c.id === ver) : -1;
  const sel = posicion >= 0 ? corridas[posicion] : null;
  const pillSel = sel ? (pillCorrida(t)[sel.estado] ?? { estado: 'neutral' as TonoEstado, etiqueta: sel.estado }) : null;
  const resSel = sel ? resumenVeredicto(sel.veredicto) : null;

  const panelCorridas = historialError !== null ? null : (
    <Tarjeta
      titulo={t('qa_pantalla.historial_de_corridas')}
      estado={corridas.length === 0 ? 'vacio' : 'ok'}
      mensaje={t('qa_pantalla.todavia_no_hay_corridas')}
      detalle={t('qa_pantalla.elige_un_escenario_arriba_marca_tus')}
    >
      <TablaBase etiqueta={t('qa_pantalla.historial_de_corridas')} columnas={columnas} filas={corridas} idFila={(c) => c.id} tarjetaMovil />
      <p className="rv-qa-nota">
        {t(corridas.length === 1 ? 'qa_pantalla.corridas_una' : 'qa_pantalla.corridas_varias', { n: numero(corridas.length, idioma) })}{t('qa_pantalla.las_mas_nuevas_primero_cada_una')}</p>
    </Tarjeta>
  );

  return (
    <ProveedorVistas inicial={sel || historialError === null ? 'corridas' : 'lanzar'}>
    <EsqueletoTablaMaestra
      area="Calidad"
      titulo={t('qa_corrida_viva.calidad')}
      apoyo={t('qa_pantalla.pruebas_reales_fotos_de_comprobantes_procesadas')}
      etiquetaCifras={t('qa_pantalla.pruebas_reales')}
      cifras={uniformes([
          bancoError === null
            ? { etiqueta: t('qa_banco_verdad.fotos_en_el_banco'), valor: fotos.length, formato: 'entero' }
            : { etiqueta: t('qa_banco_verdad.fotos_en_el_banco'), valor: null, estado: 'error', mensaje: t('qa_pantalla.no_se_pudo_leer', { bancoError }) },
          historialError === null
            ? { etiqueta: t('qa_pantalla.corridas_lanzadas'), valor: corridas.length, formato: 'entero' }
            : { etiqueta: t('qa_pantalla.corridas_lanzadas'), valor: null, estado: 'error', mensaje: t('qa_pantalla.no_se_pudo_leer_2', { historialError }) },
          gastoError === null && gastoHoy !== null
            ? { etiqueta: t('qa_pantalla.gasto_real_de_hoy'), valor: usdCorto(gastoHoy), nota: t('qa_pantalla.de_de_tope_diario_suma_del', { usd: usd(topeDiaUsd) }) }
            : { etiqueta: t('qa_pantalla.gasto_de_hoy'), valor: null, estado: 'error', mensaje: t('qa_pantalla.no_se_pudo_leer_3', { v: gastoError ?? t('qa_pantalla.sin_dato') }) },
      ])}
      filtros={<BarraVistas<VistaQa> etiqueta={t('qa_pantalla.vistas')} opciones={opcionesVistas} />}
      vistaRapida={sel && pillSel ? (
        <CajonVistaRapida
          titulo={sel.id.slice(0, 8)} subtitulo={t('qa_pantalla.vr_subtitulo', { n: posicion + 1, total: corridas.length })} hrefCerrar="/admin/qa"
          cifras={[
            { etiqueta: t('salud_sistema.estado'), valor: pillSel.etiqueta },
            { etiqueta: t('qa_pantalla.escenario'), valor: sel.escenario === 'demo_guion' ? t('qa_pantalla.guion_del_demo') : t('qa_pantalla.feliz') },
            { etiqueta: t('qa_banco_verdad.veredicto'), valor: resSel ? t('qa_pantalla.veredicto_resumen', { ok: resSel.ok, sin: resSel.noVerificado, fallo: resSel.fallo }) : '—' },
            { etiqueta: t('qa_pantalla.costo_real'), valor: usdCorto(sel.costoUsdTotal ?? 0) },
          ]}
          pie={<BotonEnlace variante="primary" href={`/admin/qa/${sel.id}`}>{t('qa_pantalla.vr_abrir')}</BotonEnlace>}
        >
          <p className="rv-qa-nota">{t('qa_pantalla.lanzada')}: {fechaHoraMx(sel.creadaEn, idioma)}</p>
        </CajonVistaRapida>
      ) : null}
    >
      <PanelesVistas<VistaQa>
        opciones={opcionesVistas}
        paneles={{
          corridas: panelCorridas ?? <Tarjeta titulo={t('qa_pantalla.historial_de_corridas')} estado="error" mensaje={t('qa_pantalla.no_se_pudo_leer_2', { historialError: historialError ?? '' })} />,
          lanzar: (
            <LanzarForm
              fotosIniciales={fotos}
              bancoError={bancoError}
              gastoHoyUsd={gastoHoy}
              gastoError={gastoError}
              topeDiaUsd={topeDiaUsd}
              topeCorridaUsd={topeCorridaUsd}
            />
          ),
          banco: <BancoVerdad fotos={fotos} bancoError={bancoError} lecturasIniciales={lecturasIniciales} lecturasError={lecturasError} />,
        }}
      />
    </EsqueletoTablaMaestra>
    </ProveedorVistas>
  );
}

