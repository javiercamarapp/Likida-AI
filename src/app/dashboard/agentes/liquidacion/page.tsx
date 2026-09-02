import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
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

export const dynamic = 'force-dynamic';

/** Sección secundaria que no se pudo leer → null → su leyenda honesta.
 *  Mismo patrón `safe` que inicio-contenido: una gráfica caída no tumba la
 *  página, pero TAMPOCO pinta un cero sin medir. */
function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch(() => null);
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
  }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/liquidacion', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/liquidacion')) redirect('/dashboard');

  const base = sp.tenant ? `?tenant=${sp.tenant}` : sp.vista ? `?vista=${sp.vista}` : '';
  const sufijo = sp.rol ? `${base}${base ? '&' : '?'}rol=${sp.rol}` : base;

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

  // Lo que hay que conservar en cada link y en el submit del filtro: el mismo
  // contrato de sufijo del resto del panel.
  const contexto: Array<[string, string]> = [
    ...(sp.tenant ? [['tenant', sp.tenant] as [string, string]] : []),
    ...(sp.vista ? [['vista', sp.vista] as [string, string]] : []),
    ...(sp.rol ? [['rol', sp.rol] as [string, string]] : []),
  ];

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
