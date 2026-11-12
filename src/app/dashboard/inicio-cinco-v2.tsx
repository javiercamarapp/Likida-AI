import { Suspense } from 'react';
import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, hoyMx } from '@/lib/formato';
import { puedeVerArea, puedeVerRuta } from '@/lib/auth/visibilidad';
import { leerSenalesAsistente } from '@/lib/likida/asistente/senales';
import type { Insight, AgenteInsight } from '@/lib/likida/insights/tipos';
import { moduloProximamenteDeRuta, rutaProximamente } from '@/lib/auth/visibilidad';
import { Chip, EsqTarjetaV2, Tarjeta } from '@/app/ui-v2/componentes';
import { Columnas } from '@/app/ui-v2/graficas';
import { EsqueletoPortada } from '@/app/ui-v2/esqueletos';
import { itemsKpi } from './resumen-tarjetas';
import { getT } from '@/lib/i18n/servidor';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';
import { AvisoSinFlota } from './sin-flota';
import { FICHAS_CINCO_AGENTES, type FichaAgente } from './inicio-cinco-fichas';
import { leerPesosInicio, leerUltimasCorridas, leerViajesEnCurso, type PesosLeidos } from './inicio-cinco-lectores';
import {
  cifraDeAgente, esFlotaNueva, estadoDeAgente, filaViajesEnCurso, hechosUltimas24h,
} from './inicio-cinco-modelo';
import { TarjetaExtemporaneos, TarjetaHizoSolo24, TarjetaImporteIave } from './inicio-cinco-piezas';
import { TarjetaAgenteV3 } from './inicio-cinco-agente';
import { esperaConexionDe, faseDeAgente } from './inicio-cinco-fase';
import type { ClaveIconoAgente } from '@/app/ui-v2/componentes/icono-agente';
import type { SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';
import { PrimerosPasos, TarjetaPuestaEnMarcha } from './inicio-cinco-cliente';
import { coberturaDe, filasAtencion, leerDatosResumen, type RangoResumen } from './resumen-datos';
import { conSufijo, RUTA_LIQUIDACION, type DatosResumen } from './resumen-modelo';
import { FiltrosResumen, ListaAtencion } from './resumen-cliente';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import './inicio-cinco.css';

// ═══════════════════════════════════════════════════════════════════════════
// INICIO v2 DE UNA FLOTA `cinco_agentes` (L11, rediseño 11-nov). Orden por jerarquía: «Hoy» (lo que espera decisión) · Puesta en marcha →
// los cinco agentes con su fase real → franja de pesos (solo dueño y finanzas) → «Lo que hizo solo» y la gráfica de cierres (sin tarjeta de atajos: la portada de Rovaq no la tiene).
// (Ronda 2: el orden calca la portada de Rovaq — filtros → procedencia → tira → los cinco agentes en el lugar de la fila 1 → fila 4-4-4 → cifras.) Lo rápido se lee de golpe; la lectura pesada de pesos (hasta tres meses de
// archivos IAVE) va en `Suspense`, con un esqueleto por tarjeta, y NO bloquea el resto. Cada cifra dice fuente y periodo; sin dato nunca es $0.
// ═══════════════════════════════════════════════════════════════════════════

const PERFIL = 'cinco_agentes';

export async function InicioCincoV2({
  tenantId, userId, tenantNombre, nombre, tenantExiste, sufijo, soloLectura, veAsistente, rango = '30', rol, principales = [], fallidos = [], tr: trProp,
}: {
  tenantId: string; userId: string; tenantNombre: string | null; nombre: string | null; tenantExiste: boolean; sufijo: string;
  soloLectura: boolean; veAsistente: boolean; rango?: RangoResumen; rol: string;
  /** El insight más severo de cada agente que el rol ve, y los agentes cuyo lector falló (los arma `leerInsightsResumen`). */
  principales?: readonly Insight[]; fallidos?: readonly AgenteInsight[];
  /** Traductor del namespace `operacion`; sin él se arma el del idioma de la petición (y cae a es). */
  tr?: TrOperacion;
}) {
  const { t, idioma } = await getT('resto');
  const tr = trProp ?? await getT('operacion').catch(() => TR_OPERACION_ES);
  const ahora = ahoraMs();
  const diaMx = hoyMx(new Date(ahora));
  /** Ningún enlace rebota: cada ruta se ofrece solo si este rol, en este perfil, la abre. */
  const puede = (ruta: string) => puedeVerRuta(rol, ruta.split('?')[0], PERFIL);
  const verPesos = puedeVerArea(rol, 'dinero');

  // La lectura pesada arranca YA, sin esperarla; las tarjetas que la necesitan la esperan dentro de su Suspense.
  const pesosP = leerPesosInicio(tenantId, rol);
  const [d, senales, corridas, enCurso] = await Promise.all([
    leerDatosResumen(tenantId, rango, false),
    veAsistente ? leerSenalesAsistente(tenantId) : Promise.resolve(null),
    leerUltimasCorridas(tenantId),
    leerViajesEnCurso(tenantId),
  ]);

  const flotaNueva = esFlotaNueva({ corridas: FICHAS_CINCO_AGENTES.filter((f) => f.corridas).map((f) => corridas[f.clave]), enCurso, d });
  const filas = filasAtencion(d, principales, sufijo, 3, {
    puede, fallidos, extra: [filaViajesEnCurso(enCurso, puede('/dashboard/viajes') ? conSufijo('/dashboard/viajes', sufijo) : null, t)].filter((f) => f !== null),
  }, t);
  const cob = coberturaDe(d);
  const conCorridas = FICHAS_CINCO_AGENTES.filter((f) => f.corridas && corridas[f.clave]).length;
  // La serie real de cierres (ocho semanas) solo se dibuja si existe y tiene al menos una semana con cierres: nada de gráfica de ceros.
  const serieCierres = !flotaNueva && d.cierres && d.cierres.some((c) => c.valor > 0) ? d.cierres : null;
  const ambito = `${tenantId}:${userId}`;

  // La tira de cifras de la portada (Rovaq «Hoy»): las MISMAS cuatro del Resumen de las cuentas generales, sin pesos (esta lectura va con
  // `veDinero=false`). En una flota nueva «0 por revisar» leería como medición de algo que no existe: ahí cada celda dice «sin dato».
  // Rovaq «Hoy»: cada celda lleva su línea de procedencia («● Observado · fuente · periodo»): lo leído de la fuente se marca Observado; sin dato no hay sello.
  const cifras = itemsKpi(d, sufijo, puede, t).map((c) => (flotaNueva ? { ...c, valor: null, sello: undefined } : c.sello && c.valor !== null && c.valor !== undefined && c.tipo === undefined ? { ...c, tipo: 'observado' as const } : c));

  // Cifras de las filas inferiores: se pintan solo las que existen (importe/extemporáneos para dueño y finanzas, la serie real de cierres).
  const cartasInferiores = [verPesos ? 'importe' : null, verPesos ? 'extemporaneos' : null, serieCierres ? 'cierres' : null].filter((x) => x !== null);
  const varianteInferior = cartasInferiores.length >= 3 ? 'rv-ic__fila--4-4-4' : cartasInferiores.length === 2 ? 'rv-ic__fila--6-6' : 'rv-ic__fila--12';
  // Barra de procedencia (Rovaq): hasta cuándo son las cifras y qué falló, sin repetir el chip «Fuentes n de N» de la barra de filtros.
  const procedencia = (
    <>
      <li>{t('f26d2.inicio.cifras_al', { fecha: fechaMx(d.hoy, idioma) })}</li>
      {cob.ok < cob.total ? <li>{t('f26d2.inicio.fuentes_sin_lectura', { n: cob.total - cob.ok })}</li> : null}
      {flotaNueva ? <li>{t('f26d2.inicio.flota_nueva')}</li> : null}
    </>
  );

  return (
    <EsqueletoPortada
      area={tenantNombre ? `Resumen · viendo como superadmin · ${tenantNombre}` : t('op.tu_flota_en_likida')}
      titulo={t('op.resumen')}
      apoyo={t('op.tus_cinco_agentes_de_un_vistazo_2', { saludo: saludo(), v: nombre ?? 'equipo' })}
      acciones={<Chip>{fechaMx(diaMx, idioma)}</Chip>}
      avisos={!tenantExiste ? <AvisoSinFlota tenantId={tenantId} /> : undefined}
      filtros={<FiltrosResumen rango={rango} fuentes={`Fuentes ${cob.ok} de ${cob.total}`} />}
      procedencia={procedencia}
      etiquetaProcedencia={t('f26d2.inicio.procedencia')}
      cifras={cifras}
      etiquetaCifras={t('op.tu_flota_en_likida')}
    >

      {/* 1 · El estado real de cada uno de los cinco agentes, en el lugar de la fila 1 de la portada (mapa F26). */}
      <section className="rv-ic__seccion" aria-labelledby="rv-ic-agentes-t">
        <header className="rv-ic__seccion-cab">
          <p id="rv-ic-agentes-t" role="heading" aria-level={2} className="rv-ic__seccion-titulo">{tr.t('ini5a.agentes.titulo')}</p>
          <span className="rv-res__nota">{conCorridas === 0 ? tr.t('ini5a.agentes.resumen.cero') : tr.t('ini5a.agentes.resumen', { n: conCorridas })}</span>
        </header>
        <div className="rv-ic__agentes">
          {FICHAS_CINCO_AGENTES.map((f) => (
            f.clave === 'peajes' && verPesos ? (
              <Suspense key={f.clave} fallback={<EsqTarjetaV2 alto={120} />}>
                <CarrilPeajes ficha={f} pesosP={pesosP} d={d} corrida={corridas[f.clave]} ahora={ahora} puede={puede} sufijo={sufijo} senales={senales} tr={tr} t={t} />
              </Suspense>
            ) : (
              <TarjetaDeAgente t={t} key={f.clave} ficha={f} d={d} corrida={corridas[f.clave]} ahora={ahora} puede={puede} sufijo={sufijo} senales={senales} tr={tr} />
            )
          ))}
        </div>
      </section>

      {/* 2 · Fila 4-4-4 (Rovaq): lo que espera decisión HOY · la puesta en marcha (siguiente mejor acción) · lo que hizo solo. */}
      <div className={`rv-ic__fila ${senales ? 'rv-ic__fila--4-4-4' : 'rv-ic__fila--6-6'}`}>
        {/* Rovaq: «Requiere tu atención (3)» — el contador va EN el título, no como texto suelto a la derecha. */}
        <Tarjeta titulo={`${t('op.requiere_tu_atencion')}${!(flotaNueva && senales) && filas.length > 0 ? ` (${filas.length})` : ''}`} info="inicio.hoy" className="rv-ic__hoy" elevar entra="tarjeta">
          {flotaNueva && senales
            ? <PrimerosPasos senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} />
            : <ListaAtencion filas={filas} senales={null} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} />}
        </Tarjeta>
        {senales ? <TarjetaPuestaEnMarcha senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} /> : null}
        <TarjetaHizoSolo24 t={t}
          hechos={hechosUltimas24h(d.hechos, ahora)} ahora={ahora}
          hrefLiquidacion={puede(RUTA_LIQUIDACION) ? conSufijo(RUTA_LIQUIDACION, sufijo) : null}
        />
      </div>

      {/* 3 · Cifras: pesos (solo dueño y finanzas) y la serie real de cierres, en una fila de tantas tarjetas como existan. */}
      {cartasInferiores.length > 0 ? (
        <div className={`rv-ic__fila ${varianteInferior}`}>
          {verPesos ? <Suspense fallback={<EsqTarjetaV2 alto={120} />}><CarrilPesos pesosP={pesosP} cual="importe" ahora={ahora} /></Suspense> : null}
          {verPesos ? <Suspense fallback={<EsqTarjetaV2 alto={120} />}><CarrilPesos pesosP={pesosP} cual="extemporaneos" ahora={ahora} /></Suspense> : null}
          {serieCierres ? (
            <Tarjeta titulo={tr.t('ini5a.cierres.titulo')} acciones={<span className="rv-res__nota">{tr.t('ini5a.cierres.nota')}</span>} elevar entra="tarjeta">
              <Columnas
                datos={serieCierres.map((c) => ({ etiqueta: c.etiqueta, valor: c.valor, parcial: c.parcial }))}
                etiqueta={tr.t('ini5a.cierres.etiqueta')} vacio={tr.t('ini5a.cierres.vacio')}
              />
            </Tarjeta>
          ) : null}
        </div>
      ) : null}

    </EsqueletoPortada>
  );
}

type Puede = (ruta: string) => boolean;

function TarjetaDeAgente({ ficha, d, corrida, ahora, puede, sufijo, pesos, senales, tr, t = T_RESTO_ES }: {
  ficha: FichaAgente; d: DatosResumen; corrida: Awaited<ReturnType<typeof leerUltimasCorridas>>[string]; ahora: number; puede: Puede; sufijo: string;
  pesos?: PesosLeidos | null; senales: SenalesAsistente | null; tr: TrOperacion; t?: TResto;
}) {
  // «Próximamente» (fase 2 del perfil): se ve la ficha, sin datos y con enlace al anuncio, no a la función.
  const prox = moduloProximamenteDeRuta(PERFIL, ficha.href);
  const o = { registraCorridas: ficha.corridas !== null, proximamente: prox !== null };
  const estado = estadoDeAgente(corrida, ahora, o, t);
  const fase = faseDeAgente(corrida, ahora, { ...o, esperaConexion: esperaConexionDe(ficha.clave as ClaveIconoAgente, senales) });
  // Una flota sin un solo viaje liquidado: «0 por revisar» leería como medición de algo que aún no existe; se dice qué falta.
  const sinLiquidados = ficha.clave === 'liquidacion' && d.kpis !== null && d.kpis.viajesLiquidados === 0;
  const cifra = prox ? { valor: null, etiqueta: t('op.sin_dato'), nota: t('op.todavia_no_esta_activo_en_tu_2') } : sinLiquidados ? { valor: null, etiqueta: 'por revisar', nota: tr.t('ini5a.sin_liquidados') } : cifraDeAgente(ficha.clave, { d, pesos: pesos?.cifras, corridaPeajes: ficha.clave === 'peajes' ? corrida : undefined }, t);
  const href = prox ? rutaProximamente(prox) : puede(ficha.href) ? ficha.href : null;
  return <TarjetaAgenteV3 ficha={ficha} estado={estado} fase={fase} cifra={cifra} href={href} sufijo={sufijo} tr={tr} />;
}

async function CarrilPeajes({ ficha, pesosP, ...resto }: {
  ficha: FichaAgente; pesosP: Promise<PesosLeidos | null>; d: DatosResumen; corrida: Awaited<ReturnType<typeof leerUltimasCorridas>>[string]; ahora: number; puede: Puede; sufijo: string;
  senales: SenalesAsistente | null; tr: TrOperacion; t?: TResto;
}) {
  return <TarjetaDeAgente ficha={ficha} pesos={await pesosP} {...resto} />;
}

async function CarrilPesos({ pesosP, cual, ahora }: { pesosP: Promise<PesosLeidos | null>; cual: 'importe' | 'extemporaneos'; ahora: number }) {
  const p = await pesosP;
  if (p === null) return null; // la puerta de #777 no abrió: ni siquiera «Sin dato»
  // Fallo TOTAL: un solo bloque con un solo Reintentar (el de importe); la tarjeta de extemporáneos no se pinta.
  if (cual === 'extemporaneos' && p.cifras.importeDecena.reintentar && p.cifras.extemporaneos.reintentar) return null;
  return cual === 'importe'
    ? <TarjetaImporteIave c={p.cifras.importeDecena} leidoEn={p.leidoEn} ahora={ahora} />
    : <TarjetaExtemporaneos c={p.cifras.extemporaneos} leidoEn={p.leidoEn} ahora={ahora} />;
}
