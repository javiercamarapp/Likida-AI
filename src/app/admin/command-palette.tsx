'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Power, Eye, Siren, AlertTriangle, Check, Sparkles } from 'lucide-react';
import { TODAS_LAS_RUTAS } from './rutas';
import { etiquetaInterruptor } from './observabilidad/etiquetas';

/**
 * ⌘K (Ctrl+K en Windows/Linux) — el buscador de /admin, ahora con ACCIONES
 * además de navegar (informe de consolas SV: el palette que solo navega es
 * medio palette). Tres acciones, cada una con su atajo GLOBAL real (patrón
 * Superhuman: el kbd que se enseña junto a la acción es uno que de verdad
 * funciona, no un adorno — por eso son ⌃⇧, que ningún navegador ocupa,
 * y no ⌘⇧ que en Chrome ya tienen dueño):
 *
 *   · Apagar/encender un agente… (⌃⇧A) — los interruptores de la 0110, vía
 *     /api/admin/palette (la MISMA lib y la MISMA bitácora que los toggles
 *     de /admin/observabilidad; el route handler re-gatea superadmin).
 *     Apagar pide el motivo AQUÍ MISMO (el input se vuelve el campo de
 *     motivo): obligatorio, igual que en la base.
 *   · Ver como flota… (⌃⇧F) — lista las flotas y abre /dashboard?tenant=,
 *     que desde la 0110 queda FIRMADO en la bitácora.
 *   · Ir a escalaciones (⌃⇧E).
 *
 * Sin librería nueva, igual que antes: overlay a mano, filtrado por
 * substring, ↑↓ + Enter, Esc cierra, Backspace con el campo vacío regresa
 * del submenú a la raíz.
 */

type Modo = 'raiz' | 'interruptores' | 'flotas' | 'motivo';

interface InterruptorLite { id: string; apagado: boolean; motivo: string | null }
interface FlotaLite { id: string; nombre: string }
interface Datos { interruptores: InterruptorLite[]; flotas: FlotaLite[] }

interface Item {
  key: string;
  etiqueta: string;
  /** Lo que se pinta a la derecha: un kbd real o el estado del interruptor. */
  detalle?: string;
  apagado?: boolean;
  Icono?: typeof Search;
  correr: () => void;
}

export default function CommandPalette() {
  const [abierto, setAbierto] = useState(false);
  const [abiertoPrevio, setAbiertoPrevio] = useState(abierto);
  const [consulta, setConsulta] = useState('');
  const [consultaPrevia, setConsultaPrevia] = useState(consulta);
  const [activo, setActivo] = useState(0);
  const [modo, setModo] = useState<Modo>('raiz');
  /** Con qué modo se pidió abrir (⌃⇧A abre directo en interruptores). */
  const [aperturaModo, setAperturaModo] = useState<Modo>('raiz');
  /** El interruptor al que se le está escribiendo el motivo (modo 'motivo'). */
  const [motivoPara, setMotivoPara] = useState<string | null>(null);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [errorDatos, setErrorDatos] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Estado derivado EN el render (mismo patrón de estado-anterior que
  // contador-retro.tsx; comparar contra un ref durante el render lo prohíbe
  // `react-hooks/refs`). Al abrir se arranca en el modo pedido; al teclear se
  // reinicia la selección.
  if (abierto !== abiertoPrevio) {
    setAbiertoPrevio(abierto);
    if (abierto) {
      setConsulta('');
      setActivo(0);
      setModo(aperturaModo);
      setMotivoPara(null);
      setAviso(null);
    }
  }
  if (consulta !== consultaPrevia) {
    setConsultaPrevia(consulta);
    setActivo(0);
  }

  const cargarDatos = useCallback(async () => {
    setErrorDatos(null);
    try {
      const res = await fetch('/api/admin/palette');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDatos(await res.json() as Datos);
    } catch {
      // El error se DICE en el palette: una lista vacía afirmaría que no hay
      // flotas ni interruptores, que es distinto de no haber podido mirar.
      setDatos(null);
      setErrorDatos('No se pudieron leer interruptores y flotas. Reabre el buscador para reintentar.');
    }
  }, []);

  // Los datos se piden al ABRIR (aquí, no en un efecto): el palette vive en
  // todo /admin y pedir interruptores+flotas en cada carga de página cobraría
  // a todas las pantallas por una lista que casi nunca se abre.
  const abrirEn = useCallback((m: Modo) => {
    setAperturaModo(m);
    setAbierto(true);
    void cargarDatos();
  }, [cargarDatos]);

  async function ejecutarInterruptor(operacion: 'apagar' | 'encender', id: string, motivo?: string) {
    if (enviando) return; // el doble Enter no puede firmar dos veces
    setEnviando(true);
    setAviso(null);
    try {
      const res = await fetch('/api/admin/palette', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operacion, id, motivo }),
      });
      const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setAviso({ tipo: 'error', texto: j.error ?? `No se pudo (${res.status}).` });
        return;
      }
      setAviso({
        tipo: 'ok',
        texto: operacion === 'apagar'
          ? `${etiquetaInterruptor(id)} APAGADO. Los crons lo saltan desde su siguiente corrida; quedó firmado en la bitácora.`
          : `${etiquetaInterruptor(id)} encendido.`,
      });
      setModo('interruptores');
      setMotivoPara(null);
      setConsulta('');
      await cargarDatos();
      // Para que /admin/observabilidad (si está detrás) repinte las palancas.
      router.refresh();
    } catch {
      setAviso({ tipo: 'error', texto: 'No se pudo hablar con el servidor.' });
    } finally {
      setEnviando(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && k === 'k') {
        e.preventDefault();
        if (abierto) setAbierto(false);
        else abrirEn('raiz');
      } else if (e.ctrlKey && e.shiftKey && k === 'a') {
        e.preventDefault();
        abrirEn('interruptores');
      } else if (e.ctrlKey && e.shiftKey && k === 'f') {
        e.preventDefault();
        abrirEn('flotas');
      } else if (e.ctrlKey && e.shiftKey && k === 'e') {
        e.preventDefault();
        setAbierto(false);
        router.push('/admin/escalaciones');
      } else if (e.key === 'Escape') {
        setAbierto(false);
      }
    }
    // El botón "Buscar" del sidebar (layout.tsx) dispara este evento en vez
    // de compartir estado de React — es más simple que levantar el estado
    // hasta el layout (Server Component) solo para un botón.
    function onAbrir() { abrirEn('raiz'); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('likida:abrir-buscador', onAbrir);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('likida:abrir-buscador', onAbrir);
    };
  }, [router, abierto, abrirEn]);

  useEffect(() => {
    if (!abierto) return;
    // Un tick para que el input ya esté montado antes de enfocarlo.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [abierto]);

  function ir(href: string) {
    setAbierto(false);
    router.push(href);
  }

  function pedirMotivo(id: string) {
    setMotivoPara(id);
    setModo('motivo');
    setConsulta('');
    setAviso(null);
  }

  const resultados = useMemo((): Item[] => {
    const q = consulta.trim().toLowerCase();
    const filtra = (items: Item[]) => (q ? items.filter((i) => i.etiqueta.toLowerCase().includes(q)) : items);

    if (modo === 'interruptores') {
      return filtra((datos?.interruptores ?? []).map((i): Item => ({
        key: `int-${i.id}`,
        etiqueta: etiquetaInterruptor(i.id),
        detalle: i.apagado ? 'APAGADO · Enter: encender' : 'Encendido · Enter: apagar…',
        apagado: i.apagado,
        Icono: Power,
        correr: () => { if (i.apagado) void ejecutarInterruptor('encender', i.id); else pedirMotivo(i.id); },
      })));
    }
    if (modo === 'flotas') {
      return filtra((datos?.flotas ?? []).map((f): Item => ({
        key: `flota-${f.id}`,
        etiqueta: f.nombre,
        detalle: 'ver como — firmado',
        Icono: Eye,
        correr: () => ir(`/dashboard?tenant=${f.id}&rol=flota_admin`),
      })));
    }
    if (modo === 'motivo') return [];

    const acciones: Item[] = [
      {
        key: 'acc-interruptores', etiqueta: 'Apagar / encender un agente…', detalle: '⌃⇧A', Icono: Power,
        correr: () => { setModo('interruptores'); setConsulta(''); setActivo(0); },
      },
      {
        key: 'acc-flotas', etiqueta: 'Ver como flota…', detalle: '⌃⇧F', Icono: Eye,
        correr: () => { setModo('flotas'); setConsulta(''); setActivo(0); },
      },
      { key: 'acc-escalaciones', etiqueta: 'Ir a escalaciones', detalle: '⌃⇧E', Icono: Siren, correr: () => ir('/admin/escalaciones') },
      {
        // El panel lateral del copiloto (diseño §6). Mismo puente de evento
        // que el botón "Buscar" del sidebar: el estado vive en su componente.
        key: 'acc-copiloto', etiqueta: 'Abrir el copiloto (panel lateral)', detalle: '⌘J', Icono: Sparkles,
        correr: () => { setAbierto(false); window.dispatchEvent(new CustomEvent('likida:abrir-copiloto')); },
      },
    ];
    const rutas = TODAS_LAS_RUTAS.map((r): Item => ({
      key: r.href, etiqueta: r.nombre, Icono: r.Icono, correr: () => ir(r.href),
    }));
    return filtra([...acciones, ...rutas]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, modo, datos]);

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (modo === 'motivo') {
      if (e.key === 'Enter') {
        e.preventDefault();
        const m = consulta.trim();
        if (!m) { setAviso({ tipo: 'error', texto: 'El motivo es obligatorio para apagar — sin nota nadie sabrá después por qué.' }); return; }
        if (motivoPara) void ejecutarInterruptor('apagar', motivoPara, m);
      } else if (e.key === 'Backspace' && consulta === '') {
        setModo('interruptores');
        setMotivoPara(null);
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((i) => Math.min(i + 1, resultados.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (resultados[activo]) resultados[activo].correr(); }
    else if (e.key === 'Backspace' && consulta === '' && modo !== 'raiz') { setModo('raiz'); setAviso(null); }
  }

  if (!abierto) return null;

  const placeholder = modo === 'motivo'
    ? `Motivo para apagar ${motivoPara ? etiquetaInterruptor(motivoPara) : ''} (obligatorio) — Enter confirma`
    : modo === 'interruptores' ? 'Filtrar interruptores… (Backspace vacío: regresar)'
    : modo === 'flotas' ? 'Filtrar flotas… (Backspace vacío: regresar)'
    : 'Buscar página o acción… (Inicio, Apagar, Ver como…)';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={() => setAbierto(false)}
    >
      <div className="w-full rounded-2xl overflow-hidden glass-panel" style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ borderColor: 'var(--line)' }}>
          {modo === 'motivo'
            ? <Power width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />
            : <Search width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          <input
            ref={inputRef}
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={placeholder}
            className="flex-1 min-w-0 text-sm bg-transparent outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded hairline shrink-0" style={{ color: 'var(--muted)' }}>Esc</kbd>
        </div>

        {/* El resultado de la última palanca — visible sin cerrar el palette. */}
        {aviso && (
          <div aria-live="polite" className="flex items-start gap-2 px-4 py-2.5 text-xs border-b"
            style={{
              borderColor: 'var(--line)',
              background: aviso.tipo === 'error' ? 'var(--badbg)' : 'var(--okbg)',
              color: aviso.tipo === 'error' ? 'var(--bad)' : 'var(--ok)',
            }}>
            {aviso.tipo === 'error'
              ? <AlertTriangle width={13} height={13} strokeWidth={2} className="shrink-0 mt-0.5" />
              : <Check width={13} height={13} strokeWidth={2} className="shrink-0 mt-0.5" />}
            <span>{aviso.texto}</span>
          </div>
        )}

        <div className="max-h-80 overflow-y-auto py-1.5">
          {modo === 'motivo' ? (
            <div className="px-4 py-4 text-sm" style={{ color: 'var(--muted)' }}>
              Vas a apagar <span className="font-medium" style={{ color: 'var(--ink)' }}>{motivoPara ? etiquetaInterruptor(motivoPara) : ''}</span>.
              Escribe el motivo arriba y confirma con Enter. {enviando ? 'Guardando…' : ''}
            </div>
          ) : errorDatos && (modo === 'interruptores' || modo === 'flotas') ? (
            <div className="px-4 py-4 text-sm" style={{ color: 'var(--bad)' }}>{errorDatos}</div>
          ) : (modo === 'interruptores' || modo === 'flotas') && datos === null ? (
            <div className="px-4 py-4 text-sm" style={{ color: 'var(--muted)' }}>Leyendo…</div>
          ) : resultados.length === 0 ? (
            <div className="px-4 py-6 text-sm text-center" style={{ color: 'var(--muted)' }}>Sin resultados.</div>
          ) : (
            resultados.map((item, i) => {
              const { key, etiqueta, detalle, Icono, apagado, correr } = item;
              return (
                <button key={key} type="button" onClick={correr} disabled={enviando}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors disabled:opacity-60"
                  style={i === activo ? { background: 'var(--marca)', color: 'white' } : undefined}
                  onMouseEnter={() => setActivo(i)}
                >
                  {Icono && (
                    <Icono width={15} height={15} strokeWidth={1.75}
                      style={{ color: i === activo ? 'white' : apagado ? 'var(--bad)' : 'var(--muted)' }} />
                  )}
                  <span className="flex-1 min-w-0 truncate">{etiqueta}</span>
                  {detalle && (
                    <span className="text-[10px] shrink-0 tabular"
                      style={{ color: i === activo ? 'rgba(255,255,255,0.8)' : apagado ? 'var(--bad)' : 'var(--muted)' }}>
                      {detalle}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
