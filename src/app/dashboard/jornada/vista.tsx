import Link from 'next/link';
import { CalendarClock, Download, ShieldQuestion } from 'lucide-react';
import { numero, TZ_MX } from '@/lib/formato';
import { EstadoVacio, EstadoError } from '@/app/admin/ui/kit';
import {
  ROTULO_PROCEDENCIA, ALCANCE_PROCEDENCIA, aHoras, fraseDelHueco,
  type JornadaCompuesta,
} from '@/lib/likida/jornada/modelo';
import {
  ROTULO_VEREDICTO, LEYENDA_VEREDICTOS, type RiesgoDia, type PoliticaFlota,
} from '@/lib/likida/jornada/riesgo';
import { LEYENDA_NOM_087, LEYENDA_NO_ES_BITACORA_83 } from '@/lib/likida/jornada/topes';
import type { SemanaEvaluada } from '@/lib/likida/jornada/semanas';
import { BarraPagina } from '../resumen-visual';
import { FormasJornada, FormaPolitica, type AccionJornada } from './formas';

/**
 * LA PANTALLA DEL CONTRALOR — ver, corregir y cerrar el registro de jornada.
 *
 * ── LAS TRES REGLAS QUE ESTA VISTA NO ROMPE ─────────────────────────────
 *
 * 1. NINGUNA HORA SIN SU ORIGEN. Cada marca se pinta con su procedencia al
 *    lado. Una hora derivada del GPS y una que el operador declaró NO se ven
 *    igual, porque no valen igual: en un juicio, la primera prueba que la
 *    unidad se movió y la segunda es la declaración del trabajador.
 *
 * 2. EL DÍA SIN DATO SE ESCRIBE CON PALABRAS. No hay un `0` ni un `—` en la
 *    columna de horas de un día sin marcas: hay la frase que dice que nadie
 *    reportó y que eso NO son cero horas. Es la diferencia entre un hueco y
 *    una afirmación falsa que el patrón firma sin darse cuenta.
 *
 * 3. UNA LECTURA CAÍDA SE DICE. `filas === null` pinta el error; nunca el
 *    vacío. «No pude leer» y «no hay registro» se ven idénticos si el catch
 *    se los traga, y aquí el segundo es una afirmación sobre la jornada de
 *    una persona.
 */
export interface FilaJornada {
  jornadaId: string;
  operadorId: string;
  operadorNombre: string;
  dia: string;
  estado: 'abierto' | 'cerrado';
  cerradoPorEmail: string | null;
  conformeOperadorEn: string | null;
  jornada: JornadaCompuesta;
  riesgo: RiesgoDia;
}

const TONO: Record<string, { fondo: string; texto: string }> = {
  exceso: { fondo: 'var(--badbg)', texto: 'var(--bad)' },
  sin_registro_declarado: { fondo: 'var(--warnbg)', texto: 'var(--warn)' },
  dato_insuficiente: { fondo: 'var(--warnbg)', texto: 'var(--warn)' },
  sin_senal_de_exceso: { fondo: 'var(--okbg)', texto: 'var(--ok)' },
};

function hora(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ_MX, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

export function VistaJornada({
  filas, semanas, motivoIlegible, truncada, politica, desde, hasta, sufijo, operador, abrir, puedeCorregir,
  anularMarca, capturarMarca, cerrarElDia, declararPolitica,
}: {
  filas: FilaJornada[] | null;
  /** El eje semanal (tableros al día, 28-ago-2026): solo semanas ENTERAS de
   *  la ventana. `null` = no se evaluó (lectura caída o truncada) — que no es
   *  lo mismo que «cero semanas completas» ([]). */
  semanas: SemanaEvaluada[] | null;
  motivoIlegible: string | null;
  truncada: boolean;
  politica: PoliticaFlota | null;
  desde: string;
  hasta: string;
  sufijo: string;
  operador: string | null;
  abrir: string | null;
  puedeCorregir: boolean;
  anularMarca: AccionJornada;
  capturarMarca: AccionJornada;
  cerrarElDia: AccionJornada;
  declararPolitica: AccionJornada;
}) {
  const lista = filas ?? [];

  // ── LOS CONTADORES SON `null` CUANDO NO HAY QUÉ CONTAR ──────────────────
  //
  // `filas === null` NO es una lista vacía: es una lectura que se cayó. Contar
  // sobre `[]` pintaría cuatro tarjetas diciendo «0 sin registro declarado, 0
  // posible exceso» sobre la jornada de personas cuyo expediente no se pudo
  // ni abrir — cifras inventadas junto al banner que dice que no se pudo leer,
  // que es exactamente la regla 3 del encabezado de este archivo rota por la
  // puerta de atrás. Con `null` las tarjetas dicen que no se pudo contar.
  const cuenta = filas === null
    ? null
    : {
      sinRegistro: lista.filter((f) => f.riesgo.veredicto === 'sin_registro_declarado').length,
      conExceso: lista.filter((f) => f.riesgo.veredicto === 'exceso').length,
      insuficientes: lista.filter((f) => f.riesgo.veredicto === 'dato_insuficiente').length,
      sinConformidad: lista.filter((f) => f.conformeOperadorEn === null).length,
    };

  // LA DESCARGA ARRASTRA LA SESIÓN EFECTIVA Y EL FILTRO, o el CSV no es el de
  // la tabla. Sin `sufijo` un superadmin viendo la flota X se baja el archivo
  // de SU flota bajo un encabezado que dice X (`sufijo.ts`); sin `operador` la
  // tabla sale filtrada y el CSV completo, y los dos se llaman igual.
  const paramsExport = new URLSearchParams(sufijo.replace(/^\?/, ''));
  paramsExport.set('desde', desde);
  paramsExport.set('hasta', hasta);
  if (operador) paramsExport.set('operador', operador);
  const urlExport = `/api/export/jornada?${paramsExport.toString()}`;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<CalendarClock width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Registro de jornada"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          {/* QUÉ ES ESTE DOCUMENTO Y QUÉ NO ES. Va arriba, no en una nota al
              pie: una flota que crea que esto sustituye la bitácora de horas
              de servicio se lleva la multa del art. 83 con nuestro archivo en
              la mano. */}
          <section className="card p-4 space-y-2">
            <h2 className="font-display text-[15px] font-semibold">
              Registro del artículo 132 fracción XXXIV de la Ley Federal del Trabajo
            </h2>
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{LEYENDA_NO_ES_BITACORA_83}</p>
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{LEYENDA_NOM_087}</p>
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{LEYENDA_VEREDICTOS}</p>
          </section>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Sin registro declarado" valor={cuenta && numero(cuenta.sinRegistro)}
              nota="nadie reportó — no son cero horas" tono={cuenta && cuenta.sinRegistro > 0 ? 'warn' : undefined} />
            <Kpi titulo="Posible exceso" valor={cuenta && numero(cuenta.conExceso)}
              nota="rebasa un tope citable" tono={cuenta && cuenta.conExceso > 0 ? 'bad' : undefined} />
            <Kpi titulo="Dato insuficiente" valor={cuenta && numero(cuenta.insuficientes)}
              nota="no alcanza para concluir" tono={cuenta && cuenta.insuficientes > 0 ? 'warn' : undefined} />
            <Kpi titulo="Sin conformidad" valor={cuenta && numero(cuenta.sinConformidad)}
              nota="el operador no ha confirmado" tono={cuenta && cuenta.sinConformidad > 0 ? 'warn' : undefined} />
          </div>

          <section className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-display text-[15px] font-semibold">
                Del {desde} al {hasta}
              </h2>
              <Link href={`${urlExport}`} prefetch={false}
                className="h-9 px-3.5 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 hairline hover:opacity-85 transition-opacity">
                <Download width={14} height={14} strokeWidth={1.75} />
                Descargar el reporte (CSV)
              </Link>
            </div>

            {/* El filtro de fechas por GET: mueve TODO lo que hay debajo,
                incluida la liga de descarga. Un rótulo que dice «del X al Y»
                tiene que ser cierto para las dos cosas. */}
            <form method="get" className="flex items-end gap-2 flex-wrap">
              <label className="text-[11px] font-medium">
                Desde
                <input type="date" name="desde" defaultValue={desde}
                  className="block hairline rounded-lg px-3 h-9 text-[13px] outline-none mt-1.5" />
              </label>
              <label className="text-[11px] font-medium">
                Hasta
                <input type="date" name="hasta" defaultValue={hasta}
                  className="block hairline rounded-lg px-3 h-9 text-[13px] outline-none mt-1.5" />
              </label>
              <button type="submit" className="h-9 px-4 rounded-lg text-[13px] font-medium hairline hover:opacity-85 transition-opacity">
                Ver
              </button>
            </form>

            {truncada && (
              <EstadoError mensaje="Este periodo trae más expedientes de los que caben en una lectura. Lo que se ve NO es el periodo entero: pídelo en rangos más cortos." />
            )}

            {motivoIlegible !== null ? (
              <EstadoError mensaje={`${motivoIlegible} No se enseña media lista: media lista se ve igual que la lista entera, solo más corta — y aquí eso sería afirmar que unos operadores no reportaron.`} />
            ) : lista.length === 0 ? (
              <EstadoVacio icono={<CalendarClock width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                No hay expedientes de jornada en este periodo. Eso no significa que nadie trabajó:
                significa que todavía no hay registro. Los operadores lo abren por WhatsApp con
                «inicio jornada», y el sistema deriva lo que puede de los viajes y del GPS.
              </EstadoVacio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <Th>Día</Th>
                      <Th>Operador</Th>
                      <Th>Inicio</Th>
                      <Th>Fin</Th>
                      <Th>Descanso</Th>
                      <Th>Total</Th>
                      <Th>Lectura</Th>
                      <Th>Estado</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((f) => (
                      <Renglon key={f.jornadaId} f={f} sufijo={sufijo} desde={desde} hasta={hasta} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── EL EJE SEMANAL (tableros al día, 28-ago-2026) ──────────────
              El tope del decreto es SEMANAL: un contralor podía tener catorce
              días verdes uno por uno y una semana de 63 h — y esta pantalla
              nunca lo decía, porque `evaluarRiesgoSemana` no tenía un solo
              llamador. Solo semanas ENTERAS (lunes a domingo dentro de la
              ventana): media semana evaluada diría «va bien» con el recorte. */}
          {motivoIlegible === null && (
            <SeccionSemanas semanas={semanas} truncada={truncada} />
          )}

          {/* El detalle y las correcciones del día abierto. Un solo día a la
              vez: pintar un formulario por cada renglón mete cientos de forms
              en una pantalla donde se corrige uno (la lección de FE-12 en
              /dashboard/operadores). */}
          {abrir !== null && lista.some((f) => f.jornadaId === abrir) && (
            <FormasJornada
              fila={lista.find((f) => f.jornadaId === abrir)!}
              puedeCorregir={puedeCorregir}
              anularMarca={anularMarca}
              capturarMarca={capturarMarca}
              cerrarElDia={cerrarElDia}
            />
          )}

          <PoliticaSeccion
            politica={politica}
            puedeCorregir={puedeCorregir}
            declararPolitica={declararPolitica}
          />
        </div>
      </div>
    </main>
  );
}

function Renglon({ f, sufijo, desde, hasta }: { f: FilaJornada; sufijo: string; desde: string; hasta: string }) {
  const j = f.jornada;
  const horas = aHoras(j.minutosEfectivos ?? j.minutosBrutos);
  const hueco = fraseDelHueco(j);
  const tono = TONO[f.riesgo.veredicto] ?? TONO.dato_insuficiente;
  const sep = sufijo ? `${sufijo}&` : '?';
  const href = `/dashboard/jornada${sep}desde=${desde}&hasta=${hasta}&abrir=${f.jornadaId}`;

  return (
    <tr className="hairline-t align-top">
      <Td><Link href={href} className="underline underline-offset-2">{f.dia}</Link></Td>
      <Td>{f.operadorNombre}</Td>
      <Td><Marca a={j.inicio} /></Td>
      <Td><Marca a={j.fin} /></Td>
      <Td>
        {/* `null` NO se pinta como 0: son dos afirmaciones distintas. */}
        {j.minutosDescanso === null
          ? <span style={{ color: 'var(--muted)' }}>sin descanso reportado</span>
          : `${j.minutosDescanso} min`}
      </Td>
      <Td>
        {horas === null
          ? <span style={{ color: 'var(--muted)' }}>{hueco ?? 'no se puede calcular'}</span>
          : (
            <>
              {horas} h
              {/* Las extraordinarias del art. 61 se calculaban y se tiraban
                  (tableros al día, 28-ago-2026): el dato que decide un pago
                  al triple no llegaba a la pantalla. Solo se pinta MEDIDO
                  (> 0): null es «no se pudo medir» y 0 es «sin tiempo extra»,
                  y ninguna de las dos amerita un renglón que confunda. */}
              {f.riesgo.horasExtraordinarias !== null && f.riesgo.horasExtraordinarias > 0 && (
                <span className="block text-[11px]" style={{ color: 'var(--warn)' }}>
                  {f.riesgo.horasExtraordinarias} h extraordinarias (art. 61)
                </span>
              )}
            </>
          )}
      </Td>
      <Td>
        <span className="inline-block px-2 py-0.5 rounded-md text-[11.5px] font-medium"
          style={{ background: tono.fondo, color: tono.texto }}>
          {ROTULO_VEREDICTO[f.riesgo.veredicto]}
        </span>
      </Td>
      <Td>
        <div>{f.estado === 'cerrado' ? `Cerrado · ${f.cerradoPorEmail ?? 'sin firma'}` : 'Abierto'}</div>
        <div style={{ color: 'var(--muted)' }} className="text-[11.5px]">
          {f.conformeOperadorEn ? 'Con conformidad del operador' : 'Sin conformidad del operador'}
        </div>
      </Td>
    </tr>
  );
}

/**
 * El eje semanal, semana entera por operador. Exportada para probar el render
 * sin montar la vista completa.
 *
 * Las tres verdades que esta sección no negocia:
 *   · `semanas === null` ≠ «no hay semanas completas»: es «no se evaluó»
 *     (lectura truncada), y se dice con esas palabras.
 *   · Una semana con días sin expediente NO se concluye — y el renglón dice
 *     CUÁLES días faltan y que no son cero horas.
 *   · Las señales se pintan con su fundamento citable, tal como las escribió
 *     `evaluarRiesgoSemana` — aquí no se redacta ley.
 */
export function SeccionSemanas({ semanas, truncada }: { semanas: SemanaEvaluada[] | null; truncada: boolean }) {
  return (
    <section className="card p-4 space-y-3">
      <h2 className="font-display text-[15px] font-semibold">
        La semana completa, contra el tope del año
      </h2>
      <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
        El decreto del 1 de mayo de 2026 escalona la jornada SEMANAL por año (48 h ordinarias en
        2026). Catorce días verdes uno por uno pueden esconder una semana rebasada — por eso aquí
        se evalúa la semana entera, de lunes a domingo, solo cuando cabe completa en el rango de
        arriba.
      </p>
      {semanas === null ? (
        <p className="text-[12.5px]" style={{ color: 'var(--warn)' }}>
          {truncada
            ? 'No se evaluó ninguna semana: la lectura vino recortada, y una semana evaluada sobre el recorte diría «va bien» con los días que faltan. Pide un rango más corto.'
            : 'No se evaluó ninguna semana: el registro no se pudo leer.'}
        </p>
      ) : semanas.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          El rango visible no contiene ninguna semana completa (de lunes a domingo) con registro.
          Amplía el rango de fechas para ver el veredicto semanal.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--muted)' }} className="text-left">
                <Th>Operador</Th>
                <Th>Semana</Th>
                <Th>Horas</Th>
                <Th>Lectura</Th>
                <Th>Qué se ve</Th>
              </tr>
            </thead>
            <tbody>
              {semanas.map((s) => <RenglonSemana key={`${s.operadorId}-${s.desde}`} s={s} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RenglonSemana({ s }: { s: SemanaEvaluada }) {
  const tono = TONO[s.riesgo.veredicto] ?? TONO.dato_insuficiente;
  const faltan = s.riesgo.diasSinDato.length;
  return (
    <tr className="hairline-t align-top">
      <Td>{s.operadorNombre}</Td>
      <Td>{s.desde} → {s.hasta}</Td>
      <Td>
        {s.riesgo.horasMedidas === null ? (
          <span style={{ color: 'var(--muted)' }}>
            {/* El guion NO quiere decir cero: se escribe la razón. */}
            no se concluye — {faltan === 1 ? 'falta 1 día' : `faltan ${numero(faltan)} días`} sin
            registro, y eso no son cero horas
          </span>
        ) : (
          <>
            {s.riesgo.horasMedidas} h
            {s.riesgo.topeOrdinariaHoras !== null && (
              <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
                tope ordinario del año: {s.riesgo.topeOrdinariaHoras} h
              </span>
            )}
          </>
        )}
      </Td>
      <Td>
        <span className="inline-block px-2 py-0.5 rounded-md text-[11.5px] font-medium"
          style={{ background: tono.fondo, color: tono.texto }}>
          {ROTULO_VEREDICTO[s.riesgo.veredicto]}
        </span>
      </Td>
      <Td>
        {s.riesgo.senales.length === 0 ? (
          <span style={{ color: 'var(--muted)' }}>
            {s.riesgo.horasMedidas === null
              ? `sin datos completos no se afirma nada — días sin registro: ${s.riesgo.diasSinDato.join(', ')}`
              : 'nada rebasado de lo que este motor evalúa'}
          </span>
        ) : (
          <ul className="space-y-1.5">
            {s.riesgo.senales.map((x, i) => (
              <li key={i}>
                <div>{x.dice}</div>
                {x.fundamento && (
                  <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{x.fundamento}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Td>
    </tr>
  );
}

/** Una hora con su origen. NUNCA una hora sola: eso es lo que en un juicio no
 *  prueba nada. */
function Marca({ a }: { a: JornadaCompuesta['inicio'] }) {
  if (!a) return <span style={{ color: 'var(--muted)' }}>no lo tengo</span>;
  return (
    <span title={ALCANCE_PROCEDENCIA[a.procedencia]}>
      {hora(a.momento)}
      <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
        {ROTULO_PROCEDENCIA[a.procedencia]}
      </span>
    </span>
  );
}

function PoliticaSeccion({
  politica, puedeCorregir, declararPolitica,
}: {
  politica: PoliticaFlota | null;
  puedeCorregir: boolean;
  declararPolitica: AccionJornada;
}) {
  return (
    <section className="card p-4 space-y-3">
      <h2 className="font-display text-[15px] font-semibold flex items-center gap-2">
        <ShieldQuestion width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
        Los umbrales de tu flota
      </h2>
      <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
        Likida ya evalúa los topes de la ley (los artículos 61, 63, 68 y 69 de la LFT, y la tabla
        de jornada semanal por año del decreto del 1 de mayo de 2026). Aquí van los tuyos, si tu
        flota se fijó unos más estrictos por contrato colectivo, por póliza o por política interna.
        Dejar un campo vacío significa <strong>no declarado</strong>, no cero.
      </p>
      {politica === null && (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Todavía no has declarado ninguno. El registro y las alertas de ley funcionan igual sin ellos.
        </p>
      )}
      {puedeCorregir && (
        <FormaPolitica politica={politica} declararPolitica={declararPolitica} />
      )}
    </section>
  );
}

/** `valor === null` = no se pudo contar. Se ESCRIBE, no se pinta un 0: un cero
 *  aquí es una afirmación sobre cuántos operadores no reportaron. */
function Kpi({ titulo, valor, nota, tono }: {
  titulo: string; valor: string | null; nota?: string; tono?: 'warn' | 'bad' | null;
}) {
  const color = tono === 'bad' ? 'var(--bad)' : tono === 'warn' ? 'var(--warn)' : undefined;
  return (
    <div className="card p-3.5">
      <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>{titulo}</div>
      {valor === null ? (
        <div className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>
          no se pudo leer
        </div>
      ) : (
        <>
          <div className="font-display text-[22px] font-semibold mt-0.5" style={color ? { color } : undefined}>{valor}</div>
          {nota && <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>{nota}</div>}
        </>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="font-medium text-[11.5px] pb-2 pr-3">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="py-2.5 pr-3">{children}</td>;
}
