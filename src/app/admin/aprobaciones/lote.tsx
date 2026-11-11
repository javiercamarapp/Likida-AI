'use client';

import { useActionState } from 'react';
import { Aviso, Boton, CampoTexto, StatusChip, Tarjeta } from '../../ui-v2/componentes';
import { AvisoResultado } from '../../ui-v2/componentes/aviso-resultado';
import { BotonConfirmar } from '../../ui-v2/componentes/confirmar';
import { clasesBoton } from '../../ui-v2/componentes/boton';
import { numero } from '@/lib/formato';
import type { ResumenBandejaCola, ResumenVencidas } from '@/lib/admin/cola-aprobacion';
import '../bandeja.css';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';

export type ResultadoConteo =
  | { error: string; resumen?: undefined; entrada?: undefined }
  | { resumen: ResumenVencidas; entrada: { dias: string; limite: string; tipos: string }; error?: undefined }
  | null;
export type ResultadoVaciado = { ok: string; error?: undefined } | { error: string; ok?: undefined } | null;

/**
 * Vaciar la cola de aprobación por lotes (auditoría admin, P0). Tres pasos que NO se saltan:
 *  1. CONTAR: el dry-run (`contarVencidas`) dice cuántas piezas tocaría y de qué tipos. No escribe nada.
 *  2. CONFIRMAR: el diálogo repite la cifra contada y qué le pasa a cada pieza.
 *  3. EJECUTAR: el servidor vuelve a contar y se niega si la cifra cambió; el lote deja UNA entrada firmada en la bitácora.
 * Lo que se ejecuta son los parámetros CONTADOS (campos ocultos), no lo que haya quedado escrito después en el formulario.
 */
export function LimpiezaLote({ contar, vaciar, bandeja }: {
  contar: (previo: ResultadoConteo, fd: FormData) => Promise<ResultadoConteo>;
  vaciar: (previo: ResultadoVaciado, fd: FormData) => Promise<ResultadoVaciado>;
  /** Estado de la bandeja leído por el servidor; `null` = no se pudo leer. */
  bandeja: ResumenBandejaCola | null;
}) {
  const { t, idioma } = useT('admin_sistema', admin_sistemaEs);
  const [conteo, enviarConteo, contando] = useActionState<ResultadoConteo, FormData>(contar, null);
  const [vaciado, enviarVaciado, vaciando] = useActionState<ResultadoVaciado, FormData>(vaciar, null);
  const r = conteo?.resumen;

  return (
    <Tarjeta titulo={t('aprobaciones_lote.limpiar_piezas_vencidas')}>
      <div className="bj-lote">
        {bandeja === null ? (
          <Aviso tono="warn">{t('aprobaciones_lote.no_se_pudo_leer_el_estado')}</Aviso>
        ) : bandeja.frenaAlRunner ? (
          <Aviso tono="error" titulo={t('aprobaciones_lote.la_bandeja_esta_frenando_a_los')}>{t('aprobaciones_lote.hay_piezas_pendientes', { numero: numero(bandeja.pendientes, idioma) })}{bandeja.diasMasVieja !== null ? t('aprobaciones_lote.y_la_mas_vieja_lleva_dias', { numero: numero(Math.floor(bandeja.diasMasVieja), idioma) }) : ''}{t('aprobaciones_lote.el_runner_no_fabrica_encima_mientras', { numero: numero(bandeja.topeBandeja, idioma), numero2: numero(bandeja.diasVencimiento, idioma) })}</Aviso>
        ) : (
          <p className="bj-nota">{t('aprobaciones_lote.hay_piezas_pendientes_y_la_bandeja', { numero: numero(bandeja.pendientes, idioma) })}</p>
        )}

        <p className="bj-nota">{t('aprobaciones_lote.las_piezas_con_mas_de_n')}</p>

        <form action={enviarConteo} className="bj-lote">
          <div className="bj-lote__campos">
            <CampoTexto etiqueta={t('aprobaciones_lote.dias_sin_atender')} tipo="number" name="dias" min={1} max={365} step={1} defaultValue={30} />
            <CampoTexto etiqueta={t('aprobaciones_lote.piezas_por_lote')} tipo="number" name="limite" min={1} max={200} step={1} defaultValue={50} />
            <CampoTexto etiqueta={t('aprobaciones_lote.solo_estos_tipos_opcional')} name="tipos" placeholder={t('aprobaciones_lote.parte_diario_parte_semanal')} ayuda={t('aprobaciones_lote.vacio_todos_separados_por_coma')} />
          </div>
          <div className="bj-acciones">
            <Boton type="submit" variante="secondary" tamano="sm" disabled={contando}>{contando ? t('aprobaciones_lote.contando') : t('aprobaciones_lote.contar_no_cambia_nada')}</Boton>
          </div>
        </form>

        {conteo?.error && <Aviso tono="error">{conteo.error}</Aviso>}

        {r && (
          <div className="bj-lote">
            {r.vencidas === 0 ? (
              <Aviso tono="ok">{t('aprobaciones_lote.no_hay_piezas_pendientes_con_mas', { numero: numero(r.dias, idioma) })}</Aviso>
            ) : (
              <>
                <ul className="bj-lote__resumen">
                  <li>{t('aprobaciones_lote.con_mas_de_dias_sin_atender', { numero: numero(r.dias, idioma) })}{' '}<strong>{numero(r.vencidas, idioma)}</strong>{' '}{t('aprobaciones_lote.piezas')}</li>
                  <li>{t('aprobaciones_lote.este_lote_tocaria')}{' '}<strong>{numero(r.enElLote, idioma)}</strong>{' '}{t('aprobaciones_lote.tope_por_lote_las_mas_viejas', { numero: numero(r.limite, idioma) })}</li>
                  {r.vencidas > r.enElLote && <li>{t('aprobaciones_lote.quedarian_para_otro_lote', { numero: numero(r.vencidas - r.enElLote, idioma) })}</li>}
                </ul>
                <div className="bj-lote__desglose" aria-label={t('aprobaciones_lote.por_tipo_de_pieza')}>
                  {Object.entries(r.porTipo).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                    <StatusChip key={t} tono="neutral">{t}: {numero(n, idioma)}</StatusChip>
                  ))}
                </div>
                {vaciado?.ok ? null : (
                  <form action={enviarVaciado} className="bj-acciones">
                    <input type="hidden" name="dias" value={conteo.entrada.dias} />
                    <input type="hidden" name="limite" value={conteo.entrada.limite} />
                    <input type="hidden" name="tipos" value={conteo.entrada.tipos} />
                    <input type="hidden" name="esperadas" value={r.enElLote} />
                    <BotonConfirmar
                      etiqueta={vaciando ? t('aprobaciones_lote.archivando') : t('aprobaciones_lote.archivar_piezas', { n: numero(r.enElLote, idioma) })}
                      deshabilitado={vaciando}
                      tono="peligro"
                      titulo={t('aprobaciones_lote.archivar_piezas_vencidas')}
                      etiquetaConfirmar={t('aprobaciones_lote.si_archivar', { numero: numero(r.enElLote, idioma) })}
                      descripcion={t('aprobaciones_lote.se_rechazaran_piezas_pendientes_con_mas', { numero: numero(r.enElLote, idioma), numero2: numero(r.dias, idioma) })
                        + t('aprobaciones_lote.con_el_motivo_archivada_por_vencimiento')
                        + t('aprobaciones_lote.esta_pantalla_no_tiene_boton_para')}
                      className={clasesBoton('danger', 'sm')}
                    />
                  </form>
                )}
              </>
            )}
          </div>
        )}

        <AvisoResultado estado={vaciado} />
      </div>
    </Tarjeta>
  );
}
