'use client';

// ═══════════════════════════════════════════════════════════════════════════
// LA PRECISIÓN DEL OCR DE UNA CORRIDA — la sección que pinta lo que
// `qa_foto_lectura` midió (migs. 0239/0246).
//
// Las cuatro reglas de esta pantalla, en orden de importancia:
//
//  1. UN `null` SE PINTA «sin medir», JAMÁS 0%. `exactitud: null` significa
//     que no hay ni un campo medido — afirmar 0% sería inventar el peor
//     número posible sobre una medición que no existe.
//  2. EL DESGLOSE POR CAMPO VALE MÁS QUE EL GLOBAL: un 90% global esconde un
//     folio que falla una de cada tres veces, y el folio es lo que el portal
//     de facturación exige. El peor campo se marca.
//  3. LOS NEGATIVOS VAN APARTE. Los papeles que NO son comprobante miden lo
//     único que puede hundir el producto — qué inventa el OCR cuando no hay
//     nada que leer — y diluirlos entre 90 fotos los esconde.
//  4. DEL NÚMERO SE LLEGA A LA FOTO. Cada fila se abre a su medición campo
//     por campo y a la foto firmada: un porcentaje sin poder abrir el caso
//     que lo bajó no se puede accionar.
//
// Moneda, número y porcentaje SOLO por lib/formato.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { TituloSeccion } from '../../../dashboard/resumen-visual';
import { mxn, numero, porcentaje, usd4, fechaCorta } from '@/lib/formato';
import { NOMBRE_CLAVE_VERDAD, type ClaveVerdad } from '@/lib/admin/qa-tipos';
import { esAlucinacion, type MedicionCampo, type ResumenPrecisionCorrida } from '@/lib/admin/qa-verdad';
import type { FotoFirmada } from './corrida-viva';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';
import { rico } from '@/lib/i18n/rico';

export function MedicionCorrida({ medicion, error, fotos, viva }: {
  medicion: ResumenPrecisionCorrida | null;
  error: string | null;
  fotos: FotoFirmada[];
  viva: boolean;
}) {
  const { t, idioma } = useT('admin_sistema', admin_sistemaEs);
  const urlPorFoto = useMemo(() => new Map(fotos.map((f) => [f.id, f.url])), [fotos]);

  // El campo que PEOR se lee: la exactitud mínima entre los que sí se
  // midieron. Empates: gana el que más errores absolutos tiene.
  const peorCampo = useMemo(() => {
    if (!medicion) return null;
    const medidos = medicion.porCampo.filter((c) => c.exactitud !== null);
    if (medidos.length === 0) return null;
    return medidos.reduce((peor, c) => {
      if (c.exactitud! < peor.exactitud!) return c;
      if (c.exactitud! === peor.exactitud! && c.mal > peor.mal) return c;
      return peor;
    });
  }, [medicion]);

  return (
    <div className="card p-3">
      <TituloSeccion>{t('qa_medicion_corrida.la_precision_del_ocr_medida_contra')}</TituloSeccion>

      {error !== null && (
        <p className="text-sm mt-2 m-0 rv-qa-bad">{t('qa_medicion_corrida.la_medicion_no_se_pudo_leer', { error })}</p>
      )}

      {error === null && medicion === null && (
        <p className="text-sm mt-2 m-0 rv-qa-mut">
          {viva
            ? t('qa_medicion_corrida.la_medicion_se_escribe_al_final')
            : t('qa_medicion_corrida.esta_corrida_termino_sin_medicion_escrita')}
        </p>
      )}

      {medicion !== null && (
        <div className="mt-2 space-y-3">
          {/* ── Los números de arriba ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <CifraM
              etiqueta={t('qa_medicion_corrida.exactitud_global')}
              valor={medicion.global.exactitud === null ? t('qa_medicion_corrida.sin_medir') : porcentaje(medicion.global.exactitud * 100, 1, idioma)}
              nota={medicion.global.exactitud === null
                ? t('qa_medicion_corrida.ni_un_campo_medido_no_hay')
                : t('qa_medicion_corrida.acertados_fallados_sobre', { ok: numero(medicion.global.ok, idioma), mal: numero(medicion.global.mal, idioma), medidos: numero(medicion.global.medidos, idioma) })}
            />
            {/* LA PONDERACIÓN DECLARADA, con los dos números a la vista: no
                fallan igual de caro (un folio mal es un timbrado fallido; una
                sucursal a medias, una etiqueta), y promediarlos escondería a
                los dos. La vara por campo es la MISMA de siempre. */}
            <CifraM
              etiqueta={t('qa_medicion_corrida.fiscales_descriptivos')}
              valor={`${medicion.fiscales.exactitud === null ? 's/m' : porcentaje(medicion.fiscales.exactitud * 100, 1, idioma)} · ${medicion.descriptivos.exactitud === null ? 's/m' : porcentaje(medicion.descriptivos.exactitud * 100, 1, idioma)}`}
              nota={t('qa_medicion_corrida.fiscales_rfc_folio_monto_fecha_medidos', { numero: numero(medicion.fiscales.medidos, idioma), numero2: numero(medicion.descriptivos.medidos, idioma) })}
            />
            <CifraM
              etiqueta={t('qa_medicion_corrida.el_campo_que_peor_se_lee')}
              valor={peorCampo === null ? t('qa_medicion_corrida.sin_medir') : NOMBRE_CLAVE_VERDAD[peorCampo.clave]}
              nota={peorCampo === null
                ? t('qa_medicion_corrida.sin_campos_medidos_todavia')
                : t('qa_medicion_corrida.fallos_de_este_numero_vale_mas', { porcentaje: porcentaje(peorCampo.exactitud! * 100, 1, idioma), numero: numero(peorCampo.mal, idioma), numero2: numero(peorCampo.medidos, idioma) })}
            />
            <CifraM
              etiqueta={t('qa_medicion_corrida.papeles_que_no_son_comprobante')}
              valor={medicion.negativos.fotos === 0 ? t('qa_medicion_corrida.ninguno_en_la_corrida') : t('qa_medicion_corrida.de_con_alucinacion', { numero: numero(medicion.negativos.conAlucinacion, idioma), numero2: numero(medicion.negativos.fotos, idioma) })}
              nota={medicion.negativos.fotos === 0
                ? t('qa_medicion_corrida.esta_corrida_no_trae_casos_negativos')
                : medicion.negativos.conAlucinacion === 0
                  ? t('qa_medicion_corrida.los_rechazo_todos_el_veredicto_correcto')
                  : t('qa_medicion_corrida.campo_s_inventados_sobre_papeles_sin', { numero: numero(medicion.negativos.camposAlucinados, idioma) })}
            />
            <CifraM
              etiqueta={t('qa_medicion_corrida.fuera_del_denominador')}
              valor={numero(medicion.global.noMedidos, idioma)}
              nota={t('qa_medicion_corrida.campos_sin_vara_ilegibles_fallo_tecnico')}
            />
          </div>

          {/* ── El desglose por campo ─────────────────────────────────────── */}
          <div className="overflow-x-auto">
            <table aria-label={t('qa_medicion_corrida.exactitud_por_campo')} className="w-full text-xs">
              <thead>
                <tr className="text-left rv-qa-mut">
                  <th scope="col" className="py-1 pr-3 font-medium">{t('qa_medicion_corrida.campo')}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t('qa_medicion_corrida.acerto')}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t('qa_medicion_corrida.fallo')}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t('qa_medicion_corrida.sin_medir')}</th>
                  <th scope="col" className="py-1 font-medium">{t('qa_medicion_corrida.exactitud')}</th>
                </tr>
              </thead>
              <tbody>
                {medicion.porCampo.map((c) => {
                  const esPeor = peorCampo !== null && c.clave === peorCampo.clave;
                  return (
                    <tr key={c.clave} className="border-t rv-qa-bl2">
                      <td className="py-1 pr-3 whitespace-nowrap">
                        {NOMBRE_CLAVE_VERDAD[c.clave]}
                        {esPeor && <span className="ml-1.5 text-[10px] font-semibold rv-qa-bad">{t('qa_medicion_corrida.el_peor')}</span>}
                      </td>
                      <td className="py-1 pr-3 tabular">{numero(c.ok, idioma)}</td>
                      <td className={c.mal > 0 ? 'py-1 pr-3 tabular rv-qa-bad' : 'py-1 pr-3 tabular'}>{numero(c.mal, idioma)}</td>
                      <td className="py-1 pr-3 tabular rv-qa-mut">{numero(c.noMedidos, idioma)}</td>
                      <td className="py-1 tabular">
                        {/* null jamás se pinta como 0%: es un campo sin ni una medición. */}
                        {c.exactitud === null
                          ? <span className="rv-qa-faint">{t('qa_medicion_corrida.sin_medir')}</span>
                          : porcentaje(c.exactitud * 100, 1, idioma)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Por qué salieron campos del denominador ───────────────────── */}
          {medicion.noMedidosPorMotivo.length > 0 && (
            <details className="text-xs rv-qa-mut">
              <summary className="cursor-pointer">{t('qa_medicion_corrida.los_campos_fuera_del_denominador_por', { numero: numero(medicion.global.noMedidos, idioma) })}</summary>
              <ul className="mt-1.5 space-y-0.5">
                {medicion.noMedidosPorMotivo.map((m, i) => (
                  <li key={i}>{t('qa_medicion_corrida.campo_2', { numero: numero(m.campos, idioma) })}{m.campos === 1 ? '' : 's'}: {m.motivo}</li>
                ))}
              </ul>
            </details>
          )}

          {/* ── Foto por foto: del número al caso concreto ────────────────── */}
          <div>
            <p className="text-xs mb-1.5 m-0 rv-qa-faint">{t('qa_medicion_corrida.las_fotos_medidas_cada_una_con', { numero: numero(medicion.fotos.length, idioma) })}</p>
            <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
              {medicion.fotos.map((f) => {
                const url = urlPorFoto.get(f.fotoId) ?? null;
                const alucino = f.medicion.campos.some(esAlucinacion);
                return (
                  <details key={f.fotoId} className="rounded-lg hairline rv-qa-fs">
                    <summary className="cursor-pointer flex items-center gap-2 px-2.5 py-1.5 text-xs">
                      <span className="truncate flex-1 min-w-0">{f.etiqueta}</span>
                      {f.clase === 'no_comprobante' && (
                        <span className={alucino ? 'shrink-0 font-medium rv-qa-bad' : 'shrink-0 font-medium rv-qa-mut'}>
                          {alucino ? t('qa_medicion_corrida.no_es_comprobante_y_alucino') : t('qa_medicion_corrida.no_es_comprobante_rechazada_correctamente')}
                        </span>
                      )}{rico(t('qa_medicion_corrida.e0_acertados_fallados_sin_medir_e0', { camposOk: f.medicion.camposOk, camposMal: f.medicion.camposMal, camposNoMedidos: f.medicion.camposNoMedidos }), { e0: (c) => <span className="shrink-0 tabular whitespace-nowrap">{c}</span> })}</summary>
                    <div className="px-2.5 pb-2 pt-1 border-t text-xs space-y-1.5 rv-qa-bl2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rv-qa-mut">
                        <span>{t('qa_medicion_corrida.modelo')} <span className="font-mono">{f.modelo}</span></span>
                        <span>{t('qa_medicion_corrida.costo', { v: usd4(f.costoUsd) })}</span>
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" className="font-medium px-2 py-0.5 rounded-full hairline hover:opacity-70">{t('qa_medicion_corrida.abrir_la_foto_firma_60_s')}</a>
                        ) : (
                          <span className="rv-qa-faint">{t('qa_medicion_corrida.foto_sin_firma_ahora_mismo')}</span>
                        )}
                      </div>
                      <table aria-label={t('qa_medicion_corrida.campos_medidos_de_la_foto')} className="w-full">
                        <tbody>
                          {f.medicion.campos.map((c) => <FilaCampo key={c.clave} c={c} />)}
                        </tbody>
                      </table>
                      {f.motivo && <p className="m-0 rv-qa-warn">{f.motivo}</p>}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CifraM({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota: string }) {
  return (
    <div className="rounded-xl px-3 py-2 min-w-0 rv-qa-caja">
      <div className="text-[11px] rv-qa-mut">{etiqueta}</div>
      <div className="font-display text-[17px] leading-tight font-semibold tabular mt-0.5">{valor}</div>
      <div className="text-[10px] mt-0.5 rv-qa-faint">{nota}</div>
    </div>
  );
}

function FilaCampo({ c }: { c: MedicionCampo }) {
  const { t } = useT('admin_sistema', admin_sistemaEs);
  return (
    <tr className="border-t align-top rv-qa-bl2">
      <td className="py-0.5 pr-2 whitespace-nowrap">{NOMBRE_CLAVE_VERDAD[c.clave as ClaveVerdad]}</td>
      <td className="py-0.5 pr-2"><ValorCampo clave={c.clave} v={c.esperado} vacio="—" /></td>
      <td className="py-0.5 pr-2"><ValorCampo clave={c.clave} v={c.leido} vacio={t('qa_medicion_corrida.no_leyo_nada')} /></td>
      <td className="py-0.5 whitespace-nowrap" title={c.motivo ?? ''}>
        {c.veredicto === 'ok' ? t('qa_medicion_corrida.acerto_2') : c.veredicto === 'mal' ? (esAlucinacion(c) ? t('qa_medicion_corrida.alucino') : t('qa_medicion_corrida.fallo_2')) : t('qa_medicion_corrida.sin_medir')}
      </td>
    </tr>
  );
}

/** Moneda y fecha SOLO por lib/formato.ts. */
function ValorCampo({ clave, v, vacio }: { clave: ClaveVerdad; v: string | number | null; vacio: string }) {
  if (v === null || v === undefined || v === '') {
    return <span className="rv-qa-faint">{vacio}</span>;
  }
  if (clave === 'monto') return <span className="tabular">{mxn(Number(v))}</span>;
  if (clave === 'fecha') return <span className="whitespace-nowrap">{fechaCorta(String(v))}</span>;
  return <span className="break-all">{String(v)}</span>;
}
