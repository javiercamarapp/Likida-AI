import { Suspense } from 'react';
import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, hoyMx } from '@/lib/formato';
import { puedeVerArea, puedeVerRuta } from '@/lib/auth/visibilidad';
import { leerSenalesAsistente } from '@/lib/likida/asistente/senales';
import type { Insight, AgenteInsight } from '@/lib/likida/insights/tipos';
import { moduloProximamenteDeRuta, rutaProximamente } from '@/lib/auth/visibilidad';
import { Chip, EncabezadoPagina, EsqTarjetaV2, Tarjeta } from '@/app/ui-v2/componentes';
import { Columnas } from '@/app/ui-v2/graficas';
import { getT } from '@/lib/i18n/servidor';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';
import { AvisoSinFlota } from './sin-flota';
import { FICHAS_CINCO_AGENTES, type FichaAgente } from './inicio-cinco-fichas';
import { leerPesosInicio, leerUltimasCorridas, leerViajesEnCurso, type PesosLeidos } from './inicio-cinco-lectores';
import {
  ATAJOS_CINCO, cifraDeAgente, esFlotaNueva, estadoDeAgente, filaViajesEnCurso, hechosUltimas24h,
} from './inicio-cinco-modelo';
import { TarjetaAtajos, TarjetaExtemporaneos, TarjetaHizoSolo24, TarjetaImporteIave } from './inicio-cinco-piezas';
import { TarjetaAgenteV3 } from './inicio-cinco-agente';
import { esperaConexionDe, faseDeAgente } from './inicio-cinco-fase';
import type { ClaveIconoAgente } from '@/app/ui-v2/componentes/icono-agente';
import type { SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';
import { PrimerosPasos, TarjetaPuestaEnMarcha } from './inicio-cinco-cliente';
import { coberturaDe, filasAtencion, leerDatosResumen, type RangoResumen } from './resumen-datos';
import { conSufijo, RUTA_LIQUIDACION, type DatosResumen } from './resumen-modelo';
import { FiltrosResumen, ListaAtencion } from './resumen-cliente';

// ═══════════════════════════════════════════════════════════════════════════
// INICIO v2 DE UNA FLOTA `cinco_agentes` (L11, rediseño 11-nov). Orden por jerarquía: «Hoy» (lo que espera decisión) · Puesta en marcha →
// los cinco agentes con su fase real → franja de pesos (solo dueño y finanzas) → «Lo que hizo solo» y la gráfica de cierres → atajos. Lo rápido se lee de golpe; la lectura pesada de pesos (hasta tres meses de
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
    puede, fallidos, extra: [filaViajesEnCurso(enCurso, puede('/dashboard/viajes') ? conSufijo('/dashboard/viajes', sufijo) : null)].filter((f) => f !== null),
  });
  const atajos = ATAJOS_CINCO.filter((a) => puede(a.href));
  const cob = coberturaDe(d);
  const conCorridas = FICHAS_CINCO_AGENTES.filter((f) => f.corridas && corridas[f.clave]).length;
  // La serie real de cierres (ocho semanas) solo se dibuja si existe y tiene al menos una semana con cierres: nada de gráfica de ceros.
  const serieCierres = !flotaNueva && d.cierres && d.cierres.some((c) => c.valor > 0) ? d.cierres : null;
  const ambito = `${tenantId}:${userId}`;

  return (
    <main className="rv-res rv-ic">
      <EncabezadoPagina
        area={tenantNombre ? `Resumen · viendo como superadmin · ${tenantNombre}` : undefined}
        titulo="Resumen"
        apoyo={`${saludo()}, ${nombre ?? 'equipo'}. Tus cinco agentes, de un vistazo.`}
        acciones={<Chip>{fechaMx(diaMx)}</Chip>}
      />

      {!tenantExiste && <AvisoSinFlota tenantId={tenantId} />}

      <FiltrosResumen rango={rango} fuentes={`Fuentes ${cob.ok} de ${cob.total}`} />

      {/* 1 · Lo que espera decisión HOY, con la puesta en marcha al lado: lo primero que se lee. */}
      <div className={`rv-ic__fila ${senales ? 'rv-ic__fila--7-5' : 'rv-ic__fila--12'}`}>
        <Tarjeta titulo="Hoy" info="inicio.hoy" acciones={<span className="rv-res__nota">Requiere tu atención</span>} className="rv-ic__hoy" elevar entra="tarjeta">
          {flotaNueva && senales
            ? <PrimerosPasos senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} />
            : <ListaAtencion filas={filas} senales={null} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} />}
        </Tarjeta>
        {senales ? <TarjetaPuestaEnMarcha senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} /> : null}
      </div>

      {/* 2 · El estado real de cada uno de los cinco agentes. */}
      <section className="rv-ic__seccion" aria-labelledby="rv-ic-agentes-t">
        <header className="rv-ic__seccion-cab">
          <p id="rv-ic-agentes-t" role="heading" aria-level={2} className="rv-ic__seccion-titulo">{tr.t('ini5a.agentes.titulo')}</p>
          <span className="rv-res__nota">{conCorridas === 0 ? tr.t('ini5a.agentes.resumen.cero') : tr.t('ini5a.agentes.resumen', { n: conCorridas })}</span>
        </header>
        <div className="rv-ic__agentes">
          {FICHAS_CINCO_AGENTES.map((f) => (
            f.clave === 'peajes' && verPesos ? (
              <Suspense key={f.clave} fallback={<EsqTarjetaV2 alto={120} />}>
                <CarrilPeajes ficha={f} pesosP={pesosP} d={d} corrida={corridas[f.clave]} ahora={ahora} puede={puede} sufijo={sufijo} senales={senales} tr={tr} />
              </Suspense>
            ) : (
              <TarjetaDeAgente key={f.clave} ficha={f} d={d} corrida={corridas[f.clave]} ahora={ahora} puede={puede} sufijo={sufijo} senales={senales} tr={tr} />
            )
          ))}
        </div>
      </section>

      {/* 3 · Las cifras: pesos (solo dueño y finanzas), lo que hizo solo y la serie real de cierres. */}
      {verPesos ? (
        <div className="rv-ic__fila rv-ic__fila--7-5">
          <Suspense fallback={<EsqTarjetaV2 alto={120} />}><CarrilPesos pesosP={pesosP} cual="importe" ahora={ahora} /></Suspense>
          <Suspense fallback={<EsqTarjetaV2 alto={120} />}><CarrilPesos pesosP={pesosP} cual="extemporaneos" ahora={ahora} /></Suspense>
        </div>
      ) : null}

      <div className="rv-ic__fila rv-ic__fila--6-6">
        <TarjetaHizoSolo24
          hechos={hechosUltimas24h(d.hechos, ahora)} ahora={ahora}
          hrefLiquidacion={puede(RUTA_LIQUIDACION) ? conSufijo(RUTA_LIQUIDACION, sufijo) : null}
        />
        {serieCierres ? (
          <Tarjeta titulo={tr.t('ini5a.cierres.titulo')} acciones={<span className="rv-res__nota">{tr.t('ini5a.cierres.nota')}</span>} elevar entra="tarjeta">
            <Columnas
              datos={serieCierres.map((c) => ({ etiqueta: c.etiqueta, valor: c.valor, parcial: c.parcial }))}
              etiqueta={tr.t('ini5a.cierres.etiqueta')} vacio={tr.t('ini5a.cierres.vacio')}
            />
          </Tarjeta>
        ) : null}
      </div>

      <TarjetaAtajos atajos={atajos} sufijo={sufijo} />
    </main>
  );
}

type Puede = (ruta: string) => boolean;

function TarjetaDeAgente({ ficha, d, corrida, ahora, puede, sufijo, pesos, senales, tr }: {
  ficha: FichaAgente; d: DatosResumen; corrida: Awaited<ReturnType<typeof leerUltimasCorridas>>[string]; ahora: number; puede: Puede; sufijo: string;
  pesos?: PesosLeidos | null; senales: SenalesAsistente | null; tr: TrOperacion;
}) {
  // «Próximamente» (fase 2 del perfil): se ve la ficha, sin datos y con enlace al anuncio, no a la función.
  const prox = moduloProximamenteDeRuta(PERFIL, ficha.href);
  const o = { registraCorridas: ficha.corridas !== null, proximamente: prox !== null };
  const estado = estadoDeAgente(corrida, ahora, o);
  const fase = faseDeAgente(corrida, ahora, { ...o, esperaConexion: esperaConexionDe(ficha.clave as ClaveIconoAgente, senales) });
  // Una flota sin un solo viaje liquidado: «0 por revisar» leería como medición de algo que aún no existe; se dice qué falta.
  const sinLiquidados = ficha.clave === 'liquidacion' && d.kpis !== null && d.kpis.viajesLiquidados === 0;
  const cifra = prox ? { valor: null, etiqueta: 'sin dato', nota: 'Todavía no está activo en tu cuenta.' } : sinLiquidados ? { valor: null, etiqueta: 'por revisar', nota: tr.t('ini5a.sin_liquidados') } : cifraDeAgente(ficha.clave, { d, pesos: pesos?.cifras, corridaPeajes: ficha.clave === 'peajes' ? corrida : undefined });
  const href = prox ? rutaProximamente(prox) : puede(ficha.href) ? ficha.href : null;
  return <TarjetaAgenteV3 ficha={ficha} estado={estado} fase={fase} cifra={cifra} href={href} sufijo={sufijo} tr={tr} />;
}

async function CarrilPeajes({ ficha, pesosP, ...resto }: {
  ficha: FichaAgente; pesosP: Promise<PesosLeidos | null>; d: DatosResumen; corrida: Awaited<ReturnType<typeof leerUltimasCorridas>>[string]; ahora: number; puede: Puede; sufijo: string;
  senales: SenalesAsistente | null; tr: TrOperacion;
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
