'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EL BANCO DE COMPROBANTES REALES — verdad-de-terreno y medición del OCR.
//
// Tres cosas, y las tres existen para que un número que alguien va a citar sea
// defendible:
//
//  1. LISTA EL BANCO ENTERO, con el conteo real a la vista. La rejilla del
//     formulario de lanzar enseña miniaturas para elegir 10; ésta es la otra
//     mitad del trabajo — mirar las 91 fichas. Si la lista es larga se dice
//     con su número, nunca se recorta en silencio.
//
//  2. ENSEÑA LA FICHA DE CADA FOTO tal como la etiquetó una persona, y marca
//     lo ILEGIBLE como ilegible y lo que NO APLICA como no aplica. Los tres
//     estados se ven distintos a propósito: pintar los tres como una celda
//     vacía borraría justo la distinción de la que depende el veredicto («el
//     papel no lo trae» vs «el papel lo trae y no se ve»).
//
//  3. CORRE EL OCR REAL contra lo seleccionado y pinta el resultado campo por
//     campo, con el esperado y el leído lado a lado. El agregado dice «sin
//     medir» cuando no hay ni un campo medido — nunca 0% ni 100% sobre una
//     medición que no existe.
//
// Todo el formato de moneda, fecha y número sale de lib/formato.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Camera, Loader2, ScanLine, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { TituloSeccion } from '../../dashboard/resumen-visual';
import { StatusPill } from '../ui/kit';
import { mxn, numero, porcentaje, usd4, fechaCorta, fechaHoraMx } from '@/lib/formato';
import {
  validarLoteOcr, MAX_FOTOS_OCR, CLAVES_VERDAD, NOMBRE_CLAVE_VERDAD,
  type ClaveVerdad, type VerdadTerreno,
} from '@/lib/admin/qa-tipos';
import { agregar, type Medicion, type MedicionCampo, type RespuestaOcrBanco, type ResultadoFotoOcr } from '@/lib/admin/qa-verdad';
import type { FotoConUrl } from './lanzar-form';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { rico } from '@/lib/i18n/rico';

/** La última lectura de cada foto, ya leída por el servidor. Se tipa aquí con
 *  lo que la pantalla usa y no con la fila entera: el componente es cliente y
 *  no tiene por qué conocer la forma de la tabla. */
export interface UltimaLectura {
  corridaEn: string;
  modelo: string;
  medicion: Medicion;
  costoUsd: number;
  motivo: string | null;
}

export function BancoVerdad({ fotos, bancoError, lecturasIniciales, lecturasError }: {
  fotos: FotoConUrl[];
  bancoError: string | null;
  lecturasIniciales: Record<string, UltimaLectura>;
  lecturasError: string | null;
}) {
  const { t, tp, idioma } = useT('admin_sistema', admin_sistemaEs);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [lecturas, setLecturas] = useState<Record<string, UltimaLectura>>(lecturasIniciales);
  const [corriendo, setCorriendo] = useState(false);
  const [errorCorrida, setErrorCorrida] = useState<string | null>(null);
  const [sinTurno, setSinTurno] = useState<string[]>([]);
  const [avisos, setAvisos] = useState<string[]>([]);

  const etiquetadas = useMemo(() => fotos.filter((f) => f.ocrEsperado !== null), [fotos]);

  // El agregado sale de las lecturas que HAY, no de las fotos que existen. Una
  // foto sin lectura no es un 0% — es una foto sin medir, y el denominador la
  // ignora.
  const resumen = useMemo(
    () => agregar(Object.values(lecturas).map((l) => l.medicion)),
    [lecturas],
  );

  const alternar = (conjunto: Set<string>, id: string) => {
    const s = new Set(conjunto);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  };

  // El motivo del botón deshabilitado sale de la MISMA función que valida el
  // servidor, para que los dos cuenten la misma historia (mismo criterio que
  // `lanzar-form.tsx`).
  const validacion = validarLoteOcr({ fotoIds: [...seleccion] });
  const sinEtiqueta = [...seleccion].filter((id) => fotos.find((f) => f.id === id)?.ocrEsperado == null);
  const motivoBloqueo =
    bancoError !== null ? t('qa_banco_verdad.el_banco_de_fotos_no_se')
    : !validacion.ok ? validacion.error
    : sinEtiqueta.length === seleccion.size ? t('qa_banco_verdad.ninguna_de_las_fotos_elegidas_tiene')
    : null;

  const correrOcr = async () => {
    if (motivoBloqueo || corriendo) return;
    setCorriendo(true);
    setErrorCorrida(null);
    setSinTurno([]);
    setAvisos([]);
    try {
      const res = await fetch('/api/admin/qa/fotos/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fotoIds: [...seleccion] }),
      });
      const cuerpo = await res.json().catch(() => null) as (RespuestaOcrBanco & { error?: string }) | null;
      if (!res.ok || !cuerpo?.resultados) {
        setErrorCorrida(cuerpo?.error ?? t('qa_banco_verdad.la_corrida_del_ocr_fallo_http', { status: res.status }));
        return;
      }
      // Solo las fotos que de verdad se midieron actualizan su ficha. Una
      // `no_medida` o un fallo técnico NO pisan una lectura anterior buena:
      // sería cambiar una medición por la ausencia de una.
      const nuevas: Record<string, UltimaLectura> = {};
      const dichos: string[] = [];
      for (const r of cuerpo.resultados as ResultadoFotoOcr[]) {
        if (r.medicion && r.estado === 'medida') {
          nuevas[r.fotoId] = {
            corridaEn: new Date().toISOString(),
            modelo: r.modelo ?? 'desconocido',
            medicion: r.medicion,
            costoUsd: r.costoUsd,
            motivo: r.motivo,
          };
        }
        if (r.motivo) dichos.push(`${r.etiqueta}: ${r.motivo}`);
      }
      setLecturas((prev) => ({ ...prev, ...nuevas }));
      setSinTurno(cuerpo.sinTurno ?? []);
      setAvisos(dichos);
      // Lo recién medido se abre solo: para eso se apretó el botón.
      setAbiertas((prev) => new Set([...prev, ...Object.keys(nuevas)]));
    } catch (e) {
      setErrorCorrida(e instanceof Error ? e.message : String(e));
    } finally {
      setCorriendo(false);
    }
  };

  if (bancoError !== null) {
    return (
      <div className="card p-4 flex items-start gap-3">
        <AlertTriangle width={15} height={15} strokeWidth={1.75} className="rv-qa-bad" />
        <p className="text-sm m-0">{rico(t('qa_banco_verdad.e0_el_banco_de_comprobantes_no'), { e0: (c) => <span className="font-semibold">{c}</span> })}<span className="block text-xs mt-0.5 font-mono rv-qa-mut">{bancoError}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-3">
      <TituloSeccion>{t('qa_banco_verdad.banco_de_comprobantes_reales_verdad_de')}</TituloSeccion>

      {/* ── Los números de arriba ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Cifra etiqueta={t('qa_banco_verdad.fotos_en_el_banco')} valor={numero(fotos.length, idioma)} nota={t('qa_banco_verdad.listadas_todas_sin_recorte')} />
        <Cifra
          etiqueta={t('qa_banco_verdad.con_verdad_de_terreno')}
          valor={t('qa_banco_verdad.n_de_m', { n: numero(etiquetadas.length, idioma), m: numero(fotos.length, idioma) })}
          nota={etiquetadas.length === fotos.length ? t('qa_banco_verdad.todas_etiquetadas') : t('qa_banco_verdad.sin_etiquetar_no_se_pueden_medir', { numero: numero(fotos.length - etiquetadas.length, idioma) })}
        />
        <Cifra
          etiqueta={t('qa_banco_verdad.campos_medidos')}
          valor={resumen.medidos === 0 ? t('qa_medicion_corrida.sin_medir') : t('qa_banco_verdad.acertados_fallados', { ok: numero(resumen.ok, idioma), mal: numero(resumen.mal, idioma) })}
          nota={resumen.medidos === 0
            ? t('qa_banco_verdad.todavia_no_se_ha_corrido_el')
            : t('qa_banco_verdad.sin_medir_ilegibles_o_fallo_tecnico', { numero: numero(resumen.noMedidos, idioma) })}
        />
        <Cifra
          etiqueta={t('qa_banco_verdad.exactitud_del_ocr')}
          // Jamás 0% ni 100% sobre una medición que no existe.
          valor={resumen.exactitud === null ? t('qa_medicion_corrida.sin_medir') : porcentaje(resumen.exactitud * 100, 1, idioma)}
          nota={resumen.exactitud === null
            ? t('qa_banco_verdad.no_hay_ni_un_campo_medido')
            : t('qa_banco_verdad.sobre_campos_con_valor', { n: numero(resumen.medidos, idioma) })}
        />
      </div>

      {lecturasError !== null && (
        <p className="text-xs m-0 rv-qa-bad">{t('qa_banco_verdad.las_lecturas_guardadas_del_ocr_no', { lecturasError })}</p>
      )}

      {/* ── El botón ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 pb-1">
        <button type="button" onClick={() => void correrOcr()} disabled={Boolean(motivoBloqueo) || corriendo}
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-opacity disabled:opacity-40 rv-qa-marca">
          {corriendo ? <Loader2 width={14} height={14} strokeWidth={1.75} className="animate-spin" /> : <ScanLine width={14} height={14} strokeWidth={1.75} />}
          {corriendo ? t('qa_banco_verdad.corriendo_el_ocr_real') : tp('qa_banco_verdad.correr_el_ocr_contra', seleccion.size)}
        </button>
        <button type="button"
          onClick={() => setSeleccion(new Set(etiquetadas.slice(0, MAX_FOTOS_OCR).map((f) => f.id)))}
          className="text-xs font-medium hover:opacity-70 rv-qa-mut">{t('qa_banco_verdad.elegir_las_primeras_etiquetadas', { maxFotosOcr: MAX_FOTOS_OCR })}</button>
        <button type="button" onClick={() => setSeleccion(new Set())}
          className="text-xs font-medium hover:opacity-70 rv-qa-mut">{t('qa_banco_verdad.limpiar_seleccion')}</button>
        {motivoBloqueo && <span className="text-xs rv-qa-mut">{t('qa_banco_verdad.bloqueado')}{' '}{motivoBloqueo}</span>}
        {errorCorrida && <span className="text-xs font-medium rv-qa-bad">{errorCorrida}</span>}
      </div>

      {/* Lo que no alcanzó turno se DICE por su nombre: el reloj de la
          invocación cortó y esas fotos ni se intentaron. */}
      {sinTurno.length > 0 && (
        <p className="text-xs m-0 rv-qa-warn">
          {tp('qa_banco_verdad.fotos_sin_turno', sinTurno.length, { n: numero(sinTurno.length, idioma) })}{' '}{t('qa_banco_verdad.se_quedaron_sin_turno_el_reloj')}</p>
      )}
      {avisos.length > 0 && (
        <ul className="text-xs space-y-0.5 m-0 rv-qa-mut">
          {avisos.map((a, i) => <li key={i}>· {a}</li>)}
        </ul>
      )}

      {/* ── La lista ───────────────────────────────────────────────────────── */}
      {fotos.length === 0 ? (
        <p className="text-xs m-0 rv-qa-mut">{t('qa_banco_verdad.el_banco_esta_vacio_de_verdad')}</p>
      ) : (
        <>
          <p className="text-xs m-0 rv-qa-mut">
            {tp('qa_banco_verdad.comprobantes', fotos.length, { n: numero(fotos.length, idioma) })}{' '}{t('qa_banco_verdad.en_el_banco_todos_listados_abre')}</p>
          <div className="space-y-1.5 max-h-[36rem] overflow-y-auto pr-1">
            {fotos.map((f) => (
              <FilaFoto
                key={f.id}
                foto={f}
                lectura={lecturas[f.id] ?? null}
                elegida={seleccion.has(f.id)}
                abierta={abiertas.has(f.id)}
                onElegir={() => setSeleccion((p) => alternar(p, f.id))}
                onAbrir={() => setAbiertas((p) => alternar(p, f.id))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Cifra({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota: string }) {
  return (
    <div className="rounded-xl px-3 py-2 min-w-0 rv-qa-caja">
      <div className="text-[11px] rv-qa-ink2">{etiqueta}</div>
      <div className="font-display text-[17px] leading-tight font-semibold tabular mt-0.5">{valor}</div>
      <div className="text-[11px] mt-0.5 rv-qa-mut">{nota}</div>
    </div>
  );
}

function FilaFoto({ foto, lectura, elegida, abierta, onElegir, onAbrir }: {
  foto: FotoConUrl;
  lectura: UltimaLectura | null;
  elegida: boolean;
  abierta: boolean;
  onElegir: () => void;
  onAbrir: () => void;
}) {
  const { t } = useT('admin_sistema', admin_sistemaEs);
  const verdad = foto.ocrEsperado;
  return (
    <div className="rounded-xl hairline overflow-hidden rv-qa-fs">
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <input type="checkbox" checked={elegida} onChange={onElegir} aria-label={`elegir ${foto.etiqueta}`} />
        {foto.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada de 60 s de un bucket privado: next/image no puede optimizarla (expira) y cachearla la rompería
          <img src={foto.url} alt={foto.etiqueta} className="w-10 h-10 rounded object-cover shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded flex items-center justify-center shrink-0 rv-qa-fc">
            <Camera width={15} height={15} strokeWidth={1.75} className="rv-qa-faint" />
          </div>
        )}
        <button type="button" onClick={onAbrir} className="flex-1 min-w-0 text-left inline-flex items-center gap-1.5">
          {abierta ? <ChevronDown width={13} height={13} strokeWidth={1.75} /> : <ChevronRight width={13} height={13} strokeWidth={1.75} />}
          <span className="text-sm truncate">{foto.etiqueta}</span>
        </button>
        {verdad === null ? (
          <StatusPill estado="neutral">{t('qa_banco_verdad.sin_etiquetar')}</StatusPill>
        ) : (
          <span className="text-xs whitespace-nowrap rv-qa-mut">
            {claseEs(t)[verdad.clase]}
          </span>
        )}
        {lectura === null ? (
          <span className="text-xs whitespace-nowrap rv-qa-faint">{t('qa_medicion_corrida.sin_medir')}</span>
        ) : (
          <span className="text-xs whitespace-nowrap tabular">{t('qa_banco_verdad.acertados_fallados_sin_medir', { camposOk: lectura.medicion.camposOk, camposMal: lectura.medicion.camposMal, camposNoMedidos: lectura.medicion.camposNoMedidos })}</span>
        )}
      </div>

      {abierta && (
        <div className="px-2.5 pb-2.5 pt-1 border-t rv-qa-bl2">
          {verdad === null ? (
            <p className="text-xs m-0 rv-qa-mut">{t('qa_banco_verdad.nadie_ha_confirmado_que_dice_este')}</p>
          ) : (
            <Ficha verdad={verdad} lectura={lectura} confirmadoEn={foto.confirmadoEn} />
          )}
        </div>
      )}
    </div>
  );
}

const claseEs = (t: TSistema = T_SISTEMA_ES): Record<VerdadTerreno['clase'], string> => ({
  ticket: t('qa_banco_verdad.ticket'),
  voucher_bancario: t('qa_banco_verdad.voucher_bancario'),
  cfdi_impreso: t('qa_banco_verdad.cfdi_impreso'),
  no_comprobante: t('qa_banco_verdad.no_es_comprobante'),
});

/** La ficha de una foto: qué dice el papel según la persona, y —si ya se
 *  corrió— qué leyó el OCR y cómo salió cada campo. */
function Ficha({ verdad, lectura, confirmadoEn }: {
  verdad: VerdadTerreno;
  lectura: UltimaLectura | null;
  confirmadoEn: string | null;
}) {
  const { t, idioma } = useT('admin_sistema', admin_sistemaEs);
  const porClave = new Map<ClaveVerdad, MedicionCampo>(
    (lectura?.medicion.campos ?? []).map((c) => [c.clave, c]),
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] rv-qa-mut">
        <span>{t('qa_banco_verdad.comercio')}{' '}{verdad.comercioClave === null
            ? <span className="rv-qa-warn">{t('qa_banco_verdad.fuera_del_catalogo_comercios_hallazgo_no')}</span>
            : <span className="font-mono">{verdad.comercioClave}</span>}
        </span>{rico(t('qa_banco_verdad.e0_clase_e0', { claseEs: claseEs(t)[verdad.clase] }), { e0: (c) => <span>{c}</span> })}{confirmadoEn && <span>{t('qa_banco_verdad.etiquetada_el')}{' '}{fechaCorta(confirmadoEn, idioma)}</span>}
        {lectura && <span>{t('qa_banco_verdad.ultimo_ocr', { fechaHoraMx: fechaHoraMx(lectura.corridaEn, idioma), modelo: lectura.modelo })}{' '}{usd4(lectura.costoUsd)}</span>}
      </div>

      <div className="overflow-x-auto">
        <table aria-label={t('qa_banco_verdad.campo_esperado_contra_campo_leido_por')} className="w-full text-xs">
          <thead>
            <tr className="text-left rv-qa-mut">
              <th scope="col" className="py-1 pr-3 font-medium">{t('qa_medicion_corrida.campo')}</th>
              <th scope="col" className="py-1 pr-3 font-medium">{t('qa_banco_verdad.esperado_la_persona')}</th>
              <th scope="col" className="py-1 pr-3 font-medium">{t('qa_banco_verdad.leido_el_ocr')}</th>
              <th scope="col" className="py-1 font-medium">{t('qa_banco_verdad.veredicto')}</th>
            </tr>
          </thead>
          <tbody>
            {CLAVES_VERDAD.map((clave) => {
              const m = porClave.get(clave) ?? null;
              return (
                <tr key={clave} className="border-t align-top rv-qa-bl2">
                  <td className="py-1 pr-3 whitespace-nowrap">{NOMBRE_CLAVE_VERDAD[clave]}</td>
                  <td className="py-1 pr-3"><Esperado verdad={verdad} clave={clave} /></td>
                  <td className="py-1 pr-3">
                    {m === null
                      ? <span className="rv-qa-faint">{t('qa_medicion_corrida.sin_medir')}</span>
                      : <Valor clave={clave} v={m.leido} />}
                  </td>
                  <td className="py-1">
                    {m === null
                      ? <span className="rv-qa-faint">—</span>
                      : <span title={m.motivo ?? ''}>
                          {m.veredicto === 'ok' ? t('qa_medicion_corrida.acerto_2') : m.veredicto === 'mal' ? t('qa_medicion_corrida.fallo_2') : t('qa_banco_verdad.no_medido')}
                        </span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {verdad.notas && (
        <p className="text-[11px] m-0 rv-qa-mut">{t('qa_banco_verdad.notas_de_quien_etiqueto')}{' '}{verdad.notas}</p>
      )}
      {lectura?.motivo && (
        <p className="text-[11px] m-0 rv-qa-warn">{lectura.motivo}</p>
      )}
    </div>
  );
}

/** El valor ESPERADO, con los tres estados bien distintos. Un ilegible pintado
 *  como celda vacía es la mentira que este panel existe para no contar. */
function Esperado({ verdad, clave }: { verdad: VerdadTerreno; clave: ClaveVerdad }) {
  const { t } = useT('admin_sistema', admin_sistemaEs);
  if (verdad.ilegibles.includes(clave)) {
    return <span className="font-medium rv-qa-warn">{t('qa_banco_verdad.ilegible_en_la_foto')}</span>;
  }
  if (verdad.noAplica.includes(clave)) {
    return <span className="rv-qa-faint">{t('qa_banco_verdad.el_papel_no_lo_imprime')}</span>;
  }
  return <Valor clave={clave} v={verdad[clave]} />;
}

/** Moneda y fecha SOLO por lib/formato.ts. */
function Valor({ clave, v }: { clave: ClaveVerdad; v: string | number | null }) {
  const { t, idioma } = useT('admin_sistema', admin_sistemaEs);
  if (v === null || v === undefined || v === '') {
    return <span className="rv-qa-faint">{t('qa_medicion_corrida.no_leyo_nada')}</span>;
  }
  if (clave === 'monto') return <span className="tabular">{mxn(Number(v), idioma)}</span>;
  if (clave === 'fecha') return <span className="whitespace-nowrap">{fechaCorta(String(v), idioma)}</span>;
  return <span className="break-all">{String(v)}</span>;
}
