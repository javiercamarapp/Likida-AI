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

const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

export function BancoVerdad({ fotos, bancoError, lecturasIniciales, lecturasError }: {
  fotos: FotoConUrl[];
  bancoError: string | null;
  lecturasIniciales: Record<string, UltimaLectura>;
  lecturasError: string | null;
}) {
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
    bancoError !== null ? 'el banco de fotos no se pudo leer'
    : !validacion.ok ? validacion.error
    : sinEtiqueta.length === seleccion.size ? 'ninguna de las fotos elegidas tiene verdad-de-terreno: no habría contra qué medir'
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
        setErrorCorrida(cuerpo?.error ?? `la corrida del OCR falló (HTTP ${res.status})`);
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
        <AlertTriangle {...ICONO} style={{ color: 'var(--bad)' }} />
        <p className="text-sm m-0">
          <span className="font-semibold">El banco de comprobantes no se pudo leer.</span>
          <span className="block text-xs mt-0.5 font-mono" style={{ color: 'var(--muted)' }}>{bancoError}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-3">
      <TituloSeccion>Banco de comprobantes reales — verdad de terreno y medición del OCR</TituloSeccion>

      {/* ── Los números de arriba ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Cifra etiqueta="Fotos en el banco" valor={numero(fotos.length)} nota="listadas todas, sin recorte" />
        <Cifra
          etiqueta="Con verdad de terreno"
          valor={`${numero(etiquetadas.length)} de ${numero(fotos.length)}`}
          nota={etiquetadas.length === fotos.length ? 'todas etiquetadas' : `${numero(fotos.length - etiquetadas.length)} sin etiquetar: no se pueden medir`}
        />
        <Cifra
          etiqueta="Campos medidos"
          valor={resumen.medidos === 0 ? 'sin medir' : `${numero(resumen.ok)} ✅ · ${numero(resumen.mal)} ❌`}
          nota={resumen.medidos === 0
            ? 'todavía no se ha corrido el OCR contra ninguna foto'
            : `${numero(resumen.noMedidos)} sin medir (ilegibles o fallo técnico) — fuera del denominador`}
        />
        <Cifra
          etiqueta="Exactitud del OCR"
          // Jamás 0% ni 100% sobre una medición que no existe.
          valor={resumen.exactitud === null ? 'sin medir' : porcentaje(resumen.exactitud * 100)}
          nota={resumen.exactitud === null
            ? 'no hay ni un campo medido: no hay porcentaje que decir'
            : `sobre ${numero(resumen.medidos)} campos con valor esperado`}
        />
      </div>

      {lecturasError !== null && (
        <p className="text-xs m-0" style={{ color: 'var(--bad)' }}>
          Las lecturas guardadas del OCR no se pudieron leer, así que arriba falta lo ya medido: {lecturasError}
        </p>
      )}

      {/* ── El botón ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 pb-1">
        <button type="button" onClick={() => void correrOcr()} disabled={Boolean(motivoBloqueo) || corriendo}
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-opacity disabled:opacity-40"
          style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
          {corriendo ? <Loader2 width={14} height={14} strokeWidth={2} className="animate-spin" /> : <ScanLine width={14} height={14} strokeWidth={2} />}
          {corriendo ? 'Corriendo el OCR real…' : `Correr el OCR contra ${seleccion.size} foto${seleccion.size === 1 ? '' : 's'}`}
        </button>
        <button type="button"
          onClick={() => setSeleccion(new Set(etiquetadas.slice(0, MAX_FOTOS_OCR).map((f) => f.id)))}
          className="text-xs font-medium hover:opacity-70" style={{ color: 'var(--muted)' }}>
          elegir las primeras {MAX_FOTOS_OCR} etiquetadas
        </button>
        <button type="button" onClick={() => setSeleccion(new Set())}
          className="text-xs font-medium hover:opacity-70" style={{ color: 'var(--muted)' }}>
          limpiar selección
        </button>
        {motivoBloqueo && <span className="text-xs" style={{ color: 'var(--muted)' }}>⛔ {motivoBloqueo}</span>}
        {errorCorrida && <span className="text-xs font-medium" style={{ color: 'var(--bad)' }}>{errorCorrida}</span>}
      </div>

      {/* Lo que no alcanzó turno se DICE por su nombre: el reloj de la
          invocación cortó y esas fotos ni se intentaron. */}
      {sinTurno.length > 0 && (
        <p className="text-xs m-0" style={{ color: 'var(--warn)' }}>
          ⏱ {numero(sinTurno.length)} foto{sinTurno.length === 1 ? '' : 's'} se quedaron sin turno: el reloj de la
          invocación se agotó antes de llegar a ellas y NO se corrieron. Vuelve a apretar el botón con ellas
          seleccionadas.
        </p>
      )}
      {avisos.length > 0 && (
        <ul className="text-xs space-y-0.5 m-0" style={{ color: 'var(--muted)' }}>
          {avisos.map((a, i) => <li key={i}>· {a}</li>)}
        </ul>
      )}

      {/* ── La lista ───────────────────────────────────────────────────────── */}
      {fotos.length === 0 ? (
        <p className="text-xs m-0" style={{ color: 'var(--muted)' }}>
          El banco está vacío de verdad (el índice se leyó completo): sube comprobantes en el formulario de arriba.
        </p>
      ) : (
        <>
          <p className="text-xs m-0" style={{ color: 'var(--faint)' }}>
            {numero(fotos.length)} comprobante{fotos.length === 1 ? '' : 's'} en el banco, todos listados. Abre uno para
            ver su ficha y su última medición.
          </p>
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
    <div className="rounded-xl px-3 py-2 min-w-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line2)' }}>
      <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{etiqueta}</div>
      <div className="font-display text-[17px] leading-tight font-semibold tabular mt-0.5">{valor}</div>
      <div className="text-[10px] mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</div>
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
  const verdad = foto.ocrEsperado;
  return (
    <div className="rounded-xl hairline overflow-hidden" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <input type="checkbox" checked={elegida} onChange={onElegir} aria-label={`elegir ${foto.etiqueta}`} />
        {foto.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada de 60 s de un bucket privado: next/image no puede optimizarla (expira) y cachearla la rompería
          <img src={foto.url} alt={foto.etiqueta} className="w-10 h-10 rounded object-cover shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)' }}>
            <Camera {...ICONO} style={{ color: 'var(--faint)' }} />
          </div>
        )}
        <button type="button" onClick={onAbrir} className="flex-1 min-w-0 text-left inline-flex items-center gap-1.5">
          {abierta ? <ChevronDown width={13} height={13} strokeWidth={1.75} /> : <ChevronRight width={13} height={13} strokeWidth={1.75} />}
          <span className="text-sm truncate">{foto.etiqueta}</span>
        </button>
        {verdad === null ? (
          <StatusPill estado="neutral">Sin etiquetar</StatusPill>
        ) : (
          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
            {CLASE_ES[verdad.clase]}
          </span>
        )}
        {lectura === null ? (
          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--faint)' }}>sin medir</span>
        ) : (
          <span className="text-xs whitespace-nowrap tabular">
            ✅ {lectura.medicion.camposOk} · ❌ {lectura.medicion.camposMal} · — {lectura.medicion.camposNoMedidos}
          </span>
        )}
      </div>

      {abierta && (
        <div className="px-2.5 pb-2.5 pt-1 border-t" style={{ borderColor: 'var(--line2)' }}>
          {verdad === null ? (
            <p className="text-xs m-0" style={{ color: 'var(--muted)' }}>
              Nadie ha confirmado qué dice este comprobante, así que no hay vara contra la que medir el OCR. Una foto
              sin verdad de terreno NO cuenta como acierto ni como error: queda fuera de la medición.
            </p>
          ) : (
            <Ficha verdad={verdad} lectura={lectura} confirmadoEn={foto.confirmadoEn} />
          )}
        </div>
      )}
    </div>
  );
}

const CLASE_ES: Record<VerdadTerreno['clase'], string> = {
  ticket: 'Ticket',
  voucher_bancario: 'Voucher bancario',
  cfdi_impreso: 'CFDI impreso',
  no_comprobante: 'No es comprobante',
};

/** La ficha de una foto: qué dice el papel según la persona, y —si ya se
 *  corrió— qué leyó el OCR y cómo salió cada campo. */
function Ficha({ verdad, lectura, confirmadoEn }: {
  verdad: VerdadTerreno;
  lectura: UltimaLectura | null;
  confirmadoEn: string | null;
}) {
  const porClave = new Map<ClaveVerdad, MedicionCampo>(
    (lectura?.medicion.campos ?? []).map((c) => [c.clave, c]),
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: 'var(--muted)' }}>
        <span>
          Comercio:{' '}
          {verdad.comercioClave === null
            ? <span style={{ color: 'var(--warn)' }}>fuera del catálogo COMERCIOS (hallazgo, no hueco)</span>
            : <span className="font-mono">{verdad.comercioClave}</span>}
        </span>
        <span>Clase: {CLASE_ES[verdad.clase]}</span>
        {confirmadoEn && <span>Etiquetada el {fechaCorta(confirmadoEn)}</span>}
        {lectura && <span>Último OCR: {fechaHoraMx(lectura.corridaEn)} · {lectura.modelo} · {usd4(lectura.costoUsd)}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left" style={{ color: 'var(--muted)' }}>
              <th className="py-1 pr-3 font-medium">Campo</th>
              <th className="py-1 pr-3 font-medium">Esperado (la persona)</th>
              <th className="py-1 pr-3 font-medium">Leído (el OCR)</th>
              <th className="py-1 font-medium">Veredicto</th>
            </tr>
          </thead>
          <tbody>
            {CLAVES_VERDAD.map((clave) => {
              const m = porClave.get(clave) ?? null;
              return (
                <tr key={clave} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                  <td className="py-1 pr-3 whitespace-nowrap">{NOMBRE_CLAVE_VERDAD[clave]}</td>
                  <td className="py-1 pr-3"><Esperado verdad={verdad} clave={clave} /></td>
                  <td className="py-1 pr-3">
                    {m === null
                      ? <span style={{ color: 'var(--faint)' }}>sin medir</span>
                      : <Valor clave={clave} v={m.leido} />}
                  </td>
                  <td className="py-1">
                    {m === null
                      ? <span style={{ color: 'var(--faint)' }}>—</span>
                      : <span title={m.motivo ?? ''}>
                          {m.veredicto === 'ok' ? '✅ acertó' : m.veredicto === 'mal' ? '❌ falló' : '— no medido'}
                        </span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {verdad.notas && (
        <p className="text-[11px] m-0" style={{ color: 'var(--muted)' }}>Notas de quien etiquetó: {verdad.notas}</p>
      )}
      {lectura?.motivo && (
        <p className="text-[11px] m-0" style={{ color: 'var(--warn)' }}>{lectura.motivo}</p>
      )}
    </div>
  );
}

/** El valor ESPERADO, con los tres estados bien distintos. Un ilegible pintado
 *  como celda vacía es la mentira que este panel existe para no contar. */
function Esperado({ verdad, clave }: { verdad: VerdadTerreno; clave: ClaveVerdad }) {
  if (verdad.ilegibles.includes(clave)) {
    return <span className="font-medium" style={{ color: 'var(--warn)' }}>ilegible en la foto</span>;
  }
  if (verdad.noAplica.includes(clave)) {
    return <span style={{ color: 'var(--faint)' }}>el papel no lo imprime</span>;
  }
  return <Valor clave={clave} v={verdad[clave]} />;
}

/** Moneda y fecha SOLO por lib/formato.ts. */
function Valor({ clave, v }: { clave: ClaveVerdad; v: string | number | null }) {
  if (v === null || v === undefined || v === '') {
    return <span style={{ color: 'var(--faint)' }}>no leyó nada</span>;
  }
  if (clave === 'monto') return <span className="tabular">{mxn(Number(v))}</span>;
  if (clave === 'fecha') return <span className="whitespace-nowrap">{fechaCorta(String(v))}</span>;
  return <span className="break-all">{String(v)}</span>;
}
