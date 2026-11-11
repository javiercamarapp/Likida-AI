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
  COLOR_EMBUDO, TAMANOS, desempacar,
  esProspectoTerminal, limitesRampa, pasoDeRampa,
  type DatosMapa, type Giro, type ProspectoMapa, type ResumenProspectos, type Tamano, type TextosProspecto,
} from '@/lib/admin/prospectos-mapa-client';
import { fechaHoraMx, numero, hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { useT } from '@/lib/i18n/proveedor';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { usePrefersReducedMotion } from '../ui/prefers-reduced-motion';
import {
  Boton, Campo, CampoSelect, EsqTarjetaV2, Fieldset, Disclosure, Drawer, FilaTarjetas, FiltroChip, Icono, SegmentedControl, Tarjeta, Tooltip, clasesBoton, cx,
} from '../../ui-v2/componentes';
import { BarList, TiraCifras } from '../../ui-v2/graficas';
import { uniformes } from '../cifras-uniformes';
import { idsSinTextos } from './csv_prospectos';
import { hrefWa, hrefCorreo, esperandoTextos } from './mensajes';
import { arrancarLatido, visibilidadDelNavegador } from './latido';
import { accionRegistrarExportacion } from './acciones-exportar';
import {
  SIN_FILTROS, alternarEnSet, contarFiltrosActivos, csvDe, filtrarProspectos, ordenarProspectos, plazasDe, type Filtros,
} from './filtros';
import './cerebro.css';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { rico } from '@/lib/i18n/rico';
import { criterioScoreTr, nombreEtapaTr, nombreGiroTr } from '@/lib/i18n/rotulos_tr';

const Calles = dynamic(() => import('./calles'), { ssr: false });

const ORDEN_EMBUDO = [
  'negociacion', 'proposal', 'pilot', 'demo', 'appointment', 'rescheduled',
  'no-show', 'cancelled', 'contactado', 'nuevo', 'won', 'cerrado', 'perdido',
] as const;
/** `lost` y `perdido` son el MISMO estado en dos vocabularios (migración del embudo): se rotulan igual, así que en la leyenda, el embudo y los
 *  filtros salen como UNA etapa («Perdido») que suma las dos. */
const etapaVisible = (estado: string): string => (estado === 'lost' ? 'perdido' : estado);
const GIROS: Giro[] = ['transportista', 'embotelladora', 'abarrotes_mayoreo', 'flota_propia', 'logistica', 'otro'];
const fuentesTr = (tx: TSistema = T_SISTEMA_ES) => ([
  { clave: 'censo', nombre: tx('mapa_prospectos_cerebro.censo_vacantes') },
  { clave: 'denue', nombre: tx('mapa_prospectos_cerebro.universo_denue') },
  { clave: 'canacar', nombre: tx('mapa_prospectos_cerebro.directorio_canacar') },
  { clave: 'bolsa', nombre: tx('mapa_prospectos_cerebro.bolsas_historico') },
  { clave: 'aaag', nombre: tx('mapa_prospectos_cerebro.padron_aaag') },
  { clave: 'scribd-tampico', nombre: tx('mapa_prospectos_cerebro.directorio_tampico') },
  { clave: 'manual', nombre: tx('mapa_prospectos_cerebro.cuentas_a_mano') },
  { clave: 'landing', nombre: tx('mapa_prospectos_cerebro.landing_organica') },
  { clave: 'campana', nombre: tx('mapa_prospectos_cerebro.campana_directa') },
  { clave: 'ads-meta', nombre: 'Ads Meta' },
  { clave: 'ads-google', nombre: 'Ads Google' },
] as const);

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
    <FiltroChip activo={activo} onClick={onClick}>
      {etapa ? <i className="cer-punto" data-etapa={etapa} aria-hidden="true" /> : null}
      {children}
    </FiltroChip>
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
  const { t: tx, idioma } = useT('admin_sistema', admin_sistemaEs);
  // El mensaje del agente experto MANDA sobre la plantilla: mientras no llegue, el botón no se abre. Abrirlo con la plantilla mandaría
  // el texto equivocado, firmado por Javier, y eso no se deshace.
  const esperando = esperandoTextos(p, t);
  const BTN = clasesBoton('secondary', 'sm');
  return (
    <article className={cx('cer-prospecto', plana && 'cer-prospecto--plana')} data-nuevo={nuevo || undefined}>
      <div className="cer-prospecto__cab">
        <i className="cer-punto" data-etapa={p.estado in COLOR_EMBUDO ? p.estado : 'nuevo'} aria-hidden="true" />
        <div className="min-w-0">
          <Link href={`/admin/mapa-prospectos/${p.id}`} className="cer-prospecto__nombre">{p.empresa}</Link>
          <p className="cer-prospecto__meta">
            {nombreEtapaTr(p.estado in COLOR_EMBUDO ? p.estado : 'nuevo', tx)} · {nombreGiroTr(p.giro, tx)}
            {p.numUnidades !== null ? ` · ${tx('mapa_prospectos_cerebro.n_unidades', { n: numero(p.numUnidades, idioma) })}` : p.tamano ? ` · ${tx('mapa_prospectos_cerebro.n_pers', { n: p.tamano })}` : ''}
            {p.ciudad ? ` · ${p.ciudad}` : ''}{' '}{tx('mapa_prospectos_cerebro.datos', { completitud: p.completitud })}</p>
        </div>
      </div>
      {(p.contacto || p.telefono || p.correo) && (
        <div className="cer-prospecto__contacto">
          {p.contacto && <p><Icono icono={User} tam={14} /><span>{p.contacto}</span></p>}
          {p.telefono && <p><Icono icono={Phone} tam={14} /><a href={`tel:${p.telefono}`}>{p.telefono}</a></p>}
          {p.correo && <p><Icono icono={Mail} tam={14} /><a href={`mailto:${p.correo}`}>{p.correo}</a></p>}
        </div>
      )}
      {p.vacante && <p className="cer-prospecto__tenue">{tx('mapa_prospectos_cerebro.vacante')}{' '}{p.vacante}</p>}
      {t?.notas && <p className="cer-prospecto__tenue cer-prospecto__notas" title={t.notas}>{t.notas}</p>}
      <BarraPct etiqueta={tx('mapa_prospectos_detalle.urgencia')} pct={p.urgencia} serie="urgencia" />
      <BarraPct etiqueta={tx('mapa_prospectos_detalle.cierre')} pct={p.cierre} serie="cierre" />
      <BarraPct etiqueta="ICP" pct={p.similitudIcpPct} serie="icp" />
      <BarraPct etiqueta={tx('mapa_prospectos_detalle.necesid')} pct={p.necesidadPct} serie="necesidad" />
      {p.mensajesGeneradosEn && (
        <p className="cer-prospecto__tenue">{tx('mapa_prospectos_cerebro.con_mensaje_del_agente_experto_listo')}</p>
      )}
      {p.ultimoToque && (
        <p className="cer-prospecto__tenue">{tx('mapa_prospectos_cerebro.ultimo_toque')}{' '}{fechaHoraMx(p.ultimoToque, idioma)}</p>
      )}
      {(p.telefono || p.correo || p.lat !== null) && (
        <div className="cer-prospecto__acciones">
          {p.telefono && (esperando ? (
            <span aria-disabled className={BTN} title={tx('mapa_prospectos_cerebro.el_mensaje_que_redacto_el_agente')}>{tx('mapa_prospectos_cerebro.whatsapp')}</span>
          ) : (
            <a href={hrefWa(p, t)!} target="_blank" rel="noreferrer" onClick={() => onToque?.(p.id, 'whatsapp')} className={BTN}>{tx('mapa_prospectos_cerebro.whatsapp_2')}</a>
          ))}
          {p.correo && (esperando ? (
            <span aria-disabled className={BTN} title={tx('mapa_prospectos_cerebro.el_correo_que_redacto_el_agente')}>{tx('mapa_prospectos_cerebro.correo')}</span>
          ) : (
            <a href={hrefCorreo(p, t)!} onClick={() => onToque?.(p.id, 'correo')} className={BTN}>{tx('mapa_prospectos_cerebro.correo_2')}</a>
          ))}
          {p.lat !== null && (
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`} target="_blank" rel="noreferrer" className={BTN}>
              <Icono icono={Navigation} tam={14} />{tx('mapa_prospectos_calles.como_llegar')}</a>
          )}
          {onAfinar && !esProspectoTerminal(p.estado) && (p.telefono || p.correo) && (
            <Tooltip texto={tx('mapa_prospectos_cerebro.el_agente_experto_redacta_el_primer')}>
              <Boton tamano="sm" onClick={() => onAfinar(p.id)} disabled={afinando} icono={<Icono icono={p.mensajesGeneradosEn ? RefreshCw : Sparkles} tam={14} />}>
                {afinando ? tx('mapa_prospectos_detalle.redactando') : p.mensajesGeneradosEn ? 'IA' : tx('mapa_prospectos_cerebro.mensaje_ia')}
              </Boton>
            </Tooltip>
          )}
        </div>
      )}
      {avisoIa && (
        <p role="alert" className={avisoIa.error ? 'cer-prospecto__error' : 'cer-prospecto__aviso'}>{avisoIa.texto}</p>
      )}
    </article>
  );
}

export function Cerebro({ resumen = null, inicial, estadoInicial }: {
  /** Lo único que viaja en el HTML (w15/perf): conteos agregados por estado y por etapa. Con él el mapa, el ranking y las cifras pintan al
   *  instante, sin esperar los 33 mil prospectos. `null` = la lectura falló (la página lo avisa; aquí no se inventan cifras). */
  resumen?: ResumenProspectos | null;
  /** La cartera ya entregada (carga completa): sin ella el detalle se pide al montar, en segundo plano, por el latido de siempre. */
  inicial?: DatosMapa;
  estadoInicial?: string;
}) {
  const { t: tx, idioma } = useT('admin_sistema', admin_sistemaEs);
  const reducido = usePrefersReducedMotion();
  const tr = useT('shell', shellEs);
  // ── LA CARTERA, LIGERA (FE-16) ───────────────────────────────────────────
  // Llega empacada en tuplas y sin los textos largos; se desempaca UNA vez.
  // `listaRef` es la misma lista, accesible desde los manejadores sin
  // arrastrar el valor viejo de un closure (el latido corre cada 5 min).
  //
  // w15/perf (punto 4): el HTML ya NO trae las 33 mil filas (2.3 MB y 25 s de pantalla blanca). Trae el resumen; el detalle (filtros,
  // luces, fichas, CSV) se pide al montar por la misma ruta del latido y, mientras llega, lo que depende de él se DICE «cargando».
  const [prospectos, setProspectos] = useState<ProspectoMapa[]>(() => (inicial ? inicial.filas.map(desempacar) : []));
  const [listo, setListo] = useState<boolean>(Boolean(inicial));
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState(false);
  const listaRef = useRef<ProspectoMapa[]>(prospectos);
  const ponerLista = useCallback((nueva: ProspectoMapa[]) => {
    listaRef.current = nueva;
    setProspectos(nueva);
  }, []);
  const [generadoEn, setGeneradoEn] = useState(inicial?.generadoEn ?? resumen?.generadoEn ?? '');
  /** La marca de agua del delta: hasta aquí ya sabemos. */
  const marca = useRef<string | null>(inicial?.marca ?? null);
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
        setErrorExport(tx('mapa_prospectos_cerebro.no_se_pudieron_cargar_las_notas', { length: faltan.length }));
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
      setErrorExport(tx('mapa_prospectos_cerebro.no_se_pudo_registrar_la_exportacion'));
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
      }).then((resp) => leerRespuestaMensaje(resp, tx), () => ({ ok: false as const, error: tx('mapa_prospectos_detalle.no_se_pudo_contactar_al_servidor') }));
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
    // La PRIMERA entrega del detalle (venía vacío) no es «llegaron 33 mil nuevos»: se anotan como conocidos sin encender el destello.
    const primera = antes.length === 0 && conocidos.current.size === 0;
    const nuevos = new Set(llegaron.filter((p) => !conocidos.current.has(p.id)).map((p) => p.id));
    llegaron.forEach((p) => conocidos.current.add(p.id));
    ponerLista(siguiente);
    if (nuevos.size && !primera) setRecientes(nuevos);
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

  // El detalle de la cartera, a pedido: al montar (sin bloquear la primera pintura) y con «Reintentar» si falló.
  const cargarDetalle = useCallback(async () => {
    setCargando(true);
    setErrorCarga(false);
    try {
      const d = await pedirMapa(null);
      if (!d) throw new Error('sin detalle');
      aplicar(d);
      setListo(true);
    } catch {
      setErrorCarga(true);
    } finally {
      setCargando(false);
    }
  }, [aplicar, pedirMapa]);
  const detalleSolicitado = useRef(false);
  useEffect(() => {
    if (listo || detalleSolicitado.current) return;
    detalleSolicitado.current = true;
    void cargarDetalle();
  }, [listo, cargarDetalle]);

  useEffect(() => (!listo ? undefined : arrancarLatido({
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
  })), [listo, aplicar, pedirMapa]);

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

  const sinPlazaDetalle = useMemo(() => filtrados.filter((p) => !p.entidad).length, [filtrados]);
  const conTelefonoDetalle = useMemo(() => filtrados.filter((p) => p.telefono).length, [filtrados]);
  const conDecisorDetalle = useMemo(() => filtrados.filter((p) => p.contacto).length, [filtrados]);
  const calientes = useMemo(() => filtrados.filter((p) => p.urgencia >= 70).length, [filtrados]);

  // ── LAS CIFRAS: del resumen del servidor hasta que llega el detalle; después, de la cartera filtrada ──────────
  // Mismo universo y misma definición de «vivo» (ver prospectos-mapa.ts › indiceProspectos): al llegar el detalle sin filtros, las cifras
  // no cambian. Lo que SOLO el detalle sabe (urgentes: sale de las notas) se dice «cargando» y no se rellena con un cero.
  const totalCifra = listo ? filtrados.length : resumen?.total ?? null;
  const conTelefono = listo ? conTelefonoDetalle : resumen?.conTelefono ?? null;
  const conDecisor = listo ? conDecisorDetalle : resumen?.conDecisor ?? null;
  const sinPlaza = listo ? sinPlazaDetalle : resumen?.sinPlaza ?? 0;
  /** Prospectos por estado de la república: lo que pinta el mapa de color y el ranking. */
  const nPorEstado = useMemo(() => {
    const m = new Map<string, number>();
    if (listo) for (const [k, l] of porEstado) m.set(k, l.length);
    else if (resumen) for (const [k, e] of Object.entries(resumen.porEntidad)) m.set(k, e.n);
    return m;
  }, [listo, porEstado, resumen]);
  const maxEstado = useMemo(() => Math.max(1, ...nPorEstado.values()), [nPorEstado]);

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
    if (listo) for (const p of filtrados) { const k = etapaVisible(p.estado); m.set(k, (m.get(k) ?? 0) + 1); }
    else if (resumen) for (const [k0, n] of Object.entries(resumen.porEtapa)) { const k = etapaVisible(k0); m.set(k, (m.get(k) ?? 0) + n); }
    return m;
  }, [listo, filtrados, resumen]);
  const itemsEmbudo = useMemo(() => ORDEN_EMBUDO.map((e) => ({
    clave: e, etiqueta: nombreEtapaTr(e, tx), valor: porEtapa.get(e) ?? 0, texto: numero(porEtapa.get(e) ?? 0, idioma),
  })), [porEtapa, tx, idioma]);
  // El ranking del panel lateral (como «Estados con más casos» de Rovaq): orden por prospectos, desempate por nombre (nunca un orden no único).
  const ranking = useMemo(() => [...nPorEstado.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'es'))
    .map(([nombre, n]) => ({ nombre, n, paso: pasoDeRampa(n, maxEstado) })), [nPorEstado, maxEstado]);
  const itemsPlazas = useMemo(() => ranking.slice(0, 14)
    .map(({ nombre, n }) => ({ clave: nombre, etiqueta: nombre, valor: n, texto: numero(n, idioma) })), [ranking, idioma]);
  const limites = useMemo(() => limitesRampa(maxEstado), [maxEstado]);
  /** El detalle del estado elegido para el panel lateral: del resumen (instantáneo) y, cuando llegó, de la cartera filtrada. */
  const detalleSeleccion = seleccion
    ? (listo
      ? { n: listaSeleccion.length, tel: listaSeleccion.filter((p) => p.telefono).length, dec: listaSeleccion.filter((p) => p.contacto).length }
      : resumen?.porEntidad[seleccion.nombre]
        ? { n: resumen.porEntidad[seleccion.nombre].n, tel: resumen.porEntidad[seleccion.nombre].conTelefono, dec: resumen.porEntidad[seleccion.nombre].conDecisor }
        : null)
    : null;
  const etapasSeleccion = seleccion
    ? (listo
      ? ORDEN_EMBUDO.map((e) => [e, listaSeleccion.filter((p) => etapaVisible(p.estado) === e).length] as const)
      : ORDEN_EMBUDO.map((e) => [e, (resumen?.porEntidad[seleccion.nombre]?.porEtapa[e] ?? 0) + (e === 'perdido' ? (resumen?.porEntidad[seleccion.nombre]?.porEtapa.lost ?? 0) : 0)] as const)).filter(([, n]) => n > 0)
    : [];

  /** Una cifra de la tira: sin lectura NO es un cero, es «no se pudo leer» (la página ya avisó de la avería). */
  const cifra = (etiqueta: string, valor: number | null) => (valor === null
    ? { etiqueta, valor: null, estado: 'error' as const, mensaje: tr.t('mapa.sinLectura') }
    : { etiqueta, valor, conteo: true as const });
  const elegirEstado = (destino: EstadoGeo | null) => { setSeleccion(destino); volarA(destino); };
  const alPais = () => { setSeleccion(null); setCalles(false); volarA(null); };
  const enSeleccion = seleccion ? conCoords.filter((p) => p.entidad === seleccion.nombre).length : conCoords.length;

  return (
    <div className="cer-raiz">
      <TiraCifras etiqueta={tx('mapa_prospectos_cerebro.cartera_filtrada')} items={uniformes([
        cifra(tx('mapa_prospectos_cerebro.prospectos'), totalCifra),
        cifra(tx('mapa_prospectos_cerebro.con_telefono'), conTelefono),
        cifra(tx('mapa_prospectos_cerebro.con_decisor'), conDecisor),
        {
          etiqueta: tx('mapa_prospectos_cerebro.urgentes'), nota: tx('mapa_prospectos_cerebro.urgencia_de_70_o_mas'),
          ...(listo
            ? { valor: calientes, conteo: true as const }
            : { valor: null, estado: 'vacio' as const, mensaje: errorCarga ? tr.t('mapa.errorCarga') : tr.t('mapa.cargando') }),
        },
      ])} />

      {/* ── Herramientas del mapa ───────────────────────────────────────── */}
      <div className="cer-barra">
        <p className="cer-barra__resumen" aria-live="polite">
          {seleccion
            ? tx('mapa_prospectos_cerebro.seleccion_prospectos', { nombre: seleccion.nombre, n: numero(detalleSeleccion?.n ?? listaSeleccion.length, idioma) })
            : tx('mapa_prospectos_cerebro.rueda_para_acercar_arrastra_para_moverte')}
        </p>
        <div className="cer-barra__acciones">
          {(camK > 1.02 || seleccion) && (
            <Tooltip texto={tx('mapa_prospectos_calles.volver_al_pais')}>
              <Boton tamano="sm" icono={<Icono icono={Undo2} />} onClick={alPais}>{tx('mapa_prospectos_cerebro.pais')}</Boton>
            </Tooltip>
          )}
          {/* Los dos atajos más pedidos: un clic, sin abrir el cajón. Mismo estado que los criterios de adentro. */}
          <Boton tamano="sm" className="cer-toggle" aria-pressed={filtros.soloDecisor} icono={<Icono icono={UserCheck} />} disabled={!listo}
            onClick={() => setFiltros((f) => ({ ...f, soloDecisor: !f.soloDecisor }))}>{tx('mapa_prospectos_cerebro.con_decisor')}</Boton>
          <Boton tamano="sm" className="cer-toggle" aria-pressed={filtros.minUrgencia === 70} icono={<Icono icono={Flame} />} disabled={!listo}
            onClick={() => setFiltros((f) => ({ ...f, minUrgencia: f.minUrgencia === 70 ? 0 : 70 }))}>{tx('mapa_prospectos_cerebro.urgentes')}</Boton>
          <Boton tamano="sm" icono={<Icono icono={SlidersHorizontal} />} disabled={!listo} onClick={() => setFiltrosAbiertos(true)}>
            {tx('mapa_prospectos_cerebro.filtros')}{filtrosActivos ? ` · ${filtrosActivos}` : ''}
          </Boton>
          <Tooltip texto={tx('mapa_prospectos_cerebro.pantalla_completa')}>
            <Boton tamano="sm" onClick={alternarPantalla} icono={<Icono icono={pantallaCompleta ? Minimize2 : Maximize2} />}>
              <span className="rv-sr">{tx('mapa_prospectos_cerebro.pantalla_completa')}</span>
            </Boton>
          </Tooltip>
        </div>
      </div>

      {/* ── El mundo: el mapa de color (choropleth secuencial por estado) y, a su lado, el ranking ──────────────── */}
      <div className="cer-cuerpo">
      <section ref={zonaRef} className="cer-zona" aria-label={tx('mapa_prospectos_cerebro.mapa_de_la_cartera')}>
        {/* El ala izquierda: solo en pantallas anchas (1900 px o más); el embudo y los más cerrables VIVEN junto al país, sin taparlo. */}
        <aside className="cer-ala" aria-label={tx('mapa_prospectos_cerebro.embudo_y_mas_cerrables')}>
          <div className="cer-ala__bloque">
            <h3 className="cer-ala__titulo">{tx('mapa_prospectos_cerebro.el_embudo')}</h3>
            {ORDEN_EMBUDO.map((e) => (
              <div key={e} className="cer-ala__fila">
                <i className="cer-punto" data-etapa={e} aria-hidden="true" />
                <span>{nombreEtapaTr(e, tx)}</span>
                <b>{numero(porEtapa.get(e) ?? 0, idioma)}</b>
              </div>
            ))}
          </div>
          <div className="cer-ala__bloque cer-ala__bloque--lista">
            <h3 className="cer-ala__titulo">{tx('mapa_prospectos_cerebro.mas_cerrables')}</h3>
            {!listo && <p className="cer-ala__cerrable">{errorCarga ? tr.t('mapa.errorCarga') : tr.t('mapa.cargando')}</p>}
            {ordenados.slice(0, 7).map((p) => (
              <div key={p.id} className="cer-ala__cerrable">
                <p>{p.empresa}</p>
                <p>{p.entidad ?? tx('mapa_prospectos_cerebro.sin_plaza')}{' '}{tx('mapa_prospectos_cerebro.cierre_urgencia', { cierre: p.cierre, urgencia: p.urgencia })}</p>
              </div>
            ))}
          </div>
        </aside>

        {/* El país: cámara libre (rueda, arrastre y vuelo) */}
        <svg ref={svgRef} viewBox={`0 0 ${VIEWBOX_ESTADOS.w} ${VIEWBOX_ESTADOS.h}`} className="cer-svg"
          onPointerDown={alBajarPuntero} onPointerMove={alMoverPuntero}
          onPointerUp={alSoltarPuntero} onPointerCancel={alSoltarPuntero}
          role="img" aria-label={tx('mapa_prospectos_cerebro.mapa_de_mexico_con_la_cartera')}>
          {/* El mar: clic fuera de un estado = volver al país (si no fue arrastre). */}
          <rect x={0} y={0} width={VIEWBOX_ESTADOS.w} height={VIEWBOX_ESTADOS.h} fill="transparent"
            onClick={() => { if (arrastro.current) return; alPais(); }} />
          <g ref={gRef} className="cer-camara">
            {ESTADOS_GEO.map((e) => {
              const nEstado = nPorEstado.get(e.nombre) ?? 0;
              const activo = seleccion?.id === e.id;
              return (
                <path key={e.id} d={e.path} className="cer-estado"
                  data-paso={pasoDeRampa(nEstado, maxEstado)}
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
            {/* Rótulos: el código del estado y su cifra EXACTA (el color nunca es la única señal); solo donde caben al zoom actual. Van DESPUÉS de las luces y con halo, para que ningún punto se encime al texto. */}
            {ESTADOS_GEO.map((e) => {
              const nEstado = nPorEstado.get(e.nombre) ?? 0;
              if (nEstado === 0 || seleccion !== null || e.bw * camK < 44 || e.bh * camK < 28) return null;
              const tam = 11 / camK;
              return (
                <text key={e.id} className="cer-rotulo" data-paso={pasoDeRampa(nEstado, maxEstado)} x={e.cx} y={e.cy} fontSize={tam} textAnchor="middle" strokeWidth={2.5 / camK} aria-hidden="true">
                  <tspan x={e.cx}>{e.id.slice(3)}</tspan>
                  {e.bh * camK >= 44 && <tspan x={e.cx} dy={tam * 1.2}>{numero(nEstado, idioma)}</tspan>}
                </text>
              );
            })}
          </g>
        </svg>

        {/* Tooltip del hover a nivel país */}
        {hover && !seleccion && (() => {
          const e = ESTADOS_GEO.find((x) => x.id === hover)!;
          const lista = porEstado.get(e.nombre) ?? [];
          const r = resumen?.porEntidad[e.nombre];
          return (
            <div className="cer-tip">
              <strong>{e.nombre}</strong>
              {listo
                ? rico(tx('mapa_prospectos_cerebro.e0_prospectos_con_telefono_urgentes_e0', { length: lista.length, length2: lista.filter((p) => p.telefono).length, length3: lista.filter((p) => p.urgencia >= 70).length }), { e0: (c) => <span>{c}</span> })
                : rico(tx('mapa_prospectos_cerebro.e0_prospectos_con_telefono_e0', { n: numero(r?.n ?? 0, idioma), tel: numero(r?.conTelefono ?? 0, idioma) }), { e0: (c) => <span>{c}</span> })}
            </div>
          );
        })()}

        {listo && filtrados.length > conCoords.length && (
          <p className="cer-nota-sin-punto" role="status">{tr.tp('mapa.sinPunto', filtrados.length - conCoords.length)}</p>
        )}
        {lucesRecortadas && (
          <p className="cer-nota-luces">{tx('mapa_prospectos_cerebro.luces_las_mas_calientes_de_afina', { numero: numero(pines.length, idioma), numero2: numero(enSeleccion, idioma) })}</p>
        )}
        {/* Los leads del estado: tarjetas flotando al lateral del país. El país respira entre ellas; solo la columna hace scroll. */}
        {seleccion && !calles && (
          <div className="cer-panel">
            <div className="cer-cabeza-panel">
              <strong>{seleccion.nombre}</strong>
              <span>{numero(detalleSeleccion?.n ?? listaSeleccion.length, idioma)}</span>
              {listaSeleccion.some((p) => p.lat !== null) && (
                <Boton tamano="sm" variante="primary" onClick={() => setCalles(true)}>{tx('mapa_prospectos_cerebro.calles')}</Boton>
              )}
              <Tooltip texto={tx('mapa_prospectos_cerebro.cerrar')}>
                <Boton tamano="sm" variante="ghost" onClick={() => elegirEstado(null)} icono={<Icono icono={X} />}>{rico(tx('mapa_prospectos_cerebro.e0_cerrar_el_estado_e0'), { e0: (c) => <span className="rv-sr">{c}</span> })}</Boton>
              </Tooltip>
            </div>
            <div className="cer-lista">
              {!listo ? (
                <p className="cer-aviso-lista" role="status">
                  {errorCarga ? tr.t('mapa.errorCarga') : tr.t('mapa.cargandoEstado', { estado: seleccion.nombre })}
                  {errorCarga && <> <Boton tamano="sm" onClick={() => void cargarDetalle()} disabled={cargando}>{tr.t('mapa.reintentar')}</Boton></>}
                </p>
              ) : listaSeleccion.length === 0 ? (
                <p className="cer-aviso-lista">{tx('mapa_prospectos_cerebro.el_censo_todavia_no_encuentra_a')}</p>
              ) : (
                <>
                  {listaSeleccion.slice(0, 60).map((p) => (
                    <TarjetaProspecto key={p.id} p={p} t={textos.get(p.id)} nuevo={recientes.has(p.id)} afinando={afinando === p.id} onAfinar={afinar} onToque={tocar} avisoIa={avisosIa.get(p.id) ?? null} />
                  ))}
                  {listaSeleccion.length > 60 && (
                    <p className="cer-aviso-lista">{tx('mapa_prospectos_cerebro.se_ensenan_las_60_mejores_de', { numero: numero(listaSeleccion.length, idioma) })}</p>
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

      {/* El ranking lateral (como «Estados con más casos» de Rovaq): barras con la cifra exacta, el estado elegido en detalle y la leyenda REAL
          de la rampa (los límites salen de la misma función que pinta el mapa). */}
      <aside className="cer-rank" aria-label={tr.t('mapa.rankingTitulo')}>
        <div className="cer-rank__bloque">
          <h3 className="cer-ala__titulo">{tr.t('mapa.rankingTitulo')}</h3>
          {ranking.length === 0 ? (
            <p className="cer-prospecto__tenue">{tr.t('mapa.rankingVacio')}</p>
          ) : (
            <ol className="cer-rank__lista">
              {ranking.slice(0, 10).map((r) => {
                const geo = ESTADOS_GEO.find((x) => x.nombre === r.nombre) ?? null;
                return (
                  <li key={r.nombre}>
                    <Boton variante="ghost" className="cer-rank__fila" aria-pressed={seleccion?.nombre === r.nombre} disabled={geo === null}
                      onClick={() => { if (!geo) return; setCalles(false); setFiltrosAbiertos(false); elegirEstado(seleccion?.id === geo.id ? null : geo); }}>
                      <span className="cer-rank__nombre">{r.nombre}</span>
                      <svg className="cer-rank__pista" width="100%" height="6" aria-hidden="true">
                        <rect className="cer-rank__barra" x="0" y="0" height="6" rx="3" width={`${Math.max(2, (r.n / maxEstado) * 100).toFixed(2)}%`} />
                      </svg>
                      <b>{numero(r.n, idioma)}</b>
                    </Boton>
                  </li>
                );
              })}
            </ol>
          )}
          <ul className="cer-rampa" aria-label={tr.t('mapa.leyendaTitulo')}>
            {limites.map((l) => (
              <li key={l.paso} data-paso={l.paso}><i aria-hidden="true" />{l.desde === l.hasta ? numero(l.desde, idioma) : `${numero(l.desde, idioma)}–${numero(l.hasta, idioma)}`}</li>
            ))}
          </ul>
          <p className="cer-prospecto__tenue">{tr.t('mapa.sinPlaza', { n: numero(sinPlaza, idioma) })}</p>
        </div>
        {seleccion && detalleSeleccion && (
          <div className="cer-rank__bloque cer-rank__det">
            <h3 className="cer-ala__titulo">{seleccion.nombre}</h3>
            <p className="cer-rank__cifra"><b>{numero(detalleSeleccion.n, idioma)}</b> {tr.t('mapa.prospectos')}</p>
            <p className="cer-prospecto__tenue">{tr.t('mapa.detalleContacto', { tel: numero(detalleSeleccion.tel, idioma), dec: numero(detalleSeleccion.dec, idioma) })}</p>
            {etapasSeleccion.map(([e, n]) => (
              <div key={e} className="cer-ala__fila">
                <i className="cer-punto" data-etapa={e} aria-hidden="true" />
                <span>{nombreEtapaTr(e, tx)}</span>
                <b>{numero(n, idioma)}</b>
              </div>
            ))}
          </div>
        )}
        <div className="cer-rank__bloque">
          <h3 className="cer-ala__titulo">{tr.t('mapa.lucesTitulo')}</h3>
          <div className="cer-leyenda" aria-label={tx('mapa_prospectos_cerebro.leyenda_del_embudo')}>
            {ORDEN_EMBUDO.map((e) => (
              <span key={e}><i className="cer-punto" data-etapa={e} aria-hidden="true" />{nombreEtapaTr(e, tx)}</span>
            ))}
          </div>
        </div>
      </aside>
      </div>

      {/* ── Lo que sigue del mapa ────────────────────────────────────────── */}
      <FilaTarjetas variante="6-6">
        <Tarjeta titulo={tx('mapa_prospectos_cerebro.el_embudo_en_luces')}>
          <BarList etiqueta={tx('mapa_prospectos_cerebro.prospectos_por_etapa_del_embudo')} items={itemsEmbudo} />
        </Tarjeta>
        <Tarjeta titulo={tx('mapa_prospectos_cerebro.donde_vive_la_cartera')}>
          <BarList etiqueta={tx('mapa_prospectos_cerebro.prospectos_por_estado')} items={itemsPlazas} />
          <p className="cer-prospecto__tenue">{tr.t('mapa.sinPlaza', { n: numero(sinPlaza, idioma) })}</p>
        </Tarjeta>
      </FilaTarjetas>

      <Tarjeta titulo={tx('mapa_prospectos_cerebro.los_12_mas_cerrables_del_pais')} estado={!listo ? 'cargando' : ordenados.length === 0 ? 'vacio' : 'ok'} esqueleto={<EsqTarjetaV2 alto={240} />}
        mensaje={tx('mapa_prospectos_cerebro.ningun_prospecto_pasa_el_filtro')} detalle={tx('mapa_prospectos_cerebro.quita_criterios_del_cajon_de_filtros')}>
        <div className="cer-grid">
          {ordenados.slice(0, 12).map((p) => (
            <TarjetaProspecto key={p.id} p={p} t={textos.get(p.id)} plana nuevo={recientes.has(p.id)} afinando={afinando === p.id} onAfinar={afinar} onToque={tocar} avisoIa={avisosIa.get(p.id) ?? null} />
          ))}
        </div>
      </Tarjeta>

      <Disclosure titulo={tx('mapa_prospectos_cerebro.como_se_calculan_los_porcentajes')} resumen={tx('mapa_prospectos_cerebro.estimaciones_deterministas_no_mediciones')}>
        <div className="cer-criterios">
          <p>{criterioScoreTr('urgencia', tx)}</p>
          <p>{criterioScoreTr('cierre', tx)}</p>
          <p>{criterioScoreTr('datos', tx)}</p>
          <p>{criterioScoreTr('similitud', tx)}</p>
          <p>{criterioScoreTr('necesidad', tx)}</p>
          <p suppressHydrationWarning>{tx('mapa_prospectos_cerebro.puntos_en_el_mapa_solo_prospectos', { fechaHoraMx: fechaHoraMx(generadoEn, idioma) })}</p>
        </div>
      </Disclosure>

      {/* ── Filtros y orden (cajón) ─────────────────────────────────────── */}
      <Drawer abierto={filtrosAbiertos} onCerrar={() => setFiltrosAbiertos(false)} titulo={tx('mapa_prospectos_cerebro.filtros_del_cerebro')}
        descripcion={tx('mapa_prospectos_cerebro.de_prospectos_pasan_el_filtro', { numero: numero(filtrados.length, idioma), numero2: numero(prospectos.length, idioma) })}
        pie={(
          <>
            <Boton variante="ghost" onClick={() => setFiltros(SIN_FILTROS)}>{tx('mapa_prospectos_cerebro.limpiar_todo')}</Boton>
            <Boton variante="primary" icono={<Icono icono={Download} />} disabled={exportando} onClick={() => void exportarCsv()}>
              {exportando ? tx('mapa_prospectos_cerebro.preparando') : tx('mapa_prospectos_cerebro.exportar_csv', { n: numero(filtrados.length, idioma) })}
            </Boton>
          </>
        )}>
        <div className="cer-filtros">
          <Fieldset leyenda={tx('mapa_prospectos_cerebro.categoria')}>
            <div className="cer-chips">
              {GIROS.map((g) => (
                <Opcion key={g} activo={filtros.giros?.has(g) ?? false} onClick={() => setFiltros((f) => ({ ...f, giros: alternarEnSet(f.giros, g) }))}>
                  {nombreGiroTr(g, tx)} · {numero(prospectos.filter((p) => p.giro === g).length, idioma)}
                </Opcion>
              ))}
            </div>
          </Fieldset>
          <Fieldset leyenda={tx('mapa_prospectos_cerebro.etapa_del_embudo')}>
            <div className="cer-chips">
              {ORDEN_EMBUDO.map((e) => (
                <Opcion key={e} etapa={e} activo={filtros.etapas?.has(e) ?? false} onClick={() => setFiltros((f) => ({ ...f, etapas: alternarEnSet(f.etapas, e) }))}>
                  {nombreEtapaTr(e, tx)}
                </Opcion>
              ))}
            </div>
          </Fieldset>
          <Fieldset leyenda={tx('mapa_prospectos_cerebro.tamano_personal_denue')}>
            <div className="cer-chips">
              {TAMANOS_UI.map((t) => (
                <Opcion key={t} activo={filtros.tamanos?.has(t) ?? false} onClick={() => setFiltros((f) => ({ ...f, tamanos: alternarEnSet(f.tamanos, t) }))}>
                  {t === 'n/d' ? tx('mapa_prospectos_cerebro.sin_dato') : t}
                </Opcion>
              ))}
            </div>
          </Fieldset>
          <Fieldset leyenda={tx('trust_safety.fuente')}>
            <div className="cer-chips">
              {fuentesTr(tx).map((f) => (
                <Opcion key={f.clave} activo={filtros.fuentes?.has(f.clave) ?? false} onClick={() => setFiltros((v) => ({ ...v, fuentes: alternarEnSet(v.fuentes, f.clave) }))}>
                  {f.nombre}
                </Opcion>
              ))}
            </div>
          </Fieldset>
          <Fieldset leyenda={tx('mapa_prospectos_cerebro.alcanzables')}>
            <div className="cer-chips">
              <Opcion activo={filtros.soloTel} onClick={() => setFiltros((f) => ({ ...f, soloTel: !f.soloTel }))}>{tx('mapa_prospectos_cerebro.con_telefono')}</Opcion>
              <Opcion activo={filtros.soloDecisor} onClick={() => setFiltros((f) => ({ ...f, soloDecisor: !f.soloDecisor }))}>{tx('mapa_prospectos_cerebro.con_decisor')}</Opcion>
              <Opcion activo={filtros.soloMensajeIA} onClick={() => setFiltros((f) => ({ ...f, soloMensajeIA: !f.soloMensajeIA }))}>{tx('mapa_prospectos_cerebro.mensaje_listo')}</Opcion>
              <Opcion activo={filtros.soloVacante} onClick={() => setFiltros((f) => ({ ...f, soloVacante: !f.soloVacante }))}>{tx('mapa_prospectos_cerebro.con_vacante')}</Opcion>
            </div>
          </Fieldset>
          <Fieldset leyenda={tx('mapa_prospectos_cerebro.urgencia_minima')}>
            <Elige etiqueta={tx('mapa_prospectos_cerebro.urgencia_minima')} valor={filtros.minUrgencia} valores={[0, 50, 70] as const}
              rotulo={(v) => (v === 0 ? tx('mapa_prospectos_cerebro.todas') : `≥${v}%`)} onChange={(v) => setFiltros((f) => ({ ...f, minUrgencia: v }))} />
          </Fieldset>
          <Fieldset leyenda={tx('mapa_prospectos_cerebro.similitud_icp_minima')} ayuda={criterioScoreTr('similitud', tx)}>
            <Elige etiqueta={tx('mapa_prospectos_cerebro.similitud_icp_minima')} valor={filtros.minSimilitud} valores={[0, 40, 65, 85] as const}
              rotulo={(v) => (v === 0 ? tx('mapa_prospectos_cerebro.todas') : `≥${v}%`)} onChange={(v) => setFiltros((f) => ({ ...f, minSimilitud: v }))} />
          </Fieldset>
          <Fieldset leyenda={tx('mapa_prospectos_cerebro.necesidad_minima')} ayuda={criterioScoreTr('necesidad', tx)}>
            <Elige etiqueta={tx('mapa_prospectos_cerebro.necesidad_minima')} valor={filtros.minNecesidad} valores={[0, 40, 65, 85] as const}
              rotulo={(v) => (v === 0 ? tx('mapa_prospectos_cerebro.todas') : `≥${v}%`)} onChange={(v) => setFiltros((f) => ({ ...f, minNecesidad: v }))} />
          </Fieldset>
          <Fieldset leyenda={tx('mapa_prospectos_cerebro.datos_completos')}>
            <Elige etiqueta={tx('mapa_prospectos_cerebro.datos_completos')} valor={filtros.minCompletitud} valores={[0, 50, 75] as const}
              rotulo={(v) => (v === 0 ? tx('mapa_prospectos_cerebro.todos') : `≥${v}%`)} onChange={(v) => setFiltros((f) => ({ ...f, minCompletitud: v }))} />
          </Fieldset>
          <Fieldset leyenda={tx('mapa_prospectos_cerebro.sin_toque_en')}>
            <Elige etiqueta={tx('mapa_prospectos_cerebro.sin_toque_en')} valor={filtros.sinToqueDias} valores={[0, 7, 14, 30] as const}
              rotulo={(v) => (v === 0 ? tx('mapa_prospectos_cerebro.todos') : tx('mapa_prospectos_cerebro.dias', { v }))} onChange={(v) => setFiltros((f) => ({ ...f, sinToqueDias: v }))} />
          </Fieldset>
          <CampoSelect etiqueta={tx('mapa_prospectos_cerebro.ordenar_por')} value={filtros.orden}
            onChange={(e) => setFiltros((f) => ({ ...f, orden: e.target.value as Filtros['orden'] }))}>
            <option value="cierre">{tx('mapa_prospectos_cerebro.cierre')}</option>
            <option value="urgencia">{tx('mapa_prospectos_cerebro.urgencia')}</option>
            <option value="similitud">{tx('mapa_prospectos_cerebro.similitud_icp')}</option>
            <option value="necesidad">{tx('mapa_prospectos_cerebro.necesidad')}</option>
            <option value="completos">{tx('mapa_prospectos_cerebro.datos_completos')}</option>
            <option value="recientes">{tx('mapa_prospectos_cerebro.recientes')}</option>
          </CampoSelect>
          <Campo etiqueta={tx('mapa_prospectos_cerebro.cerca_de_plaza')} ayuda={tx('mapa_prospectos_cerebro.elige_una_ciudad_de_la_lista')}>
            <input className="rv-ctl" list="cerebro-plazas" placeholder={tx('mapa_prospectos_cerebro.escribe_una_ciudad')} defaultValue={filtros.centro?.nombre ?? ''}
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
          <Fieldset leyenda={tx('mapa_prospectos_cerebro.radio')}>
            <Elige etiqueta={tx('mapa_prospectos_cerebro.radio_desde_la_plaza')} valor={filtros.centro ? filtros.radioKm : 0} valores={[0, 25, 50, 100, 200] as const}
              rotulo={(v) => (v === 0 ? tx('mapa_prospectos_cerebro.sin_radio') : `${v} km`)} onChange={(v) => setFiltros((f) => ({ ...f, radioKm: v }))} />
          </Fieldset>
          {errorExport && <p role="alert" className="cer-prospecto__error">{errorExport}</p>}
          <p className="cer-filtros__pie">{numero(filtrados.length, idioma)}{' '}{tx('mapa_prospectos_cerebro.de_prospectos_pasan_el_filtro_2', { numero: numero(prospectos.length, idioma) })}</p>
        </div>
      </Drawer>
    </div>
  );
}
