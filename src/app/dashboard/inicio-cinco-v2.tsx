import { Suspense } from 'react';
import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, hoyMx } from '@/lib/formato';
import { puedeVerArea, puedeVerRuta } from '@/lib/auth/visibilidad';
import { leerSenalesAsistente } from '@/lib/likida/asistente/senales';
import type { Insight, AgenteInsight } from '@/lib/likida/insights/tipos';
import { moduloProximamenteDeRuta, rutaProximamente } from '@/lib/auth/visibilidad';
import { Chip, EncabezadoPagina, EsqTarjetaV2, Tarjeta } from '@/app/ui-v2/componentes';
import { AvisoSinFlota } from './sin-flota';
import { FICHAS_CINCO_AGENTES, type FichaAgente } from './inicio-cinco-fichas';
import { leerPesosInicio, leerUltimasCorridas, leerViajesEnCurso, type PesosLeidos } from './inicio-cinco-lectores';
import {
  ATAJOS_CINCO, cifraDeAgente, esFlotaNueva, estadoDeAgente, filaViajesEnCurso, hechosUltimas24h,
} from './inicio-cinco-modelo';
import { TarjetaAgente, TarjetaAtajos, TarjetaExtemporaneos, TarjetaHizoSolo24, TarjetaImporteIave } from './inicio-cinco-piezas';
import { PrimerosPasos, TarjetaPuestaEnMarcha } from './inicio-cinco-cliente';
import { coberturaDe, filasAtencion, leerDatosResumen, type RangoResumen } from './resumen-datos';
import { conSufijo, RUTA_LIQUIDACION, type DatosResumen } from './resumen-modelo';
import { FiltrosResumen, ListaAtencion } from './resumen-cliente';

// ═══════════════════════════════════════════════════════════════════════════
// INICIO v2 DE UNA FLOTA `cinco_agentes` (L11). Orden: cinco tarjetas (una por agente) → franja de pesos (solo dueño y finanzas)
// → «Hoy» · Puesta en marcha · «Lo que hizo solo» → atajos. Lo rápido se lee de golpe; la lectura pesada de pesos (hasta tres meses de
// archivos IAVE) va en `Suspense`, con un esqueleto por tarjeta, y NO bloquea el resto. Cada cifra dice fuente y periodo; sin dato nunca es $0.
// ═══════════════════════════════════════════════════════════════════════════

const PERFIL = 'cinco_agentes';

export async function InicioCincoV2({
  tenantId, userId, tenantNombre, nombre, tenantExiste, sufijo, soloLectura, veAsistente, rango = '30', rol, principales = [], fallidos = [],
}: {
  tenantId: string; userId: string; tenantNombre: string | null; nombre: string | null; tenantExiste: boolean; sufijo: string;
  soloLectura: boolean; veAsistente: boolean; rango?: RangoResumen; rol: string;
  /** El insight más severo de cada agente que el rol ve, y los agentes cuyo lector falló (los arma `leerInsightsResumen`). */
  principales?: readonly Insight[]; fallidos?: readonly AgenteInsight[];
}) {
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

      <section className="rv-ic__agentes" aria-label="Tus cinco agentes">
        {FICHAS_CINCO_AGENTES.map((f) => (
          f.clave === 'peajes' && verPesos ? (
            <Suspense key={f.clave} fallback={<EsqTarjetaV2 alto={120} />}>
              <CarrilPeajes ficha={f} pesosP={pesosP} d={d} corrida={corridas[f.clave]} ahora={ahora} puede={puede} sufijo={sufijo} />
            </Suspense>
          ) : (
            <TarjetaDeAgente key={f.clave} ficha={f} d={d} corrida={corridas[f.clave]} ahora={ahora} puede={puede} sufijo={sufijo} />
          )
        ))}
      </section>

      {verPesos ? (
        <div className="rv-ic__fila rv-ic__fila--7-5">
          <Suspense fallback={<EsqTarjetaV2 alto={120} />}><CarrilPesos pesosP={pesosP} cual="importe" ahora={ahora} /></Suspense>
          <Suspense fallback={<EsqTarjetaV2 alto={120} />}><CarrilPesos pesosP={pesosP} cual="extemporaneos" ahora={ahora} /></Suspense>
        </div>
      ) : null}

      <div className={`rv-ic__fila ${senales ? 'rv-ic__fila--4-4-4' : 'rv-ic__fila--6-6'}`}>
        <Tarjeta titulo="Hoy" info="inicio.hoy" acciones={<span className="rv-res__nota">Requiere tu atención</span>} className="rv-ic__hoy">
          {flotaNueva && senales
            ? <PrimerosPasos senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} />
            : <ListaAtencion filas={filas} senales={null} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} />}
        </Tarjeta>
        {senales ? <TarjetaPuestaEnMarcha senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} /> : null}
        <TarjetaHizoSolo24
          hechos={hechosUltimas24h(d.hechos, ahora)} ahora={ahora}
          hrefLiquidacion={puede(RUTA_LIQUIDACION) ? conSufijo(RUTA_LIQUIDACION, sufijo) : null}
        />
      </div>

      <TarjetaAtajos atajos={atajos} sufijo={sufijo} />
    </main>
  );
}

type Puede = (ruta: string) => boolean;

function TarjetaDeAgente({ ficha, d, corrida, ahora, puede, sufijo, pesos }: {
  ficha: FichaAgente; d: DatosResumen; corrida: Awaited<ReturnType<typeof leerUltimasCorridas>>[string]; ahora: number; puede: Puede; sufijo: string;
  pesos?: PesosLeidos | null;
}) {
  // «Próximamente» (fase 2 del perfil): se ve la ficha, sin datos y con enlace al anuncio, no a la función.
  const prox = moduloProximamenteDeRuta(PERFIL, ficha.href);
  const estado = estadoDeAgente(corrida, ahora, { registraCorridas: ficha.corridas !== null, proximamente: prox !== null });
  const cifra = prox ? { valor: null, etiqueta: 'sin dato', nota: 'Todavía no está activo en tu cuenta.' } : cifraDeAgente(ficha.clave, { d, pesos: pesos?.cifras, corridaPeajes: ficha.clave === 'peajes' ? corrida : undefined });
  const href = prox ? rutaProximamente(prox) : puede(ficha.href) ? ficha.href : null;
  return <TarjetaAgente ficha={ficha} estado={estado} cifra={cifra} href={href} sufijo={sufijo} />;
}

async function CarrilPeajes({ ficha, pesosP, ...resto }: {
  ficha: FichaAgente; pesosP: Promise<PesosLeidos | null>; d: DatosResumen; corrida: Awaited<ReturnType<typeof leerUltimasCorridas>>[string]; ahora: number; puede: Puede; sufijo: string;
}) {
  return <TarjetaDeAgente ficha={ficha} pesos={await pesosP} {...resto} />;
}

async function CarrilPesos({ pesosP, cual, ahora }: { pesosP: Promise<PesosLeidos | null>; cual: 'importe' | 'extemporaneos'; ahora: number }) {
  const p = await pesosP;
  if (p === null) return null; // la puerta de #777 no abrió: ni siquiera «Sin dato»
  return cual === 'importe'
    ? <TarjetaImporteIave c={p.cifras.importeDecena} leidoEn={p.leidoEn} ahora={ahora} />
    : <TarjetaExtemporaneos c={p.cifras.extemporaneos} leidoEn={p.leidoEn} ahora={ahora} />;
}
