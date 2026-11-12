import { uniformes } from '@/app/admin/cifras-uniformes';
import { fechaHoraMx } from '@/lib/formato';
import { CRONS, type CronId, type LatidoDetallado } from '@/lib/admin/salud';
import { Aviso, Disclosure, EstadoError, StatusChip, type TonoEstado } from '../../ui-v2/componentes';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import {
  nombreReloj, oficioReloj, cadaCuanto, desdeHace, guiaDeArreglo, porQueNoCorrio, resumenDetalle, resumenRelojes,
} from './estado-relojes';
import '../sistema.css';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { rico } from '@/lib/i18n/rico';
import type { Idioma } from '@/lib/i18n/idioma';

// Las piezas puras viven en `estado-relojes.ts` (las usa también la portada de Salud); se re-exportan para quien ya las importaba de aquí.
export { cadaCuanto, desdeHace, resumenDetalle, resumenRelojes };

/**
 * LOS RELOJES DEL SISTEMA — el render. `cron_latido` lleva el pulso de cada reloj; hasta que existió esta pantalla el único que lo leía
 * era `/api/health`, que contesta un booleano agregado porque es un endpoint público: a quien pregunta desde fuera no se le dice qué
 * reloj se paró. Aquí sí se dice cuál, desde cuándo, por qué no corrió y, si es falta de configuración, cómo se arregla.
 *
 * LO QUE NO HACE: no dispara un reloj a mano. Uno que se puede lanzar desde el panel es uno que corre dos veces —el reloj de Vercel no
 * se entera de que alguien le ganó— y varios (`facturar`, `runner`) reservan filas: dos pasadas simultáneas se pisan. Se OBSERVA aquí
 * y se APAGA en Observabilidad, que es donde vive la palanca.
 */

/**
 * El veredicto de `juzgarLatido` como chip. `sin_latido` es ÁMBAR y no rojo a propósito: significa «nunca escribió», que tanto puede ser
 * un reloj recién nacido como uno que no PUEDE escribir. No es lo mismo que `vencido`, donde sí consta que latía y dejó de hacerlo.
 */
const chipSalud = (t: TSistema = T_SISTEMA_ES): Record<LatidoDetallado['estado'], { tono: TonoEstado; etiqueta: string }> => ({
  ok: { tono: 'ok', etiqueta: t('crons_vista.latiendo') },
  vencido: { tono: 'bad', etiqueta: t('crons_vista.no_late') },
  sin_latido: { tono: 'warn', etiqueta: t('crons_vista.nunca_latio') },
});

/** Lo que el propio reloj dijo de su última pasada. */
const chipUltimo = (t: TSistema = T_SISTEMA_ES): Record<string, { tono: TonoEstado; etiqueta: string }> => ({
  ok: { tono: 'ok', etiqueta: 'OK' },
  parcial: { tono: 'warn', etiqueta: t('observabilidad.parcial') },
  saltado: { tono: 'neutral', etiqueta: t('crons_vista.saltado') },
  fallo: { tono: 'bad', etiqueta: t('observabilidad.fallo') },
});

type Fila = { cron: CronId; l: LatidoDetallado };

const columnasTr = (t: TSistema = T_SISTEMA_ES, idioma?: Idioma): ColumnaTabla<Fila>[] => ([
  {
    id: 'reloj', titulo: t('crons_vista.reloj'), principal: true,
    celda: (x) => <>{nombreReloj(t)[x.cron]}<span className="adm-sis-sub">{oficioReloj(t)[x.cron]}</span></>,
  },
  { id: 'cadencia', titulo: t('crons_vista.cadencia'), corta: true, celda: (x) => cadaCuanto(x.l.cadenciaMs, t) },
  { id: 'pulso', titulo: t('crons_vista.pulso'), celda: (x) => <StatusChip tono={chipSalud(t)[x.l.estado].tono}>{chipSalud(t)[x.l.estado].etiqueta}</StatusChip> },
  {
    id: 'ultimo', titulo: t('crons_vista.ultimo_latido'),
    // La fecha exacta ARRIBA y el «hace» debajo: el «hace» se lee de un golpe, la fecha es la que se pega en un reporte.
    celda: (x) => <>{x.l.ultimoLatido === null ? '—' : fechaHoraMx(x.l.ultimoLatido, idioma)}<span className="adm-sis-sub">{desdeHace(x.l.haceMin, t)}</span></>,
  },
  {
    id: 'resultado', titulo: t('crons_vista.como_le_fue'),
    celda: (x) => (x.l.ultimoEstado === null ? '—' : <StatusChip tono={chipUltimo(t)[x.l.ultimoEstado]?.tono ?? 'neutral'}>{chipUltimo(t)[x.l.ultimoEstado]?.etiqueta ?? x.l.ultimoEstado}</StatusChip>),
  },
  {
    id: 'porque', titulo: t('crons_vista.por_que'),
    celda: (x) => { const p = porQueNoCorrio(x.l, t); return p.causa === 'ninguna' ? '—' : <span className="adm-sis-celda-una" title={p.texto}>{p.texto}</span>; },
  },
]);

export function VistaCrons({ latidos, t = T_SISTEMA_ES, idioma }: { latidos: Record<CronId, LatidoDetallado> | null; t?: TSistema; idioma?: Idioma }) {
  const lista: Fila[] = latidos === null ? [] : CRONS.map((c) => ({ cron: c, l: latidos[c] }));
  const { sinLatir, conFallo, parciales } = resumenRelojes(lista);
  const malos = [...sinLatir, ...conFallo];
  const guias = lista.map((x) => guiaDeArreglo(x.cron, x.l, t)).filter((g) => g !== null);
  const nombres = (ids: CronId[]) => ids.map((c) => nombreReloj(t)[c]).join(', ');
  // Una columna que sale vacía («—» en todas las filas) no se pinta: no dice nada y estrecha las que sí.
  const hayResultado = lista.some((x) => x.l.ultimoEstado !== null);
  const columnas = columnasTr(t, idioma).filter((c) => hayResultado || c.id !== 'resultado');

  // El aviso va ANTES de las cifras (plantilla TM de Rovaq: filtros → avisos → cifras → tabla); por eso viaja en `avisos`, no en `children`.
  // El rótulo cuenta lo MEDIDO, no una meta. `CRONS.length` sale de la misma constante que vercel.json cruza en `salud.test.ts`.
  const avisoGeneral = latidos === null ? undefined : (
    <>
          {malos.length === 0 ? (
            <Aviso tono={parciales.length > 0 ? 'warn' : 'ok'} titulo={t('crons_vista.los_relojes_latieron_dentro_de_su', { length: CRONS.length })}>{t('crons_vista.ninguno_reporto_fallo_en_su_ultima')}{parciales.length > 0 ? ` ${t(parciales.length === 1 ? 'crons_vista.reporto_corrida_parcial_uno' : 'crons_vista.reporto_corrida_parcial_varios', { nombres: nombres(parciales) })}` : ''}
            </Aviso>
          ) : (
            <Aviso tono="error" titulo={t('crons_vista.hay_relojes_que_necesitan_atencion')}>
              {t('crons_vista.n_necesitan_revision', { n: new Set(malos).size, length: CRONS.length })}
              <Disclosure titulo={t('crons_vista.ver_cuales_son')} variante="linea">
              {sinLatir.length > 0 ? <><strong>{sinLatir.length}</strong>{' '}{t('crons_vista.de_relojes_no_estan_latiendo_como', { length: CRONS.length, nombres: nombres(sinLatir) })}</> : null}
              {conFallo.length > 0 ? <>{conFallo.length === 1 ? t('crons_vista.un_reloj_late') : t('crons_vista.relojes_laten', { n: conFallo.length })}{' '}{rico(t('crons_vista.a_tiempo_pero_su_ultima_corrida', { nombres: nombres(conFallo) }), { strong: (c) => <strong>{c}</strong> })}</> : null}
              </Disclosure>
            </Aviso>
          )}
    </>
  );

  return (
    <EsqueletoTablaMaestra
      avisos={avisoGeneral}
      titulo={t('crons_vista.relojes')}
      apoyo={t('crons_vista.los_procesos_programados_del_sistema_cuando')}
      cifras={latidos === null ? undefined : uniformes([
        { etiqueta: t('crons_vista.kpi_total'), valor: CRONS.length, formato: 'entero' },
        { etiqueta: t('salud_sistema.relojes_a_tiempo'), valor: CRONS.length - malos.length, formato: 'entero', tono: malos.length > 0 ? 'bad' : parciales.length > 0 ? 'warn' : 'ok' },
        { etiqueta: t('crons_vista.kpi_sin_latir'), valor: sinLatir.length, formato: 'entero', tono: sinLatir.length > 0 ? 'bad' : undefined },
        { etiqueta: t('crons_vista.kpi_con_fallo'), valor: conFallo.length, formato: 'entero', tono: conFallo.length > 0 ? 'bad' : undefined },
        { etiqueta: t('crons_vista.kpi_parciales'), valor: parciales.length, formato: 'entero', tono: parciales.length > 0 ? 'warn' : undefined },
      ])}
    >
      {latidos === null ? (
        <EstadoError reintentar>{t('crons_vista.no_se_pudo_leer_el_pulso')}</EstadoError>
      ) : (
        <>
          {guias.length > 0 ? (
            <section className="adm-sis-bloque adm-sis-caja" aria-labelledby="que-falta">
              <h2 className="adm-sis-titulo" id="que-falta">{t('crons_vista.que_falta_para_que_corran_completos')}</h2>
              {guias.map((g) => (
                <Aviso key={g.cron} tono="warn" titulo={nombreReloj(t)[g.cron]}>
                  {g.queFalta} {g.quien}
                  <Disclosure titulo={t('crons_vista.como_arreglarlo')} variante="linea">
                    <ol className="adm-sis-guia">
                      {g.pasos.map((p) => <li key={p}>{p}</li>)}
                    </ol>
                    {g.dicho ? <p className="adm-sis-nota">{t('crons_vista.lo_que_el_reloj_dejo_dicho')}{' '}{g.dicho}</p> : null}
                  </Disclosure>
                </Aviso>
              ))}
            </section>
          ) : null}

          <section className="adm-sis-bloque adm-sis-caja" aria-labelledby="relojes-uno-por-uno">
            <div className="adm-sis-cab-caja">
              <span className="adm-sis-eyebrow">{t('crons_vista.eyebrow_relojes')}</span>
              <h2 className="adm-sis-titulo" id="relojes-uno-por-uno">{t('crons_vista.uno_por_uno')}</h2>
            </div>
            <TablaLista<Fila>
              etiqueta={t('crons_vista.relojes_del_sistema_uno_por_uno')} columnas={columnas} filas={lista} idFila={(x) => x.cron} base="/admin/crons" params={{}}
            />
            <p className="adm-sis-nota">{t('crons_vista.el_pulso_lo_escribe_cada_reloj')}</p>
          </section>
        </>
      )}
    </EsqueletoTablaMaestra>
  );
}
