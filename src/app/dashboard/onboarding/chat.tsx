'use client';

import MenuAdjuntar from '../menu-adjuntar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowUp, Search, Paperclip, X, FileText, Check } from 'lucide-react';
import { Boton, BotonEnlace, Icono, cx } from '@/app/ui-v2/componentes';
import { AreaMini, DonaMini } from '@/app/ui-v2/graficas';
import './entrevista.css';
import { mxn, litros } from '@/lib/formato';
import { Logo, LogoIcono } from '../../logo';
import { CampoPixeles } from '../pixeles';
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
      <div className="rv-ob__visual">
        <div className="rv-ob__cifra tabular">{v.valor}</div>
        {v.nota && <p className="rv-ob__cifra-nota">{v.nota}</p>}
      </div>
    );
  }
  if (v.tipo === 'dona') {
    return <div className="rv-ob__visual rv-ob__visual--ancho"><DonaMini gajos={v.segmentos.map((g) => ({ etiqueta: g.etiqueta, valor: g.valor }))} etiqueta="Distribución de la respuesta del asistente" /></div>;
  }
  if (v.tipo === 'serie') {
    return (
      <div className="rv-ob__visual rv-ob__visual--ancho">
        <AreaMini valores={v.puntos.map((p) => p.valor)} etiquetas={v.puntos.map((p) => p.dia)} etiqueta="Serie de la respuesta del asistente" formato={v.formato === 'mxn' ? 'mxn' : 'numero'} />
      </div>
    );
  }
  return (
    <div className="rv-ob__visual rv-ob__visual--ancho">
      <dl className="rv-ob__datos" aria-label="Datos de la respuesta del asistente">
        {v.filas.map(([k, val]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="cifra-mono">{val}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ChatEntrevista({
  preguntaInicial, preguntaIdInicial, chipsIniciales, perfilListoInicial, sufijo, formulario,
}: {
  preguntaInicial: string | null;
  /** Id de la pregunta vigente: el servidor rechaza una respuesta a otra (A36-R01-03). */
  preguntaIdInicial?: string | null;
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
  const [preguntaId, setPreguntaId] = useState<string | null | undefined>(preguntaIdInicial);
  const [listo, setListo] = useState(perfilListoInicial);
  const [recomendar, setRecomendar] = useState(false);
  const [menuAdjuntar, setMenuAdjuntar] = useState(false);
  const [documento, setDocumento] = useState<{ nombre: string; extracto: string } | null>(null);
  const [fasePensando, setFasePensando] = useState('Pensando…');
  const [pasosVivos, setPasosVivos] = useState<Array<{ tool: string; listo: boolean }>>([]);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const inputImagen = useRef<HTMLInputElement>(null);
  const inputCamara = useRef<HTMLInputElement>(null);
  const botonClip = useRef<HTMLButtonElement>(null);
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
          ...(preguntaId !== undefined ? { preguntaId } : {}),
        }),
        // >= maxDuration de la ruta (120 s): abortar antes dejaba al servidor
        // guardando mientras la pantalla decía que no (A36-R15-04).
        signal: AbortSignal.timeout(125_000),
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
      if (d && (typeof d.siguienteId === 'string' || d.siguienteId === null)) setPreguntaId(d.siguienteId as string | null);
      if (d?.perfilListo === true) setListo(true);
    } catch {
      setHistorial((h) => [...h.slice(0, -1), {
        q: mostrado,
        r: { texto: 'Se cortó la conexión. No pude confirmar si se guardó: revisa tu perfil (Operadores, Unidades, Fiscal) antes de repetir la respuesta, o usa el formulario.' },
      }]);
    } finally {
      clearInterval(relojFases);
      setPasosVivos([]);
      setOcupado(false);
    }
  }

  const puedeEnviar = Boolean(texto.trim() || documento) && !ocupado;

  const caja = (
    <form onSubmit={(e) => { e.preventDefault(); preguntar(texto); }} className="rv-ob__caja">
      <MenuAdjuntar abierto={menuAdjuntar} onCerrar={() => setMenuAdjuntar(false)} ancla={botonClip}
      onCamara={() => inputCamara.current?.click()} onImagen={() => inputImagen.current?.click()} onArchivo={() => inputArchivo.current?.click()} />
      {documento && (
        <div className="rv-ob__adjunto">
          <Icono icono={FileText} tam={14} />
          <span>{documento.nombre}</span>
          <button type="button" aria-label="Quitar archivo" onClick={() => setDocumento(null)} className="rv-icono-boton">
            <Icono icono={X} tam={14} />
          </button>
        </div>
      )}
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={documento ? `Pregunta sobre «${documento.nombre}» o tu operación…` : 'Pregunta sobre tu operación…'}
        aria-label="Pregunta sobre tu operación"
        className="rv-ob__campo" data-anillo="envolvente"
      />
      <div className="rv-ob__barra">
        <Boton variante="primary" tamano="sm" icono={<Icono icono={Search} tam={14} />} onClick={() => setRecomendar((v) => !v)}>
          Consulta
        </Boton>

        <div className="rv-ob__herramientas">
          <input ref={inputCamara} type="file" accept="image/*" capture="environment" className="rv-ob__archivo"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerArchivo(f); }} />
          <input ref={inputImagen} type="file" accept="image/*" className="rv-ob__archivo"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerArchivo(f); }} />
          <input ref={inputArchivo} type="file" accept="image/*,.pdf,.xlsx,.xls,.csv,.tsv,.ods,.xml,.txt,.json,.md" className="rv-ob__archivo"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerArchivo(f); }} />
          <button ref={botonClip} type="button" aria-label="Adjuntar comprobante" title="Adjuntar comprobante"
            onClick={() => setMenuAdjuntar((v) => !v)} disabled={ocupado} className="rv-icono-boton">
            <Icono icono={Paperclip} />
          </button>
          <button type="submit" aria-label="Enviar" disabled={!puedeEnviar} className="rv-icono-boton rv-ob__enviar">
            <Icono icono={ArrowUp} />
          </button>
        </div>
      </div>
    </form>
  );

  const panelConsulta = recomendar && (
    <div className="rv-ob__temas">
      {CATALOGO_CONSULTA.map((c) => (
        <div key={c.categoria} className="rv-ob__tema">
          <div className="rv-ob__tema-titulo">{c.categoria}</div>
          {c.preguntas.map((rq) => (
            <button key={rq} type="button" className="rv-ob__pregunta"
              onClick={() => { setRecomendar(false); preguntar(rq); }}>
              {rq}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  const chipsRow = chips.length > 0 && (
    <div className="rv-ob__chips" data-portada={vacio || undefined}>
      {chips.map((c) => (
        <button key={c.valor} type="button" onClick={() => preguntar(c.valor, c.etiqueta)} className="rv-chip">
          {c.etiqueta}
        </button>
      ))}
    </div>
  );

  const pillListo = listo && (
    <div className="rv-ob__listo">
      <BotonEnlace href={`/dashboard${sufijo}`} variante="secondary" tamano="sm">Ir al panel</BotonEnlace>
    </div>
  );

  if (!vacio) {
    return (
      <div className="rv-ob__lienzo">
        {pillListo}
        <div className="rv-ob__conversacion">
          <div className="rv-ob__hilo-col">
            <div className="rv-ob__hilo">
              {historial.map((h, i) => (
                <div key={i}>
                  <div className="rv-ob__q-fila"><div className="rv-ob__q">{h.q}</div></div>
                  <div className="rv-ob__r">
                    {h.r.pendiente ? (
                      <div className="rv-ob__pensando">
                        <span className="likida-respira rv-ob__pensando-icono"><LogoIcono alto="h-[16px]" /></span>
                        <div>
                          <div className="rv-ob__fase">{fasePensando}</div>
                          {pasosVivos.length > 0 && (
                            <div className="rv-ob__pasos">
                              {pasosVivos.map((p, j) => (
                                <div key={j} className="rv-ob__paso" data-listo={p.listo || undefined}>
                                  {p.listo
                                    ? <span className="rv-ob__paso-ok"><Icono icono={Check} tam={14} /></span>
                                    : <span className="skeleton rv-ob__paso-pend" />}
                                  {rotuloPaso(p.tool)}{p.listo ? '' : '…'}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rv-ob__r-texto">{h.r.texto}</div>
                    )}
                    {h.r.visual && <VisualRespuesta v={h.r.visual} />}
                  </div>
                </div>
              ))}
              <div ref={finConversacion} />
            </div>
            <div className="rv-ob__pie">
              {panelConsulta}
              {!recomendar && chipsRow}
              {caja}
              {formulario}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rv-ob__lienzo">
      <CampoPixeles />
      {pillListo}
      <div className="rv-ob__portada">
        <div className="rv-ob__columna">
          <Logo alto="h-7" className="rv-ob__marca" />
          <p className="rv-ob__lead">
            {preguntaInicial
              ?? (listo
                ? 'Puedes corregir lo declarado. El motor usa esto en el próximo cuadre — no se supone nada nuevo.'
                : 'Fiscal, sistemas y operación. Adjunta la constancia o un PDF — y responde aquí. No supongo nada.')}
          </p>

          {caja}

          {recomendar ? (
            <div className={cx('rv-ob__formulario', menuAdjuntar && 'rv-ob__oculto')}>{panelConsulta}</div>
          ) : (
            <div className={menuAdjuntar ? 'rv-ob__oculto' : undefined}>{chipsRow}</div>
          )}

          <p className={cx('rv-ob__nota', menuAdjuntar && 'rv-ob__oculto')}>
            Cada cifra que el motor aplique sale de una declaración tuya o de un comprobante,
            nunca de un default. El estímulo de peaje (LIF 2026 art. 20-A) no se enciende hasta que lo declares.
          </p>
          {formulario && (
            <div className={cx('rv-ob__formulario', menuAdjuntar && 'rv-ob__oculto')}>{formulario}</div>
          )}
        </div>
      </div>
    </div>
  );
}
