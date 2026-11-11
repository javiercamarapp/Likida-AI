import Link from 'next/link';
import { fechaHoraMx, numero, usd, usd4 } from '@/lib/formato';
import { MarcoPagina, Tarjeta, TablaBase, StatusChip, type ColumnaBase } from '@/app/ui-v2/componentes';
import { TiraCifras } from '@/app/ui-v2/graficas';
import type { Estado } from '../ui/kit';
import { resumenVeredicto, type CorridaQA, type EstadoCorrida } from '@/lib/admin/qa-tipos';
import { LanzarForm, type FotoConUrl } from './lanzar-form';
import { BancoVerdad, type UltimaLectura } from './banco-verdad';
import './qa.css';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import type { Idioma } from '@/lib/i18n/idioma';

export const pillCorrida = (t: TSistema = T_SISTEMA_ES): Record<EstadoCorrida, { estado: Estado; etiqueta: string }> => ({
  pendiente: { estado: 'neutral', etiqueta: t('trust_safety.pendiente') },
  corriendo: { estado: 'neutral', etiqueta: t('qa_pantalla.corriendo') },
  ok: { estado: 'ok', etiqueta: 'OK' },
  parcial: { estado: 'warn', etiqueta: t('observabilidad.parcial') },
  fallo: { estado: 'bad', etiqueta: t('observabilidad.fallo') },
  abortada: { estado: 'bad', etiqueta: t('qa_pantalla.abortada') },
});
export const PILL_CORRIDA = pillCorrida();

/**
 * LA PANTALLA de /admin/qa (Calidad › Pruebas reales): fotos reales contra el pipeline real. Presentacional a propósito (la página
 * server le pasa los datos ya leídos): así el preview importa el componente REAL. Errores POR FUENTE dichos: jamás un 0 sobre una
 * lectura que falló. El costo es el REAL de `llm_costo`, nunca estimado.
 */
export function PantallaQa({
  fotos, bancoError, corridas, historialError, gastoHoy, gastoError, topeDiaUsd, topeCorridaUsd,
  lecturasIniciales = {}, lecturasError = null, t = T_SISTEMA_ES, idioma,
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
}) {
  const columnas: ColumnaBase<CorridaQA>[] = [
    { id: 'corrida', titulo: t('qa_pantalla.corrida'), principal: true, celda: (c) => <Link href={`/admin/qa/${c.id}`} className="font-mono">{c.id.slice(0, 8)}</Link> },
    { id: 'escenario', titulo: t('qa_pantalla.escenario'), celda: (c) => (c.escenario === 'demo_guion' ? t('qa_pantalla.guion_del_demo') : t('qa_pantalla.feliz')) },
    { id: 'lanzada', titulo: t('qa_pantalla.lanzada'), celda: (c) => fechaHoraMx(c.creadaEn, idioma) },
    {
      id: 'estado', titulo: t('salud_sistema.estado'),
      celda: (c) => { const pill = pillCorrida(t)[c.estado] ?? { estado: 'neutral' as Estado, etiqueta: c.estado }; return <StatusChip tono={pill.estado}>{pill.etiqueta}</StatusChip>; },
    },
    {
      id: 'veredicto', titulo: t('qa_banco_verdad.veredicto'), alinear: 'der',
      celda: (c) => { const res = resumenVeredicto(c.veredicto); return res ? t('qa_pantalla.veredicto_resumen', { ok: res.ok, sin: res.noVerificado, fallo: res.fallo }) : '—'; },
    },
    { id: 'costo', titulo: t('qa_pantalla.costo_real'), alinear: 'der', celda: (c) => usd4(c.costoUsdTotal ?? 0) },
  ];

  return (
    <MarcoPagina
      area="Calidad"
      titulo={t('qa_corrida_viva.calidad')}
      apoyo={t('qa_pantalla.pruebas_reales_fotos_de_comprobantes_procesadas')}
    >
      <TiraCifras
        etiqueta={t('qa_pantalla.pruebas_reales')}
        items={[
          bancoError === null
            ? { etiqueta: t('qa_banco_verdad.fotos_en_el_banco'), valor: fotos.length, formato: 'entero' }
            : { etiqueta: t('qa_banco_verdad.fotos_en_el_banco'), valor: null, estado: 'error', mensaje: t('qa_pantalla.no_se_pudo_leer', { bancoError }) },
          historialError === null
            ? { etiqueta: t('qa_pantalla.corridas_lanzadas'), valor: corridas.length, formato: 'entero' }
            : { etiqueta: t('qa_pantalla.corridas_lanzadas'), valor: null, estado: 'error', mensaje: t('qa_pantalla.no_se_pudo_leer_2', { historialError }) },
          gastoError === null && gastoHoy !== null
            ? { etiqueta: t('qa_pantalla.gasto_real_de_hoy'), valor: usd4(gastoHoy), nota: t('qa_pantalla.de_de_tope_diario_suma_del', { usd: usd(topeDiaUsd) }) }
            : { etiqueta: t('qa_pantalla.gasto_de_hoy'), valor: null, estado: 'error', mensaje: t('qa_pantalla.no_se_pudo_leer_3', { v: gastoError ?? t('qa_pantalla.sin_dato') }) },
        ]}
      />

      {/* ── Lanzar una corrida ─────────────────────────────────────────── */}
      <LanzarForm
        fotosIniciales={fotos}
        bancoError={bancoError}
        gastoHoyUsd={gastoHoy}
        gastoError={gastoError}
        topeDiaUsd={topeDiaUsd}
        topeCorridaUsd={topeCorridaUsd}
      />

      {/* ── El banco de comprobantes reales: la ficha de cada foto y la medición del OCR contra ella ── */}
      <BancoVerdad fotos={fotos} bancoError={bancoError} lecturasIniciales={lecturasIniciales} lecturasError={lecturasError} />

      {/* ── El historial ───────────────────────────────────────────────── */}
      {historialError !== null ? null : (
        <Tarjeta
          titulo={t('qa_pantalla.historial_de_corridas')}
          estado={corridas.length === 0 ? 'vacio' : 'ok'}
          mensaje={t('qa_pantalla.todavia_no_hay_corridas')}
          detalle={t('qa_pantalla.elige_un_escenario_arriba_marca_tus')}
        >
          <TablaBase etiqueta={t('qa_pantalla.historial_de_corridas')} columnas={columnas} filas={corridas} idFila={(c) => c.id} tarjetaMovil />
          <p className="text-xs rv-qa-mut">
            {t(corridas.length === 1 ? 'qa_pantalla.corridas_una' : 'qa_pantalla.corridas_varias', { n: numero(corridas.length, idioma) })}{t('qa_pantalla.las_mas_nuevas_primero_cada_una')}</p>
        </Tarjeta>
      )}
    </MarcoPagina>
  );
}

