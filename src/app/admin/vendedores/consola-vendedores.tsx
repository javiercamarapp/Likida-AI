import { Suspense, cache } from 'react';
import { Building2 } from 'lucide-react';
import {
  ESTADOS_PROSPECTO, ESTADOS_VIVOS, TRANSICIONES_PROSPECTO,
  reglaComision, listarVendedores,
  type VendedorRow,
} from '@/lib/likida/vendedores';
import { getPipelineVendedores, type PipelineVendedores } from '@/lib/admin/prospectos-mapa';
import { ultimasCorridasNegocio, duracionLegible, type CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { fechaHoraMx, numero, porcentaje } from '@/lib/formato';
import { resolverFormato } from '../ui/formato-preset';
import {
  AvisoCompacto, BarraFiltros, EsqCifrasV2, EsqTablaV2, EsqTarjetaV2, EstadoVacio, FilaTarjetas, FiltroBusqueda, FiltroOpciones,
  StatusChip, Tarjeta, TablaBase, type ColumnaBase, type TonoEstado,
} from '../../ui-v2/componentes';
import { BarList, TiraCifras } from '../../ui-v2/graficas';
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { getT } from '@/lib/i18n/servidor';
import { estadoProspectoTr } from '@/lib/i18n/rotulos_tr';
import { embudoDeVentas } from './embudo-ventas';
import { uniformes } from '../cifras-uniformes';
import { TableroProspectos, type ColumnaTablero } from './tablero';
import { FormaProspecto, FormaInvitarVendedor, BotonRepartir } from './formas';
import {
  accionMover, accionAsignar, accionNota, accionRedactar,
  accionCrearProspecto, accionInvitar, accionRepartir,
} from './acciones';
import './tablero.css';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';

const RUTA = '/admin/vendedores';

/** Tarjetas que se pintan por columna. El censo trae ~800 empresas: pintar cientos de tarjetas por columna cuelga el tablero, así que se
 *  recorta y el recorte SE DICE ("y N más — filtra para verlos"). */
const TOPE_COLUMNA = 30;

/** Resiliencia por sección, mismo helper que los dashboards: una consulta caída deja `null` y su tarjeta lo dice, jamás un cero con cara de dato. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/** R9c: las lecturas las pide cada bloque dentro de su <Suspense>; `cache()` las comparte entre bloques de una misma petición, así que no
 *  se lee nada dos veces ni se suma ninguna lectura nueva. */
const cargarVendedores = cache(() => safe<VendedorRow[]>(() => listarVendedores()));
/** w15/perf (punto 5): antes `listarProspectos()` bajaba las ~33 mil filas con `notas` (15 s) para contar y quedarse con 30 por columna. Ahora los
 *  totales y los filtros salen del índice ligero y `notas` solo de las tarjetas que se pintan. Los tres bloques comparten UNA lectura
 *  (los totales no dependen del filtro; solo las columnas). */
const cargarPipeline = cache((vendedor: string | undefined, q: string | undefined) =>
  safe<PipelineVendedores>(() => getPipelineVendedores({ vendedor, q }, TOPE_COLUMNA)));
const cargarCorridas = cache(() => safe<CorridaRegistrada[]>(() => ultimasCorridasNegocio('ventas', 5)));

/**
 * VENTAS › VENDEDORES — el contenido completo de /admin/vendedores, SIN el gate. Vive en su propio archivo, exportado, por la razón #2 de
 * `dashboard/inicio-contenido.tsx`: la página llama `requireSuperadmin()` y un preview headless sin sesión no puede montarla; este
 * componente sí, y es el REAL (una copia verificaría la copia).
 *
 * La AUTORIZACIÓN no se relaja con la extracción: el gate de pantalla sigue en admin/layout.tsx + page.tsx, y cada server action de aquí
 * re-gatea superadmin por sesión y MFA en `acciones.ts`: montar el componente no regala ninguna escritura.
 */
export function ConsolaVendedores({ sp, tx = T_SISTEMA_ES }: { nombre?: string | null; sp: { vendedor?: string; q?: string }; tx?: TSistema }) {
  return (
    <EsqueletoTablaMaestra
      titulo={tx('mapa_prospectos.ventas')} apoyo={tx('vendedores_consola_vendedores.el_pipeline_del_censo_el_equipo')}
      filtros={<Suspense fallback={null}><BloqueFiltros sp={sp} /></Suspense>}
    >
      <Suspense fallback={<EsqCifrasV2 n={5} />}><BloqueKpis sp={sp} /></Suspense>
      <FilaTarjetas variante="6-6" className="adm-fila-alto-contenido">
        <Suspense fallback={<EsqTarjetaV2 alto={240} />}><BloqueEmbudo sp={sp} /></Suspense>
        {/* Las dos tarjetas de la derecha miden lo que dice su contenido y juntas llenan el alto del embudo: sin 140 px de aire. */}
        <div className="adm-pila">
        <Tarjeta titulo={tx('vendedores_consola_vendedores.agente_asignador')}>
          <p className="ven-tarjeta__tenue">{tx('vendedores_consola_vendedores.reparte_los_prospectos_sin_vendedor_en')}</p>
          <BotonRepartir accion={accionRepartir} />
          <Suspense fallback={<EsqTarjetaV2 alto={60} plana />}><BloqueCorridas /></Suspense>
          {/* Lo que NO existe no se pinta como si existiera: los agentes que buscan leads y hacen el primer acercamiento son roadmap. */}
          <p className="ven-tarjeta__tenue ven-tarjeta__tenue--fino">{tx('vendedores_consola_vendedores.proximamente_agentes_que_busquen_leads_nuevos')}</p>
        </Tarjeta>
        <BloqueComisiones tx={tx} />
        </div>
      </FilaTarjetas>
      <Suspense fallback={<EsqTarjetaV2 alto={320} />}><BloqueTablero sp={sp} /></Suspense>
      <Suspense fallback={<EsqTablaV2 filas={4} />}><BloqueDesempeno /></Suspense>
      <Suspense fallback={<EsqTarjetaV2 alto={160} />}><BloqueAltas /></Suspense>
    </EsqueletoTablaMaestra>
  );
}

// ── Comisiones: solo con base real ───────────────────────────────────────────

/** La regla pactada SÍ se enseña (es un dato del negocio); el MONTO no: no hay registro de comisiones ni liga de prospecto a flota y a
 *  factura pagada, así que calcular una cifra hoy sería inventarla. Cuando exista la base, esta tarjeta se sustituye por el cálculo. */
function BloqueComisiones({ tx = T_SISTEMA_ES }: { tx?: TSistema }) {
  const regla = reglaComision();
  return (
    <Tarjeta titulo={tx('vendedores_consola_vendedores.comisiones_de_vendedores')} estado="vacio" contenida mensaje={tx('vendedores_consola_vendedores.falta_aun_no_hay_base_para')}
      detalle={tx('vendedores_consola_vendedores.hace_falta_ligar_cada_prospecto_cerrado')}>
      <p className="ven-regla"><span>{regla.primerMes}</span><span>{regla.recurrente}</span></p>
    </Tarjeta>
  );
}

// ── Bloques con su propia lectura y su propio <Suspense> (R9c) ───────────────

/** Los datos derivados del pipeline, una sola vez por bloque que los necesite (solo si las lecturas llegaron). */
async function derivarPipeline(sp: { vendedor?: string; q?: string }) {
  const [vendedores, pipeline] = await Promise.all([cargarVendedores(), cargarPipeline(sp.vendedor, sp.q)]);
  const nombresVendedor = new Map((vendedores ?? []).map((v) => [v.id, v.nombre ?? v.email]));
  const opcionesVendedor = (vendedores ?? []).map((v) => ({ id: v.id, nombre: v.nombre ?? v.email }));
  const hayFiltro = Boolean(sp.vendedor || sp.q);
  const totales = pipeline?.totales ?? null;
  const columnas: ColumnaTablero[] | null = pipeline === null ? null : pipeline.columnas.map((c) => ({
    estado: c.estado,
    rotulo: c.rotulo,
    total: c.total,
    tarjetas: c.tarjetas.map((p) => ({
      id: p.id,
      empresa: p.empresa,
      vacante: p.vacante,
      ciudad: p.ciudad,
      notas: p.notas,
      estado: p.estado,
      vendedorId: p.vendedorId,
      vendedorNombre: p.vendedorId ? nombresVendedor.get(p.vendedorId) ?? null : null,
    })),
  }));
  const vivos = totales === null ? 0 : ESTADOS_VIVOS.reduce((s, e) => s + totales[e], 0);
  return {
    vendedores, prospectos: pipeline, opcionesVendedor, hayFiltro, columnas, totales: totales ?? undefined,
    vivos, vivosSinVendedor: pipeline?.vivosSinVendedor ?? 0, totalProspectos: pipeline?.totalProspectos ?? 0,
  };
}

async function BloqueKpis({ sp }: { sp: { vendedor?: string; q?: string } }) {
  const { t: tx } = await getT('admin_sistema');
  const { vendedores, prospectos, totales, vivos, vivosSinVendedor, totalProspectos } = await derivarPipeline(sp);
  // Solo si el pipeline se pudo LEER: unos ceros sobre una base caída afirmarían «no hay prospectos» estando ciegos.
  if (prospectos === null) {
    return (
      <AvisoCompacto tono="error"
        resumen={tx('vendedores_consola_vendedores.no_se_pudo_leer_el_pipeline')} />
    );
  }
  return (
    <TiraCifras etiqueta={tx('vendedores_consola_vendedores.pipeline_de_ventas')} items={uniformes([
      { etiqueta: tx('vendedores_consola_vendedores.prospectos_en_el_pipeline'), valor: totalProspectos, formato: 'entero' },
      { etiqueta: tx('vendedores_consola_vendedores.con_seguimiento'), valor: vivos, formato: 'entero' },
      { etiqueta: tx('vendedores_consola_vendedores.ganados'), valor: totales?.won ?? 0, formato: 'entero' },
      { etiqueta: tx('vendedores_consola_vendedores.vivos_sin_vendedor'), valor: vivosSinVendedor, formato: 'entero' },
      vendedores !== null
        ? { etiqueta: tx('vendedores_consola_vendedores.vendedores_con_cuenta'), valor: vendedores.length, formato: 'entero' }
        : { etiqueta: tx('vendedores_consola_vendedores.vendedores_con_cuenta'), valor: null, estado: 'error' as const, mensaje: tx('vendedores_consola_vendedores.no_se_pudo_leer_el_equipo') },
    ])} />
  );
}

/** El embudo de la ruta principal (ver `embudo-ventas.ts`: cada etapa cuenta a quien está en ella o más adelante). Sin la lectura: lo dice, no pinta ceros. */
async function BloqueEmbudo({ sp }: { sp: { vendedor?: string; q?: string } }) {
  const [{ prospectos, totales }, { t, idioma }] = await Promise.all([derivarPipeline(sp), getT('graficas')]);
  const titulo = t('ventas.embudo.titulo');
  if (prospectos === null) return <Tarjeta titulo={titulo} estado="error" mensaje={t('ventas.embudo.error')} reintentar elevar entra="tarjeta" />;
  if (!totales) return <Tarjeta titulo={titulo} estado="error" mensaje={t('ventas.embudo.error')} reintentar elevar entra="tarjeta" />;
  const { etapas, fuera, enRuta } = embudoDeVentas(totales);
  if (enRuta === 0) return <Tarjeta titulo={titulo} estado="vacio" mensaje={t('ventas.embudo.vacio')} contenida elevar entra="tarjeta" />;
  // Embudo compacto (Rovaq «Análisis»): una fila por etapa con barra de 6 px, la cifra exacta y su parte de la primera etapa en píldora.
  const base = etapas.find((e) => e.valor !== null && e.valor > 0)?.valor ?? null;
  const items = etapas.map((e) => ({
    clave: e.etiqueta, etiqueta: e.etiqueta, valor: e.valor,
    texto: e.valor === null ? '—' : base ? `${numero(e.valor, idioma)} · ${porcentaje((e.valor / base) * 100, 0)}` : numero(e.valor, idioma),
  }));
  return (
    <Tarjeta titulo={titulo} elevar entra="tarjeta">
      <BarList items={items} etiqueta={t('ventas.embudo.etiqueta')} matiz={8} />
      <p className="ven-tarjeta__tenue ven-tarjeta__tenue--fino">{t('ventas.embudo.nota', { enRuta: numero(enRuta, idioma), fuera: numero(fuera, idioma) })}</p>
    </Tarjeta>
  );
}

const TONO_CORRIDA: Record<string, TonoEstado> = { ok: 'ok', parcial: 'warn', fallo: 'bad' };

async function BloqueCorridas() {
  const { t: tx, idioma } = await getT('admin_sistema');
  const corridas = await cargarCorridas();
  return (
    <div>
      <h3 className="ven-tarjeta__empresa">{tx('vendedores_consola_vendedores.ultimas_corridas')}</h3>
      {corridas === null ? (
        <p className="ven-tarjeta__tenue">{tx('vendedores_consola_vendedores.no_se_pudo_leer_la_bitacora')}</p>
      ) : corridas.length === 0 ? (
        <p className="ven-tarjeta__tenue">{tx('vendedores_consola_vendedores.el_asignador_aun_no_corre_su')}</p>
      ) : (
        <ul className="ven-corridas">
          {corridas.map((c) => (
            <li key={c.id}>
              <StatusChip tono={TONO_CORRIDA[c.estado] ?? 'neutral'}>{c.estado}</StatusChip>
              <span className="ven-corridas__fecha">{fechaHoraMx(c.inicio, idioma)}</span>
              <span>{c.tareasHechas !== null && c.tareasTotal !== null ? `${c.tareasHechas}/${c.tareasTotal}` : '—'}</span>
              <span className="ven-corridas__dur">{duracionLegible(c.duracionMs) ?? ''}</span>
              {c.error && <span className="ven-corridas__error">{c.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** La barra de filtros VA ARRIBA de las cifras (Rovaq TM: cabecera → filtros → tira → tabla). Filtro por GET: los searchParams SON el estado
 *  del filtro, así que el enlace se comparte y el refresh no lo pierde. */
async function BloqueFiltros({ sp }: { sp: { vendedor?: string; q?: string } }) {
  const { t: tx } = await getT('admin_sistema');
  const { opcionesVendedor, hayFiltro } = await derivarPipeline(sp);
  return (
    <BarraFiltros accion={RUTA} buscar etiqueta={tx('vendedores_consola_vendedores.filtrar_el_pipeline')} limpiarHref={RUTA} nActivos={hayFiltro ? 1 : 0}>
      <FiltroOpciones nombre="vendedor" etiqueta={tx('vendedores_consola_vendedores.vendedor')} valor={sp.vendedor ?? ''}
        opciones={[{ valor: '', rotulo: tx('vendedores_consola_vendedores.todos_los_vendedores') }, { valor: 'sin', rotulo: tx('vendedores_consola_vendedores.sin_asignar') }, ...opcionesVendedor.map((v) => ({ valor: v.id, rotulo: v.nombre }))]} />
      <FiltroBusqueda nombre="q" valor={sp.q ?? ''} placeholder={tx('vendedores_consola_vendedores.empresa_vacante_o_ciudad')} etiqueta={tx('vendedores_consola_vendedores.buscar_prospecto')} maxLength={120} />
    </BarraFiltros>
  );
}

async function BloqueTablero({ sp }: { sp: { vendedor?: string; q?: string } }) {
  const { t: tx } = await getT('admin_sistema');
  const { columnas, opcionesVendedor, hayFiltro, totalProspectos } = await derivarPipeline(sp);
  if (columnas === null) {
    return <Tarjeta titulo={tx('vendedores_consola_vendedores.pipeline_de_prospectos')} estado="error" mensaje={tx('vendedores_consola_vendedores.no_se_pudo_leer_el_pipeline_2')} reintentar />;
  }
  return (
    <Tarjeta titulo={tx('vendedores_consola_vendedores.pipeline_de_prospectos')}>
      {totalProspectos === 0 ? (
        <EstadoVacio titulo={tx('vendedores_consola_vendedores.sin_prospectos_todavia')} icono={Building2}>{tx('vendedores_consola_vendedores.agrega_el_primero_en_agregar_prospecto')}</EstadoVacio>
      ) : (
        <TableroProspectos
          columnas={columnas}
          orden={ESTADOS_PROSPECTO.map((e) => e.valor)}
          transiciones={TRANSICIONES_PROSPECTO}
          rotulos={Object.fromEntries(ESTADOS_PROSPECTO.map((e) => [e.valor, e.rotulo]))}
          vendedores={opcionesVendedor}
          mover={accionMover}
          asignar={accionAsignar}
          guardarNota={accionNota}
          redactar={accionRedactar}
          hayFiltro={hayFiltro}
        />
      )}
    </Tarjeta>
  );
}

async function BloqueDesempeno() {
  const { t: tx } = await getT('admin_sistema');
  const vendedores = await cargarVendedores();
  const pct = resolverFormato('porcentaje');
  if (vendedores === null) {
    return <Tarjeta titulo={tx('vendedores_consola_vendedores.desempeno_por_vendedor')} estado="error" mensaje={tx('vendedores_consola_vendedores.no_se_pudo_leer_el_equipo_2')} reintentar />;
  }
  if (vendedores.length === 0) {
    return (
      <Tarjeta titulo={tx('vendedores_consola_vendedores.desempeno_por_vendedor')} estado="vacio" mensaje={tx('vendedores_consola_vendedores.sin_vendedores_todavia')}
        detalle={tx('vendedores_consola_vendedores.invita_al_primero_mas_abajo_entra')} />
    );
  }
  const columnas: ColumnaBase<VendedorRow>[] = [
    { id: 'vendedor', titulo: tx('vendedores_consola_vendedores.vendedor'), principal: true, celda: (v) => v.nombre ?? v.email },
    { id: 'asignados', titulo: tx('vendedores_consola_vendedores.asignados'), alinear: 'der', celda: (v) => v.asignados },
    ...ESTADOS_PROSPECTO.map((e): ColumnaBase<VendedorRow> => ({ id: e.valor, titulo: estadoProspectoTr(e.valor, tx, e.rotulo), alinear: 'der', celda: (v) => v.conteos[e.valor] })),
    // Sin cartera no hay tasa: un «0 %» pintado se leería como «lo intentó y no cerró».
    { id: 'conversion', titulo: tx('vendedores_consola_vendedores.conversion'), alinear: 'der', celda: (v) => (v.tasaConversion === null ? tx('vendedores_consola_vendedores.sin_actividad_todavia') : pct(v.tasaConversion * 100)) },
  ];
  // Cifras REALES de la tabla prospecto.
  return (
    <Tarjeta titulo={tx('vendedores_consola_vendedores.desempeno_por_vendedor')}>
      <TablaBase etiqueta={tx('vendedores_consola_vendedores.prospectos_por_vendedor_y_estado')} columnas={columnas} filas={vendedores} idFila={(v) => v.id} tarjetaMovil className="ven-desempeno" />
    </Tarjeta>
  );
}

async function BloqueAltas() {
  const { t: tx } = await getT('admin_sistema');
  const vendedores = await cargarVendedores();
  const opcionesVendedor = (vendedores ?? []).map((v) => ({ id: v.id, nombre: v.nombre ?? v.email }));
  return (
    <FilaTarjetas variante="6-6">
      <Tarjeta titulo={tx('vendedores_consola_vendedores.agregar_prospecto')}>
        <FormaProspecto accion={accionCrearProspecto} vendedores={opcionesVendedor} />
      </Tarjeta>
      <Tarjeta titulo={tx('vendedores_consola_vendedores.invitar_vendedor')}>
        <p className="ven-tarjeta__tenue">{tx('vendedores_consola_vendedores.cuenta_de_likida_sin_flota_entra')}</p>
        <FormaInvitarVendedor accion={accionInvitar} />
      </Tarjeta>
    </FilaTarjetas>
  );
}
