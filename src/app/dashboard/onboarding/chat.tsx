'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowUp, Search, Paperclip, Camera, FileImage, X, FileText, Check } from 'lucide-react';
import { mxn, litros, numero } from '@/lib/formato';
import { Logo, LogoIcono } from '../../logo';
import { CampoPixeles } from '../pixeles';
import { Dona, AreaChartSimple } from '../../admin/charts';
import type { OpcionChip } from '@/lib/likida/perfil/entrevista';

/**
 * Clon del hero de ChatFlota (`../chat.tsx`, variante `hero`): la misma caja
 * (Consulta + clip + ArrowUp), el mismo recuadro, el mismo pensando. El POST
 * va a /api/dashboard/onboarding-chat — recepción de datos de la flota, no
 * consulta de KPIs. Historial persistente no se finge: esa API no existe aquí.
 */

const FASES_PENSANDO: Array<[number, string]> = [
  [0, 'Pensando…'],
  [3000, 'Leyendo tu declaración…'],
  [9000, 'Cruzando con la norma…'],
  [17000, 'Armando la respuesta…'],
  [30000, 'Esto está tardando más de lo normal…'],
];

const ETIQUETA_PASO: Record<string, string> = {
  leer_perfil: 'Leyendo el perfil de la flota',
  interpretar_respuesta: 'Leyendo tu respuesta',
  guardar_perfil: 'Guardando la declaración',
  nutrir_operacion: 'Escribiendo en operadores, unidades y políticas',
  explicar_norma: 'Consultando el sustento',
  armar_respuesta: 'Armando la respuesta',
};
const rotuloPaso = (t: string) => ETIQUETA_PASO[t] ?? t.replaceAll('_', ' ');

/** Mismo catálogo de Consulta que ChatFlota: tres columnas, clic = mensaje.
 *  Aquí son preguntas al configurador (el LLM solo explica fichas del catálogo). */
const CATALOGO_CONSULTA: Array<{ categoria: string; preguntas: string[] }> = [
  {
    categoria: 'Fiscal',
    preguntas: [
      '¿Por qué importa el umbral de $300 millones?',
      '¿Qué es una parte relacionada?',
      '¿Qué régimen abre la facilidad del 15%?',
    ],
  },
  {
    categoria: 'Comprobantes',
    preguntas: [
      '¿Por qué el RFC tiene que coincidir letra por letra?',
      '¿Qué pasa si el chofer paga con su tarjeta?',
      '¿Cómo funciona el monedero de diésel?',
    ],
  },
  {
    categoria: 'Operación',
    preguntas: [
      '¿Qué necesitas para el WhatsApp de los choferes?',
      '¿Los topes de gasto son ley?',
      '¿Qué infieres de los tickets y qué no?',
    ],
  },
];

type Visual =
  | { tipo: 'tabla'; filas: Array<[string, string]> }
  | { tipo: 'dona'; segmentos: Array<{ etiqueta: string; valor: number }> }
  | { tipo: 'cifra'; valor: string; nota?: string }
  | { tipo: 'serie'; puntos: Array<{ dia: string; valor: number }>; formato: 'mxn' | 'numero' };

interface Turno {
  q: string;
  r: { texto: string; chips?: OpcionChip[]; pendiente?: boolean; visual?: Visual };
}

function VisualRespuesta({ v }: { v: Visual }) {
  if (v.tipo === 'cifra') {
    return (
      <div className="card px-4 py-3 mt-2 inline-block">
        <div className="font-display text-[22px] leading-tight font-semibold tabular">{v.valor}</div>
        {v.nota && <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>{v.nota}</p>}
      </div>
    );
  }
  if (v.tipo === 'dona') {
    return <div className="card p-3 mt-2"><Dona segmentos={v.segmentos} /></div>;
  }
  if (v.tipo === 'serie') {
    return (
      <div className="card p-3 mt-2">
        <AreaChartSimple datos={v.puntos} etiquetaValor={v.formato === 'mxn' ? mxn : numero} />
      </div>
    );
  }
  return (
    <div className="card p-1.5 mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          {v.filas.map(([k, val]) => (
            <tr key={k} className="border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}>
              <td className="px-2.5 py-1.5" style={{ color: 'var(--muted)' }}>{k}</td>
              <td className="cifra-mono px-2.5 py-1.5 text-right">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChatEntrevista({
  preguntaInicial, chipsIniciales, perfilListoInicial, sufijo, formulario,
}: {
  preguntaInicial: string | null;
  chipsIniciales: OpcionChip[];
  /** Lo sigue pasando la página; el clon de ChatFlota usa Consulta, no un botón Sustento. */
  sustentoInicial?: { cita: string; texto: string } | null;
  perfilListoInicial: boolean;
  sufijo: string;
  formulario?: ReactNode;
}) {
  const sp = useSearchParams();
  const [historial, setHistorial] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [listo, setListo] = useState(perfilListoInicial);
  const [recomendar, setRecomendar] = useState(false);
  const [menuAdjuntar, setMenuAdjuntar] = useState(false);
  const [documento, setDocumento] = useState<{ nombre: string; extracto: string } | null>(null);
  const [fasePensando, setFasePensando] = useState('Pensando…');
  const [pasosVivos, setPasosVivos] = useState<Array<{ tool: string; listo: boolean }>>([]);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const inputImagen = useRef<HTMLInputElement>(null);
  const inputCamara = useRef<HTMLInputElement>(null);
  const finConversacion = useRef<HTMLDivElement>(null);

  const vacio = historial.length === 0;
  const ultimo = historial[historial.length - 1];
  const chips = ocupado ? [] : (ultimo?.r.chips ?? (vacio ? chipsIniciales : []));

  useEffect(() => {
    finConversacion.current?.scrollIntoView({ block: 'end' });
  }, [historial.length]);

  async function leerArchivo(archivo: File) {
    if (ocupado) return;
    if (!archivo.type.startsWith('image/')) {
      setOcupado(true);
      const etiqueta = `Adjuntar: ${archivo.name}`;
      try {
        const b64 = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(archivo);
        });
        const resp = await fetch('/api/dashboard/archivo', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: archivo.name, contenido: b64 }),
          signal: AbortSignal.timeout(75_000),
        });
        const d = await resp.json().catch(() => null);
        if (!resp.ok || !d?.extracto) {
          setHistorial((h) => [...h, { q: etiqueta, r: { texto: d?.error ?? 'No se pudo leer el archivo en este momento.' } }]);
          return;
        }
        setDocumento({ nombre: archivo.name, extracto: d.extracto });
        setHistorial((h) => [...h, {
          q: etiqueta,
          r: {
            texto: `Listo, leí «${archivo.name}» y lo tengo a la mano en esta conversación — pregúntame lo que quieras sobre él o mándalo como respuesta.`,
            visual: Array.isArray(d.meta) && d.meta.length > 0 ? { tipo: 'tabla', filas: d.meta as Array<[string, string]> } : undefined,
            chips,
          },
        }]);
      } catch {
        setHistorial((h) => [...h, { q: etiqueta, r: { texto: 'No se pudo leer el archivo en este momento.' } }]);
      } finally {
        setOcupado(false);
        if (inputArchivo.current) inputArchivo.current.value = '';
      }
      return;
    }
    setOcupado(true);
    const etiquetaQ = `Leer comprobante: ${archivo.name}`;
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(archivo);
      });
      const resp = await fetch('/api/dashboard/ingesta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagen: dataUrl }),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok || !d) {
        setHistorial((h) => [...h, { q: etiquetaQ, r: { texto: d?.error ?? 'No se pudo leer la imagen en este momento.' } }]);
        return;
      }
      if (!d.legible) {
        setHistorial((h) => [...h, { q: etiquetaQ, r: { texto: `El motor no pudo leer este papel${d.motivo ? ` (${d.motivo})` : ''}. Con una foto más cercana y sin reflejos suele salir.` } }]);
        return;
      }
      const filas: Array<[string, string]> = [];
      if (d.campos.concepto) filas.push(['Concepto', String(d.campos.concepto)]);
      if (typeof d.campos.monto === 'number') filas.push(['Monto', mxn(d.campos.monto)]);
      if (d.campos.fecha) filas.push(['Fecha', String(d.campos.fecha)]);
      if (d.campos.folio) filas.push(['Folio', String(d.campos.folio)]);
      if (d.campos.rfcEmisor) filas.push(['RFC emisor', String(d.campos.rfcEmisor)]);
      if (typeof d.campos.litros === 'number') filas.push(['Litros', litros(d.campos.litros)]);
      if (typeof d.campos.confianza === 'number') filas.push(['Confianza del OCR', `${Math.round(d.campos.confianza * 100)}%`]);
      setHistorial((h) => [...h, {
        q: etiquetaQ,
        r: {
          texto: 'Esto fue lo que el motor leyó del papel — lectura de prueba. Un ticket de bomba no se declara como RFC de la flota: el emisor es la estación. Si es tu constancia, adjúntala en PDF.',
          visual: filas.length > 0 ? { tipo: 'tabla', filas } : undefined,
          chips,
        },
      }]);
    } catch {
      setHistorial((h) => [...h, { q: etiquetaQ, r: { texto: 'No se pudo leer la imagen en este momento.' } }]);
    } finally {
      setOcupado(false);
      if (inputArchivo.current) inputArchivo.current.value = '';
      if (inputImagen.current) inputImagen.current.value = '';
      if (inputCamara.current) inputCamara.current.value = '';
    }
  }

  function preguntar(q: string, visible?: string) {
    if ((!q.trim() && !documento) || ocupado) return;
    setTexto('');
    setRecomendar(false);
    void enviar(q.trim() || `Adjunto «${documento?.nombre}».`, visible);
  }

  async function enviar(contenido: string, visible?: string) {
    const t = contenido.trim();
    if ((!t && !documento) || ocupado) return;
    const mostrado = (visible ?? contenido).trim() || (documento ? `Adjunto «${documento.nombre}».` : t);
    setTexto('');
    setRecomendar(false);
    setOcupado(true);
    setFasePensando('Pensando…');
    setPasosVivos([]);
    setHistorial((h) => [...h, { q: mostrado, r: { texto: 'Pensando…', pendiente: true } }]);
    let ticks = 0;
    const relojFases = setInterval(() => {
      ticks += 1;
      const ms = ticks * 700;
      const fase = [...FASES_PENSANDO].reverse().find(([desde]) => ms >= desde);
      if (fase) setFasePensando(fase[1]);
    }, 700);
    try {
      const tenant = sp.get('tenant');
      const previos = historial.flatMap((h) => [
        { rol: 'usuario' as const, texto: h.q },
        { rol: 'asistente' as const, texto: h.r.texto },
      ]);
      const resp = await fetch(`/api/dashboard/onboarding-chat${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensajes: [...previos, { rol: 'usuario', texto: t || mostrado }],
          documento,
        }),
        signal: AbortSignal.timeout(75_000),
      });
      let d: Record<string, unknown> | null = null;
      if (resp.ok && resp.body && (resp.headers.get('content-type') ?? '').includes('ndjson')) {
        const lector = resp.body.getReader();
        const dec = new TextDecoder();
        let resto = '';
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          resto += dec.decode(value, { stream: true });
          let salto;
          while ((salto = resto.indexOf('\n')) >= 0) {
            const linea = resto.slice(0, salto).trim();
            resto = resto.slice(salto + 1);
            if (!linea) continue;
            let ev: Record<string, unknown> | null = null;
            try { ev = JSON.parse(linea) as Record<string, unknown>; } catch { continue; }
            if (ev.t === 'paso' && typeof ev.tool === 'string') {
              const tool = ev.tool;
              if (ev.fase === 'inicio') {
                setPasosVivos((p) => [...p, { tool, listo: false }]);
              } else {
                setPasosVivos((p) => {
                  let idx = -1;
                  for (let i = p.length - 1; i >= 0; i--) {
                    if (p[i].tool === tool && !p[i].listo) { idx = i; break; }
                  }
                  if (idx >= 0) return p.map((x, i) => (i === idx ? { ...x, listo: true } : x));
                  return [...p, { tool, listo: true }];
                });
              }
            } else if (ev.t === 'fin' || ev.t === 'error') {
              d = ev;
            }
          }
        }
      } else {
        d = await resp.json().catch(() => null);
      }
      // FRONTEND-19C2-6: `d.error` son strings INTERNOS de la ruta ('sin
      // sesion', 'sin acceso', 'mensajes inválidos', 'cuerpo inválido') — se
      // imprimían tal cual en la burbuja de chat sin distinguir 401/403
      // (sesión muerta, necesita recargar) de un 400 (algo del cliente,
      // recuperable con reintentar). Nunca se muestra `d.error` crudo.
      const respuesta = resp.ok && d && typeof d.texto === 'string'
        ? d.texto
        : resp.status === 401 || resp.status === 403
          ? 'Tu sesión expiró. Recarga la página para volver a entrar.'
          : 'No pude guardar eso y prefiero no suponerlo. Inténtalo de nuevo o usa el formulario.';
      setHistorial((h) => [...h.slice(0, -1), {
        q: mostrado,
        r: { texto: respuesta, chips: Array.isArray(d?.chips) ? d.chips as OpcionChip[] : undefined },
      }]);
      if (d?.perfilListo === true) setListo(true);
    } catch {
      setHistorial((h) => [...h.slice(0, -1), {
        q: mostrado,
        r: { texto: 'Se cortó la conexión. No guardé nada. Repite la respuesta o usa el formulario.' },
      }]);
    } finally {
      clearInterval(relojFases);
      setPasosVivos([]);
      setOcupado(false);
    }
  }

  const puedeEnviar = Boolean(texto.trim() || documento) && !ocupado;

  const caja = (
    <form
      onSubmit={(e) => { e.preventDefault(); preguntar(texto); }}
      className="relative w-full rounded-2xl px-4 pt-3.5 pb-3 transition-shadow focus-within:shadow-lg"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {menuAdjuntar && (
        <>
          <button type="button" aria-label="Cerrar menú" onClick={() => setMenuAdjuntar(false)}
            className="fixed inset-0 z-20 cursor-default" style={{ background: 'transparent' }} />
          <div className={`absolute left-0 right-0 z-30 card p-1.5 ${vacio ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]'}`}>
            <button type="button"
              onClick={() => { setMenuAdjuntar(false); inputCamara.current?.click(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors hover:bg-[var(--canvas)] text-left">
              <Camera width={15} height={15} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--muted)' }} />
              <span className="text-[13.5px] font-medium shrink-0">Tomar foto</span>
              <span className="text-[13px] truncate" style={{ color: 'var(--muted)' }}>Con la cámara del teléfono</span>
            </button>
            <button type="button"
              onClick={() => { setMenuAdjuntar(false); inputImagen.current?.click(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors hover:bg-[var(--canvas)] text-left">
              <FileImage width={15} height={15} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--muted)' }} />
              <span className="text-[13.5px] font-medium shrink-0">Subir imágenes</span>
              <span className="text-[13px] truncate" style={{ color: 'var(--muted)' }}>Fotos de tickets desde tu equipo</span>
            </button>
            <button type="button"
              onClick={() => { setMenuAdjuntar(false); inputArchivo.current?.click(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors hover:bg-[var(--canvas)] text-left">
              <Paperclip width={15} height={15} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--muted)' }} />
              <span className="text-[13.5px] font-medium shrink-0">Adjuntar archivos</span>
              <span className="text-[13px] truncate" style={{ color: 'var(--muted)' }}>PDF, Excel, CSV, XML de CFDI…</span>
            </button>
          </div>
        </>
      )}
      {documento && (
        <div className="mb-2">
          <span className="hairline inline-flex items-center gap-1.5 text-[12px] font-medium pl-2.5 pr-1.5 py-1 rounded-full" style={{ background: 'var(--canvas)' }}>
            <FileText width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
            <span className="max-w-[260px] truncate">{documento.nombre}</span>
            <button type="button" aria-label="Quitar archivo" onClick={() => setDocumento(null)}
              className="w-5 h-5 rounded-full inline-flex items-center justify-center transition-colors hover:bg-[var(--line2)]">
              <X width={12} height={12} strokeWidth={2} />
            </button>
          </span>
        </div>
      )}
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={documento ? `Pregunta sobre «${documento.nombre}» o tu operación…` : 'Pregunta sobre tu operación…'}
        aria-label="Pregunta sobre tu operación"
        className="w-full bg-transparent border-0 outline-none text-[15px] leading-relaxed"
      />
      <div className="flex items-center justify-between mt-3 relative">
        <button type="button" onClick={() => setRecomendar((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full transition-opacity hover:opacity-85"
          style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
          <Search width={11} height={11} strokeWidth={2.25} />
          Consulta
        </button>

        <div className="flex items-center gap-1.5">
          <input ref={inputCamara} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerArchivo(f); }} />
          <input ref={inputImagen} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerArchivo(f); }} />
          <input ref={inputArchivo} type="file" accept="image/*,.pdf,.xlsx,.xls,.csv,.tsv,.ods,.xml,.txt,.json,.md" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerArchivo(f); }} />
          <button type="button" aria-label="Adjuntar comprobante" title="Adjuntar comprobante"
            onClick={() => setMenuAdjuntar((v) => !v)} disabled={ocupado}
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors hover:bg-[var(--canvas)] disabled:opacity-50"
            style={{ color: 'var(--ink2)' }}>
            <Paperclip width={14} height={14} strokeWidth={2} />
          </button>
          <button
            type="submit"
            aria-label="Enviar"
            disabled={!puedeEnviar}
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-opacity disabled:cursor-default"
            style={{
              background: 'var(--marca)',
              color: 'var(--marca-fg)',
              opacity: puedeEnviar ? 1 : 0.35,
            }}
          >
            <ArrowUp width={15} height={15} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </form>
  );

  const panelConsulta = recomendar && (
    <div className="w-full max-h-72 overflow-y-auto grid grid-cols-1 sm:grid-cols-3 gap-2.5 pr-0.5">
      {CATALOGO_CONSULTA.map((c) => (
        <div key={c.categoria} className="card p-3 self-start">
          <div className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: 'var(--muted)' }}>
            {c.categoria}
          </div>
          {c.preguntas.map((rq) => (
            <button key={rq} type="button"
              onClick={() => { setRecomendar(false); preguntar(rq); }}
              className="w-full text-left text-[13px] px-2 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]">
              {rq}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  const chipsRow = chips.length > 0 && (
    <div className={`flex flex-wrap gap-2 ${vacio ? 'justify-center mt-4' : 'mb-3'}`}>
      {chips.map((c) => (
        <button
          key={c.valor}
          type="button"
          onClick={() => preguntar(c.valor, c.etiqueta)}
          className="text-xs px-3 py-1.5 rounded-full hairline transition-opacity hover:opacity-70"
          style={{ color: 'var(--ink2)', background: 'var(--surface)' }}
        >
          {c.etiqueta}
        </button>
      ))}
    </div>
  );

  const pillListo = listo && (
    <div className="sticky top-0 z-30 h-0 w-full">
      <a href={`/dashboard${sufijo}`}
        className="absolute top-3 right-4 hairline inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-full text-[12.5px] font-medium transition-colors hover:bg-[var(--canvas)]"
        style={{ background: 'var(--surface)', color: 'var(--ink2)' }}>
        Ir al panel
      </a>
    </div>
  );

  if (!vacio) {
    return (
      <div className="min-h-full w-full flex-1 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          {pillListo}
          <div className="flex-1 flex flex-col px-4 pt-4">
            <div className="w-full max-w-2xl mx-auto flex-1 flex flex-col">
              <div className="flex-1 space-y-4 py-2">
                {historial.map((h, i) => (
                  <div key={i}>
                    <div className="flex justify-end">
                      <div className="hairline rounded-2xl rounded-br-md px-3.5 py-2 text-sm max-w-[85%]" style={{ background: 'var(--surface)' }}>
                        {h.q}
                      </div>
                    </div>
                    <div className="mt-2.5 text-sm max-w-[85%]">
                      {h.r.pendiente ? (
                        <div className="flex items-start gap-2.5">
                          <span className="likida-respira shrink-0 mt-0.5" style={{ color: 'var(--ink)' }}><LogoIcono alto="h-[16px]" /></span>
                          <div>
                            <div style={{ color: 'var(--muted)' }}>{fasePensando}</div>
                            {pasosVivos.length > 0 && (
                              <div className="mt-2 space-y-1.5">
                                {pasosVivos.map((p, j) => (
                                  <div key={j} className="flex items-center gap-2 text-[12.5px]"
                                    style={{ color: p.listo ? 'var(--faint)' : 'var(--ink)' }}>
                                    {p.listo
                                      ? <Check width={12} height={12} strokeWidth={2} className="shrink-0" style={{ color: 'var(--muted)' }} />
                                      : <span className="skeleton inline-block w-2.5 h-2.5 rounded-full shrink-0" />}
                                    {rotuloPaso(p.tool)}{p.listo ? '' : '…'}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{h.r.texto}</div>
                      )}
                      {h.r.visual && <VisualRespuesta v={h.r.visual} />}
                    </div>
                  </div>
                ))}
                <div ref={finConversacion} />
              </div>
              <div className="sticky bottom-0 shrink-0 pt-3 pb-4" style={{ background: 'var(--g1)' }}>
                {panelConsulta}
                {!recomendar && chipsRow}
                <div className={recomendar || chips.length > 0 ? 'mt-3' : ''}>{caja}</div>
                {formulario && (
                  <div className="mt-3">{formulario}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full flex-1 flex">
      <div className="relative flex-1 min-w-0 flex flex-col">
        <CampoPixeles />
        {pillListo}
        <div className="relative z-10 w-full flex-1 flex flex-col items-center justify-center px-4 py-10">
          <div className="w-full max-w-2xl flex flex-col items-center">
            <Logo alto="h-7" className="mb-6" />
            <h1 className="text-[26px] leading-tight font-medium tracking-tight text-center">
              Configura tu flota
            </h1>
            <p className="mt-2 mb-8 text-sm text-center max-w-md" style={{ color: 'var(--muted)' }}>
              {preguntaInicial
                ?? (listo
                  ? 'Puedes corregir lo declarado. El motor usa esto en el próximo cuadre — no se supone nada nuevo.'
                  : 'Fiscal, sistemas y operación. Adjunta la constancia o un PDF — y responde aquí. No supongo nada.')}
            </p>

            {caja}

            {recomendar ? (
              <div className={`w-full mt-4 ${menuAdjuntar ? 'invisible' : ''}`}>{panelConsulta}</div>
            ) : (
              <div className={menuAdjuntar ? 'invisible' : ''}>{chipsRow}</div>
            )}

            <p className={`mt-8 text-[11px] leading-relaxed text-center max-w-lg ${menuAdjuntar ? 'invisible' : ''}`} style={{ color: 'var(--faint)' }}>
              Cada cifra que el motor aplique sale de una declaración tuya o de un comprobante,
              nunca de un default. El estímulo de peaje (LIF 2026 art. 20-A) no se enciende hasta que lo declares.
            </p>
            {formulario && (
              <div className={`w-full mt-6 ${menuAdjuntar ? 'invisible' : ''}`}>{formulario}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
