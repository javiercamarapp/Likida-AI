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

import { uniformes } from '@/app/admin/cifras-uniformes';
import { useMemo } from 'react';
import { Aviso, BotonEnlace, Disclosure, Tarjeta, TablaBase, Tooltip, type ColumnaBase } from '@/app/ui-v2/componentes';
import { TiraCifras } from '@/app/ui-v2/graficas';
import '../qa.css';
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

  const columnasFoto: ColumnaBase<MedicionCampo>[] = [
    { id: 'campo', titulo: t('qa_medicion_corrida.campo'), principal: true, celda: (c) => NOMBRE_CLAVE_VERDAD[c.clave as ClaveVerdad] },
    { id: 'esperado', titulo: t('qa_banco_verdad.esperado_la_persona'), celda: (c) => <ValorCampo clave={c.clave} v={c.esperado} vacio="—" /> },
    { id: 'leido', titulo: t('qa_banco_verdad.leido_el_ocr'), celda: (c) => <ValorCampo clave={c.clave} v={c.leido} vacio={t('qa_medicion_corrida.no_leyo_nada')} /> },
    {
      id: 'veredicto', titulo: t('qa_banco_verdad.veredicto'),
      celda: (c) => {
        const texto = c.veredicto === 'ok' ? t('qa_medicion_corrida.acerto_2') : c.veredicto === 'mal' ? (esAlucinacion(c) ? t('qa_medicion_corrida.alucino') : t('qa_medicion_corrida.fallo_2')) : t('qa_medicion_corrida.sin_medir');
        return c.motivo ? <Tooltip texto={c.motivo}>{texto}</Tooltip> : texto;
      },
    },
  ];
  const columnas: ColumnaBase<ResumenPrecisionCorrida['porCampo'][number]>[] = [
    {
      id: 'campo', titulo: t('qa_medicion_corrida.campo'), principal: true,
      celda: (c) => (
        <>
          {NOMBRE_CLAVE_VERDAD[c.clave]}
          {peorCampo !== null && c.clave === peorCampo.clave && <span className="rv-qa-bad rv-qa-etq">{t('qa_medicion_corrida.el_peor')}</span>}
        </>
      ),
    },
    { id: 'ok', titulo: t('qa_medicion_corrida.acerto'), alinear: 'der', celda: (c) => numero(c.ok, idioma) },
    { id: 'mal', titulo: t('qa_medicion_corrida.fallo'), alinear: 'der', celda: (c) => <span className={c.mal > 0 ? 'rv-qa-bad' : undefined}>{numero(c.mal, idioma)}</span> },
    { id: 'no', titulo: t('qa_medicion_corrida.sin_medir'), alinear: 'der', celda: (c) => <span className="rv-qa-mut">{numero(c.noMedidos, idioma)}</span> },
    {
      id: 'exactitud', titulo: t('qa_medicion_corrida.exactitud'), alinear: 'der',
      // null jamás se pinta como 0%: es un campo sin ni una medición.
      celda: (c) => (c.exactitud === null ? <span className="rv-qa-tenue">{t('qa_medicion_corrida.sin_medir')}</span> : porcentaje(c.exactitud * 100, 1, idioma)),
    },
  ];

  return (
    <Tarjeta titulo={t('qa_medicion_corrida.la_precision_del_ocr_medida_contra')}>
      <div className="rv-qa-pila">
        {error !== null && (
          <Aviso tono="error">{t('qa_medicion_corrida.la_medicion_no_se_pudo_leer', { error })}</Aviso>
        )}

        {error === null && medicion === null && (
          <p className="rv-qa-nota">
            {viva
              ? t('qa_medicion_corrida.la_medicion_se_escribe_al_final')
              : t('qa_medicion_corrida.esta_corrida_termino_sin_medicion_escrita')}
          </p>
        )}

        {medicion !== null && (
          <>
            {/* ── Los números de arriba ─────────────────────────────────────── */}
            <TiraCifras
              etiqueta={t('qa_medicion_corrida.la_precision_del_ocr_medida_contra')}
              items={uniformes([
                {
                  etiqueta: t('qa_medicion_corrida.exactitud_global'),
                  valor: medicion.global.exactitud === null ? t('qa_medicion_corrida.sin_medir') : porcentaje(medicion.global.exactitud * 100, 1, idioma),
                  nota: medicion.global.exactitud === null
                    ? t('qa_medicion_corrida.ni_un_campo_medido_no_hay')
                    : t('qa_medicion_corrida.acertados_fallados_sobre', { ok: numero(medicion.global.ok, idioma), mal: numero(medicion.global.mal, idioma), medidos: numero(medicion.global.medidos, idioma) }),
                },
                /* LA PONDERACIÓN DECLARADA, con los dos números a la vista: no
                   fallan igual de caro (un folio mal es un timbrado fallido; una
                   sucursal a medias, una etiqueta), y promediarlos escondería a
                   los dos. La vara por campo es la MISMA de siempre. */
                {
                  etiqueta: t('qa_medicion_corrida.fiscales_descriptivos'),
                  valor: `${medicion.fiscales.exactitud === null ? 's/m' : porcentaje(medicion.fiscales.exactitud * 100, 1, idioma)} · ${medicion.descriptivos.exactitud === null ? 's/m' : porcentaje(medicion.descriptivos.exactitud * 100, 1, idioma)}`,
                  nota: t('qa_medicion_corrida.fiscales_rfc_folio_monto_fecha_medidos', { numero: numero(medicion.fiscales.medidos, idioma), numero2: numero(medicion.descriptivos.medidos, idioma) }),
                },
                {
                  etiqueta: t('qa_medicion_corrida.el_campo_que_peor_se_lee'),
                  valor: peorCampo === null ? t('qa_medicion_corrida.sin_medir') : NOMBRE_CLAVE_VERDAD[peorCampo.clave],
                  nota: peorCampo === null
                    ? t('qa_medicion_corrida.sin_campos_medidos_todavia')
                    : t('qa_medicion_corrida.fallos_de_este_numero_vale_mas', { porcentaje: porcentaje(peorCampo.exactitud! * 100, 1, idioma), numero: numero(peorCampo.mal, idioma), numero2: numero(peorCampo.medidos, idioma) }),
                },
                {
                  etiqueta: t('qa_medicion_corrida.papeles_que_no_son_comprobante'),
                  valor: medicion.negativos.fotos === 0 ? t('qa_medicion_corrida.ninguno_en_la_corrida') : t('qa_medicion_corrida.de_con_alucinacion', { numero: numero(medicion.negativos.conAlucinacion, idioma), numero2: numero(medicion.negativos.fotos, idioma) }),
                  nota: medicion.negativos.fotos === 0
                    ? t('qa_medicion_corrida.esta_corrida_no_trae_casos_negativos')
                    : medicion.negativos.conAlucinacion === 0
                      ? t('qa_medicion_corrida.los_rechazo_todos_el_veredicto_correcto')
                      : t('qa_medicion_corrida.campo_s_inventados_sobre_papeles_sin', { numero: numero(medicion.negativos.camposAlucinados, idioma) }),
                },
                {
                  etiqueta: t('qa_medicion_corrida.fuera_del_denominador'),
                  valor: numero(medicion.global.noMedidos, idioma),
                  nota: t('qa_medicion_corrida.campos_sin_vara_ilegibles_fallo_tecnico'),
                },
              ])}
            />

            {/* ── El desglose por campo ─────────────────────────────────────── */}
            <TablaBase etiqueta={t('qa_medicion_corrida.exactitud_por_campo')} columnas={columnas} filas={medicion.porCampo} idFila={(c) => c.clave} densa altoMaximo={false} />

            {/* ── Por qué salieron campos del denominador ───────────────────── */}
            {medicion.noMedidosPorMotivo.length > 0 && (
              <Disclosure variante="linea" titulo={t('qa_medicion_corrida.los_campos_fuera_del_denominador_por', { numero: numero(medicion.global.noMedidos, idioma) })}>
                <ul className="rv-qa-lista">
                  {medicion.noMedidosPorMotivo.map((m, i) => (
                    <li key={i}>{t('qa_medicion_corrida.campo_2', { numero: numero(m.campos, idioma) })}{m.campos === 1 ? '' : 's'}: {m.motivo}</li>
                  ))}
                </ul>
              </Disclosure>
            )}

            {/* ── Foto por foto: del número al caso concreto ────────────────── */}
            <div>
              <p className="rv-qa-nota">{t('qa_medicion_corrida.las_fotos_medidas_cada_una_con', { numero: numero(medicion.fotos.length, idioma) })}</p>
              <div className="rv-qa-filas rv-qa-sep">
                {medicion.fotos.map((f) => {
                  const url = urlPorFoto.get(f.fotoId) ?? null;
                  const alucino = f.medicion.campos.some(esAlucinacion);
                  return (
                    <Disclosure
                      key={f.fotoId}
                      titulo={<span className="rv-qa-trunca">{f.etiqueta}</span>}
                      resumen={(
                        <span className="rv-qa-resumen">
                          {f.clase === 'no_comprobante' && (
                            <span className={alucino ? 'rv-qa-bad' : 'rv-qa-mut'}>
                              {alucino ? t('qa_medicion_corrida.no_es_comprobante_y_alucino') : t('qa_medicion_corrida.no_es_comprobante_rechazada_correctamente')}
                            </span>
                          )}
                          {rico(t('qa_medicion_corrida.e0_acertados_fallados_sin_medir_e0', { camposOk: f.medicion.camposOk, camposMal: f.medicion.camposMal, camposNoMedidos: f.medicion.camposNoMedidos }), { e0: (c) => <span className="tabular">{c}</span> })}
                        </span>
                      )}
                    >
                      <div className="rv-qa-pila rv-qa-pila--corta">
                        <div className="rv-qa-meta">
                          <span>{t('qa_medicion_corrida.modelo')} <span className="rv-qa-mono">{f.modelo}</span></span>
                          <span>{t('qa_medicion_corrida.costo', { v: usd4(f.costoUsd) })}</span>
                          {url ? (
                            <BotonEnlace href={url} variante="secondary" tamano="sm" target="_blank" rel="noreferrer">{t('qa_medicion_corrida.abrir_la_foto_firma_60_s')}</BotonEnlace>
                          ) : (
                            <span className="rv-qa-tenue">{t('qa_medicion_corrida.foto_sin_firma_ahora_mismo')}</span>
                          )}
                        </div>
                        <TablaBase etiqueta={t('qa_medicion_corrida.campos_medidos_de_la_foto')} columnas={columnasFoto} filas={f.medicion.campos} idFila={(c) => c.clave} densa altoMaximo={false} />
                        {f.motivo && <p className="rv-qa-nota rv-qa-warn">{f.motivo}</p>}
                      </div>
                    </Disclosure>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </Tarjeta>
  );
}

/** Moneda y fecha SOLO por lib/formato.ts. */
function ValorCampo({ clave, v, vacio }: { clave: ClaveVerdad; v: string | number | null; vacio: string }) {
  if (v === null || v === undefined || v === '') {
    return <span className="rv-qa-tenue">{vacio}</span>;
  }
  if (clave === 'monto') return <span className="tabular">{mxn(Number(v))}</span>;
  if (clave === 'fecha') return <span className="whitespace-nowrap">{fechaCorta(String(v))}</span>;
  return <span className="break-all">{String(v)}</span>;
}
