import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import {
  getKpis, getLiquidaciones, contarViajes, getLiquidacionesPorDia,
  getHechosSolos, getDineroObservadoPorTipo, getStatsPorOperador, getValorAhorro,
} from '@/lib/likida/analytics';
import { getConfig, type LikidaConfig } from '@/lib/likida/config';
import { traerResumenCostoIaTenant } from '@/lib/likida/costos';
import { ultimasCorridas } from '@/lib/likida/agentes/corridas';
import { VistaAgenteLiquidacion, type ExtraAgenteLiquidacion } from './vista';
import { SeccionNotificaciones } from '../seccion-notificaciones';
import { FichaCorridas } from '../ficha-corridas';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { validarUmbralConfianza, guardarEstrategiaAgente } from '@/lib/likida/agentes/estrategia';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { revalidatePath } from 'next/cache';
import { FormaEstrategiaLiquidacion, type ResultadoEstrategia } from '../estrategia-forma';
import { Bloque, EsqTabla, vigilar } from '../../bloque';
import { colaRevision, leerFiltrosCola, decodificarCursorCola, listarTerminales } from '@/lib/likida/revision';
import { buscarCatalogo, type OpcionCatalogo, type TipoCatalogo } from '@/lib/likida/repo';
import {
  contarPorEstado, contarNoCoincide, listarLiquidacionesExternas, avisosDiscrepanciaDe, type FiltroListado,
} from '@/lib/likida/liquidacion_externa/repo';
import { reintentarLiquidacionExterna, reenviarCopiaAJefe, reavisarDiscrepancia, canalDeEntregaPorOmision } from '@/lib/likida/liquidacion_externa/servicio';
import { reenviarDesglose, type DestinoReenvio, type MotivoReenvio } from '@/lib/likida/liquidacion_externa/reenvio_correo';
import { liberarEnvio } from '@/lib/likida/liquidacion_externa/liberar_envio';
import { leerFormatoFlota, leerTelefonosFlota } from '@/lib/likida/liquidacion_externa/repo';
import { importarLiquidacionesDeArchivo } from '@/lib/likida/liquidacion_externa/importar_archivo';
import { decodificarCursor, codificarCursor } from '@/app/api/v1/_comun';
import { SeccionExternas, leerFiltroExterno, leerMensajeExterno } from './externas';
import {
  SeccionDesgloses, VistaDesgloses, PanelDetalleDesglose, SeccionExcepciones, leerMensajeDesglose,
  leerFiltroDesglose, leerDia, destinosDe, cumpleFiltro,
  type FiltroDesglose, type FilaDesglose, type FilaSinPoliza, type FichasDesgloses, type LecturaDesgloses,
} from './desgloses';
import {
  listarDesgloses, entregasDe, contarParaInsights, listarExcepciones, type CursorLista,
} from '@/lib/likida/liquidacion_externa/repo_correo';
import { leerPorId } from '@/lib/likida/liquidacion_externa/repo';
import { hoyMx, inicioDiaMx, finDiaMx } from '@/lib/formato';
import { cargarDetalle, leerIdDetalle } from './detalle_desglose';

export const dynamic = 'force-dynamic';

/** Sección secundaria que no se pudo leer → null → su leyenda honesta.
 *  Mismo patrón `safe` que inicio-contenido: una gráfica caída no tumba la
 *  página, pero TAMPOCO pinta un cero sin medir. */
function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch(() => null);
}


const PAGINA_DESGLOSES = 20;
const LOTE_FILTRADO = 40;
const MAX_LOTES = 5;
const DIA_MS = 24 * 3600 * 1000;

/** El canal del desglose de la flota: LA MISMA función que usa la entrega (A37-S14-02), con el fail-safe `cinco_agentes` (siempre
 *  correo). Sin fila de configuración, o si no se puede leer, es el de siempre (`whatsapp`): jamás se cambia la pantalla de una flota
 *  por una lectura que falló. */
async function canalDeLaFlota(tenantId: string): Promise<'whatsapp' | 'correo' | 'ambos'> {
  try {
    return await canalDeEntregaPorOmision(tenantId);
  } catch {
    return 'whatsapp';
  }
}

/** Un conteo medido o `null`: la tabla ausente o una lectura caída no son un cero. */
async function medir(fn: () => Promise<number | null>): Promise<number | null> {
  try { return await fn(); } catch { return null; }
}

async function fichasDesgloses(tenantId: string): Promise<FichasDesgloses> {
  const hoy = hoyMx();
  const manana = new Date(Date.parse(inicioDiaMx(hoy)) + DIA_MS);
  const hace30 = new Date(Date.parse(inicioDiaMx(hoy)) - 29 * DIA_MS);
  const [deHoy, de30, retenidos, sinPoliza] = await Promise.all([
    contarParaInsights(tenantId, new Date(inicioDiaMx(hoy)), manana).catch(() => null),
    contarParaInsights(tenantId, hace30, manana).catch(() => null),
    medir(async () => {
      const r = await listarDesgloses(tenantId, { soloRetenidos: true, limite: 200 });
      return r.ok && !r.valor.siguiente ? r.valor.items.length : null;
    }),
    medir(async () => {
      const r = await listarExcepciones(tenantId, { tipo: 'sin_poliza', limite: 500 });
      return r.ok && r.valor.length < 500 ? r.valor.length : null;
    }),
  ]);
  const e = de30 && de30.ok ? de30.valor.entregasPorEstado : null;
  return {
    recibidosHoy: deHoy && deHoy.ok ? deHoy.valor.desgloses : null,
    enviados: e ? (e.enviada ?? 0) : null,
    entregados: e ? (e.entregada ?? 0) : null,
    rebotados: e ? (e.rebotada ?? 0) + (e.queja ?? 0) + (e.fallida ?? 0) : null,
    retenidos,
    sinPoliza,
  };
}

/** Vuelve al detalle con el código del resultado en la URL (el texto lo pone la pantalla). Módulo, no cierre: una acción de servidor no puede capturar funciones. */
function volverAlDetalle(contexto: Array<[string, string]>, id: string | null, codigo: string): never {
  revalidatePath('/dashboard/agentes/liquidacion');
  const params: Array<[string, string]> = [...contexto, ...(id ? [['des_det', id] as [string, string]] : []), ['des_msg', codigo]];
  redirect(`/dashboard/agentes/liquidacion?${new URLSearchParams(params).toString()}#detalle-desglose`);
}

/** Las excepciones abiertas de la flota (las 50 más recientes). `null` = no se pudo leer: jamás «sin excepciones». */
async function cargarExcepciones(tenantId: string) {
  try {
    const r = await listarExcepciones(tenantId, { limite: 50 });
    return r.ok ? r.valor : null;
  } catch {
    return null;
  }
}

/**
 * La lista de desgloses con el estado de cada destinatario. Con un filtro por estado o por fecha, el estado de entrega vive en otra
 * tabla: se leen lotes acotados (máximo `MAX_LOTES`) hasta juntar una página, y el cursor continúa donde se dejó de mirar. Si algo de
 * la lectura falla, devuelve `ok: false` — nunca una lista parcial presentada como completa.
 */
async function cargarDesgloses(
  tenantId: string, filtro: FiltroDesglose | null, desde: string | null, hasta: string | null, cursor: CursorLista | null,
): Promise<LecturaDesgloses> {
  try {
    const fichas = await fichasDesgloses(tenantId);
    if (filtro === 'sin_poliza') {
      const ex = await listarExcepciones(tenantId, { tipo: 'sin_poliza', limite: 200 });
      if (!ex.ok) return { ok: false };
      const sinPoliza: FilaSinPoliza[] = ex.valor.map((x) => ({ bitacora: x.claveExterna, desde: x.primeraVez, ultimaVez: x.ultimaVez }));
      return { ok: true, fichas, filas: [], sinPoliza, siguiente: null };
    }
    const cota = { desde: desde ? Date.parse(inicioDiaMx(desde)) : null, hasta: hasta ? Date.parse(finDiaMx(hasta)) : null };
    const filtrando = !!(filtro || desde || hasta);
    const limite = filtrando ? LOTE_FILTRADO : PAGINA_DESGLOSES;
    const filas: FilaDesglose[] = [];
    let ultimaIncluida: CursorLista | null = null;
    let siguiente: CursorLista | null = null;
    let actual = cursor;
    for (let lote = 0; lote < MAX_LOTES; lote++) {
      const l = await listarDesgloses(tenantId, { soloRetenidos: filtro === 'retenido', limite }, actual);
      if (!l.ok) return { ok: false };
      const { items, siguiente: masAdelante } = l.valor;
      const dentro = items.filter((d) => {
        const t = Date.parse(d.creadoEn);
        return (cota.hasta === null || t <= cota.hasta) && (cota.desde === null || t >= cota.desde);
      });
      const enriquecidos = await Promise.all(dentro.map(async (d) => {
        const [liq, ent] = await Promise.all([leerPorId(tenantId, d.liquidacionExternaId).catch(() => null), entregasDe(tenantId, d.liquidacionExternaId)]);
        if (!ent.ok) throw new Error('entregas no disponibles');
        const fila: FilaDesglose = {
          liquidacionId: d.liquidacionExternaId, bitacora: d.bitacora, operador: liq?.operadorNombre ?? null,
          periodoDesde: liq?.periodoDesde ?? null, periodoHasta: liq?.periodoHasta ?? null, neto: liq?.total ?? null,
          moneda: liq?.moneda ?? 'MXN', terminal: d.terminal || null, destinos: destinosDe(ent.valor, d.retenidaMotivo),
        };
        return { d, fila };
      }));
      let hayMas = false;
      for (const { d, fila } of enriquecidos) {
        if (!cumpleFiltro(fila.destinos, filtro)) continue;
        if (filas.length === PAGINA_DESGLOSES) { hayMas = true; break; }
        filas.push(fila);
        ultimaIncluida = { creadoEn: d.creadoEn, id: d.liquidacionExternaId };
      }
      if (hayMas) { siguiente = ultimaIncluida; break; }
      const ultimaVista = items[items.length - 1];
      const pasoLaCota = cota.desde !== null && !!ultimaVista && Date.parse(ultimaVista.creadoEn) < cota.desde;
      if (!masAdelante || pasoLaCota) break;
      actual = masAdelante;
      // Se agotó el presupuesto de lotes: se ofrece continuar desde donde se dejó de mirar.
      if (lote === MAX_LOTES - 1) siguiente = masAdelante;
    }
    return { ok: true, fichas, filas, sinPoliza: [], siguiente: siguiente ? codificarCursor(siguiente) : null };
  } catch {
    return { ok: false };
  }
}

/**
 * Agente de Liquidación de Ruta — v2 (13-ago-2026: "gráficas, algo visual").
 * Esta puerta trae sesión y TODOS los datos; el dibujo vive en `vista.tsx`
 * (patrón page/vista).
 *
 * ── FE-14 (22-ago-2026): TRECE CONSULTAS QUE YA NO SE ESPERAN ENTRE SÍ ────
 *
 * Aquí había un `Promise.all` de trece lecturas y la página no devolvía nada
 * hasta la última: la tabla "Esperan tu revisión" —la única razón por la que
 * un humano abre esta pantalla— aterrizaba al mismo tiempo que la serie de 84
 * días del calendario de cierres. Ahora las trece se lanzan igual de juntas y
 * se esperan DENTRO de la tarjeta que las usa (ver `bloque.tsx`).
 *
 * Los primarios (KPIs, cola) siguen sin `safe`: no se pinta "0 por revisar"
 * ciego. Lo que cambia es DÓNDE se nota la caída — antes reventaba la ruta
 * entera vía `error.tsx`; ahora `LimiteError` la contiene en su tarjeta, con
 * su `EstadoError` y su botón de reintento, y las hermanas que sí leyeron
 * siguen en pie. La regla que importaba —jamás un cero sin medir— queda
 * intacta; la que se cae es la de arrastrar la pantalla completa.
 */
export default async function PaginaAgenteLiquidacion({
  searchParams,
}: {
  // Los siete de la cola (`rev`, `estado`, `operador`, `unidad`, `terminal`,
  // `desde`, `hasta`, `cursor`) van en la URL a propósito: un filtro se
  // comparte por chat y el botón de atrás funciona (ver `cola.tsx`).
  searchParams: Promise<{
    vista?: string; tenant?: string; rol?: string;
    rev?: string; estado?: string; operador?: string; unidad?: string;
    terminal?: string; desde?: string; hasta?: string; cursor?: string;
    // La sección «Liquidaciones externas» (0370) tiene SUS parámetros, con
    // prefijo, para que su filtro no pise a los de la cola de arriba.
    ext_estado?: string; ext_cursor?: string; ext_msg?: string; ext_imp?: string; ext_det?: string;
    // La lista de desgloses por correo (T-A1-28) tiene los suyos, con prefijo `des_`.
    des_estado?: string; des_desde?: string; des_hasta?: string; des_cursor?: string;
    // El detalle de un desglose (T-A1-29): solo su id y el código del resultado de la última acción; nunca cifras.
    des_det?: string; des_msg?: string;
  }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/liquidacion', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/liquidacion')) redirect('/dashboard');

  const base = sp.tenant ? `?tenant=${sp.tenant}` : sp.vista ? `?vista=${sp.vista}` : '';
  const sufijo = sp.rol ? `${base}${base ? '&' : '?'}rol=${sp.rol}` : base;

  // Lo que hay que conservar en cada link y en el submit del filtro: el mismo
  // contrato de sufijo del resto del panel.
  const contexto: Array<[string, string]> = [
    ...(sp.tenant ? [['tenant', sp.tenant] as [string, string]] : []),
    ...(sp.vista ? [['vista', sp.vista] as [string, string]] : []),
    ...(sp.rol ? [['rol', sp.rol] as [string, string]] : []),
  ];

  // ── ACCIONES DEL DETALLE DEL DESGLOSE (T-A1-29) ─────────────────────────
  // Cada una re-gatea con la sesión REAL (es alcanzable por POST directo): ruta visible + tenant efectivo; `puedeAdministrar` lo exige
  // además la librería. Vuelven SIEMPRE a la pantalla con un código de resultado en la URL (el texto lo pone la pantalla, no la URL).

  /** Reenvía por correo el desglose de UNA liquidación («operador, no me da mi desglose»), con o sin correo corregido del operador. */
  async function reenviarDesgloseExterno(fd: FormData): Promise<void> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/agentes/liquidacion', sp);
    if (!puedeVerRuta(s.rol, '/dashboard/agentes/liquidacion')) throw new Error('Tu rol no ve esta pantalla.');
    const id = leerIdDetalle(String(fd.get('id') ?? ''));
    const a = String(fd.get('a') ?? '');
    const motivo = String(fd.get('motivo') ?? 'manual');
    if (!id || !['operador', 'coordinador', 'rh', 'todos'].includes(a) || !['reclamo', 'correccion_de_correo', 'manual'].includes(motivo)) {
      return volverAlDetalle(contexto, id, 'r_entrada');
    }
    let codigo: string;
    try {
      const r = await reenviarDesglose(s.tenantId, id, {
        a: a as DestinoReenvio, motivo: motivo as MotivoReenvio, actor: { userId: s.userId, rol: s.rol },
        correoNuevo: String(fd.get('correo_nuevo') ?? ''),
      });
      codigo = r.estado === 'reenviado' ? 'reenvio_ok' : `r_${r.motivo}`;
    } catch {
      codigo = 'r_error';
    }
    return volverAlDetalle(contexto, id, codigo);
  }

  /** Libera el envío de un desglose retenido (neto negativo, tipo sin regla): crea las entregas y deja al actor en la auditoría. */
  async function liberarEnvioExterno(fd: FormData): Promise<void> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/agentes/liquidacion', sp);
    if (!puedeVerRuta(s.rol, '/dashboard/agentes/liquidacion')) throw new Error('Tu rol no ve esta pantalla.');
    const id = leerIdDetalle(String(fd.get('id') ?? ''));
    if (!id) return volverAlDetalle(contexto, null, 'r_entrada');
    let codigo: string;
    try {
      const r = await liberarEnvio(s.tenantId, id, { userId: s.userId, rol: s.rol });
      codigo = r.estado === 'liberado' ? 'liberado_ok' : `r_${r.motivo}`;
    } catch {
      codigo = 'r_error';
    }
    return volverAlDetalle(contexto, id, codigo);
  }

  // ── DESGLOSE POR CORREO (T-A1-28) ───────────────────────────────────────
  // Una flota con el canal en correo ve la lista de desgloses EN LUGAR de los KPIs, la cola y la estrategia del flujo de fotos (se
  // ocultan, no se borran: otras flotas siguen igual). Sin configuración guardada el canal es `whatsapp` y todo queda como hoy.
  if ((await canalDeLaFlota(tenantId)) !== 'whatsapp') {
    const filtroDes: FiltroDesglose | null = leerFiltroDesglose(sp.des_estado);
    const desdeDes = leerDia(sp.des_desde);
    const hastaDes = leerDia(sp.des_hasta);
    const cursorDes = sp.des_cursor ? decodificarCursor(sp.des_cursor) : null;
    const lectura = cargarDesgloses(tenantId, filtroDes, desdeDes, hastaDes, cursorDes);
    const idDetalle = leerIdDetalle(sp.des_det);
    const paramsLista: Array<[string, string]> = [
      ...(filtroDes ? [['des_estado', filtroDes] as [string, string]] : []),
      ...(desdeDes ? [['des_desde', desdeDes] as [string, string]] : []),
      ...(hastaDes ? [['des_hasta', hastaDes] as [string, string]] : []),
    ];
    return (
      <VistaDesgloses
        desgloses={
          <Bloque mensaje="No se pudieron leer los desgloses." esqueleto={<EsqTabla filas={5} />}>
            <SeccionDesgloses lectura={lectura} filtro={filtroDes} desde={desdeDes} hasta={hastaDes} contexto={contexto} />
          </Bloque>
        }
        detalle={idDetalle && (
          <Bloque mensaje="No se pudo leer el detalle del desglose." esqueleto={<EsqTabla filas={5} />}>
            <PanelDetalleDesglose
              lectura={cargarDetalle(tenantId, idDetalle)} acciones={{ reenviar: reenviarDesgloseExterno, liberar: liberarEnvioExterno }}
              mensaje={leerMensajeDesglose(sp.des_msg)} contexto={contexto} params={paramsLista}
            />
          </Bloque>
        )}
        excepciones={
          <Bloque mensaje="No se pudieron leer las excepciones." esqueleto={<EsqTabla filas={3} />}>
            <SeccionExcepciones excepciones={cargarExcepciones(tenantId)} contexto={contexto} />
          </Bloque>
        }
        notificaciones={
          <Bloque mensaje="No se pudo leer la configuración de avisos." esqueleto={<EsqTabla filas={4} />}>
            <SeccionNotificaciones tenantId={tenantId} agenteId="liquidacion" />
          </Bloque>
        }
      />
    );
  }

  // Las trece, lanzadas de una. `vigilar` sobre las que PUEDEN rechazar: una
  // promesa sin oyente que revienta antes de que su bloque la espere se
  // cuenta como unhandledRejection (ver la nota en `bloque.tsx`).
  const pKpis = vigilar(getKpis(tenantId));
  const pLiqs = vigilar(getLiquidaciones(tenantId));
  const pCosto = vigilar(traerResumenCostoIaTenant(tenantId, 'pagina_agente_liquidacion'));
  const pAbiertos = vigilar(contarViajes(tenantId, ['abierto']));
  const pEnCuadre = vigilar(contarViajes(tenantId, ['en_cuadre']));
  const pLiquidados = vigilar(contarViajes(tenantId, ['liquidado']));
  // Secundarios: cada uno degrada solo.
  const pPorDia = safe(() => getLiquidacionesPorDia(tenantId, 84));
  const pHechos = safe(() => getHechosSolos(tenantId));
  const pPorTipo = safe(() => getDineroObservadoPorTipo(tenantId));
  const pStats = safe(() => getStatsPorOperador(tenantId));
  const pAhorro = safe(() => getValorAhorro(tenantId));
  const pConfig: Promise<LikidaConfig | null> = safe(() => getConfig(tenantId));
  // La ficha de corridas (B3): el corazón del producto era el ÚNICO de los
  // 7 agentes sin bitácora hasta la Fase 1 del blueprint (0115); su corrida
  // es el cierre por WhatsApp. null = no se pudo leer, y la ficha lo dice.
  const pCorridas = safe(() => ultimasCorridas(tenantId, 'liquidacion'));

  // ── FE-5 · BLOQ-6: LA COLA ES SU PROPIA CONSULTA ────────────────────────
  // Ya no un filtro en memoria sobre `getLiquidaciones` (50 más recientes ≈
  // 2.4 h a 500 cierres/día). Va por llave, por antigüedad y con `count` real
  // de la base; primaria, o sea SIN `safe`: una cola que no se pudo leer
  // enseña su error, nunca «nada que firmar».
  const filtros = leerFiltrosCola(sp);
  const pCola = vigilar(colaRevision(tenantId, filtros, decodificarCursorCola(sp.cursor)));
  // El selector de terminales sí degrada: sin él la cola sigue sirviendo.
  const pTerminales = safe(() => listarTerminales(tenantId));

  /** Buscador de catálogo para los combos de operador/unidad de los filtros.
   *  Re-gatea con la sesión REAL: es alcanzable por POST directo y devuelve
   *  nombres de UNA flota. Lanza ante rechazo — una lista vacía afirmaría
   *  "ningún chofer se llama así". */
  async function buscarFiltro(tipo: TipoCatalogo, q: string): Promise<OpcionCatalogo[]> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/agentes/liquidacion', sp);
    if (!puedeVerRuta(s.rol, '/dashboard/agentes/liquidacion')) throw new Error('Tu rol no ve esta pantalla.');
    if (tipo !== 'operador' && tipo !== 'unidad') throw new Error('Catálogo desconocido.');
    return buscarCatalogo(s.tenantId, tipo, typeof q === 'string' ? q : '');
  }

  // ── LIQUIDACIONES EXTERNAS (0370) ───────────────────────────────────────
  // Su propia consulta y su propio `Bloque`: primarias (sin `safe`) — una
  // sección que no se pudo leer enseña su error, jamás «ninguna liquidación».
  const filtroExterno = leerFiltroExterno(sp.ext_estado);
  const filtroListado: FiltroListado = filtroExterno === 'no_coincide'
    ? { acuseTipo: 'no_coincide' }
    : filtroExterno ? { estado: filtroExterno } : {};
  const cursorExterno = sp.ext_cursor ? decodificarCursor(sp.ext_cursor) : null;
  const pFichasExternas = vigilar(Promise.all([contarPorEstado(tenantId), contarNoCoincide(tenantId)])
    .then(([porEstado, noCoincide]) => ({ porEstado, noCoincide })));
  const pPaginaExterna = vigilar(listarLiquidacionesExternas(tenantId, filtroListado, 20, cursorExterno, true)
    .then((r) => {
      const ultima = r.filas.at(-1);
      return {
        filas: r.filas, hayMas: r.hayMas, total: r.total,
        siguiente: r.hayMas && ultima ? codificarCursor({ creadoEn: ultima.creadaEn, id: ultima.id }) : null,
      };
    }));

  // El estado del aviso a la oficina de las discrepancias de ESTA página (0643). Mejor esfuerzo: sin la tabla o con un error de lectura
  // es `null` y la pantalla no pinta rótulo (jamás inventa uno).
  const pAvisos = pPaginaExterna
    .then((pg) => avisosDiscrepanciaDe(tenantId, pg.filas.filter((l) => l.acuseTipo === 'no_coincide').map((l) => l.id)))
    .then((m) => (m ? Object.fromEntries([...m].map(([id, a]) => [id, { estado: a.estado }])) : null))
    .catch(() => null);

  // El formato de la flota (0564): solo para decidir qué enlaces se pintan; si no se pudo leer, no se pintan.
  // La copia al jefe no depende del formato (0645): se lee de los teléfonos, con o sin Excel de muestra.
  const pFormato = Promise.all([leerFormatoFlota(tenantId), leerTelefonosFlota(tenantId)])
    .then(([c, t]) => ({ excel: c !== null, copia: (t?.copia.length ?? 0) > 0 }))
    .catch(() => null);

  /** Reintenta UNA entrega fallida. Re-gatea con la sesión REAL (es alcanzable
   *  por POST directo) y siempre vuelve a la pantalla con el resultado en la
   *  URL: ni un éxito ni un fallo pasan en silencio. */
  async function reintentarExterna(fd: FormData): Promise<void> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/agentes/liquidacion', sp);
    if (!puedeVerRuta(s.rol, '/dashboard/agentes/liquidacion')) throw new Error('Tu rol no ve esta pantalla.');
    const id = String(fd.get('id') ?? '');
    let resultado: 'reintentada' | 'no_aplica' | 'no_encontrada' | 'error' = 'no_encontrada';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      try {
        resultado = await reintentarLiquidacionExterna(s.tenantId, id.toLowerCase(), s.userId);
      } catch {
        resultado = 'error';
      }
    }
    revalidatePath('/dashboard/agentes/liquidacion');
    redirect(`/dashboard/agentes/liquidacion?${new URLSearchParams([...contexto, ['ext_msg', resultado]]).toString()}#liquidaciones-externas`);
  }

  /** Sube el CSV/Excel de liquidaciones que la oficina ya tiene: entra por el mismo camino que POST /v1/liquidaciones-externas. */
  async function subirLiquidacionesExternas(fd: FormData): Promise<void> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/agentes/liquidacion', sp);
    if (!puedeVerRuta(s.rol, '/dashboard/agentes/liquidacion') || !puedeVerArea(s.rol, 'administracion')) throw new Error('Solo el dueño de la flota sube liquidaciones.');
    const a = fd.get('archivo');
    const params: Array<[string, string]> = [...contexto];
    if (!(a instanceof File) || a.size === 0) {
      params.push(['ext_msg', 'importacion_error'], ['ext_det', 'Elige el archivo de liquidaciones (CSV o Excel).']);
    } else if (a.size > 4_000_000) {
      params.push(['ext_msg', 'importacion_error'], ['ext_det', 'El archivo pesa demasiado (máximo 4 MB). Pártelo en varios.']);
    } else {
      try {
        const r = await importarLiquidacionesDeArchivo(s.tenantId, a.name, new Uint8Array(await a.arrayBuffer()));
        const detalle = (r.error ?? r.problemas.slice(0, 5).map((x) => `${x.clave ?? 'archivo'}: ${x.motivo}`).join(' · ')).slice(0, 700);
        params.push(['ext_msg', r.error ? 'importacion_error' : 'importada'], ['ext_imp', `${r.recibidas}.${r.repetidas}.${r.problemas.length}`]);
        if (detalle) params.push(['ext_det', detalle]);
      } catch {
        params.push(['ext_msg', 'importacion_error'], ['ext_det', 'No se pudo procesar el archivo. Vuelve a intentarlo: repetirlo es seguro.']);
      }
    }
    revalidatePath('/dashboard/agentes/liquidacion');
    redirect(`/dashboard/agentes/liquidacion?${new URLSearchParams(params).toString()}#liquidaciones-externas`);
  }

  /** Reenvía la copia al jefe de flota de UNA liquidación ya entregada (la primera pudo no llegar). */
  async function reenviarCopiaExterna(fd: FormData): Promise<void> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/agentes/liquidacion', sp);
    if (!puedeVerRuta(s.rol, '/dashboard/agentes/liquidacion')) throw new Error('Tu rol no ve esta pantalla.');
    const id = String(fd.get('id') ?? '');
    let resultado: 'copia_enviada' | 'copia_ya' | 'copia_fallo' | 'copia_sin_jefe' | 'canal_correo' | 'no_encontrada' | 'error' = 'no_encontrada';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      try {
        const r = await reenviarCopiaAJefe(s.tenantId, id.toLowerCase());
        resultado = r.estado === 'enviada' ? 'copia_enviada' : r.estado === 'ya_enviada' ? 'copia_ya'
          : r.estado === 'sin_destinatarios' ? 'copia_sin_jefe' : r.estado === 'canal_correo' ? 'canal_correo' : r.estado === 'no_enviada' ? 'copia_fallo' : 'no_encontrada';
      } catch {
        resultado = 'error';
      }
    }
    revalidatePath('/dashboard/agentes/liquidacion');
    redirect(`/dashboard/agentes/liquidacion?${new URLSearchParams([...contexto, ['ext_msg', resultado]]).toString()}#liquidaciones-externas`);
  }

  /** «Reavisar» una discrepancia: rearma el aviso fallido o pendiente y lo manda ya. Re-gatea con la sesión REAL (es alcanzable por
   *  POST directo) y vuelve a la pantalla con el resultado en la URL. */
  async function reavisarExterna(fd: FormData): Promise<void> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/agentes/liquidacion', sp);
    if (!puedeVerRuta(s.rol, '/dashboard/agentes/liquidacion')) throw new Error('Tu rol no ve esta pantalla.');
    const id = String(fd.get('id') ?? '');
    let resultado: 'reaviso_ok' | 'reaviso_parcial' | 'reaviso_pendiente' | 'reaviso_ya' | 'reaviso_en_curso' | 'canal_correo' | 'no_aplica' | 'no_encontrada' | 'error' = 'no_encontrada';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      try {
        const r = await reavisarDiscrepancia(s.tenantId, id.toLowerCase(), s.userId);
        resultado = r === 'reavisada' ? 'reaviso_ok' : r === 'parcial' ? 'reaviso_parcial' : r === 'pendiente' ? 'reaviso_pendiente'
          : r === 'ya_enviado' ? 'reaviso_ya' : r === 'en_curso' ? 'reaviso_en_curso' : r;
      } catch {
        resultado = 'error';
      }
    }
    revalidatePath('/dashboard/agentes/liquidacion');
    redirect(`/dashboard/agentes/liquidacion?${new URLSearchParams([...contexto, ['ext_msg', resultado]]).toString()}#liquidaciones-externas`);
  }

  // Derivadas: `.then` sobre promesas YA lanzadas — no añaden espera, solo
  // dicen qué hacer cuando lleguen, y agrupan lo que una MISMA tarjeta pinta.
  const extra: ExtraAgenteLiquidacion = {
    puedeVerReglas: puedeVerRuta(rol, '/dashboard/configuracion'),
    ciclo: vigilar(Promise.all([pAbiertos, pEnCuadre, pKpis, pLiquidados]).then(
      ([abiertos, enCuadre, kpis, liquidados]) => ({ abiertos, enCuadre, porRevisar: kpis.porRevisar, liquidados }))),
    cierresPorDia: pPorDia.then((porDia) => porDia?.map((d) => ({ fecha: d.dia, valor: d.valor })) ?? null),
    // "Lo que hizo solo" es UNA tarjeta con cuatro fuentes: van juntas para
    // que aterrice completa y no a pedazos.
    hizoSolo: vigilar(Promise.all([pHechos, pAhorro, pCosto]).then(([hechos, ahorro, costo]) => ({
      hechos,
      huerfanos: ahorro ? { resueltos: ahorro.huerfanosResueltos, totales: ahorro.huerfanosTotales } : null,
      docsProcesados: ahorro?.documentosProcesados ?? null,
      actividadIa: 'ok' in costo
        ? costo.ok.porFase.filter((f) => f.fase !== 'chat').reduce((s, f) => s + f.n, 0)
        : null,
    }))),
    porTipo: pPorTipo,
    operadores: pStats.then((stats) => stats
      ?.filter((o) => o.diferencias > 0)
      .sort((a, b) => b.diferencias - a.diferencias)
      .slice(0, 6)
      .map((o) => ({ etiqueta: o.nombre, valor: o.diferencias })) ?? null),
    politica: pConfig.then((config) => config?.politica ?? null),
  };

  async function guardarEstrategia(_previo: ResultadoEstrategia, fd: FormData): Promise<ResultadoEstrategia> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/agentes/liquidacion', sp);
    if (!puedeVerRuta(s.rol, '/dashboard/agentes/liquidacion') || !puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota cambia la estrategia del agente.' };
    }
    try {
      const umbral = validarUmbralConfianza(String(fd.get('umbralConfianza') ?? ''));
      await guardarEstrategiaAgente(s.tenantId, { liquidacion: { umbralConfianza: umbral } }, { id: s.userId });
      revalidatePath('/dashboard/agentes/liquidacion');
      return { ok: true, mensaje: `Listo: las lecturas por debajo de ${umbral} salen a revisar, desde el próximo cuadre.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar la estrategia') };
    }
  }

  return (
    <VistaAgenteLiquidacion
      kpis={pKpis}
      liquidaciones={pLiqs}
      cola={{ cola: pCola, filtros, terminales: pTerminales, buscar: buscarFiltro, contexto, sufijo }}
      externas={
        <Bloque mensaje="No se pudieron leer las liquidaciones externas." esqueleto={<EsqTabla filas={4} />}>
          <SeccionExternas
            fichas={pFichasExternas} pagina={pPaginaExterna} filtroEstado={filtroExterno}
            contexto={contexto} mensaje={leerMensajeExterno(sp.ext_msg)}
            puedeReintentar reintentar={reintentarExterna}
            formato={pFormato} reenviarCopia={reenviarCopiaExterna} avisos={pAvisos} reavisar={reavisarExterna}
            subirArchivo={puedeVerArea(rol, 'administracion') ? subirLiquidacionesExternas : undefined}
            importacion={{ conteo: sp.ext_imp, detalle: sp.ext_det }}
          />
        </Bloque>
      }
      extra={extra}
      sufijo={sufijo}
      notificaciones={
        <>
          {/* La estrategia (B4): solo el dueño, y solo con la config actual
              legible — sin ella, la forma guardaría a ciegas. */}
          {puedeAdministrar(rol) && (
            <Bloque mensaje="No se pudo leer la estrategia del agente." esqueleto={null}>
              <BloqueEstrategia pConfig={pConfig} accion={guardarEstrategia} />
            </Bloque>
          )}
          <Bloque mensaje="No se pudo leer la bitácora de corridas." esqueleto={<EsqTabla filas={3} />}>
            <BloqueCorridas pCorridas={pCorridas} />
          </Bloque>
          {/* Notificaciones hace SUS propias lecturas (config del canal,
              usuarios avisables): en su propio boundary no retiene a nadie. */}
          <Bloque mensaje="No se pudo leer la configuración de avisos." esqueleto={<EsqTabla filas={4} />}>
            <SeccionNotificaciones tenantId={tenantId} agenteId="liquidacion" />
          </Bloque>
        </>
      }
    />
  );
}

async function BloqueEstrategia({ pConfig, accion }: {
  pConfig: Promise<LikidaConfig | null>;
  accion: (previo: ResultadoEstrategia, fd: FormData) => Promise<ResultadoEstrategia>;
}) {
  const config = await pConfig;
  if (config === null) return null;
  return <FormaEstrategiaLiquidacion accion={accion} umbralActual={config.agentes.liquidacion.umbralConfianza} />;
}

async function BloqueCorridas({ pCorridas }: {
  pCorridas: Promise<Awaited<ReturnType<typeof ultimasCorridas>> | null>;
}) {
  return <FichaCorridas corridas={await pCorridas} />;
}
