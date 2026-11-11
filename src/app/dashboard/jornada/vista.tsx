import { CajonAlta } from '../cajon-alta';
import { TarjetaTabla } from '../bloque';
import { cifrasUniformes } from '../formato';
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
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { CajonVistaRapida, EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import {
  Aviso, AvisoCompacto, BarraPeriodo, clasesBoton, EstadoError, EstadoVacio, hrefConParams, Icono, InfoTip, StatusChip, TablaBase, Tarjeta, BotonEnlace,
  type ColumnaBase, type TonoEstado,
} from '@/app/ui-v2/componentes';
import './jornada.css';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';

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

export function VistaJornada({ tr = TR_OPERACION_ES,
  filas, semanas, motivoIlegible, truncada, politica, desde, hasta, sufijo, operador, operadores, abrir, puedeCorregir,
  puedeDeclararPolitica, anularMarca, capturarMarca, cerrarElDia, declararPolitica,
  alertaConfig, alertaConfigIlegible, alertas, puedeConfigurarAlerta, guardarAlerta,
}: { tr?: TrOperacion;
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
  const { t, idioma } = tr;
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
      id: 'dia', titulo: t('jor.col.dia'), principal: true,
      celda: (f) => <Link href={hrefJornada(f)} className="rv-jn__enlace">{f.dia}</Link>,
    },
    { id: 'operador', titulo: t('jor.col.operador'), celda: (f) => f.operadorNombre },
    { id: 'inicio', titulo: t('jor.col.inicio'), celda: (f) => <Marca a={f.jornada.inicio} /> },
    { id: 'fin', titulo: t('jor.col.fin'), celda: (f) => <Marca a={f.jornada.fin} /> },
    {
      id: 'descanso', titulo: t('jor.col.descanso'),
      // `null` NO se pinta como 0: son dos afirmaciones distintas.
      celda: (f) => (f.jornada.minutosDescanso === null
        ? <span className="rv-jn__apagado">{t('jor.sindescanso')}</span>
        : `${f.jornada.minutosDescanso} min`),
    },
    { id: 'total', titulo: t('jor.col.total'), celda: (f) => <TotalDelDia f={f} tr={tr} /> },
    { id: 'lectura', titulo: t('jor.col.lectura'), celda: (f) => <StatusChip tono={TONO[f.riesgo.veredicto] ?? 'warn'}>{ROTULO_VEREDICTO[f.riesgo.veredicto]}</StatusChip> },
    {
      id: 'estado', titulo: t('jor.col.estado'),
      celda: (f) => (
        <>
          {f.estado === 'cerrado' ? `Cerrado · ${f.cerradoPorEmail ?? 'sin firma'}` : t('jor.abierto')}
          <span className="rv-jn__tenue">{f.conformeOperadorEn ? t('jor.conformidad.si') : t('jor.conformidad.no')}</span>
        </>
      ),
    },
    {
      id: 'vr', titulo: t('jor.vr.ver'), alinear: 'der', tituloOculto: true,
      celda: (f) => <BotonEnlace variante="ghost" tamano="sm" href={hrefJornada(f)}>{t('jor.vr.ver')}</BotonEnlace>,
    },
  ];
  const hrefJornada = (f: FilaJornada) => `/dashboard/jornada${sufijo ? `${sufijo}&` : '?'}desde=${desde}&hasta=${hasta}&abrir=${f.jornadaId}`;
  const hrefCerrar = `/dashboard/jornada${sufijo ? `${sufijo}&` : '?'}desde=${desde}&hasta=${hasta}${operador ? `&operador=${encodeURIComponent(operador)}` : ''}`;
  const sel = abrir !== null ? lista.find((f) => f.jornadaId === abrir) : undefined;
  const cifras: PropsCifra[] = [
    { etiqueta: t('jor.cifra.sinregistro'), valor: cuenta && numero(cuenta.sinRegistro, idioma),
      nota: t('jor.cifra.sinregistro.nota'), tono: cuenta && cuenta.sinRegistro > 0 ? 'warn' : undefined, info: 'jornada.sin_registro' },
    { etiqueta: t('jor.cifra.exceso'), valor: cuenta && numero(cuenta.conExceso, idioma),
      nota: t('jor.cifra.exceso.nota'), tono: cuenta && cuenta.conExceso > 0 ? 'bad' : undefined, info: 'jornada.posible_exceso' },
    { etiqueta: t('jor.cifra.insuficiente'), valor: cuenta && numero(cuenta.insuficientes, idioma),
      nota: t('jor.cifra.insuficiente.nota'), tono: cuenta && cuenta.insuficientes > 0 ? 'warn' : undefined, info: 'jornada.dato_insuficiente' },
    { etiqueta: t('jor.cifra.sinconformidad'), valor: cuenta && numero(cuenta.sinConformidad, idioma),
      nota: t('jor.cifra.sinconformidad.nota'), tono: cuenta && cuenta.sinConformidad > 0 ? 'warn' : undefined, info: 'jornada.sin_conformidad' },
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={t('jor.titulo')}
      apoyo={t('jor.apoyo')}
      acciones={(
        // `<a>` y no `Link`: es un archivo que baja, no una ruta que se precarga (un prefetch dispararía la exportación).
        <a href={urlExport} className={clasesBoton('secondary', 'sm')}>
          <Icono icono={Download} />
          {t('jor.descargar')}
        </a>
      )}
      cifras={cifrasUniformes(cifras)}
      selloCifras={selloHoy('Registro de jornada')}
      filtros={(
        // El filtro de fechas por GET: mueve TODO lo que hay debajo, incluida la liga de descarga. Un rótulo que dice «del X al Y»
        // tiene que ser cierto para las dos cosas.
        <BarraPeriodo etiqueta={t('jor.periodo.aria')}
          chips={[
            { id: 'rango', etiqueta: t('jor.periodo.del', { desde: fechaMx(desde, idioma), hasta: fechaMx(hasta, idioma) }) },
            ...(operador ? [{ id: 'operador', etiqueta: operadores?.find((o) => o.id === operador)?.nombre ?? 'Operador elegido', hrefQuitar: hrefConParams('/dashboard/jornada', { ...ctxJornada, desde, hasta, operador }, { operador: null }) }] : []),
          ]}
          cajon={{
            accion: '/dashboard/jornada', ocultos: Object.entries(ctxJornada), limpiarHref: hrefConParams('/dashboard/jornada', ctxJornada), nActivos: operador ? 1 : 0,
            resumen: t(operador ? 'jor.periodo.operador' : 'jor.periodo.del', { desde: fechaMx(desde, idioma), hasta: fechaMx(hasta, idioma) }),
            periodo: { desde, hasta },
            // FE-19: con cientos de choferes la ventana por omisión nace truncada casi siempre; sin este selector la única forma de ver a UN operador era teclear su id en la URL.
            campos: operadores && operadores.length > 0 ? { items: [{ tipo: 'select', nombre: 'operador', etiqueta: t('jor.operador'), valor: operador ?? '', opciones: [{ valor: '', rotulo: 'Todos' }, ...operadores.map((o) => ({ valor: o.id, rotulo: o.nombre }))] }] } : undefined,
          }} />
      )}
      avisos={(
        <>
          {/* QUÉ ES ESTE DOCUMENTO Y QUÉ NO ES. Va arriba, no en una nota al pie: una flota que crea que esto sustituye la bitácora de horas
              de servicio se lleva la multa del art. 83 con nuestro archivo en la mano. */}
          <AvisoCompacto tono="warn" resumen={LEYENDA_NO_ES_BITACORA_83} etiquetaMas="Ver más: alcance legal"
            mas={(
              <>
                <strong>{t('jor.nota.ley')}</strong> <InfoTip clave="jornada.alcance" />
                <p>{LEYENDA_NOM_087}</p>
                <p>{LEYENDA_VEREDICTOS}</p>
              </>
            )} />
          {operadores === null && (
            <p className="rv-jn__aviso">
              No se pudo leer el catálogo de operadores — el filtro por URL (<code>?operador=</code>) sigue funcionando.
            </p>
          )}
        </>
      )}
      vistaRapida={sel ? (
        // El detalle y las correcciones del día abierto. Un solo día a la vez: pintar un formulario por cada renglón mete cientos de
        // forms en una pantalla donde se corrige uno (la lección de FE-12 en /dashboard/operadores).
        <CajonVistaRapida
          titulo={sel.operadorNombre}
          subtitulo={t('jor.vr.sub', { n: numero(lista.indexOf(sel) + 1, idioma), total: numero(lista.length, idioma) })}
          hrefCerrar={hrefCerrar}
          cifras={[
            { etiqueta: t('jor.col.dia'), valor: sel.dia },
            { etiqueta: t('jor.col.estado'), valor: sel.estado === 'cerrado' ? 'Cerrado' : t('jor.abierto') },
            { etiqueta: t('jor.col.lectura'), valor: ROTULO_VEREDICTO[sel.riesgo.veredicto] },
            { etiqueta: t('jor.col.descanso'), valor: sel.jornada.minutosDescanso === null ? t('jor.sindescanso') : `${sel.jornada.minutosDescanso} min` },
          ]}
        >
          <FormasJornada
            fila={sel}
            puedeCorregir={puedeCorregir && sel.editable}
            anularMarca={anularMarca}
            capturarMarca={capturarMarca}
            cerrarElDia={cerrarElDia}
          />
        </CajonVistaRapida>
      ) : null}
    >
      {truncada && (
        <EstadoError>{t('jor.truncada')}</EstadoError>
      )}

      {motivoIlegible !== null ? (
        <EstadoError reintentar>{`${motivoIlegible} No se enseña media lista: media lista se ve igual que la lista entera, solo más corta — y aquí eso sería afirmar que unos operadores no reportaron.`}</EstadoError>
      ) : (
        // La tabla y su vacío viven en una tarjeta (a sangre), nunca sueltos sobre el lienzo.
        <TarjetaTabla titulo={t('jor.tabla.etiqueta')} contador={lista.length > 0 ? numero(lista.length, idioma) : undefined}>
          {lista.length === 0 ? (
            <EstadoVacio contenido icono={CalendarClock} titulo={t('jor.vacio.titulo')}>
              {t('jor.vacio')}
            </EstadoVacio>
          ) : (
            <TablaBase<FilaJornada> etiqueta={t('jor.tabla.etiqueta')} columnas={columnas} filas={lista} idFila={(f) => f.jornadaId} tarjetaMovil />
          )}
        </TarjetaTabla>
      )}

      {/* ── EL EJE SEMANAL (tableros al día, 28-ago-2026) ──────────────
          El tope del decreto es SEMANAL: un contralor podía tener catorce días verdes uno por uno y una semana de 63 h — y esta
          pantalla nunca lo decía. Solo semanas ENTERAS (lunes a domingo dentro de la ventana): media semana evaluada diría «va
          bien» con el recorte. */}
      {motivoIlegible === null && (
        <SeccionSemanas semanas={semanas} truncada={truncada} tr={tr} />
      )}

      <PoliticaSeccion
          tr={tr}
        politica={politica}
        puedeCorregir={puedeDeclararPolitica}
        declararPolitica={declararPolitica}
      />

      {motivoIlegible === null && (
        <AlertaTopeSeccion
          tr={tr}
          config={alertaConfig}
          configIlegible={alertaConfigIlegible}
          alertas={alertas}
          filas={lista}
          truncada={truncada}
          puedeConfigurar={puedeConfigurarAlerta}
          guardarAlerta={guardarAlerta}
        />
      )}
    </EsqueletoTablaMaestra>
  );
}

/** Total del día con las horas extraordinarias del art. 61 SOLO cuando están medidas (> 0). */
function TotalDelDia({ tr = TR_OPERACION_ES, f }: { tr?: TrOperacion; f: FilaJornada }) {
  const { t } = tr;
  const j = f.jornada;
  const horas = aHoras(j.minutosEfectivos ?? j.minutosBrutos);
  const hueco = fraseDelHueco(j);
  if (horas === null) return <span className="rv-jn__apagado">{hueco ?? t('jor.nocalcula')}</span>;
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
export function SeccionSemanas({ tr = TR_OPERACION_ES, semanas, truncada }: { tr?: TrOperacion; semanas: SemanaEvaluada[] | null; truncada: boolean }) {
  const { t } = tr;
  const columnas: ColumnaBase<SemanaEvaluada>[] = [
    { id: 'operador', titulo: t('jor.sem.operador'), principal: true, celda: (s) => s.operadorNombre },
    { id: 'semana', titulo: t('jor.sem.semana'), celda: (s) => <>{s.desde} → {s.hasta}</> },
    { id: 'horas', titulo: t('jor.sem.horas'), celda: (s) => <HorasSemana s={s} tr={tr} /> },
    { id: 'lectura', titulo: t('jor.sem.lectura'), celda: (s) => <StatusChip tono={TONO[s.riesgo.veredicto] ?? 'warn'}>{ROTULO_VEREDICTO[s.riesgo.veredicto]}</StatusChip> },
    { id: 'que', titulo: t('jor.sem.queseve'), celda: (s) => <SenalesSemana s={s} tr={tr} /> },
  ];
  return (
    <Tarjeta titulo={t('jor.sem.titulo')} info="jornada.semana">
      <p className="rv-jn__nota">
        {t('jor.sem.nota')}
      </p>
      {semanas === null ? (
        <p className="rv-jn__nota" data-tono="warn">
          {truncada
            ? t('jor.sem.recortada')
            : t('jor.sem.noleyo')}
        </p>
      ) : semanas.length === 0 ? (
        <p className="rv-jn__nota">
          {t('jor.sem.ninguna')}
        </p>
      ) : (
        <TablaBase<SemanaEvaluada> etiqueta={t('jor.sem.veredicto')} columnas={columnas} filas={semanas}
          idFila={(s) => `${s.operadorId}-${s.desde}`} tarjetaMovil />
      )}
    </Tarjeta>
  );
}

function HorasSemana({ s, tr }: { s: SemanaEvaluada; tr: TrOperacion }) {
  const { t, tp } = tr;
  const faltan = s.riesgo.diasSinDato.length;
  if (s.riesgo.horasMedidas === null) {
    return (
      <span className="rv-jn__apagado">
        {/* El guion NO quiere decir cero: se escribe la razón. */}
        {tp('jor.sem.faltan', faltan, { n: numero(faltan, tr.idioma) })}
      </span>
    );
  }
  return (
    <>
      {s.riesgo.horasMedidas} h
      {s.riesgo.topeOrdinariaHoras !== null && (
        <span className="rv-jn__tenue">{t('jor.sem.tope', { h: s.riesgo.topeOrdinariaHoras })}</span>
      )}
    </>
  );
}

function SenalesSemana({ tr = TR_OPERACION_ES, s }: { tr?: TrOperacion; s: SemanaEvaluada }) {
  const { t } = tr;
  if (s.riesgo.senales.length === 0) {
    return (
      <span className="rv-jn__apagado">
        {s.riesgo.horasMedidas === null
          ? t('jor.sem.sinafirmar', { dias: s.riesgo.diasSinDato.join(', ') })
          : t('jor.nadarebasado')}
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

function PoliticaSeccion({ tr = TR_OPERACION_ES,
  politica, puedeCorregir, declararPolitica,
}: { tr?: TrOperacion;
  politica: PoliticaFlota | null;
  puedeCorregir: boolean;
  declararPolitica: AccionJornada;
}) {
  const { t } = tr;
  return (
    <Tarjeta titulo={t('jor.umbrales.titulo')} info="jornada.umbrales"
      // La configuración no vive abierta en la página: se edita en un cajón (Rovaq: filas de configuración en overlay, un primario por zona).
      acciones={puedeCorregir ? (
        <CajonAlta id="umbrales" titulo={t('jor.umbrales.titulo')} disparador={t('jor.umbrales.editar')} variante="secondary" tamano="xl">
          <FormaPolitica politica={politica} declararPolitica={declararPolitica} />
        </CajonAlta>
      ) : undefined}>
      <p className="rv-jn__nota">
        Likida ya evalúa los topes de la ley (los artículos 61, 63, 68 y 69 de la LFT, y la tabla
        de jornada semanal por año del decreto del 1 de mayo de 2026). Aquí van los tuyos, si tu
        flota se fijó unos más estrictos por contrato colectivo, por póliza o por política interna.
        Dejar un campo vacío significa <strong>no declarado</strong>, no cero.
      </p>
      {politica === null && (
        <p className="rv-jn__nota">
          {t('jor.umbrales.ninguno')}
        </p>
      )}
    </Tarjeta>
  );
}

const ROTULO_ESTADO_ALERTA = {
  reclamada: 'jor.estado.reclamada', enviada: 'jor.estado.enviada', parcial: 'jor.estado.parcial', fallida: 'jor.estado.fallida',
  sin_destinatario: 'jor.estado.sin_destinatario',
} as const;
const ROTULO_ESTADO_DESTINO = {
  pendiente: 'jor.dest.pendiente', enviado: 'jor.dest.enviado', fallido: 'jor.dest.fallido', sin_destinatario: 'jor.dest.sin_destinatario',
  no_aplica: 'jor.dest.no_aplica',
} as const;
const FUENTE_ALERTA = {
  declarado_operador: 'jor.fuente.declarado_operador', hito_viaje: 'jor.fuente.hito_viaje', gps: 'jor.fuente.gps',
  capturado_contralor: 'jor.fuente.capturado_contralor',
} as const;
/** El texto de un código conocido; uno nuevo sale crudo (visible, no roto). */
const rotulo = <M extends Record<string, string>>(m: M, k: string, t: (c: M[keyof M]) => string): string => (k in m ? t(m[k as keyof M]) : k);

/**
 * LA ALERTA DE TOPE (0502): configuración por flota y lista de lo ya emitido. La lista es de las jornadas que la
 * tabla de arriba enseña; una lectura caída se dice y nunca se pinta como «ninguna alerta», que sería afirmar que a
 * nadie se le avisó.
 */
export function AlertaTopeSeccion({ tr = TR_OPERACION_ES,
  config, configIlegible, alertas, filas, truncada, puedeConfigurar, guardarAlerta,
}: { tr?: TrOperacion;
  config: ConfigAlertaForma | null;
  configIlegible: boolean;
  alertas: AlertaDeJornada[] | null;
  filas: FilaJornada[];
  truncada: boolean;
  puedeConfigurar: boolean;
  guardarAlerta: AccionJornada;
}) {
  const { t, idioma } = tr;
  const porJornada = new Map(filas.map((f) => [f.jornadaId, f]));
  const ordenadas = alertas === null ? [] : [...alertas].sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));
  const columnas: ColumnaBase<AlertaDeJornada>[] = [
    {
      id: 'cuando', titulo: t('jor.al.cuando'), principal: true,
      celda: (a) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ_MX, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(a.creadaEn)),
    },
    {
      id: 'operador', titulo: t('jor.al.operadordia'),
      celda: (a) => { const f = porJornada.get(a.jornadaId); return f ? `${f.operadorNombre} · ${f.dia}` : t('jor.al.fuera'); },
    },
    { id: 'nivel', titulo: t('jor.al.nivel'), celda: (a) => <strong>{ROTULO_NIVEL[a.nivel]}</strong> },
    {
      id: 'horas', titulo: t('jor.al.horas'),
      celda: (a) => (
        <>
          {horasTexto(a.minutos, a.cotaInferior)} de {numero(a.topeMin / 60, idioma)} h
          <span className="rv-jn__tenue">{t('jor.fuente.segun', { fuente: rotulo(FUENTE_ALERTA, a.fuente, t) })}</span>
        </>
      ),
    },
    { id: 'estado', titulo: t('jor.al.estado'), celda: (a) => rotulo(ROTULO_ESTADO_ALERTA, a.estado, t) },
    { id: 'encargado', titulo: t('jor.al.encargado'), celda: (a) => rotulo(ROTULO_ESTADO_DESTINO, a.encargadoEstado, t) },
    { id: 'operadorEstado', titulo: t('jor.al.operador'), celda: (a) => rotulo(ROTULO_ESTADO_DESTINO, a.operadorEstado, t) },
  ];
  return (
    <Tarjeta titulo={t('jor.alerta.titulo')} info="jornada.alerta_tope"
      acciones={puedeConfigurar && !configIlegible ? (
        <CajonAlta id="alerta-tope" titulo={t('jor.alerta.titulo')} disparador={t('jor.alerta.configurar')} variante="secondary" tamano="xl">
          <FormaAlertaTope config={config} guardarAlerta={guardarAlerta} />
        </CajonAlta>
      ) : undefined}>
      <p className="rv-jn__nota">
        {t('jor.alerta.nota')}
      </p>
      {configIlegible ? (
        <Aviso tono="error">{t('jor.alerta.noleyo')}</Aviso>
      ) : config === null ? (
        <p className="rv-jn__nota">
          Todavía no la has configurado: <strong>la alerta está apagada</strong> y nadie recibe avisos.
        </p>
      ) : (
        <p className="rv-jn__nota">
          <strong>{config.activa ? t('jor.alerta.encendida') : t('jor.alerta.apagada')}</strong>
          {' · '}tope {config.topeHoras === null ? t('jor.alerta.ley') : `propio de ${numero(config.topeHoras, idioma)} h`}
          {' · '}aviso al {config.umbralAvisoPct} %, crítico al {config.umbralCriticoPct} %
        </p>
      )}

      {/* sin-info: subtítulo de la lista dentro de «Alerta de tope de jornada», que ya se explica arriba */}
      <h3 className="rv-jn__sub rv-jn__sep">{t('jor.emitidas.titulo')}</h3>
      {alertas === null ? (
        <Aviso tono="error">{t('jor.emitidas.noleyo')}</Aviso>
      ) : ordenadas.length === 0 ? (
        <p className="rv-jn__nota">
          {t('jor.emitidas.ninguna')}{truncada ? t('jor.emitidas.parcial') : ''}.
        </p>
      ) : (
        <TablaBase<AlertaDeJornada> etiqueta={t('jor.emitidas.aria')} columnas={columnas} filas={ordenadas}
          idFila={(a) => `${a.jornadaId}-${a.nivel}`} tarjetaMovil />
      )}
    </Tarjeta>
  );
}
