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

export function MedicionCorrida({ medicion, error, fotos, viva }: {
  medicion: ResumenPrecisionCorrida | null;
  error: string | null;
  fotos: FotoFirmada[];
  viva: boolean;
}) {
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
      <TituloSeccion>La precisión del OCR, medida contra la verdad-de-terreno</TituloSeccion>

      {error !== null && (
        <p className="text-sm mt-2 m-0" style={{ color: 'var(--bad)' }}>
          La medición no se pudo leer: {error} — no es que no exista, es que no se pudo mirar.
        </p>
      )}

      {error === null && medicion === null && (
        <p className="text-sm mt-2 m-0" style={{ color: 'var(--muted)' }}>
          {viva
            ? 'La medición se escribe al final de la corrida (fase de oráculos), foto por foto contra la etiqueta que una persona confirmó.'
            : 'Esta corrida terminó sin medición escrita — corre `npx tsx scripts/qa/medir-corrida.ts <id> --aplicar` si su tenant se conservó: se mide sobre lo persistido, sin gastar modelo.'}
        </p>
      )}

      {medicion !== null && (
        <div className="mt-2 space-y-3">
          {/* ── Los números de arriba ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <CifraM
              etiqueta="Exactitud global"
              valor={medicion.global.exactitud === null ? 'sin medir' : porcentaje(medicion.global.exactitud * 100)}
              nota={medicion.global.exactitud === null
                ? 'ni un campo medido: no hay porcentaje que decir'
                : `✅ ${numero(medicion.global.ok)} · ❌ ${numero(medicion.global.mal)} sobre ${numero(medicion.global.medidos)} campos con vara`}
            />
            {/* LA PONDERACIÓN DECLARADA, con los dos números a la vista: no
                fallan igual de caro (un folio mal es un timbrado fallido; una
                sucursal a medias, una etiqueta), y promediarlos escondería a
                los dos. La vara por campo es la MISMA de siempre. */}
            <CifraM
              etiqueta="Fiscales · Descriptivos"
              valor={`${medicion.fiscales.exactitud === null ? 's/m' : porcentaje(medicion.fiscales.exactitud * 100)} · ${medicion.descriptivos.exactitud === null ? 's/m' : porcentaje(medicion.descriptivos.exactitud * 100)}`}
              nota={`fiscales = rfc, folio, monto, fecha (${numero(medicion.fiscales.medidos)} medidos) — lo que factura · descriptivos = emisor, sucursal, dominio (${numero(medicion.descriptivos.medidos)}) — lo que ubica`}
            />
            <CifraM
              etiqueta="El campo que peor se lee"
              valor={peorCampo === null ? 'sin medir' : NOMBRE_CLAVE_VERDAD[peorCampo.clave]}
              nota={peorCampo === null
                ? 'sin campos medidos todavía'
                : `${porcentaje(peorCampo.exactitud! * 100)} (❌ ${numero(peorCampo.mal)} de ${numero(peorCampo.medidos)}) — este número vale más que el global`}
            />
            <CifraM
              etiqueta="Papeles que NO son comprobante"
              valor={medicion.negativos.fotos === 0 ? 'ninguno en la corrida' : `${numero(medicion.negativos.conAlucinacion)} de ${numero(medicion.negativos.fotos)} con alucinación`}
              nota={medicion.negativos.fotos === 0
                ? 'esta corrida no trae casos negativos'
                : medicion.negativos.conAlucinacion === 0
                  ? 'los rechazó todos — el veredicto correcto: nada inventado entró al sistema'
                  : `${numero(medicion.negativos.camposAlucinados)} campo(s) INVENTADOS sobre papeles sin nada que leer — cada uno sería un gasto fabricado`}
            />
            <CifraM
              etiqueta="Fuera del denominador"
              valor={numero(medicion.global.noMedidos)}
              nota="campos sin vara (ilegibles, fallo técnico, rechazo por diseño) — ni acierto ni error, y abajo dice por qué"
            />
          </div>

          {/* ── El desglose por campo ─────────────────────────────────────── */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ color: 'var(--muted)' }}>
                  <th className="py-1 pr-3 font-medium">Campo</th>
                  <th className="py-1 pr-3 font-medium">✅</th>
                  <th className="py-1 pr-3 font-medium">❌</th>
                  <th className="py-1 pr-3 font-medium">sin medir</th>
                  <th className="py-1 font-medium">Exactitud</th>
                </tr>
              </thead>
              <tbody>
                {medicion.porCampo.map((c) => {
                  const esPeor = peorCampo !== null && c.clave === peorCampo.clave;
                  return (
                    <tr key={c.clave} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                      <td className="py-1 pr-3 whitespace-nowrap">
                        {NOMBRE_CLAVE_VERDAD[c.clave]}
                        {esPeor && <span className="ml-1.5 text-[10px] font-semibold" style={{ color: 'var(--bad)' }}>← el peor</span>}
                      </td>
                      <td className="py-1 pr-3 tabular">{numero(c.ok)}</td>
                      <td className="py-1 pr-3 tabular" style={c.mal > 0 ? { color: 'var(--bad)' } : undefined}>{numero(c.mal)}</td>
                      <td className="py-1 pr-3 tabular" style={{ color: 'var(--muted)' }}>{numero(c.noMedidos)}</td>
                      <td className="py-1 tabular">
                        {/* null jamás se pinta como 0%: es un campo sin ni una medición. */}
                        {c.exactitud === null
                          ? <span style={{ color: 'var(--faint)' }}>sin medir</span>
                          : porcentaje(c.exactitud * 100)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Por qué salieron campos del denominador ───────────────────── */}
          {medicion.noMedidosPorMotivo.length > 0 && (
            <details className="text-xs" style={{ color: 'var(--muted)' }}>
              <summary className="cursor-pointer">
                Los {numero(medicion.global.noMedidos)} campos fuera del denominador, por su razón — un «no medido» sin razón no se puede defender
              </summary>
              <ul className="mt-1.5 space-y-0.5">
                {medicion.noMedidosPorMotivo.map((m, i) => (
                  <li key={i}>· {numero(m.campos)} campo{m.campos === 1 ? '' : 's'}: {m.motivo}</li>
                ))}
              </ul>
            </details>
          )}

          {/* ── Foto por foto: del número al caso concreto ────────────────── */}
          <div>
            <p className="text-xs mb-1.5 m-0" style={{ color: 'var(--faint)' }}>
              Las {numero(medicion.fotos.length)} fotos medidas, cada una con su veredicto campo por campo. Un
              porcentaje sin poder abrir el caso que lo bajó no se puede accionar.
            </p>
            <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
              {medicion.fotos.map((f) => {
                const url = urlPorFoto.get(f.fotoId) ?? null;
                const alucino = f.medicion.campos.some(esAlucinacion);
                return (
                  <details key={f.fotoId} className="rounded-lg hairline" style={{ background: 'var(--surface)' }}>
                    <summary className="cursor-pointer flex items-center gap-2 px-2.5 py-1.5 text-xs">
                      <span className="truncate flex-1 min-w-0">{f.etiqueta}</span>
                      {f.clase === 'no_comprobante' && (
                        <span className="shrink-0 font-medium" style={{ color: alucino ? 'var(--bad)' : 'var(--muted)' }}>
                          {alucino ? 'NO es comprobante y ALUCINÓ' : 'NO es comprobante — rechazada ✅'}
                        </span>
                      )}
                      <span className="shrink-0 tabular whitespace-nowrap">
                        ✅ {f.medicion.camposOk} · ❌ {f.medicion.camposMal} · — {f.medicion.camposNoMedidos}
                      </span>
                    </summary>
                    <div className="px-2.5 pb-2 pt-1 border-t text-xs space-y-1.5" style={{ borderColor: 'var(--line2)' }}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: 'var(--muted)' }}>
                        <span>modelo: <span className="font-mono">{f.modelo}</span></span>
                        <span>costo {usd4(f.costoUsd)}</span>
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" className="font-medium px-2 py-0.5 rounded-full hairline hover:opacity-70">
                            abrir la foto (firma 60 s)
                          </a>
                        ) : (
                          <span style={{ color: 'var(--faint)' }}>foto sin firma ahora mismo</span>
                        )}
                      </div>
                      <table className="w-full">
                        <tbody>
                          {f.medicion.campos.map((c) => <FilaCampo key={c.clave} c={c} />)}
                        </tbody>
                      </table>
                      {f.motivo && <p className="m-0" style={{ color: 'var(--warn)' }}>{f.motivo}</p>}
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
    <div className="rounded-xl px-3 py-2 min-w-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line2)' }}>
      <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{etiqueta}</div>
      <div className="font-display text-[17px] leading-tight font-semibold tabular mt-0.5">{valor}</div>
      <div className="text-[10px] mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</div>
    </div>
  );
}

function FilaCampo({ c }: { c: MedicionCampo }) {
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
      <td className="py-0.5 pr-2 whitespace-nowrap">{NOMBRE_CLAVE_VERDAD[c.clave as ClaveVerdad]}</td>
      <td className="py-0.5 pr-2"><ValorCampo clave={c.clave} v={c.esperado} vacio="—" /></td>
      <td className="py-0.5 pr-2"><ValorCampo clave={c.clave} v={c.leido} vacio="no leyó nada" /></td>
      <td className="py-0.5 whitespace-nowrap" title={c.motivo ?? ''}>
        {c.veredicto === 'ok' ? '✅' : c.veredicto === 'mal' ? (esAlucinacion(c) ? '❌ alucinó' : '❌') : '— sin medir'}
      </td>
    </tr>
  );
}

/** Moneda y fecha SOLO por lib/formato.ts. */
function ValorCampo({ clave, v, vacio }: { clave: ClaveVerdad; v: string | number | null; vacio: string }) {
  if (v === null || v === undefined || v === '') {
    return <span style={{ color: 'var(--faint)' }}>{vacio}</span>;
  }
  if (clave === 'monto') return <span className="tabular">{mxn(Number(v))}</span>;
  if (clave === 'fecha') return <span className="whitespace-nowrap">{fechaCorta(String(v))}</span>;
  return <span className="break-all">{String(v)}</span>;
}
