import Link from 'next/link';
import { MapPinOff } from 'lucide-react';
import { numero, fechaHoraMx } from '@/lib/formato';
import { nivelDePosicion, contarPorFrescura, ROTULO_FRESCURA, TONO_FRESCURA, MINUTOS_ATRASADA } from '@/lib/likida/gps_salud';
import { MapaVivo, type ViajeEnMapa, type PinUnidad } from './mapa-vivo';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { Aviso, EstadoVacio, Icono, StatusChip, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import './mapa.css';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';

export interface SinUbicar {
  id: string;
  folio: string;
  operadorNombre: string | null;
  /** Con las palabras exactas de qué faltó — nunca se omite en silencio. */
  motivo: string;
}

/** El GPS de la flota tal como se pudo leer — o el porqué de que no. */
export interface Rastreo {
  /** `null` = la lectura se completó. Con texto, NADA de lo demás se afirma. */
  error: string | null;
  /** `estado_rastreo_tenant` (0162): cuántas unidades tienen alguna posición. */
  unidadesConPosicion: number | null;
  /** La posición más reciente de TODA la flota (`max(medida_en)`). */
  ultimaPosicion: string | null;
  proveedores: Array<{ proveedor: string; ultimos4: string | null; activo: boolean; probadaEn: string | null; ultimoError: string | null }>;
  /** Salud del poller (0324). `ultimoPoll` es recepción; `ultimaMedida` es el
   * reloj del dispositivo. Nunca se presenta una como si fuera la otra. */
  polls: Array<{
    proveedor: string; recurso: 'posiciones' | 'eventos'; ultimoPoll: string | null;
    ultimoCompleto: string | null; ultimaMedida: string | null;
    backlogPendiente: boolean; paginas: number; elementos: number; error: string | null;
    eventosInvalidosUltima: number; eventosInvalidosTotal: number;
    eventosEnCuarentena: number; eventosCuarentenaMuertos: number;
    eventosOutboxPendientes: number; eventosOutboxMuertos: number;
    avisosPendientes: number; avisosMuertos: number;
  }>;
  /** Una por unidad activa con posición, ya proyectada al viewBox. */
  pines: PinUnidad[];
  /** Dispositivos que el proveedor reporta y ninguna unidad reclama (no se dibujan). `null` = no se pudo contar. */
  huerfanos?: number | null;
}

/** A partir de aquí el pin se pinta apagado y la lista lo dice: no es "ahí
 *  está el camión", es "ahí estaba hace rato". Seis horas es más de un turno
 *  de manejo — con eso el camión pudo cruzar medio país. */
export const MINUTOS_POSICION_FRESCA = MINUTOS_ATRASADA;

/** «Hace 4 h», «hace 2 días» — con la hora exacta siempre al lado, para que
 *  nadie tenga que confiar en el redondeo. */
function antiguedad(minutos: number, tr: TrOperacion): string {
  const { t, tp } = tr;
  if (minutos < 1) return t('mapa.ahora');
  if (minutos < 60) return t('mapa.hacemin', { n: minutos });
  const horas = Math.round(minutos / 60);
  if (horas < 24) return t('mapa.hacehoras', { n: horas });
  const dias = Math.round(horas / 24);
  return tp('mapa.hacedias', dias);
}

const columnasPines = (tr: TrOperacion): ColumnaBase<PinUnidad>[] => {
  const { t, idioma } = tr;
  return [
  {
    id: 'unidad', titulo: t('mapa.unidad'), principal: true,
    celda: (p) => (<><span className="rv-mp__unidad">{p.etiqueta}</span>{p.placas && <span className="rv-mp__placas">{p.placas}</span>}</>),
  },
  {
    id: 'reporto', titulo: t('mapa.reporto'),
    celda: (p) => {
      const nivel = nivelDePosicion(p.minutos);
      return (
        <>
          <StatusChip tono={TONO_FRESCURA[nivel]}>{ROTULO_FRESCURA[nivel]}</StatusChip> {antiguedad(p.minutos, tr)}
          <span className="rv-mp__sub">{fechaHoraMx(p.medidaEn, idioma)}</span>
        </>
      );
    },
  },
  {
    id: 'origen', titulo: t('mapa.origen'),
    celda: (p) => (p.proveedor === 'whatsapp' ? (p.respaldoWa ? t('mapa.origen.pin') : t('mapa.origen.wa')) : p.proveedor),
  },
  {
    // `null` NO es cero: cero es «parado», null es «el proveedor no manda velocidad».
    id: 'velocidad', titulo: t('mapa.velocidad'), alinear: 'der',
    celda: (p) => (p.velocidadKmh === null ? '—' : t('mapa.kmh', { n: numero(Math.round(p.velocidadKmh), idioma) })),
  },
  { id: 'coordenadas', titulo: t('mapa.coordenadas'), alinear: 'der', celda: (p) => <span className="rv-mp__mono">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</span> },
  ];
};

/**
 * El marco del mapa (F3): KPIs medidos arriba, el mapa vivo al centro, y la
 * lista honesta de lo que NO se pudo ubicar abajo. La leyenda del trayecto
 * ilustrativo vive junto al mapa, no en un tooltip escondido.
 */
export function VistaMapa({ tr = TR_OPERACION_ES, ubicados, sinUbicar, totalVivos, tope, rastreo }: { tr?: TrOperacion;
  ubicados: ViajeEnMapa[];
  sinUbicar: SinUbicar[];
  /** Cuántos viajes EN CURSO tiene la flota (`count exact` en la base, FE-5).
   *  `null` = no se pudo contar, y entonces no se afirma ningún total. */
  totalVivos: number | null;
  /** Cuántos cabe dibujar. Lo que pase de aquí se declara, no se esconde. */
  tope: number;
  /** El GPS: los pines medidos y la salud del conector (auditoría 20, H5). */
  rastreo: Rastreo;
}) {
  const { t, idioma } = tr;
  const escalados = ubicados.filter((v) => v.escalado).length;
  const dibujados = ubicados.length + sinUbicar.length;
  const recortado = totalVivos !== null && totalVivos > dibujados;

  // FE-5: este KPI contaba los vivos ENTRE las 100 filas más recientes — ~90 minutos de operación a 50k viajes/mes. Ahora es el conteo
  // real de la flota; lo acotado es el DIBUJO. AUDITORÍA 20 (H5): el GPS existía y no se veía. `—` cuando la lectura no se pudo hacer:
  // nunca un 0 inventado, que aquí significaría "ninguna unidad reporta".
  const cifras: PropsCifra[] = [
    { etiqueta: t('mapa.cifra.encurso'), valor: totalVivos === null ? '—' : numero(totalVivos, idioma),
      nota: totalVivos === null ? t('mapa.nocontar') : t('mapa.abiertos'), info: 'mapa.viajes_en_curso' },
    { etiqueta: t('mapa.cifra.enmapa'), valor: numero(ubicados.length, idioma), info: 'mapa.en_el_mapa' },
    { etiqueta: t('mapa.cifra.sinubicar'), valor: numero(sinUbicar.length, idioma),
      nota: sinUbicar.length > 0 ? t('mapa.sinubicar.nota') : undefined,
      tono: sinUbicar.length > 0 ? 'warn' : undefined, info: 'mapa.sin_ubicar' },
    { etiqueta: t('mapa.cifra.escalados'), valor: numero(escalados, idioma), tono: escalados > 0 ? 'bad' : undefined, info: 'mapa.escalados' },
    { etiqueta: t('mapa.cifra.unidades'),
      valor: rastreo.unidadesConPosicion === null ? '—' : numero(rastreo.unidadesConPosicion, idioma),
      nota: rastreo.error !== null
        ? t('mapa.norastreo')
        : rastreo.ultimaPosicion !== null
          ? `última: ${fechaHoraMx(rastreo.ultimaPosicion, idioma)}`
          : t('mapa.sinposicion'),
      tono: rastreo.error !== null ? 'warn' : undefined, info: 'mapa.unidades_con_posicion' },
  ];

  return (
    <EsqueletoPanelCifras
      titulo={t('mapa.titulo')}
      apoyo={t('mapa.apoyo')}
      cifras={cifras}
      selloCifras={selloHoy('Viajes en curso')}
      variante="12"
      graficas={[<MapaVivo key="mapa" viajes={ubicados} pines={rastreo.pines} />]}
      metodo={(
        // El tope se declara. Antes decía "los N viajes más recientes" mezclando liquidados y vivos; ahora la base ya filtró por estatus
        // y lo único que se recorta es cuántos caben dibujados.
        <>
          {recortado
            ? t('mapa.dibujan.n', { tope: numero(tope, idioma), total: numero(totalVivos!, idioma) })
            : t('mapa.dibujan.todos')}
        </>
      )}
    >
      {/* ── EL GPS, CON SUS PALABRAS ──────────────────────────────────
          Tres estados y ninguno se confunde con otro: no se pudo leer / no hay conector ni un solo pin / esto es lo que reportaron las
          unidades. El tercero se lista con hora y proveedor porque una coordenada sin cuándo ni quién la mandó no es verificable. */}
      {rastreo.error !== null ? (
        // AUDITORÍA 28, FE-M4: antes se pintaba `rastreo.error.slice(0, 140)` — el mensaje crudo de PostgREST llegaba a la pantalla del
        // cliente. Esta vista solo mira si hay error o no; la frase es fija.
        <Tarjeta titulo={t('mapa.ultimas')} info="mapa.posiciones" estado="error" reintentar
          mensaje={t('mapa.ultimas.error')} />
      ) : (
        <Tarjeta titulo={t('mapa.ultimas')} info="mapa.posiciones">
          {/* AUDITORÍA 28, FE-M4: `p.error` (`conector_poll_estado.ultimo_error`) ya es una frase NUESTRA — se pinta tal cual, sin acotar. */}
          {rastreo.polls.map((p) => (
            <p key={`${p.proveedor}:${p.recurso}`} className="rv-mp__poll" data-tono={p.backlogPendiente || p.eventosCuarentenaMuertos > 0 || p.eventosOutboxMuertos > 0 || p.avisosMuertos > 0 ? 'warn' : undefined}>
              {p.proveedor} · {p.recurso}: poll {p.ultimoPoll ? fechaHoraMx(p.ultimoPoll, idioma) : 'nunca'};
              {' '}medida {p.ultimaMedida ? fechaHoraMx(p.ultimaMedida, idioma) : 'ninguna'};
              {' '}{p.backlogPendiente ? `backlog pendiente${p.error ? ` (${p.error.slice(0, 100)})` : ''}` : `${numero(p.elementos, idioma)} elementos / ${numero(p.paginas, idioma)} páginas`}.
              {p.recurso === 'eventos' && (p.eventosEnCuarentena + p.eventosOutboxPendientes + p.avisosPendientes + p.eventosCuarentenaMuertos + p.eventosOutboxMuertos + p.avisosMuertos > 0)
                ? ` Atención: ${numero(p.eventosEnCuarentena, idioma)} en cuarentena, ${numero(p.eventosOutboxPendientes, idioma)} eventos pendientes, ${numero(p.avisosPendientes, idioma)} avisos pendientes; ${numero(p.eventosCuarentenaMuertos + p.eventosOutboxMuertos + p.avisosMuertos, idioma)} agotaron reintentos.`
                : ''}
            </p>
          ))}
          {rastreo.pines.length > 0 && (() => {
            const c = contarPorFrescura(rastreo.pines.map((p) => p.minutos));
            return (
              <div className="rv-mp__frescura">
                <span>Frescura del dato:</span>
                <StatusChip tono="ok">{numero(c.en_vivo, idioma)} en vivo</StatusChip>
                <StatusChip tono="warn">{numero(c.atrasada, idioma)} atrasadas</StatusChip>
                <StatusChip tono="bad">{numero(c.obsoleta, idioma)} obsoletas</StatusChip>
                <span>(en vivo ≤ 30 min, atrasada ≤ {Math.round(MINUTOS_POSICION_FRESCA / 60)} h). Un camión parado puede tener la posición vieja sin que nada falle.</span>
              </div>
            );
          })()}
          {typeof rastreo.huerfanos === 'number' && rastreo.huerfanos > 0 && (
            <Aviso tono="warn">
              {numero(rastreo.huerfanos, idioma)} {rastreo.huerfanos === 1 ? 'dispositivo que reporta tu proveedor no está ligado' : 'dispositivos que reporta tu proveedor no están ligados'} a ninguna unidad:
              no se dibujan (Likida no inventa camiones). Lígalos en <Link href="/dashboard/conexiones#gps" className="rv-mp__enlace">Conexiones</Link>.
            </Aviso>
          )}
          <p className="rv-mp__nota">
            {t('mapa.medida')}
          </p>

          {rastreo.proveedores.length > 0 && (
            <div className="rv-mp__chips">
              {rastreo.proveedores.map((p) => (
                <StatusChip key={p.proveedor} tono={p.ultimoError ? 'bad' : p.activo ? 'ok' : 'muted'}>
                  {p.proveedor} · {p.ultimoError ? `con error: ${p.ultimoError.slice(0, 60)}` : p.activo ? 'conectado' : 'apagado'}
                  {p.ultimos4 && <> ····{p.ultimos4}</>}
                </StatusChip>
              ))}
            </div>
          )}

          {rastreo.pines.length === 0 ? (
            <EstadoVacio contenido titulo={t('mapa.sinposiciones')}>
              {rastreo.proveedores.length === 0
                ? t('mapa.sinproveedor')
                : t('mapa.sinreporte')}
            </EstadoVacio>
          ) : (
            <>
              <TablaBase<PinUnidad> etiqueta={t('mapa.unidades.ultimo')} columnas={columnasPines(tr)} filas={rastreo.pines} idFila={(p) => p.unidadId} tarjetaMovil />
              <p className="rv-mp__nota">
                Lo atrasado se marca en ámbar y lo obsoleto (más de {Math.round(MINUTOS_POSICION_FRESCA / 60)} horas) en rojo
                aquí, y se dibuja apagado en el mapa: sigue siendo la última posición conocida, no dónde
                está el camión ahora.
              </p>
            </>
          )}
        </Tarjeta>
      )}

      {sinUbicar.length > 0 && (
        <Tarjeta titulo={t('mapa.sinubicar.titulo')} info="mapa.sin_ubicar_lista">
          <p className="rv-mp__nota">{t('mapa.sinubicar.nota2')}</p>
          <ul className="rv-mp__lista">
            {sinUbicar.map((v) => (
              <li key={v.id} className="rv-mp__sin">
                <Icono icono={MapPinOff} tam={16} />
                <strong>{v.folio}</strong>
                {v.operadorNombre && <span>{v.operadorNombre}</span>}
                <span className="rv-mp__sin-motivo">{v.motivo}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </EsqueletoPanelCifras>
  );
}
