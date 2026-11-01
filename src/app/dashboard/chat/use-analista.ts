'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { DashboardKpis, Acreditables } from '@/lib/likida/analytics';
import { mxn, litros } from '@/lib/formato';
import {
  FASES_PENSANDO, motivoDeFallo, respuestaDeBloques, respuestaLocal,
  type PasoTraza, type Respuesta,
} from './respuestas';

// ═══════════════════════════════════════════════════════════════════════════
// El estado y el transporte del chat (L5: salieron de `chat.tsx` SIN cambiar la lógica de datos). Mismas rutas, mismos cuerpos,
// mismos permisos: /api/dashboard/{chat,archivo,ingesta,conversaciones}. Lo nuevo es solo de experiencia:
//   · cada turno lleva un `id` y `nuevo` (solo los turnos de esta sesión se animan; un historial reabierto entra quieto);
//   · la generación se puede DETENER (AbortController) y un turno fallido se puede REINTENTAR;
//   · el tiempo de cada paso del agente se mide aquí (inicio → fin): es lo único que la traza muestra además del rótulo.
// ═══════════════════════════════════════════════════════════════════════════

export interface Turno { id: string; q: string; r: Respuesta; nuevo: boolean }
export type Conversacion = { id: string; titulo: string; actualizadoEn: string };

const TIEMPO_MAXIMO_MS = 75_000;
let contador = 0;
const nuevoId = () => `t-${Date.now().toString(36)}-${++contador}`;
const hora = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Lee un archivo del navegador como data URL (misma lectura que antes). */
function leerDataUrl(archivo: File): Promise<string> {
  return new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(archivo);
  });
}

export function useAnalista({ kpis, acred }: { kpis: DashboardKpis | null; acred: Acreditables | null }) {
  const sp = useSearchParams();
  const tenant = sp.get('tenant');
  const [historial, setHistorial] = useState<Turno[]>([]);
  const [ocupado, setOcupado] = useState(false);
  /** Solo mientras el AGENTE genera una respuesta (no al leer un archivo): es lo que se puede detener. */
  const [generando, setGenerando] = useState(false);
  const [documento, setDocumento] = useState<{ nombre: string; extracto: string } | null>(null);
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  const [convs, setConvs] = useState<Conversacion[] | 'error' | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [fasePensando, setFasePensando] = useState('Pensando…');
  // La secuencia REAL de tools del turno en curso (streaming NDJSON del servidor): 'inicio' agrega un renglón, 'fin' palomea el suyo.
  const [pasosVivos, setPasosVivos] = useState<PasoTraza[]>([]);
  const control = useRef<AbortController | null>(null);
  const detenido = useRef(false);

  // La lista del panel Historial — se carga al montar para que el botón traiga su conteo real.
  useEffect(() => {
    let vivo = true;
    fetch(`/api/dashboard/conversaciones${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (vivo) setConvs(Array.isArray(d?.conversaciones) ? d.conversaciones : 'error'); })
      .catch(() => { if (vivo) setConvs('error'); });
    return () => { vivo = false; };
  }, [tenant]);

  const agregar = (q: string, r: Respuesta) => setHistorial((h) => [...h, { id: nuevoId(), q, r, nuevo: true }]);

  async function leerArchivo(archivo: File, limpiar: () => void) {
    if (ocupado) return;
    if (!archivo.type.startsWith('image/')) {
      // Lector universal (12-ago): PDF, Excel, CSV, XML de CFDI, texto… El extracto regresa acotado y se ADJUNTA a la conversación.
      setOcupado(true);
      const etiqueta = `Adjuntar: ${archivo.name}`;
      try {
        const b64 = await leerDataUrl(archivo);
        const resp = await fetch('/api/dashboard/archivo', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: archivo.name, contenido: b64 }),
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        });
        const d = await resp.json().catch(() => null);
        if (!resp.ok || !d?.extracto) {
          agregar(etiqueta, { texto: d?.error ?? 'No se pudo leer el archivo en este momento.' });
          return;
        }
        setDocumento({ nombre: archivo.name, extracto: d.extracto });
        agregar(etiqueta, {
          texto: `Listo, leí «${archivo.name}» y lo tengo a la mano en esta conversación — pregúntame lo que quieras sobre él.`,
          visual: Array.isArray(d.meta) && d.meta.length > 0 ? { tipo: 'tabla', filas: d.meta as Array<[string, string]> } : undefined,
        });
      } catch {
        agregar(etiqueta, { texto: 'No se pudo leer el archivo en este momento.' });
      } finally {
        setOcupado(false);
        limpiar();
      }
      return;
    }
    setOcupado(true);
    const etiquetaQ = `Leer comprobante: ${archivo.name}`;
    try {
      const dataUrl = await leerDataUrl(archivo);
      // H14 (auditoría 24): esta llamada manda `?tenant=` como sus hermanas — un superadmin previsualizando una flota
      // (`?tenant=X&vista=…`) corre el OCR contra ESA flota, no contra su propia sesión.
      const resp = await fetch(`/api/dashboard/ingesta${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagen: dataUrl }),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok || !d) {
        agregar(etiquetaQ, { texto: d?.error ?? 'No se pudo leer la imagen en este momento.' });
        return;
      }
      if (!d.legible) {
        agregar(etiquetaQ, { texto: `El motor no pudo leer este papel${d.motivo ? ` (${d.motivo})` : ''}. Con una foto más cercana y sin reflejos suele salir.` });
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
      agregar(etiquetaQ, {
        texto: 'Esto fue lo que el motor leyó del papel — lectura de prueba, no se registró ningún gasto.',
        visual: filas.length > 0 ? { tipo: 'tabla', filas } : undefined,
      });
    } catch {
      agregar(etiquetaQ, { texto: 'No se pudo leer la imagen en este momento.' });
    } finally {
      setOcupado(false);
      limpiar();
    }
  }

  /** Reabre una conversación guardada: sus mensajes bajan al hilo y las visuales se re-pintan desde los bloques crudos.
   *  Devuelve `true` si abrió (la interfaz cierra el historial). Un historial reabierto NO se anima. */
  async function cargarConversacion(id: string): Promise<boolean> {
    if (ocupado) return false;
    setErrorCarga(null);
    try {
      const resp = await fetch(`/api/dashboard/conversaciones/${id}${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`);
      const d = await resp.json().catch(() => null);
      if (!resp.ok || !d || !Array.isArray(d.mensajes)) throw new Error('respuesta inválida');
      const pares: Turno[] = [];
      for (const m of d.mensajes as Array<{ rol: string; texto: string; bloques: unknown }>) {
        if (m.rol === 'usuario') {
          pares.push({ id: nuevoId(), q: m.texto, r: { texto: '' }, nuevo: false });
        } else if (pares.length > 0) {
          pares[pares.length - 1].r = Array.isArray(m.bloques) && m.bloques.length > 0
            ? respuestaDeBloques(m.bloques as Array<Record<string, unknown>>)
            : { texto: m.texto };
        }
      }
      setHistorial(pares);
      setConversacionId(id);
      setDocumento(null);
      return true;
    } catch {
      setErrorCarga('No se pudo abrir esa conversación — inténtalo de nuevo.');
      return false;
    }
  }

  function nuevoChat() {
    control.current?.abort();
    setHistorial([]);
    setConversacionId(null);
    setDocumento(null);
  }

  /** Detiene la generación en curso: el turno queda como «Generación detenida» y la caja vuelve a estar libre.
   *  LÍMITE CONOCIDO (seguimiento, NO se cambia la ruta en L5): esto solo ABORTA el fetch del cliente. `api/dashboard/chat` no escucha
   *  `req.signal`: el servidor termina de generar y guardar, así que puede quedar una conversación huérfana con la pregunta que ya no
   *  se ve, y Reintentar / Regenerar vuelven a preguntar lo mismo y pueden guardar el intercambio DOS veces. */
  function detener() {
    detenido.current = true;
    control.current?.abort();
  }

  function preguntar(q: string) {
    if (!q.trim() || ocupado) return;
    // TODO mensaje va al agente (12-ago: "no quiero respuestas prehechas"). El orquestador del servidor decide el modelo; el
    // respondedor local de palabras clave queda SOLO como paracaídas si el API falla.
    void preguntarAnalista(q, null);
  }

  /** Vuelve a preguntar lo mismo al analista: sustituye ese turno (Reintentar tras un fallo, Regenerar en el último). */
  function repetir(idTurno: string) {
    if (ocupado) return;
    const t = historial.find((x) => x.id === idTurno);
    if (t) void preguntarAnalista(t.q, idTurno);
  }

  async function preguntarAnalista(q: string, reemplazar: string | null) {
    setOcupado(true);
    setGenerando(true);
    setFasePensando('Pensando…');
    setPasosVivos([]);
    detenido.current = false;
    const ctl = new AbortController();
    control.current = ctl;
    const idTurno = reemplazar ?? nuevoId();
    const pendiente: Turno = { id: idTurno, q, r: { texto: 'Pensando…', pendiente: true }, nuevo: true };
    // Lo previo es lo ANTERIOR al turno que se pregunta (al reintentar, solo lo que iba antes de él).
    const base = reemplazar ? historial.slice(0, historial.findIndex((x) => x.id === reemplazar)) : historial;
    setHistorial(reemplazar ? [...base, pendiente] : [...historial, pendiente]);
    // El intervalo cuenta su propio tiempo (700ms × ticks) en vez de leer Date.now(): mismo comportamiento a la precisión que estas
    // fases necesitan, y sin llamadas impuras que `react-hooks/purity` no puede probar seguras.
    let ticks = 0;
    const relojFases = setInterval(() => {
      ticks += 1;
      const t = ticks * 700;
      const fase = [...FASES_PENSANDO].reverse().find(([desde]) => t >= desde);
      if (fase) setFasePensando(fase[1]);
    }, 700);
    // Sin tope, un servidor colgado dejaba "pensando…" para siempre (reportado en vivo el 12-ago).
    const tope = setTimeout(() => ctl.abort(), TIEMPO_MAXIMO_MS);
    const t0 = performance.now();
    const inicios = new Map<string, number>();
    const pasosFinales: PasoTraza[] = [];
    const reemplazarTurno = (r: Respuesta) =>
      setHistorial((h) => h.map((x) => (x.id === idTurno ? { ...x, r } : x)));
    try {
      const previos = base.flatMap((h) => [
        { rol: 'usuario' as const, texto: h.q },
        { rol: 'asistente' as const, texto: h.r.texto },
      ]);
      const resp = await fetch(`/api/dashboard/chat${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: [...previos, { rol: 'usuario', texto: q }], documento, conversacionId }),
        signal: ctl.signal,
      });
      // El endpoint transmite NDJSON (la secuencia de pensamiento en vivo); los caminos de tope siguen contestando JSON plano — se
      // entienden ambos, y un evento ilegible se ignora sin tumbar el turno.
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
                inicios.set(tool, performance.now());
                setPasosVivos((p) => [...p, { tool, listo: false }]);
              } else {
                const ini = inicios.get(tool);
                const ms = ini === undefined ? undefined : Math.round(performance.now() - ini);
                pasosFinales.push({ tool, listo: true, ms });
                setPasosVivos((p) => {
                  // findLastIndex a mano: el target de TS de este repo no lo trae.
                  let idx = -1;
                  for (let i = p.length - 1; i >= 0; i--) {
                    if (p[i].tool === tool && !p[i].listo) { idx = i; break; }
                  }
                  if (idx >= 0) return p.map((x, i) => (i === idx ? { ...x, listo: true, ms } : x));
                  return [...p, { tool, listo: true, ms }];
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
      // H4 (auditoría 24) + A41-AG-01: el fallo llega por DOS puertas — dentro del NDJSON (`{t:'error'}` con `resp.ok` en 200) y como
      // ESTADO HTTP (401/403/429/400/503, sin `t`). `motivoDeFallo` mira las dos; mirando sólo la primera, las respuestas con estado se
      // disfrazaban de respuesta normal. `respuestaLocal` lo declara antes de dar la de reserva — «fallar cerrado y decirlo».
      const motivo = motivoDeFallo(resp, d);
      const bloques = resp.ok && d && Array.isArray(d.bloques) ? (d.bloques as Array<Record<string, unknown>>) : null;
      const delAnalista = bloques !== null;
      const r: Respuesta = bloques
        ? respuestaDeBloques(bloques as Array<Record<string, unknown>>)
        : respuestaLocal(q, kpis, acred, motivo);
      r.origen = delAnalista ? 'analista' : 'reserva';
      r.hora = hora();
      r.ms = Math.round(performance.now() - t0);
      if (pasosFinales.length > 0) r.pasos = pasosFinales;
      if (!delAnalista && motivo) r.fallo = true;
      // El servidor guardó el intercambio (0088) y dice en qué conversación: se ancla para los turnos siguientes y la lista del panel
      // se actualiza localmente (la verdad completa se relee al reabrir la página).
      if (resp.ok && d && typeof d.conversacionId === 'string') {
        const idConv = d.conversacionId;
        setConversacionId(idConv);
        setConvs((prev) => {
          if (!Array.isArray(prev)) return prev;
          const ya = prev.find((c) => c.id === idConv);
          const fila = ya ?? { id: idConv, titulo: q.replace(/\s+/g, ' ').trim().slice(0, 60), actualizadoEn: new Date().toISOString() };
          return [{ ...fila, actualizadoEn: new Date().toISOString() }, ...prev.filter((c) => c.id !== idConv)];
        });
      }
      reemplazarTurno(r);
    } catch {
      if (detenido.current) {
        reemplazarTurno({ texto: 'Generación detenida. Puedes volver a preguntar cuando quieras.', cancelada: true, hora: hora() });
      } else {
        // Mismo caso que arriba: el `fetch` reventó (red, timeout de 75 s) — el analista tampoco corrió, y hay que decirlo.
        const r = respuestaLocal(q, kpis, acred, 'no se pudo conectar con el analista');
        reemplazarTurno({ ...r, origen: 'reserva', fallo: true, hora: hora(), ms: Math.round(performance.now() - t0) });
      }
    } finally {
      clearInterval(relojFases);
      clearTimeout(tope);
      control.current = null;
      setPasosVivos([]);
      setGenerando(false);
      setOcupado(false);
    }
  }

  return {
    historial, ocupado, generando, documento, setDocumento, conversacionId, convs, errorCarga, fasePensando, pasosVivos,
    preguntar, repetir, detener, nuevoChat, cargarConversacion, leerArchivo,
  };
}
