'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EL CEREBRO DE VENTAS: el mundo virtual de la cartera. México entero respirando, cada prospecto una luz con el color de su etapa del
// embudo. Se navega país → estado (zoom animado) → calles (Leaflet). Se refresca solo (por delta, con la pestaña a la vista).
//
// Fase 6 (rediseño de la piel): marco, cifras, filtros en cajón, listas y barras del sistema (ui-v2); los colores del embudo salen de
// los tokens --chart-n por `data-etapa` (cerebro.css) y no hay emojis, hex ni `style=` en el JSX. Se conservan TODAS las capacidades:
// mapa con cámara libre, latido por delta, filtros (orden, radio, similitud, necesidad, toque…), exportación CSV con rastro en la
// bitácora, ficha por prospecto, mensajes del agente experto y el ala izquierda de las pantallas de 1900 px o más.
// La lógica de la cartera (filtrar, ordenar, radio, CSV) vive en ./filtros.ts y está fijada con pruebas.
// Los % son estimaciones deterministas; el pie enseña el criterio con las mismas palabras del módulo que las calcula (CRITERIO_SCORES).
// ═══════════════════════════════════════════════════════════════════════════

import { leerRespuestaMensaje } from './respuesta_mensaje';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Download, Flame, Mail, Maximize2, Minimize2, Navigation, Phone, RefreshCw, SlidersHorizontal, Sparkles, Undo2, User, UserCheck, X,
} from 'lucide-react';
import { proyectar } from '../../dashboard/mapa/mexico-geo';
import { ESTADOS_GEO, VIEWBOX_ESTADOS, type EstadoGeo } from './mexico-estados-geo';
import {
  COLOR_EMBUDO, NOMBRE_GIRO, CRITERIO_SCORES, TAMANOS, desempacar,
  esProspectoTerminal,
  type DatosMapa, type Giro, type ProspectoMapa, type Tamano, type TextosProspecto,
} from '@/lib/admin/prospectos-mapa-client';
import { fechaHoraMx, numero, hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { useT } from '@/lib/i18n/proveedor';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { usePrefersReducedMotion } from '../ui/prefers-reduced-motion';
import {
  Boton, Campo, CampoSelect, Fieldset, Disclosure, Drawer, FilaTarjetas, Icono, SegmentedControl, Tarjeta, clasesBoton, cx,
} from '../../ui-v2/componentes';
import { BarList, TiraCifras } from '../../ui-v2/graficas';
import { idsSinTextos } from './csv_prospectos';
import { hrefWa, hrefCorreo, esperandoTextos } from './mensajes';
import { arrancarLatido, visibilidadDelNavegador } from './latido';
import { accionRegistrarExportacion } from './acciones-exportar';
import {
  SIN_FILTROS, alternarEnSet, contarFiltrosActivos, csvDe, filtrarProspectos, ordenarProspectos, plazasDe, type Filtros,
} from './filtros';
import './cerebro.css';

const Calles = dynamic(() => import('./calles'), { ssr: false });

const ORDEN_EMBUDO = [
  'negociacion', 'proposal', 'pilot', 'demo', 'appointment', 'rescheduled',
  'no-show', 'cancelled', 'contactado', 'nuevo', 'won', 'cerrado', 'lost', 'perdido',
] as const;
const GIROS: Giro[] = ['transportista', 'embotelladora', 'abarrotes_mayoreo', 'flota_propia', 'logistica', 'otro'];
const FUENTES = [
  { clave: 'censo', nombre: 'Censo (vacantes)' },
  { clave: 'denue', nombre: 'Universo DENUE' },
  { clave: 'canacar', nombre: 'Directorio CANACAR' },
  { clave: 'bolsa', nombre: 'Bolsas (histórico)' },
  { clave: 'aaag', nombre: 'Padrón AAAG' },
  { clave: 'scribd-tampico', nombre: 'Directorio Tampico' },
  { clave: 'manual', nombre: 'Cuentas a mano' },
  { clave: 'landing', nombre: 'Landing orgánica' },
  { clave: 'campana', nombre: 'Campaña directa' },
  { clave: 'ads-meta', nombre: 'Ads Meta' },
  { clave: 'ads-google', nombre: 'Ads Google' },
] as const;

/** Con más de este número de luces a nivel país, el DOM se arrastra: se enseñan las N más calientes y el pie lo DICE (nunca se recorta callado). */
const TOPE_LUCES_PAIS = 2200;

/** Cada cuánto pregunta el mapa por lo que cambió. Con el delta de FE-16 ya no cuesta el universo, pero la cadencia se respeta: el
 *  Cerebro es un tablero de venta, no un monitor de tiempo real. */
const LATIDO_MS = 300_000;
/** Cuántos ids por petición de textos: el mismo tope que acepta la ruta. */
const IDS_POR_TANDA = 2_000;
/** Referencia estable para «no hay estado elegido»: un `[]` nuevo por render invalida los `useMemo` que dependen de la lista. */
const SIN_LISTA: ProspectoMapa[] = [];

const SIN_TEXTOS = (id: string): TextosProspecto =>
  ({ id, notas: null, mensajeWaIa: null, correoAsuntoIa: null, correoCuerpoIa: null });

const TAMANOS_UI: Array<Tamano | 'n/d'> = [...TAMANOS, 'n/d'];

/** Opción de un conjunto aditivo (giro, etapa, tamaño, fuente): botón de dos estados, el activo con el azul del sistema. */
function Opcion({ activo, etapa, onClick, children }: { activo: boolean; etapa?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="cer-op" aria-pressed={activo} onClick={onClick}>
      {etapa ? <i className="cer-punto" data-etapa={etapa} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Elección única entre pocos valores numéricos («Todas», ≥40 %, ≥65 %…). Elegir «Todas» apaga el criterio. */
function Elige<T extends number>({ etiqueta, valor, valores, rotulo, onChange }: {
  etiqueta: string; valor: T; valores: readonly T[]; rotulo: (v: T) => string; onChange: (v: T) => void;
}) {
  return (
    <SegmentedControl
      etiqueta={etiqueta} tamano="sm" valor={String(valor)}
      opciones={valores.map((v) => ({ valor: String(v), etiqueta: rotulo(v) }))}
      onChange={(v) => onChange(Number(v) as T)}
    />
  );
}

/** Barra de % (urgencia, cierre, ICP, necesidad): SVG con el riel y el relleno, el color por serie sale de cerebro.css. */
export function BarraPct({ etiqueta, pct, serie }: { etiqueta: string; pct: number; serie: 'urgencia' | 'cierre' | 'icp' | 'necesidad' | 'datos' }) {
  const ancho = Math.min(100, Math.max(0, pct));
  return (
    <div className="cer-pct">
      <span className="cer-pct__etq">{etiqueta}</span>
      <svg className="cer-pct__pista" data-serie={serie} height="6" width="100%" aria-hidden="true">
        <rect className="cer-pct__riel" x="0" y="0" width="100%" height="6" rx="3" />
        <rect x="0" y="0" width={`${ancho}%`} height="6" rx="3" />
      </svg>
      <span className="cer-pct__val">{pct}%</span>
    </div>
  );
}

export function TarjetaProspecto({ p, t, nuevo, afinando, onAfinar, onToque, plana, avisoIa }: {
  p: ProspectoMapa;
  /** Los textos largos de ESTE prospecto (FE-16): llegan por su cuenta, poco después de que la tarjeta se pinta. `undefined` = todavía en camino. */
  t?: TextosProspecto;
  nuevo: boolean; afinando?: boolean; onAfinar?: (id: string) => void;
  onToque?: (id: string, canal: 'whatsapp' | 'correo') => void;
  /** true = tarjeta de sección (plana: abajo del mapa no hay país sobre el que flotar). */
  plana?: boolean;
  /** Lo que el servidor dijo al pedir «Mensaje IA» (error o aviso de que no se guardó): se muestra, no se traga. */
  avisoIa?: { texto: string; error: boolean } | null;
}) {
  // El mensaje del agente experto MANDA sobre la plantilla: mientras no llegue, el botón no se abre. Abrirlo con la plantilla mandaría
  // el texto equivocado, firmado por Javier, y eso no se deshace.
  const esperando = esperandoTextos(p, t);
  const c = COLOR_EMBUDO[p.estado] ?? COLOR_EMBUDO.nuevo;
  const BTN = clasesBoton('secondary', 'sm');
  return (
    <article className={cx('cer-prospecto', plana && 'cer-prospecto--plana')} data-nuevo={nuevo || undefined}>
      <div className="cer-prospecto__cab">
        <i className="cer-punto" data-etapa={p.estado in COLOR_EMBUDO ? p.estado : 'nuevo'} aria-hidden="true" />
        <div className="min-w-0">
          <Link href={`/admin/mapa-prospectos/${p.id}`} className="cer-prospecto__nombre">{p.empresa}</Link>
          <p className="cer-prospecto__meta">
            {c.nombre} · {NOMBRE_GIRO[p.giro]}
            {p.numUnidades !== null ? ` · ${numero(p.numUnidades)} unidades` : p.tamano ? ` · ${p.tamano} pers.` : ''}
            {p.ciudad ? ` · ${p.ciudad}` : ''} · datos {p.completitud}%
          </p>
        </div>
      </div>
      {(p.contacto || p.telefono || p.correo) && (
        <div className="cer-prospecto__contacto">
          {p.contacto && <p><Icono icono={User} tam={14} /><span>{p.contacto}</span></p>}
          {p.telefono && <p><Icono icono={Phone} tam={14} /><a href={`tel:${p.telefono}`}>{p.telefono}</a></p>}
          {p.correo && <p><Icono icono={Mail} tam={14} /><a href={`mailto:${p.correo}`}>{p.correo}</a></p>}
        </div>
      )}
      {p.vacante && <p className="cer-prospecto__tenue">Vacante: {p.vacante}</p>}
      {t?.notas && <p className="cer-prospecto__tenue cer-prospecto__notas" title={t.notas}>{t.notas}</p>}
      <BarraPct etiqueta="Urgencia" pct={p.urgencia} serie="urgencia" />
      <BarraPct etiqueta="Cierre" pct={p.cierre} serie="cierre" />
      <BarraPct etiqueta="ICP" pct={p.similitudIcpPct} serie="icp" />
      <BarraPct etiqueta="Necesid." pct={p.necesidadPct} serie="necesidad" />
      {p.mensajesGeneradosEn && (
        <p className="cer-prospecto__tenue">Con mensaje del agente experto listo</p>
      )}
      {p.ultimoToque && (
        <p className="cer-prospecto__tenue">Último toque: {fechaHoraMx(p.ultimoToque)}</p>
      )}
      {(p.telefono || p.correo || p.lat !== null) && (
        <div className="cer-prospecto__acciones">
          {p.telefono && (esperando ? (
            <span aria-disabled className={BTN} title="El mensaje que redactó el agente experto viene en camino">WhatsApp …</span>
          ) : (
            <a href={hrefWa(p, t)!} target="_blank" rel="noreferrer" onClick={() => onToque?.(p.id, 'whatsapp')} className={BTN}>WhatsApp →</a>
          ))}
          {p.correo && (esperando ? (
            <span aria-disabled className={BTN} title="El correo que redactó el agente experto viene en camino">Correo …</span>
          ) : (
            <a href={hrefCorreo(p, t)!} onClick={() => onToque?.(p.id, 'correo')} className={BTN}>Correo →</a>
          ))}
          {p.lat !== null && (
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`} target="_blank" rel="noreferrer" className={BTN}>
              <Icono icono={Navigation} tam={14} />Cómo llegar
            </a>
          )}
          {onAfinar && !esProspectoTerminal(p.estado) && (p.telefono || p.correo) && (
            <button type="button" onClick={() => onAfinar(p.id)} disabled={afinando}
              title="El agente experto redacta el primer toque con toda la info de este prospecto" className={BTN}>
              <Icono icono={p.mensajesGeneradosEn ? RefreshCw : Sparkles} tam={14} />
              {afinando ? 'Redactando…' : p.mensajesGeneradosEn ? 'IA' : 'Mensaje IA'}
            </button>
          )}
        </div>
      )}
      {avisoIa && (
        <p role="alert" className={avisoIa.error ? 'cer-prospecto__error' : 'cer-prospecto__aviso'}>{avisoIa.texto}</p>
      )}
    </article>
  );
}

export function Cerebro({ inicial, estadoInicial }: { inicial: DatosMapa; estadoInicial?: string }) {
  const reducido = usePrefersReducedMotion();
  const tr = useT('shell', shellEs);
  // ── LA CARTERA, LIGERA (FE-16) ───────────────────────────────────────────
  // Llega empacada en tuplas y sin los textos largos; se desempaca UNA vez.
  // `listaRef` es la misma lista, accesible desde los manejadores sin
  // arrastrar el valor viejo de un closure (el latido corre cada 5 min).
  const [prospectos, setProspectos] = useState<ProspectoMapa[]>(() => inicial.filas.map(desempacar));
  const listaRef = useRef<ProspectoMapa[]>(prospectos);
  const ponerLista = useCallback((nueva: ProspectoMapa[]) => {
    listaRef.current = nueva;
    setProspectos(nueva);
  }, []);
  const [generadoEn, setGeneradoEn] = useState(inicial.generadoEn);
  /** La marca de agua del delta: hasta aquí ya sabemos. */
  const marca = useRef<string | null>(inicial.marca);
  const [seleccion, setSeleccion] = useState<EstadoGeo | null>(
    () => ESTADOS_GEO.find((e) => e.nombre === estadoInicial) ?? null,
  );
  const [hover, setHover] = useState<string | null>(null);
  const [calles, setCalles] = useState(false);
  const conocidos = useRef<Set<string>>(new Set(prospectos.map((p) => p.id)));
  const [recientes, setRecientes] = useState<Set<string>>(new Set());

  // ── LOS TEXTOS LARGOS, A PEDIDO (FE-16) ──────────────────────────────────
  // `notas` y los mensajes del agente experto son 15.3 MB del universo y solo
  // se pintan en las tarjetas abiertas, el popup de calles y el CSV. Se piden
  // por id y se guardan aquí. El ref es la verdad (el exportador de CSV lo lee
  // en cuanto llega, sin esperar un render); el estado es la copia que hace
  // repintar las tarjetas.
  const textosRef = useRef<Map<string, TextosProspecto>>(new Map());
  const obtenerTextos = useCallback((id: string) => textosRef.current.get(id), []);
  const [textos, setTextos] = useState<ReadonlyMap<string, TextosProspecto>>(() => new Map());
  const pedidos = useRef<Set<string>>(new Set());
  const pedirTextos = useCallback(async (ids: string[]): Promise<void> => {
    const faltan = [...new Set(ids)].filter((id) => !pedidos.current.has(id));
    if (faltan.length === 0) return;
    faltan.forEach((id) => pedidos.current.add(id));
    for (let i = 0; i < faltan.length; i += IDS_POR_TANDA) {
      const tanda = faltan.slice(i, i + IDS_POR_TANDA);
      try {
        const r = await fetch('/api/admin/mapa-prospectos/textos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: tanda }),
        });
        if (!r.ok) throw new Error(String(r.status));
        const { textos: llegaron } = (await r.json()) as { textos: TextosProspecto[] };
        for (const t of llegaron) textosRef.current.set(t.id, t);
        // Al que NO contestó (borrado entre el listado y esta pregunta) se le
        // anota "sin textos": si no, la tarjeta lo esperaría para siempre y
        // sus botones se quedarían apagados.
        for (const id of tanda) if (!textosRef.current.has(id)) textosRef.current.set(id, SIN_TEXTOS(id));
      } catch {
        // Se sueltan para que un reintento (otro render, otro clic) los
        // vuelva a pedir — un fallo de red no puede apagar la tarjeta para
        // toda la sesión.
        tanda.forEach((id) => pedidos.current.delete(id));
      }
    }
    setTextos(new Map(textosRef.current));
  }, []);
  // Pantalla completa nativa: en el Odyssey 49 la zona ES el monitor entero.
  const zonaRef = useRef<HTMLElement>(null);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  useEffect(() => {
    const alCambiar = () => setPantallaCompleta(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', alCambiar);
    return () => document.removeEventListener('fullscreenchange', alCambiar);
  }, []);
  const alternarPantalla = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void zonaRef.current?.requestFullscreen();
  };

  // ── Filtros y orden (orden del 17-ago: "filtro y orden, muy chingón") ────
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const filtrosActivos = contarFiltrosActivos(filtros);
  const filtrados = useMemo(() => filtrarProspectos(prospectos, filtros, ahoraMs()), [prospectos, filtros]);
  // Las plazas con coordenadas (centro del radio): promedio por ciudad.
  const plazas = useMemo(() => plazasDe(prospectos), [prospectos]);
  const ordenar = useCallback((lista: ProspectoMapa[]) => ordenarProspectos(lista, filtros.orden), [filtros.orden]);
  // Ordenar 33 mil filas es caro y el render lo pedía DOS veces (el ala y la rejilla de abajo). Una sola vez por cambio de filtro/orden.
  const ordenados = useMemo(() => ordenar(filtrados), [ordenar, filtrados]);

  const [exportando, setExportando] = useState(false);
  const [errorExport, setErrorExport] = useState<string | null>(null);
  const exportarCsv = async () => {
    const lista = ordenados;
    setExportando(true);
    setErrorExport(null);
    try {
      // ADM-8 (auditoría 24): la exportación no dejaba NINGÚN rastro — un
      // clic descargaba hasta 33k filas con teléfono/correo de decisores
      // sin una sola entrada en bitácora. Se registra ANTES de armar el
      // archivo (si el navegador se cierra a medio streaming, el intento ya
      // quedó firmado) con el conteo y los filtros elegidos — nunca los
      // datos de los prospectos. A37-S06-05: FAIL-CLOSED — si el registro
      // falla (sesión/MFA vencida, red) NO hay descarga: datos personales
      // (LFPDPPP) sin rastro no salen.
      await accionRegistrarExportacion(lista.length, {
        giros: filtros.giros ? [...filtros.giros] : null,
        etapas: filtros.etapas ? [...filtros.etapas] : null,
        fuentes: filtros.fuentes ? [...filtros.fuentes] : null,
        tamanos: filtros.tamanos ? [...filtros.tamanos] : null,
        minUrgencia: filtros.minUrgencia, soloTel: filtros.soloTel, soloDecisor: filtros.soloDecisor,
        orden: filtros.orden, minCompletitud: filtros.minCompletitud,
        minSimilitud: filtros.minSimilitud, minNecesidad: filtros.minNecesidad,
        sinToqueDias: filtros.sinToqueDias, soloMensajeIA: filtros.soloMensajeIA, soloVacante: filtros.soloVacante,
        radioKm: filtros.radioKm,
      });
      // La columna `notas` ya no viene en el listado: se pide para las filas
      // que se van a exportar (en tandas) ANTES de armar el archivo. El CSV
      // sale igual de completo que antes; lo que cambió es cuándo se paga.
      const ids = lista.map((p) => p.id);
      await pedirTextos(ids);
      // A37-S06-06: si algún lote de textos falló, el CSV saldría "completo"
      // con la columna notas vacía: se aborta con aviso en vez de éxito falso.
      const faltan = idsSinTextos(ids, textosRef.current);
      if (faltan.length > 0) {
        setErrorExport(`No se pudieron cargar las notas de ${faltan.length} prospectos; la exportación se canceló. Reintenta.`);
        return;
      }
      const blob = new Blob([csvDe(lista, textosRef.current)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      // El día de México: descargado a las 19:00 el archivo se llamaba con la
      // fecha de mañana, y el orden por nombre de dos exports seguidos mentía.
      a.download = `cerebro-prospectos-${hoyMx()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setErrorExport('No se pudo registrar la exportación en la bitácora; la descarga se canceló. Reintenta (revisa tu sesión).');
    } finally {
      setExportando(false);
    }
  };

  // ── El toque se registra solo (0130): al abrir WhatsApp/correo, fila al
  // historial — fuego y olvido, el link abre igual aunque la red falle. ────
  const tocar = (id: string, canal: 'whatsapp' | 'correo') => {
    // .catch() porque "la red falle" (el comentario de arriba) sin uno deja
    // una promesa rechazada sin atrapar — ruido de "Uncaught (in promise)" en
    // la consola del que use esto, por algo que a propósito no debe avisar.
    fetch('/api/admin/mapa-prospectos/toque', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, canal, estado: 'iniciado' }),
    }).catch(() => undefined);
  };

  // ── El agente experto en vivo: afinar el mensaje de UNA tarjeta ──────────
  const [afinando, setAfinando] = useState<string | null>(null);
  const [avisosIa, setAvisosIa] = useState<Map<string, { texto: string; error: boolean }>>(new Map());
  const ponerAviso = (id: string, a: { texto: string; error: boolean } | null) =>
    setAvisosIa((antes) => { const n = new Map(antes); if (a) n.set(id, a); else n.delete(id); return n; });
  const afinar = async (id: string) => {
    setAfinando(id);
    ponerAviso(id, null);
    try {
      const r = await fetch('/api/admin/mapa-prospectos/mensaje', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).then(leerRespuestaMensaje, () => ({ ok: false as const, error: 'No se pudo contactar al servidor. Revisa tu conexión.' }));
      if (!r.ok) { ponerAviso(id, { texto: r.error, error: true }); return; } // el boton sigue con la plantilla
      if (r.aviso) ponerAviso(id, { texto: r.aviso, error: false });
      const m = r.datos;
      // El texto recién redactado entra al cache de textos (es lo que abre el
      // botón) y la fila del listado solo se entera de la MARCA.
      textosRef.current.set(id, {
        id,
        notas: textosRef.current.get(id)?.notas ?? null,
        mensajeWaIa: m.mensajeWaIa, correoAsuntoIa: m.correoAsuntoIa, correoCuerpoIa: m.correoCuerpoIa,
      });
      pedidos.current.add(id);
      setTextos(new Map(textosRef.current));
      ponerLista(listaRef.current.map((p) => (p.id === id ? { ...p, mensajesGeneradosEn: m.mensajesGeneradosEn } : p)));
    } finally {
      setAfinando(null);
    }
  };

  // ── EL LATIDO, POR DELTA Y CON LA PESTAÑA A LA VISTA (FE-16) ────────────
  // Antes: cada 5 min, la cartera ENTERA (~33 MB), mirara alguien o no. Ahora
  // se pide `?desde=` la última marca — en reposo, cero filas — y solo
  // mientras la pestaña está visible (ver latido.ts).
  const aplicar = useCallback((d: DatosMapa): number => {
    if (d.marca) marca.current = d.marca;
    setGeneradoEn(d.generadoEn);
    const llegaron = d.filas.map(desempacar);
    const antes = listaRef.current;
    let siguiente: ProspectoMapa[];
    if (!d.delta) {
      siguiente = llegaron;
    } else if (llegaron.length === 0) {
      siguiente = antes;
    } else {
      // Los que ya estaban se reemplazan EN SU LUGAR (el orden del listado es
      // created_at desc y el orden "recientes" vive de él); los que no
      // estaban son altas y van hasta arriba, el más nuevo primero.
      const cambios = new Map(llegaron.map((p) => [p.id, p]));
      const conocidosYa = new Set(antes.map((p) => p.id));
      const altas = llegaron.filter((p) => !conocidosYa.has(p.id)).reverse();
      siguiente = [...altas, ...antes.map((p) => cambios.get(p.id) ?? p)];
    }
    const nuevos = new Set(llegaron.filter((p) => !conocidos.current.has(p.id)).map((p) => p.id));
    llegaron.forEach((p) => conocidos.current.add(p.id));
    ponerLista(siguiente);
    if (nuevos.size) setRecientes(nuevos);
    return siguiente.length;
  }, [ponerLista]);

  const pedirMapa = useCallback(async (desde: string | null): Promise<DatosMapa | null> => {
    const url = desde
      ? `/api/admin/mapa-prospectos?desde=${encodeURIComponent(desde)}`
      : '/api/admin/mapa-prospectos';
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null; // el mapa vigente sigue; no se pinta un fallo como vacío
    const d = (await r.json()) as DatosMapa;
    return d.fallo ? null : d;
  }, []);

  useEffect(() => arrancarLatido({
    intervaloMs: LATIDO_MS,
    ...visibilidadDelNavegador(),
    latir: async () => {
      try {
        const d = await pedirMapa(marca.current);
        if (!d) return;
        const cuantos = aplicar(d);
        // UN DELTA NO PUEDE VER UNA BAJA: una fila borrada no se actualiza,
        // desaparece. El servidor manda su conteo y, cuando no cuadra con el
        // nuestro, se pide la carga completa — que es exactamente lo que se
        // dejó de hacer cada cinco minutos, y aquí solo pasa cuando de verdad
        // se fue alguien.
        if (d.delta && d.total !== null && d.total !== cuantos) {
          const completo = await pedirMapa(null);
          if (completo) aplicar(completo);
        }
      } catch { /* sin red: el mapa vigente sigue */ }
    },
  }), [aplicar, pedirMapa]);

  const porEstado = useMemo(() => {
    const m = new Map<string, ProspectoMapa[]>();
    for (const p of filtrados) {
      if (!p.entidad) continue;
      const lista = m.get(p.entidad) ?? [];
      lista.push(p);
      m.set(p.entidad, lista);
    }
    for (const [k, lista] of m) m.set(k, ordenar(lista));
    return m;
  }, [filtrados, ordenar]);

  const sinPlaza = useMemo(() => filtrados.filter((p) => !p.entidad).length, [filtrados]);
  const maxEstado = useMemo(() => Math.max(1, ...[...porEstado.values()].map((l) => l.length)), [porEstado]);
  const conTelefono = useMemo(() => filtrados.filter((p) => p.telefono).length, [filtrados]);
  const conDecisor = useMemo(() => filtrados.filter((p) => p.contacto).length, [filtrados]);
  const calientes = useMemo(() => filtrados.filter((p) => p.urgencia >= 70).length, [filtrados]);

  // ── LA CÁMARA LIBRE (orden 17-ago: "completamente fluido") ───────────────
  // La cámara vive en un ref y se aplica DIRECTO al <g> (sin re-render por
  // frame): la rueda acerca hacia el cursor, el arrastre panea, el clic en
  // un estado VUELA hacia él con transición — y de ahí puedes rodar o
  // arrastrarte a otro estado sin regresar al país. `camK` es la copia en
  // estado de React (para el grosor de trazos y el radio de las luces) y se
  // sincroniza al SOLTAR el gesto, no a 60fps.
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const cam = useRef({ x: 0, y: 0, k: 1 });
  const [camK, setCamK] = useState(1);
  const arrastro = useRef(false);
  const arrastrando = useRef<{ cx: number; cy: number; acumulado: number } | null>(null);
  const sincro = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aplicarCam = (transicion: boolean) => {
    const g = gRef.current;
    if (!g) return;
    g.style.transition = transicion && !reducido ? 'transform 750ms cubic-bezier(.22,1,.36,1)' : 'none';
    g.style.transform = `translate(${cam.current.x}px, ${cam.current.y}px) scale(${cam.current.k})`;
  };

  /** Coordenadas de pantalla → unidades del viewBox (preserveAspectRatio meet). */
  const factorViewBox = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { f: 1, ox: 0, oy: 0, left: 0, top: 0 };
    const f = Math.min(r.width / VIEWBOX_ESTADOS.w, r.height / VIEWBOX_ESTADOS.h);
    return { f, ox: (r.width - VIEWBOX_ESTADOS.w * f) / 2, oy: (r.height - VIEWBOX_ESTADOS.h * f) / 2, left: r.left, top: r.top };
  };

  const volarA = (e: EstadoGeo | null) => {
    if (!e) {
      cam.current = { x: 0, y: 0, k: 1 };
    } else {
      const margen = 1.35;
      const k = Math.min(9, VIEWBOX_ESTADOS.w / (e.bw * margen), VIEWBOX_ESTADOS.h / (e.bh * margen));
      // El estado aterriza al centro-izquierda: el panel vive a la derecha.
      cam.current = {
        x: VIEWBOX_ESTADOS.w * 0.36 - k * e.cx,
        y: VIEWBOX_ESTADOS.h * 0.5 - k * e.cy,
        k,
      };
    }
    aplicarCam(true);
    setCamK(cam.current.k);
  };

  const alRodar = (ev: WheelEvent) => {
    ev.preventDefault();
    const { f, ox, oy, left, top } = factorViewBox();
    const px = (ev.clientX - left - ox) / f;
    const py = (ev.clientY - top - oy) / f;
    const { x, y, k } = cam.current;
    const k2 = Math.min(16, Math.max(1, k * Math.exp(-ev.deltaY * 0.0016)));
    if (k2 === k) return;
    cam.current = { x: px - ((px - x) * k2) / k, y: py - ((py - y) * k2) / k, k: k2 };
    if (k2 === 1) cam.current = { x: 0, y: 0, k: 1 }; // al fondo, el país completo
    aplicarCam(false);
    if (sincro.current) clearTimeout(sincro.current);
    sincro.current = setTimeout(() => setCamK(cam.current.k), 120);
  };

  // La rueda necesita listener NO pasivo (preventDefault) — React no lo da.
  // Y si la página llegó con un estado inicial (deep-link), la cámara vuela
  // hacia él al montar — la cámara imperativa no lo haría sola.
  useEffect(() => {
    if (seleccion) volarA(seleccion);
    else aplicarCam(false);
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', alRodar, { passive: false });
    return () => svg.removeEventListener('wheel', alRodar);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alRodar solo lee refs
  }, []);

  const alBajarPuntero = (ev: React.PointerEvent<SVGSVGElement>) => {
    arrastro.current = false;
    arrastrando.current = { cx: ev.clientX, cy: ev.clientY, acumulado: 0 };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  };
  const alMoverPuntero = (ev: React.PointerEvent<SVGSVGElement>) => {
    const a = arrastrando.current;
    if (!a) return;
    const { f } = factorViewBox();
    const dx = ev.clientX - a.cx;
    const dy = ev.clientY - a.cy;
    a.acumulado += Math.abs(dx) + Math.abs(dy);
    a.cx = ev.clientX;
    a.cy = ev.clientY;
    if (a.acumulado > 4) arrastro.current = true;
    cam.current = { ...cam.current, x: cam.current.x + dx / f, y: cam.current.y + dy / f };
    aplicarCam(false);
  };
  const alSoltarPuntero = () => {
    if (arrastrando.current) setCamK(cam.current.k);
    arrastrando.current = null;
  };

  const listaSeleccion = useMemo(
    () => (seleccion ? porEstado.get(seleccion.nombre) ?? SIN_LISTA : SIN_LISTA),
    [seleccion, porEstado],
  );

  // Los textos largos de LO QUE SE PINTA — 72 tarjetas como mucho, no 33 mil
  // filas. Se piden en cuanto cambia el conjunto visible; el cache descarta
  // lo ya pedido, así que volver a un estado no cuesta otra vuelta de red.
  const idsVisibles = useMemo(
    () => [...new Set([...ordenados.slice(0, 12), ...listaSeleccion.slice(0, 60)].map((p) => p.id))],
    [ordenados, listaSeleccion],
  );
  useEffect(() => { void pedirTextos(idsVisibles); }, [idsVisibles, pedirTextos]);
  const conCoords = useMemo(() => filtrados.filter((p) => p.lat !== null && p.lng !== null), [filtrados]);
  const TOPE_LUCES_ESTADO = 1500;
  const lucesRecortadas = seleccion === null
    ? conCoords.length > TOPE_LUCES_PAIS
    : conCoords.filter((p) => p.entidad === seleccion.nombre).length > TOPE_LUCES_ESTADO;
  const pines = useMemo(() => {
    // Con estado elegido solo se pintan SUS luces (las 30k del país detrás
    // eran el jank); a nivel país, las más calientes hasta el tope.
    const universo = seleccion ? conCoords.filter((p) => p.entidad === seleccion.nombre) : conCoords;
    const tope = seleccion ? TOPE_LUCES_ESTADO : TOPE_LUCES_PAIS;
    const base = universo.length > tope
      ? [...universo].sort((a, b) => (b.urgencia + b.cierre) - (a.urgencia + a.cierre)).slice(0, tope)
      : universo;
    return base.map((p) => ({ p, xy: proyectar(p.lat!, p.lng!) }));
  }, [conCoords, seleccion]);

  const porEtapa = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of filtrados) m.set(p.estado, (m.get(p.estado) ?? 0) + 1);
    return m;
  }, [filtrados]);
  const itemsEmbudo = useMemo(() => ORDEN_EMBUDO.map((e) => ({
    clave: e, etiqueta: COLOR_EMBUDO[e].nombre, valor: porEtapa.get(e) ?? 0, texto: numero(porEtapa.get(e) ?? 0),
  })), [porEtapa]);
  const itemsPlazas = useMemo(() => [...porEstado.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8)
    .map(([nombre, lista]) => ({ clave: nombre, etiqueta: nombre, valor: lista.length, texto: numero(lista.length) })), [porEstado]);

  const elegirEstado = (destino: EstadoGeo | null) => { setSeleccion(destino); volarA(destino); };
  const alPais = () => { setSeleccion(null); setCalles(false); volarA(null); };
  const enSeleccion = seleccion ? conCoords.filter((p) => p.entidad === seleccion.nombre).length : conCoords.length;

  return (
    <div className="cer-raiz">
      <TiraCifras etiqueta="Cartera filtrada" items={[
        { etiqueta: 'Prospectos', valor: filtrados.length, conteo: true },
        { etiqueta: 'Con teléfono', valor: conTelefono, conteo: true },
        { etiqueta: 'Con decisor', valor: conDecisor, conteo: true },
        { etiqueta: 'Urgentes', valor: calientes, conteo: true, nota: 'Urgencia de 70 % o más' },
      ]} />

      {/* ── Herramientas del mapa ───────────────────────────────────────── */}
      <div className="cer-barra">
        <p className="cer-barra__resumen" aria-live="polite">
          {seleccion
            ? `${seleccion.nombre}: ${numero(listaSeleccion.length)} prospectos`
            : 'Rueda para acercar, arrastra para moverte, toca un estado para volar a él. Se actualiza solo.'}
        </p>
        <div className="cer-barra__acciones">
          {(camK > 1.02 || seleccion) && (
            <Boton tamano="sm" icono={<Icono icono={Undo2} />} onClick={alPais} title="Volver al país">País</Boton>
          )}
          {/* Los dos atajos más pedidos: un clic, sin abrir el cajón. Mismo estado que los criterios de adentro. */}
          <Boton tamano="sm" className="cer-toggle" aria-pressed={filtros.soloDecisor} icono={<Icono icono={UserCheck} />}
            onClick={() => setFiltros((f) => ({ ...f, soloDecisor: !f.soloDecisor }))}>Con decisor</Boton>
          <Boton tamano="sm" className="cer-toggle" aria-pressed={filtros.minUrgencia === 70} icono={<Icono icono={Flame} />}
            onClick={() => setFiltros((f) => ({ ...f, minUrgencia: f.minUrgencia === 70 ? 0 : 70 }))}>Urgentes</Boton>
          <Boton tamano="sm" icono={<Icono icono={SlidersHorizontal} />} onClick={() => setFiltrosAbiertos(true)}>
            Filtros{filtrosActivos ? ` · ${filtrosActivos}` : ''}
          </Boton>
          <Boton tamano="sm" onClick={alternarPantalla} title="Pantalla completa" icono={<Icono icono={pantallaCompleta ? Minimize2 : Maximize2} />}>
            <span className="rv-sr">Pantalla completa</span>
          </Boton>
        </div>
      </div>

      {/* ── El mundo ─────────────────────────────────────────────────────── */}
      <section ref={zonaRef} className="cer-zona" aria-label="Mapa de la cartera">
        {/* El ala izquierda: solo en pantallas anchas (1900 px o más); el embudo y los más cerrables VIVEN junto al país, sin taparlo. */}
        <aside className="cer-ala" aria-label="Embudo y más cerrables">
          <div className="cer-ala__bloque">
            <h3 className="cer-ala__titulo">El embudo</h3>
            {ORDEN_EMBUDO.map((e) => (
              <div key={e} className="cer-ala__fila">
                <i className="cer-punto" data-etapa={e} aria-hidden="true" />
                <span>{COLOR_EMBUDO[e].nombre}</span>
                <b>{numero(porEtapa.get(e) ?? 0)}</b>
              </div>
            ))}
          </div>
          <div className="cer-ala__bloque cer-ala__bloque--lista">
            <h3 className="cer-ala__titulo">Más cerrables</h3>
            {ordenados.slice(0, 7).map((p) => (
              <div key={p.id} className="cer-ala__cerrable">
                <p>{p.empresa}</p>
                <p>{p.entidad ?? 'sin plaza'} · cierre {p.cierre}% · urgencia {p.urgencia}%</p>
              </div>
            ))}
          </div>
        </aside>

        {/* El país: cámara libre (rueda, arrastre y vuelo) */}
        <svg ref={svgRef} viewBox={`0 0 ${VIEWBOX_ESTADOS.w} ${VIEWBOX_ESTADOS.h}`} className="cer-svg"
          onPointerDown={alBajarPuntero} onPointerMove={alMoverPuntero}
          onPointerUp={alSoltarPuntero} onPointerCancel={alSoltarPuntero}
          role="img" aria-label="Mapa de México con la cartera de prospectos">
          {/* El mar: clic fuera de un estado = volver al país (si no fue arrastre). */}
          <rect x={0} y={0} width={VIEWBOX_ESTADOS.w} height={VIEWBOX_ESTADOS.h} fill="transparent"
            onClick={() => { if (arrastro.current) return; alPais(); }} />
          <g ref={gRef} className="cer-camara">
            {ESTADOS_GEO.map((e) => {
              const lista = porEstado.get(e.nombre) ?? [];
              const activo = seleccion?.id === e.id;
              return (
                <path key={e.id} d={e.path} className="cer-estado"
                  data-nivel={Math.min(6, Math.round((lista.length / maxEstado) * 6))}
                  data-activo={activo || undefined}
                  data-sobre={(hover === e.id && !activo) || undefined}
                  data-apagado={(seleccion !== null && !activo) || undefined}
                  strokeWidth={Math.max(0.12, (activo ? 0.8 : 0.55) / camK)}
                  onMouseEnter={() => setHover(e.id)}
                  onMouseLeave={() => setHover((h) => (h === e.id ? null : h))}
                  onClick={() => {
                    if (arrastro.current) return; // fue paneo, no clic
                    setCalles(false);
                    setFiltrosAbiertos(false);
                    elegirEstado(activo ? null : e);
                  }}
                />
              );
            })}
            {/* Las luces: cada prospecto con coordenadas reales */}
            {pines.map(({ p, xy }) => (
              <circle key={p.id} className="cer-pin" data-etapa={p.estado in COLOR_EMBUDO ? p.estado : 'nuevo'}
                data-urgente={p.urgencia >= 70 || undefined} data-nuevo={recientes.has(p.id) || undefined}
                cx={xy.x} cy={xy.y} r={Math.max(0.5, Math.min(2.4, 2.4 / camK))}
                strokeWidth={Math.max(0.1, 0.4 / camK)} />
            ))}
          </g>
        </svg>

        {/* Tooltip del hover a nivel país */}
        {hover && !seleccion && (() => {
          const e = ESTADOS_GEO.find((x) => x.id === hover)!;
          const lista = porEstado.get(e.nombre) ?? [];
          return (
            <div className="cer-tip">
              <strong>{e.nombre}</strong>
              <span>{lista.length} prospectos · {lista.filter((p) => p.telefono).length} con teléfono · {lista.filter((p) => p.urgencia >= 70).length} urgentes</span>
            </div>
          );
        })()}

        {filtrados.length > conCoords.length && (
          <p className="cer-nota-sin-punto" role="status">{tr.tp('mapa.sinPunto', filtrados.length - conCoords.length)}</p>
        )}
        {lucesRecortadas && (
          <p className="cer-nota-luces">
            Luces: las más calientes ({numero(pines.length)} de {numero(enSeleccion)}). Afina el filtro para verlas todas.
          </p>
        )}
        {/* Leyenda del embudo */}
        <div className="cer-leyenda" aria-label="Leyenda del embudo">
          {ORDEN_EMBUDO.map((e) => (
            <span key={e}><i className="cer-punto" data-etapa={e} aria-hidden="true" />{COLOR_EMBUDO[e].nombre}</span>
          ))}
        </div>

        {/* Los leads del estado: tarjetas flotando al lateral del país. El país respira entre ellas; solo la columna hace scroll. */}
        {seleccion && !calles && (
          <div className="cer-panel">
            <div className="cer-cabeza-panel">
              <strong>{seleccion.nombre}</strong>
              <span>{numero(listaSeleccion.length)}</span>
              {listaSeleccion.some((p) => p.lat !== null) && (
                <Boton tamano="sm" variante="primary" onClick={() => setCalles(true)}>Calles →</Boton>
              )}
              <Boton tamano="sm" variante="ghost" onClick={() => elegirEstado(null)} title="Cerrar" icono={<Icono icono={X} />}>
                <span className="rv-sr">Cerrar el estado</span>
              </Boton>
            </div>
            <div className="cer-lista">
              {listaSeleccion.length === 0 ? (
                <p className="cer-aviso-lista">El censo todavía no encuentra a nadie aquí; cuando un agente lo haga, aparece solo.</p>
              ) : (
                <>
                  {listaSeleccion.slice(0, 60).map((p) => (
                    <TarjetaProspecto key={p.id} p={p} t={textos.get(p.id)} nuevo={recientes.has(p.id)} afinando={afinando === p.id} onAfinar={afinar} onToque={tocar} avisoIa={avisosIa.get(p.id) ?? null} />
                  ))}
                  {listaSeleccion.length > 60 && (
                    <p className="cer-aviso-lista">
                      Se enseñan las 60 mejores de {numero(listaSeleccion.length)}. Afina el filtro o exporta el CSV completo.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* El nivel calles */}
        {seleccion && calles && (
          <Calles prospectos={listaSeleccion} titulo={seleccion.nombre}
            obtenerTextos={obtenerTextos} pedirTextos={pedirTextos}
            onCerrar={() => setCalles(false)} />
        )}
      </section>

      {/* ── Lo que sigue del mapa ────────────────────────────────────────── */}
      <FilaTarjetas variante="6-6">
        <Tarjeta titulo="El embudo, en luces">
          <BarList etiqueta="Prospectos por etapa del embudo" items={itemsEmbudo} />
        </Tarjeta>
        <Tarjeta titulo="Dónde vive la cartera">
          <BarList etiqueta="Prospectos por estado" items={itemsPlazas} />
          <p className="cer-prospecto__tenue">{numero(sinPlaza)} sin plaza conocida: se dice, no se les inventa estado.</p>
        </Tarjeta>
      </FilaTarjetas>

      <Tarjeta titulo="Los 12 más cerrables del país" estado={ordenados.length === 0 ? 'vacio' : 'ok'} mensaje="Ningún prospecto pasa el filtro" detalle="Quita criterios del cajón de filtros para ver la cartera.">
        <div className="cer-grid">
          {ordenados.slice(0, 12).map((p) => (
            <TarjetaProspecto key={p.id} p={p} t={textos.get(p.id)} plana nuevo={recientes.has(p.id)} afinando={afinando === p.id} onAfinar={afinar} onToque={tocar} avisoIa={avisosIa.get(p.id) ?? null} />
          ))}
        </div>
      </Tarjeta>

      <Disclosure titulo="Cómo se calculan los porcentajes" resumen="Estimaciones deterministas, no mediciones">
        <div className="cer-criterios">
          <p>{CRITERIO_SCORES.urgencia}</p>
          <p>{CRITERIO_SCORES.cierre}</p>
          <p>{CRITERIO_SCORES.datos}</p>
          <p>{CRITERIO_SCORES.similitud}</p>
          <p>{CRITERIO_SCORES.necesidad}</p>
          <p suppressHydrationWarning>Puntos en el mapa: solo prospectos con dirección real (DENUE/INEGI). Actualizado {fechaHoraMx(generadoEn)}; se refresca cada 5 min y no mientras la pestaña está oculta.</p>
        </div>
      </Disclosure>

      {/* ── Filtros y orden (cajón) ─────────────────────────────────────── */}
      <Drawer abierto={filtrosAbiertos} onCerrar={() => setFiltrosAbiertos(false)} titulo="Filtros del Cerebro"
        descripcion={`${numero(filtrados.length)} de ${numero(prospectos.length)} prospectos pasan el filtro.`}
        pie={(
          <>
            <Boton variante="ghost" onClick={() => setFiltros(SIN_FILTROS)}>Limpiar todo</Boton>
            <Boton variante="primary" icono={<Icono icono={Download} />} disabled={exportando} onClick={() => void exportarCsv()}>
              {exportando ? 'Preparando…' : `Exportar CSV (${numero(filtrados.length)})`}
            </Boton>
          </>
        )}>
        <div className="cer-filtros">
          <Fieldset leyenda="Categoría">
            <div className="cer-chips">
              {GIROS.map((g) => (
                <Opcion key={g} activo={filtros.giros?.has(g) ?? false} onClick={() => setFiltros((f) => ({ ...f, giros: alternarEnSet(f.giros, g) }))}>
                  {NOMBRE_GIRO[g]} · {numero(prospectos.filter((p) => p.giro === g).length)}
                </Opcion>
              ))}
            </div>
          </Fieldset>
          <Fieldset leyenda="Etapa del embudo">
            <div className="cer-chips">
              {ORDEN_EMBUDO.map((e) => (
                <Opcion key={e} etapa={e} activo={filtros.etapas?.has(e) ?? false} onClick={() => setFiltros((f) => ({ ...f, etapas: alternarEnSet(f.etapas, e) }))}>
                  {COLOR_EMBUDO[e].nombre}
                </Opcion>
              ))}
            </div>
          </Fieldset>
          <Fieldset leyenda="Tamaño (personal DENUE)">
            <div className="cer-chips">
              {TAMANOS_UI.map((t) => (
                <Opcion key={t} activo={filtros.tamanos?.has(t) ?? false} onClick={() => setFiltros((f) => ({ ...f, tamanos: alternarEnSet(f.tamanos, t) }))}>
                  {t === 'n/d' ? 'Sin dato' : t}
                </Opcion>
              ))}
            </div>
          </Fieldset>
          <Fieldset leyenda="Fuente">
            <div className="cer-chips">
              {FUENTES.map((f) => (
                <Opcion key={f.clave} activo={filtros.fuentes?.has(f.clave) ?? false} onClick={() => setFiltros((v) => ({ ...v, fuentes: alternarEnSet(v.fuentes, f.clave) }))}>
                  {f.nombre}
                </Opcion>
              ))}
            </div>
          </Fieldset>
          <Fieldset leyenda="Alcanzables">
            <div className="cer-chips">
              <Opcion activo={filtros.soloTel} onClick={() => setFiltros((f) => ({ ...f, soloTel: !f.soloTel }))}>Con teléfono</Opcion>
              <Opcion activo={filtros.soloDecisor} onClick={() => setFiltros((f) => ({ ...f, soloDecisor: !f.soloDecisor }))}>Con decisor</Opcion>
              <Opcion activo={filtros.soloMensajeIA} onClick={() => setFiltros((f) => ({ ...f, soloMensajeIA: !f.soloMensajeIA }))}>Mensaje listo</Opcion>
              <Opcion activo={filtros.soloVacante} onClick={() => setFiltros((f) => ({ ...f, soloVacante: !f.soloVacante }))}>Con vacante</Opcion>
            </div>
          </Fieldset>
          <Fieldset leyenda="Urgencia mínima">
            <Elige etiqueta="Urgencia mínima" valor={filtros.minUrgencia} valores={[0, 50, 70] as const}
              rotulo={(v) => (v === 0 ? 'Todas' : `≥${v}%`)} onChange={(v) => setFiltros((f) => ({ ...f, minUrgencia: v }))} />
          </Fieldset>
          <Fieldset leyenda="Similitud ICP mínima" ayuda={CRITERIO_SCORES.similitud}>
            <Elige etiqueta="Similitud ICP mínima" valor={filtros.minSimilitud} valores={[0, 40, 65, 85] as const}
              rotulo={(v) => (v === 0 ? 'Todas' : `≥${v}%`)} onChange={(v) => setFiltros((f) => ({ ...f, minSimilitud: v }))} />
          </Fieldset>
          <Fieldset leyenda="Necesidad mínima" ayuda={CRITERIO_SCORES.necesidad}>
            <Elige etiqueta="Necesidad mínima" valor={filtros.minNecesidad} valores={[0, 40, 65, 85] as const}
              rotulo={(v) => (v === 0 ? 'Todas' : `≥${v}%`)} onChange={(v) => setFiltros((f) => ({ ...f, minNecesidad: v }))} />
          </Fieldset>
          <Fieldset leyenda="Datos completos">
            <Elige etiqueta="Datos completos" valor={filtros.minCompletitud} valores={[0, 50, 75] as const}
              rotulo={(v) => (v === 0 ? 'Todos' : `≥${v}%`)} onChange={(v) => setFiltros((f) => ({ ...f, minCompletitud: v }))} />
          </Fieldset>
          <Fieldset leyenda="Sin toque en">
            <Elige etiqueta="Sin toque en" valor={filtros.sinToqueDias} valores={[0, 7, 14, 30] as const}
              rotulo={(v) => (v === 0 ? 'Todos' : `≥${v} días`)} onChange={(v) => setFiltros((f) => ({ ...f, sinToqueDias: v }))} />
          </Fieldset>
          <CampoSelect etiqueta="Ordenar por" value={filtros.orden}
            onChange={(e) => setFiltros((f) => ({ ...f, orden: e.target.value as Filtros['orden'] }))}>
            <option value="cierre">% cierre</option>
            <option value="urgencia">% urgencia</option>
            <option value="similitud">% similitud ICP</option>
            <option value="necesidad">% necesidad</option>
            <option value="completos">Datos completos</option>
            <option value="recientes">Recientes</option>
          </CampoSelect>
          <Campo etiqueta="Cerca de (plaza)" ayuda="Elige una ciudad de la lista; con radio activo solo pasan los prospectos con dirección real.">
            <input className="rv-ctl" list="cerebro-plazas" placeholder="Escribe una ciudad…" defaultValue={filtros.centro?.nombre ?? ''}
              onChange={(e) => {
                const plaza = plazas.find((x) => x.nombre === e.target.value);
                setFiltros((f) => ({
                  ...f,
                  centro: plaza ? { lat: plaza.lat, lng: plaza.lng, nombre: plaza.nombre } : null,
                  radioKm: plaza ? (f.radioKm || 50) : 0,
                }));
              }} />
          </Campo>
          <datalist id="cerebro-plazas">
            {plazas.map((x) => <option key={x.nombre} value={x.nombre} />)}
          </datalist>
          <Fieldset leyenda="Radio">
            <Elige etiqueta="Radio desde la plaza" valor={filtros.centro ? filtros.radioKm : 0} valores={[0, 25, 50, 100, 200] as const}
              rotulo={(v) => (v === 0 ? 'Sin radio' : `${v} km`)} onChange={(v) => setFiltros((f) => ({ ...f, radioKm: v }))} />
          </Fieldset>
          {errorExport && <p role="alert" className="cer-prospecto__error">{errorExport}</p>}
          <p className="cer-filtros__pie">{numero(filtrados.length)} de {numero(prospectos.length)} prospectos pasan el filtro.</p>
        </div>
      </Drawer>
    </div>
  );
}
