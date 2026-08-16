'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EL FORMULARIO DE LANZAR — /admin/qa (Fase A).
//
// Sube N fotos DE GOLPE (input multiple + arrastrar y soltar: el pedido
// literal es "cantidad obscena de tickets"), elige escenario (feliz / guion
// del demo), edita anticipo/RFC/ruta/política precargados, y lanza el carril
// rápido. El botón deshabilitado SIEMPRE dice su motivo (diseño §2.a) — la
// misma validación del servidor (`validarLanzar`, qa-tipos.ts) corre aquí
// para que el motivo sea idéntico al candado real.
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Play, Trash2, Plus, Loader2 } from 'lucide-react';
import { TituloSeccion } from '../../dashboard/resumen-visual';
import { escenarioPorId, ESCENARIOS_QA } from '@/lib/admin/qa-escenarios';
import {
  validarLanzar, MAX_FOTOS_CARRIL_RAPIDO,
  type EscenarioId, type FotoBanco,
} from '@/lib/admin/qa-tipos';

export type FotoConUrl = FotoBanco & { url: string | null };

interface FilaPolitica { concepto: string; topeMonto: string; requiereCfdi: boolean }

function politicaAFilas(politica: Array<{ concepto: string; topeMonto?: number; requiereCfdi?: boolean }>): FilaPolitica[] {
  return politica.map((p) => ({
    concepto: p.concepto,
    topeMonto: p.topeMonto !== undefined ? String(p.topeMonto) : '',
    requiereCfdi: Boolean(p.requiereCfdi),
  }));
}

export function LanzarForm({ fotosIniciales, bancoError, gastoHoyUsd, gastoError, topeDiaUsd }: {
  fotosIniciales: FotoConUrl[];
  bancoError: string | null;
  gastoHoyUsd: number | null;
  gastoError: string | null;
  topeDiaUsd: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const escenarioInicial = escenarioPorId('demo_guion')!;

  const [fotos, setFotos] = useState<FotoConUrl[]>(fotosIniciales);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [escenario, setEscenario] = useState<EscenarioId>('demo_guion');
  const [anticipo, setAnticipo] = useState(escenarioInicial.anticipoDefault !== null ? String(escenarioInicial.anticipoDefault) : '');
  const [rfc, setRfc] = useState(escenarioInicial.rfcEmpresaDefault ?? '');
  const [origen, setOrigen] = useState(escenarioInicial.rutaDefault.origen);
  const [destino, setDestino] = useState(escenarioInicial.rutaDefault.destino);
  const [politica, setPolitica] = useState<FilaPolitica[]>(politicaAFilas(escenarioInicial.politicaDefault));
  const [conservar, setConservar] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [lanzando, setLanzando] = useState(false);
  const [avisosSubida, setAvisosSubida] = useState<string[]>([]);
  const [errorLanzar, setErrorLanzar] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  const elegirEscenario = (id: EscenarioId) => {
    const def = escenarioPorId(id);
    if (!def) return;
    setEscenario(id);
    setAnticipo(def.anticipoDefault !== null ? String(def.anticipoDefault) : '');
    setRfc(def.rfcEmpresaDefault ?? '');
    setOrigen(def.rutaDefault.origen);
    setDestino(def.rutaDefault.destino);
    setPolitica(politicaAFilas(def.politicaDefault));
  };

  const alternarFoto = (id: string) => {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const subirArchivos = async (archivos: FileList | File[]) => {
    const lista = Array.from(archivos);
    if (lista.length === 0) return;
    setSubiendo(true);
    setAvisosSubida([]);
    try {
      const form = new FormData();
      for (const f of lista) form.append('fotos', f, f.name);
      const res = await fetch('/api/admin/qa/fotos', { method: 'POST', body: form });
      const cuerpo = await res.json().catch(() => null) as { error?: string; resultados?: Array<{ nombre: string; id: string | null; duplicadoDe: string | null; error: string | null }>; fotos?: FotoConUrl[] } | null;
      if (!res.ok || !cuerpo?.fotos) {
        setAvisosSubida([`la subida falló: ${cuerpo?.error ?? `HTTP ${res.status}`}`]);
        return;
      }
      setFotos(cuerpo.fotos);
      const avisos: string[] = [];
      const nuevas: string[] = [];
      for (const r of cuerpo.resultados ?? []) {
        if (r.error) avisos.push(`${r.nombre}: ${r.error}`);
        else if (r.duplicadoDe) avisos.push(`${r.nombre}: ya estaba en el banco (dedup por hash) — se reusa`);
        if (r.id) nuevas.push(r.id);
      }
      // Lo recién subido queda seleccionado solo: subir → lanzar sin dar 40 clics.
      if (nuevas.length) setSeleccion((prev) => new Set([...prev, ...nuevas]));
      setAvisosSubida(avisos);
    } catch (e) {
      setAvisosSubida([`la subida falló: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // El body EXACTO que validará el servidor — el motivo del botón sale de la
  // misma función, así que nunca cuentan historias distintas.
  const cuerpoLanzar = {
    escenario,
    fotoIds: [...seleccion],
    anticipo: anticipo.trim() === '' ? NaN : Number(anticipo),
    rfcEmpresa: rfc.trim() === '' ? null : rfc.trim(),
    ruta: { origen, destino },
    politica: politica.map((p) => ({
      concepto: p.concepto,
      topeMonto: p.topeMonto.trim() === '' ? undefined : Number(p.topeMonto),
      requiereCfdi: p.requiereCfdi || undefined,
    })),
    retencion: conservar ? 'conservar' : 'borrar_al_terminar',
  };
  const validacion = validarLanzar(cuerpoLanzar);
  const motivoBloqueo =
    gastoError !== null ? 'no se pudo leer el gasto del día — no se lanza a ciegas'
    : gastoHoyUsd !== null && gastoHoyUsd >= topeDiaUsd ? `el gasto de hoy (US$${gastoHoyUsd.toFixed(4)}) ya tocó el tope diario (US$${topeDiaUsd.toFixed(2)})`
    : bancoError !== null ? 'el banco de fotos no se pudo leer'
    : !validacion.ok ? validacion.error
    : null;

  const lanzar = async () => {
    if (motivoBloqueo || lanzando) return;
    setLanzando(true);
    setErrorLanzar(null);
    try {
      const res = await fetch('/api/admin/qa/lanzar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoLanzar),
      });
      const cuerpo = await res.json().catch(() => null) as { id?: string; error?: string } | null;
      if (!res.ok || !cuerpo?.id) {
        setErrorLanzar(cuerpo?.error ?? `el lanzamiento falló (HTTP ${res.status})`);
        setLanzando(false);
        return;
      }
      router.push(`/admin/qa/${cuerpo.id}`);
    } catch (e) {
      setErrorLanzar(e instanceof Error ? e.message : String(e));
      setLanzando(false);
    }
  };

  // SIN ancho aquí a propósito: `w-full` en la base le ganaba al `w-28` del
  // tope (el orden del stylesheet decide, no el del className) y la fila de
  // política se pintaba con el concepto colapsado — visto en el preview.
  const inputCss = 'hairline rounded-lg px-2.5 py-1.5 text-sm bg-transparent';

  return (
    <div className="card p-4 space-y-4">
      <TituloSeccion>Lanzar una corrida — carril rápido (en proceso, pipeline real)</TituloSeccion>

      {/* ── Escenario ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {ESCENARIOS_QA.map((e) => (
          <button key={e.id} type="button" onClick={() => elegirEscenario(e.id)}
            className="text-left hairline rounded-xl px-3 py-2.5 transition-colors"
            style={escenario === e.id
              ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
              : { background: 'var(--surface)' }}>
            <div className="text-sm font-semibold">{e.nombre}</div>
            <div className="text-xs mt-1 opacity-80">{e.descripcion}</div>
            <div className="text-[10px] mt-1.5 font-mono opacity-70">invariantes {e.invariantes.join(' · ')} — los otros 9 escenarios del catálogo son Fase B</div>
          </button>
        ))}
      </div>

      {/* ── Fotos: arrastrar N de golpe + el banco ─────────────────────────── */}
      <div>
        <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>
          Fotos del viaje — {seleccion.size} seleccionada{seleccion.size === 1 ? '' : 's'} (máx. {MAX_FOTOS_CARRIL_RAPIDO} por corrida en el carril rápido)
        </div>
        <div
          onDragOver={(ev) => { ev.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(ev) => { ev.preventDefault(); setArrastrando(false); void subirArchivos(ev.dataTransfer.files); }}
          className="rounded-xl border border-dashed px-4 py-4 text-center cursor-pointer"
          style={{ borderColor: arrastrando ? 'var(--marca)' : 'var(--line)', background: arrastrando ? 'var(--canvas)' : 'transparent' }}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
            onChange={(ev) => { if (ev.target.files) void subirArchivos(ev.target.files); }} />
          <div className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            {subiendo ? <Loader2 width={15} height={15} strokeWidth={1.75} className="animate-spin" /> : <Upload width={15} height={15} strokeWidth={1.75} />}
            {subiendo ? 'Subiendo al banco…' : 'Suelta aquí todas las fotos que quieras (JPEG/PNG/WebP) o da clic — se deduplican por hash'}
          </div>
        </div>
        {avisosSubida.length > 0 && (
          <ul className="text-xs mt-1.5 space-y-0.5" style={{ color: 'var(--muted)' }}>
            {avisosSubida.map((a, i) => <li key={i}>· {a}</li>)}
          </ul>
        )}

        {bancoError !== null ? null : fotos.length === 0 ? (
          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
            El banco está vacío de verdad (el manifiesto se leyó completo) — sube tus primeras fotos arriba.
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-8 gap-1.5 mt-2 max-h-64 overflow-y-auto pr-1">
            {fotos.map((f) => {
              const activa = seleccion.has(f.id);
              return (
                <button key={f.id} type="button" onClick={() => alternarFoto(f.id)}
                  title={f.etiqueta}
                  className="relative rounded-lg overflow-hidden hairline text-left"
                  style={activa ? { outline: '2px solid var(--marca)', outlineOffset: '-2px' } : undefined}>
                  {f.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL firmada de 60 s de un bucket privado: next/image no puede optimizarla (expira) y cachearla la rompería
                    <img src={f.url} alt={f.etiqueta} className="w-full h-16 object-cover" />
                  ) : (
                    <div className="w-full h-16 flex items-center justify-center text-[10px] px-1" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
                      sin firma
                    </div>
                  )}
                  <div className="px-1 py-0.5 text-[9px] truncate" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                    {activa ? '✓ ' : ''}{f.etiqueta}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Parámetros del viaje ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <label className="text-xs" style={{ color: 'var(--muted)' }}>
          Anticipo (MXN)
          <input className={`${inputCss} w-full`} inputMode="decimal" value={anticipo} onChange={(e) => setAnticipo(e.target.value)}
            placeholder={escenario === 'feliz' ? 'lo que sumen tus fotos' : ''} />
        </label>
        <label className="text-xs" style={{ color: 'var(--muted)' }}>
          RFC de la empresa (opcional)
          <input className={`${inputCss} w-full`} value={rfc} onChange={(e) => setRfc(e.target.value.toUpperCase())} />
        </label>
        <label className="text-xs" style={{ color: 'var(--muted)' }}>
          Origen
          <input className={`${inputCss} w-full`} value={origen} onChange={(e) => setOrigen(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: 'var(--muted)' }}>
          Destino
          <input className={`${inputCss} w-full`} value={destino} onChange={(e) => setDestino(e.target.value)} />
        </label>
      </div>

      {/* ── Política de gasto ──────────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>
          Política de gasto del tenant sintético (concepto · tope · CFDI)
        </div>
        <div className="space-y-1.5">
          {politica.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={`${inputCss} flex-1 min-w-0`} value={p.concepto} placeholder="concepto"
                onChange={(e) => setPolitica((prev) => prev.map((x, j) => j === i ? { ...x, concepto: e.target.value } : x))} />
              <input className={`${inputCss} w-28`} inputMode="decimal" value={p.topeMonto} placeholder="sin tope"
                onChange={(e) => setPolitica((prev) => prev.map((x, j) => j === i ? { ...x, topeMonto: e.target.value } : x))} />
              <label className="text-xs inline-flex items-center gap-1.5 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                <input type="checkbox" checked={p.requiereCfdi}
                  onChange={(e) => setPolitica((prev) => prev.map((x, j) => j === i ? { ...x, requiereCfdi: e.target.checked } : x))} />
                CFDI
              </label>
              <button type="button" onClick={() => setPolitica((prev) => prev.filter((_, j) => j !== i))}
                className="p-1 rounded hover:opacity-70" aria-label={`quitar ${p.concepto || 'concepto'}`}>
                <Trash2 width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setPolitica((prev) => [...prev, { concepto: '', topeMonto: '', requiereCfdi: false }])}
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium hover:opacity-70">
          <Plus width={12} height={12} strokeWidth={1.75} /> Agregar concepto
        </button>
      </div>

      {/* ── Lanzar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 pt-1 border-t" style={{ borderColor: 'var(--line2)' }}>
        <button type="button" onClick={() => void lanzar()} disabled={Boolean(motivoBloqueo) || lanzando}
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-opacity disabled:opacity-40"
          style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
          {lanzando ? <Loader2 width={14} height={14} strokeWidth={2} className="animate-spin" /> : <Play width={14} height={14} strokeWidth={2} />}
          {lanzando ? 'Lanzando…' : 'Lanzar corrida'}
        </button>
        <label className="text-xs inline-flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
          <input type="checkbox" checked={conservar} onChange={(e) => setConservar(e.target.checked)} />
          conservar el tenant sintético al terminar (para inspección)
        </label>
        {motivoBloqueo && (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>⛔ {motivoBloqueo}</span>
        )}
        {errorLanzar && (
          <span className="text-xs font-medium" style={{ color: 'var(--bad)' }}>{errorLanzar}</span>
        )}
      </div>
    </div>
  );
}
