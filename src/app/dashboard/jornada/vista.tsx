import Link from 'next/link';
import { CalendarClock, Download } from 'lucide-react';
import { fechaMx, numero, TZ_MX } from '@/lib/formato';
import {
  ROTULO_PROCEDENCIA, ALCANCE_PROCEDENCIA, aHoras, fraseDelHueco,
  type JornadaCompuesta,
} from '@/lib/likida/jornada/modelo';
import {
  ROTULO_VEREDICTO, LEYENDA_VEREDICTOS, type RiesgoDia, type PoliticaFlota,
} from '@/lib/likida/jornada/riesgo';
import { LEYENDA_NOM_087, LEYENDA_NO_ES_BITACORA_83 } from '@/lib/likida/jornada/topes';
import type { SemanaEvaluada } from '@/lib/likida/jornada/semanas';
import type { AlertaDeJornada } from '@/lib/likida/jornada/alerta_tope_datos';
import { ROTULO_NIVEL, horasTexto } from '@/lib/likida/jornada/alerta_tope';
import { FormasJornada, FormaPolitica, FormaAlertaTope, type AccionJornada, type ConfigAlertaForma } from './formas';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import {
  Aviso, AvisoCompacto, BarraPeriodo, clasesBoton, EstadoError, EstadoVacio, hrefConParams, Icono, InfoTip, MarcoPagina, StatusChip, TablaBase, Tarjeta,
  type ColumnaBase, type TonoEstado,
} from '@/app/ui-v2/componentes';
import './jornada.css';

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
  /** ¿Cae dentro del alcance de quien mira? (W2: un jefe con patio solo corrige las
   *  jornadas de los operadores de su patio.) Lo decide el servidor con el patio
   *  leído de la base; las acciones lo vuelven a comprobar. */
  editable: boolean;
}

const TONO: Record<string, TonoEstado> = {
  exceso: 'bad',
  sin_registro_declarado: 'warn',
  dato_insuficiente: 'warn',
  sin_senal_de_exceso: 'ok',
};

function hora(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ_MX, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

export function VistaJornada({
  filas, semanas, motivoIlegible, truncada, politica, desde, hasta, sufijo, operador, operadores, abrir, puedeCorregir,
  puedeDeclararPolitica, anularMarca, capturarMarca, cerrarElDia, declararPolitica,
  alertaConfig, alertaConfigIlegible, alertas, puedeConfigurarAlerta, guardarAlerta,
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
  /** FE-19: el catálogo completo para el `<select>` — `null` = no se pudo
   *  leer (el filtro por URL sigue funcionando, solo no hay de dónde elegir). */
  operadores: Array<{ id: string; nombre: string }> | null;
  abrir: string | null;
  /** El rol puede corregir (dueño y jefe de tráfico); por fila se acota con `editable`. */
  puedeCorregir: boolean;
  /** Solo el dueño declara los umbrales de la flota. */
  puedeDeclararPolitica: boolean;
  anularMarca: AccionJornada;
  capturarMarca: AccionJornada;
  cerrarElDia: AccionJornada;
  declararPolitica: AccionJornada;
  /** La alerta de tope (0502). `null` = la flota no la ha configurado (apagada). */
  alertaConfig: ConfigAlertaForma | null;
  /** `true` = no se pudo leer la configuración: se dice, no se pinta como «apagada». */
  alertaConfigIlegible: boolean;
  /** Las alertas emitidas a las jornadas de la tabla. `null` = no se pudieron leer (no es «ninguna»). */
  alertas: AlertaDeJornada[] | null;
  /** Solo quien administra la flota configura quién recibe los avisos. */
  puedeConfigurarAlerta: boolean;
  guardarAlerta: AccionJornada;
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
  const ctxJornada: Record<string, string> = Object.fromEntries(new URLSearchParams(sufijo.replace(/^\?/, '')).entries());
  paramsExport.set('desde', desde);
  paramsExport.set('hasta', hasta);
  if (operador) paramsExport.set('operador', operador);
  const urlExport = `/api/export/jornada?${paramsExport.toString()}`;

  const columnas: ColumnaBase<FilaJornada>[] = [
    {
      id: 'dia', titulo: 'Día', principal: true,
      celda: (f) => <Link href={hrefJornada(f)} className="rv-jn__enlace">{f.dia}</Link>,
    },
    { id: 'operador', titulo: 'Operador', celda: (f) => f.operadorNombre },
    { id: 'inicio', titulo: 'Inicio', celda: (f) => <Marca a={f.jornada.inicio} /> },
    { id: 'fin', titulo: 'Fin', celda: (f) => <Marca a={f.jornada.fin} /> },
    {
      id: 'descanso', titulo: 'Descanso',
      // `null` NO se pinta como 0: son dos afirmaciones distintas.
      celda: (f) => (f.jornada.minutosDescanso === null
        ? <span className="rv-jn__apagado">sin descanso reportado</span>
        : `${f.jornada.minutosDescanso} min`),
    },
    { id: 'total', titulo: 'Total', celda: (f) => <TotalDelDia f={f} /> },
    { id: 'lectura', titulo: 'Lectura', celda: (f) => <StatusChip tono={TONO[f.riesgo.veredicto] ?? 'warn'}>{ROTULO_VEREDICTO[f.riesgo.veredicto]}</StatusChip> },
    {
      id: 'estado', titulo: 'Estado',
      celda: (f) => (
        <>
          {f.estado === 'cerrado' ? `Cerrado · ${f.cerradoPorEmail ?? 'sin firma'}` : 'Abierto'}
          <span className="rv-jn__tenue">{f.conformeOperadorEn ? 'Con conformidad del operador' : 'Sin conformidad del operador'}</span>
        </>
      ),
    },
  ];
  const hrefJornada = (f: FilaJornada) => `/dashboard/jornada${sufijo ? `${sufijo}&` : '?'}desde=${desde}&hasta=${hasta}&abrir=${f.jornadaId}`;

  return (
    <MarcoPagina titulo="Equipo" apoyo="Registro de jornada del art. 132 fr. XXXIV de la LFT, por operador. Registra y avisa; no sustituye la bitácora de horas.">

      {/* QUÉ ES ESTE DOCUMENTO Y QUÉ NO ES. Va arriba, no en una nota al pie: una flota que crea que esto sustituye la bitácora de horas
          de servicio se lleva la multa del art. 83 con nuestro archivo en la mano. */}
      <AvisoCompacto tono="warn" resumen={LEYENDA_NO_ES_BITACORA_83} etiquetaMas="Ver más: alcance legal"
        mas={(
          <>
            <strong>Registro del artículo 132 fracción XXXIV de la Ley Federal del Trabajo</strong> <InfoTip clave="jornada.alcance" />
            <p>{LEYENDA_NOM_087}</p>
            <p>{LEYENDA_VEREDICTOS}</p>
          </>
        )} />

      <TiraCifras sello={selloHoy('Registro de jornada')}>
        <Cifra etiqueta="Sin registro declarado" valor={cuenta && numero(cuenta.sinRegistro)}
          nota="nadie reportó — no son cero horas" tono={cuenta && cuenta.sinRegistro > 0 ? 'warn' : undefined} info="jornada.sin_registro" />
        <Cifra etiqueta="Posible exceso" valor={cuenta && numero(cuenta.conExceso)}
          nota="rebasa un tope citable" tono={cuenta && cuenta.conExceso > 0 ? 'bad' : undefined} info="jornada.posible_exceso" />
        <Cifra etiqueta="Dato insuficiente" valor={cuenta && numero(cuenta.insuficientes)}
          nota="no alcanza para concluir" tono={cuenta && cuenta.insuficientes > 0 ? 'warn' : undefined} info="jornada.dato_insuficiente" />
        <Cifra etiqueta="Sin conformidad" valor={cuenta && numero(cuenta.sinConformidad)}
          nota="el operador no ha confirmado" tono={cuenta && cuenta.sinConformidad > 0 ? 'warn' : undefined} info="jornada.sin_conformidad" />
      </TiraCifras>

      <Tarjeta titulo={`Del ${desde} al ${hasta}`} info="jornada.registro"
        acciones={(
          // `<a>` y no `Link`: es un archivo que baja, no una ruta que se precarga (un prefetch dispararía la exportación).
          <a href={urlExport} className={clasesBoton('secondary', 'sm')}>
            <Icono icono={Download} />
            Descargar el reporte (CSV)
          </a>
        )}>

        {/* El filtro de fechas por GET: mueve TODO lo que hay debajo, incluida la liga de descarga. Un rótulo que dice «del X al Y»
            tiene que ser cierto para las dos cosas. */}
        <BarraPeriodo etiqueta="Periodo y filtros de la jornada"
          chips={[
            { id: 'rango', etiqueta: `Del ${fechaMx(desde)} al ${fechaMx(hasta)}` },
            ...(operador ? [{ id: 'operador', etiqueta: operadores?.find((o) => o.id === operador)?.nombre ?? 'Operador elegido', hrefQuitar: hrefConParams('/dashboard/jornada', { ...ctxJornada, desde, hasta, operador }, { operador: null }) }] : []),
          ]}
          cajon={{
            accion: '/dashboard/jornada', ocultos: Object.entries(ctxJornada), limpiarHref: hrefConParams('/dashboard/jornada', ctxJornada), nActivos: operador ? 1 : 0,
            resumen: `Del ${fechaMx(desde)} al ${fechaMx(hasta)}${operador ? ' · un operador' : ''}`,
            periodo: { desde, hasta },
            // FE-19: con cientos de choferes la ventana por omisión nace truncada casi siempre; sin este selector la única forma de ver a UN operador era teclear su id en la URL.
            campos: operadores && operadores.length > 0 ? { items: [{ tipo: 'select', nombre: 'operador', etiqueta: 'Operador', valor: operador ?? '', opciones: [{ valor: '', rotulo: 'Todos' }, ...operadores.map((o) => ({ valor: o.id, rotulo: o.nombre }))] }] } : undefined,
          }} />
        {operadores === null && (
          <p className="rv-jn__aviso">
            No se pudo leer el catálogo de operadores — el filtro por URL (<code>?operador=</code>) sigue funcionando.
          </p>
        )}

        {truncada && (
          <EstadoError>Este periodo trae más expedientes de los que caben en una lectura. Lo que se ve NO es el periodo entero: pídelo en rangos más cortos.</EstadoError>
        )}

        {motivoIlegible !== null ? (
          <EstadoError reintentar>{`${motivoIlegible} No se enseña media lista: media lista se ve igual que la lista entera, solo más corta — y aquí eso sería afirmar que unos operadores no reportaron.`}</EstadoError>
        ) : lista.length === 0 ? (
          <EstadoVacio icono={CalendarClock} titulo="Sin expedientes en el periodo">
            No hay expedientes de jornada en este periodo. Eso no significa que nadie trabajó:
            significa que todavía no hay registro. Los operadores lo abren por WhatsApp con
            «inicio jornada», y el sistema deriva lo que puede de los viajes y del GPS.
          </EstadoVacio>
        ) : (
          <TablaBase<FilaJornada> etiqueta="Jornadas por día y operador" columnas={columnas} filas={lista} idFila={(f) => f.jornadaId} tarjetaMovil />
        )}
      </Tarjeta>

      {/* ── EL EJE SEMANAL (tableros al día, 28-ago-2026) ──────────────
          El tope del decreto es SEMANAL: un contralor podía tener catorce días verdes uno por uno y una semana de 63 h — y esta
          pantalla nunca lo decía. Solo semanas ENTERAS (lunes a domingo dentro de la ventana): media semana evaluada diría «va
          bien» con el recorte. */}
      {motivoIlegible === null && (
        <SeccionSemanas semanas={semanas} truncada={truncada} />
      )}

      {/* El detalle y las correcciones del día abierto. Un solo día a la vez: pintar un formulario por cada renglón mete cientos de
          forms en una pantalla donde se corrige uno (la lección de FE-12 en /dashboard/operadores). */}
      {abrir !== null && lista.some((f) => f.jornadaId === abrir) && (
        <FormasJornada
          fila={lista.find((f) => f.jornadaId === abrir)!}
          puedeCorregir={puedeCorregir && lista.find((f) => f.jornadaId === abrir)!.editable}
          anularMarca={anularMarca}
          capturarMarca={capturarMarca}
          cerrarElDia={cerrarElDia}
        />
      )}

      <PoliticaSeccion
        politica={politica}
        puedeCorregir={puedeDeclararPolitica}
        declararPolitica={declararPolitica}
      />

      {motivoIlegible === null && (
        <AlertaTopeSeccion
          config={alertaConfig}
          configIlegible={alertaConfigIlegible}
          alertas={alertas}
          filas={lista}
          truncada={truncada}
          puedeConfigurar={puedeConfigurarAlerta}
          guardarAlerta={guardarAlerta}
        />
      )}
    </MarcoPagina>
  );
}

/** Total del día con las horas extraordinarias del art. 61 SOLO cuando están medidas (> 0). */
function TotalDelDia({ f }: { f: FilaJornada }) {
  const j = f.jornada;
  const horas = aHoras(j.minutosEfectivos ?? j.minutosBrutos);
  const hueco = fraseDelHueco(j);
  if (horas === null) return <span className="rv-jn__apagado">{hueco ?? 'no se puede calcular'}</span>;
  return (
    <>
      {horas} h
      {/* Las extraordinarias del art. 61 se calculaban y se tiraban: el dato que decide un pago al triple no llegaba a la pantalla.
          Solo se pinta MEDIDO (> 0): null es «no se pudo medir» y 0 es «sin tiempo extra», y ninguna de las dos amerita un renglón. */}
      {f.riesgo.horasExtraordinarias !== null && f.riesgo.horasExtraordinarias > 0 && (
        <span className="rv-jn__extra">{f.riesgo.horasExtraordinarias} h extraordinarias (art. 61)</span>
      )}
    </>
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
  const columnas: ColumnaBase<SemanaEvaluada>[] = [
    { id: 'operador', titulo: 'Operador', principal: true, celda: (s) => s.operadorNombre },
    { id: 'semana', titulo: 'Semana', celda: (s) => <>{s.desde} → {s.hasta}</> },
    { id: 'horas', titulo: 'Horas', celda: (s) => <HorasSemana s={s} /> },
    { id: 'lectura', titulo: 'Lectura', celda: (s) => <StatusChip tono={TONO[s.riesgo.veredicto] ?? 'warn'}>{ROTULO_VEREDICTO[s.riesgo.veredicto]}</StatusChip> },
    { id: 'que', titulo: 'Qué se ve', celda: (s) => <SenalesSemana s={s} /> },
  ];
  return (
    <Tarjeta titulo="La semana completa, contra el tope del año" info="jornada.semana">
      <p className="rv-jn__nota">
        El decreto del 1 de mayo de 2026 escalona la jornada SEMANAL por año (48 h ordinarias en
        2026). Catorce días verdes uno por uno pueden esconder una semana rebasada — por eso aquí
        se evalúa la semana entera, de lunes a domingo, solo cuando cabe completa en el rango de
        arriba.
      </p>
      {semanas === null ? (
        <p className="rv-jn__nota" data-tono="warn">
          {truncada
            ? 'No se evaluó ninguna semana: la lectura vino recortada, y una semana evaluada sobre el recorte diría «va bien» con los días que faltan. Pide un rango más corto.'
            : 'No se evaluó ninguna semana: el registro no se pudo leer.'}
        </p>
      ) : semanas.length === 0 ? (
        <p className="rv-jn__nota">
          El rango visible no contiene ninguna semana completa (de lunes a domingo) con registro.
          Amplía el rango de fechas para ver el veredicto semanal.
        </p>
      ) : (
        <TablaBase<SemanaEvaluada> etiqueta="Veredicto semanal por operador" columnas={columnas} filas={semanas}
          idFila={(s) => `${s.operadorId}-${s.desde}`} tarjetaMovil />
      )}
    </Tarjeta>
  );
}

function HorasSemana({ s }: { s: SemanaEvaluada }) {
  const faltan = s.riesgo.diasSinDato.length;
  if (s.riesgo.horasMedidas === null) {
    return (
      <span className="rv-jn__apagado">
        {/* El guion NO quiere decir cero: se escribe la razón. */}
        no se concluye — {faltan === 1 ? 'falta 1 día' : `faltan ${numero(faltan)} días`} sin
        registro, y eso no son cero horas
      </span>
    );
  }
  return (
    <>
      {s.riesgo.horasMedidas} h
      {s.riesgo.topeOrdinariaHoras !== null && (
        <span className="rv-jn__tenue">tope ordinario del año: {s.riesgo.topeOrdinariaHoras} h</span>
      )}
    </>
  );
}

function SenalesSemana({ s }: { s: SemanaEvaluada }) {
  if (s.riesgo.senales.length === 0) {
    return (
      <span className="rv-jn__apagado">
        {s.riesgo.horasMedidas === null
          ? `sin datos completos no se afirma nada — días sin registro: ${s.riesgo.diasSinDato.join(', ')}`
          : 'nada rebasado de lo que este motor evalúa'}
      </span>
    );
  }
  return (
    <ul className="rv-jn__lista">
      {s.riesgo.senales.map((x, i) => (
        <li key={i}>
          {x.dice}
          {x.fundamento && <span className="rv-jn__tenue">{x.fundamento}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Una hora con su origen. NUNCA una hora sola: eso es lo que en un juicio no
 *  prueba nada. */
function Marca({ a }: { a: JornadaCompuesta['inicio'] }) {
  if (!a) return <span className="rv-jn__apagado">no lo tengo</span>;
  return (
    <span title={ALCANCE_PROCEDENCIA[a.procedencia]}>
      {hora(a.momento)}
      <span className="rv-jn__tenue">{ROTULO_PROCEDENCIA[a.procedencia]}</span>
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
    <Tarjeta titulo="Los umbrales de tu flota" info="jornada.umbrales">
      <p className="rv-jn__nota">
        Likida ya evalúa los topes de la ley (los artículos 61, 63, 68 y 69 de la LFT, y la tabla
        de jornada semanal por año del decreto del 1 de mayo de 2026). Aquí van los tuyos, si tu
        flota se fijó unos más estrictos por contrato colectivo, por póliza o por política interna.
        Dejar un campo vacío significa <strong>no declarado</strong>, no cero.
      </p>
      {politica === null && (
        <p className="rv-jn__nota">
          Todavía no has declarado ninguno. El registro y las alertas de ley funcionan igual sin ellos.
        </p>
      )}
      {puedeCorregir && (
        <FormaPolitica politica={politica} declararPolitica={declararPolitica} />
      )}
    </Tarjeta>
  );
}

const ROTULO_ESTADO_ALERTA: Record<string, string> = {
  reclamada: 'Enviándose', enviada: 'Enviada', parcial: 'Enviada en parte', fallida: 'No llegó', sin_destinatario: 'Sin a quién avisar',
};
const ROTULO_ESTADO_DESTINO: Record<string, string> = {
  pendiente: 'pendiente', enviado: 'enviado', fallido: 'no llegó', sin_destinatario: 'sin destinatario', no_aplica: 'no aplica',
};
const FUENTE_ALERTA: Record<string, string> = {
  declarado_operador: 'lo declaró el operador', hito_viaje: 'un hito del viaje', gps: 'el GPS', capturado_contralor: 'lo capturó el contralor',
};

/**
 * LA ALERTA DE TOPE (0502): configuración por flota y lista de lo ya emitido. La lista es de las jornadas que la
 * tabla de arriba enseña; una lectura caída se dice y nunca se pinta como «ninguna alerta», que sería afirmar que a
 * nadie se le avisó.
 */
export function AlertaTopeSeccion({
  config, configIlegible, alertas, filas, truncada, puedeConfigurar, guardarAlerta,
}: {
  config: ConfigAlertaForma | null;
  configIlegible: boolean;
  alertas: AlertaDeJornada[] | null;
  filas: FilaJornada[];
  truncada: boolean;
  puedeConfigurar: boolean;
  guardarAlerta: AccionJornada;
}) {
  const porJornada = new Map(filas.map((f) => [f.jornadaId, f]));
  const ordenadas = alertas === null ? [] : [...alertas].sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));
  const columnas: ColumnaBase<AlertaDeJornada>[] = [
    {
      id: 'cuando', titulo: 'Cuándo', principal: true,
      celda: (a) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ_MX, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(a.creadaEn)),
    },
    {
      id: 'operador', titulo: 'Operador y día',
      celda: (a) => { const f = porJornada.get(a.jornadaId); return f ? `${f.operadorNombre} · ${f.dia}` : 'Jornada fuera de la tabla'; },
    },
    { id: 'nivel', titulo: 'Nivel', celda: (a) => <strong>{ROTULO_NIVEL[a.nivel]}</strong> },
    {
      id: 'horas', titulo: 'Horas contra tope',
      celda: (a) => (
        <>
          {horasTexto(a.minutos, a.cotaInferior)} de {numero(a.topeMin / 60)} h
          <span className="rv-jn__tenue">según {FUENTE_ALERTA[a.fuente] ?? a.fuente}</span>
        </>
      ),
    },
    { id: 'estado', titulo: 'Estado', celda: (a) => ROTULO_ESTADO_ALERTA[a.estado] ?? a.estado },
    { id: 'encargado', titulo: 'Encargado', celda: (a) => ROTULO_ESTADO_DESTINO[a.encargadoEstado] ?? a.encargadoEstado },
    { id: 'operadorEstado', titulo: 'Operador', celda: (a) => ROTULO_ESTADO_DESTINO[a.operadorEstado] ?? a.operadorEstado },
  ];
  return (
    <Tarjeta titulo="Alerta de tope de jornada" info="jornada.alerta_tope">
      <p className="rv-jn__nota">
        Likida avisa al encargado y al operador cuando una jornada en curso llega a los umbrales que elijas
        (por omisión 80 % y 95 % del tope) y cuando lo rebasa. Solo cuenta lo registrado: sin hora de inicio no
        avisa, y si el inicio no lo declaró el operador el aviso dice «al menos». Es un aviso, no un dictamen.
      </p>
      {configIlegible ? (
        <Aviso tono="error">No se pudo leer la configuración de la alerta. No sabemos si está encendida; vuelve a cargar la pantalla.</Aviso>
      ) : config === null ? (
        <p className="rv-jn__nota">
          Todavía no la has configurado: <strong>la alerta está apagada</strong> y nadie recibe avisos.
        </p>
      ) : (
        <p className="rv-jn__nota">
          <strong>{config.activa ? 'Encendida' : 'Apagada'}</strong>
          {' · '}tope {config.topeHoras === null ? 'de la ley (12 h)' : `propio de ${numero(config.topeHoras)} h`}
          {' · '}aviso al {config.umbralAvisoPct} %, crítico al {config.umbralCriticoPct} %
        </p>
      )}
      {puedeConfigurar && !configIlegible && <FormaAlertaTope config={config} guardarAlerta={guardarAlerta} />}

      {/* sin-info: subtítulo de la lista dentro de «Alerta de tope de jornada», que ya se explica arriba */}
      <h3 className="rv-jn__sub">Alertas emitidas en este periodo</h3>
      {alertas === null ? (
        <Aviso tono="error">No se pudieron leer las alertas emitidas. Esto no significa que no haya habido.</Aviso>
      ) : ordenadas.length === 0 ? (
        <p className="rv-jn__nota">
          Ninguna alerta emitida para las jornadas que se muestran{truncada ? ' (la lista no cupo completa: acota el periodo)' : ''}.
        </p>
      ) : (
        <TablaBase<AlertaDeJornada> etiqueta="Alertas de jornada emitidas" columnas={columnas} filas={ordenadas}
          idFila={(a) => `${a.jornadaId}-${a.nivel}`} tarjetaMovil />
      )}
    </Tarjeta>
  );
}
