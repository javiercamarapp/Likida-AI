import { fechaHoraMx } from '@/lib/formato';
import { CRONS, type CronId, type LatidoDetallado } from '@/lib/admin/salud';
import { Aviso, Disclosure, EstadoError, MarcoPagina, StatusChip, type TonoEstado } from '../../ui-v2/componentes';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import {
  NOMBRE_RELOJ, OFICIO_RELOJ, cadaCuanto, desdeHace, guiaDeArreglo, porQueNoCorrio, resumenDetalle, resumenRelojes,
} from './estado-relojes';
import '../sistema.css';

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
const CHIP_SALUD: Record<LatidoDetallado['estado'], { tono: TonoEstado; etiqueta: string }> = {
  ok: { tono: 'ok', etiqueta: 'Latiendo' },
  vencido: { tono: 'bad', etiqueta: 'No late' },
  sin_latido: { tono: 'warn', etiqueta: 'Nunca latió' },
};

/** Lo que el propio reloj dijo de su última pasada. */
const CHIP_ULTIMO: Record<string, { tono: TonoEstado; etiqueta: string }> = {
  ok: { tono: 'ok', etiqueta: 'OK' },
  parcial: { tono: 'warn', etiqueta: 'Parcial' },
  saltado: { tono: 'neutral', etiqueta: 'Saltado' },
  fallo: { tono: 'bad', etiqueta: 'Fallo' },
};

type Fila = { cron: CronId; l: LatidoDetallado };

const COLUMNAS: ColumnaTabla<Fila>[] = [
  {
    id: 'reloj', titulo: 'Reloj', principal: true,
    celda: (x) => <>{NOMBRE_RELOJ[x.cron]}<span className="adm-sis-sub">{OFICIO_RELOJ[x.cron]}</span></>,
  },
  { id: 'cadencia', titulo: 'Cadencia', corta: true, celda: (x) => cadaCuanto(x.l.cadenciaMs) },
  { id: 'pulso', titulo: 'Pulso', celda: (x) => <StatusChip tono={CHIP_SALUD[x.l.estado].tono}>{CHIP_SALUD[x.l.estado].etiqueta}</StatusChip> },
  {
    id: 'ultimo', titulo: 'Último latido',
    // La fecha exacta ARRIBA y el «hace» debajo: el «hace» se lee de un golpe, la fecha es la que se pega en un reporte.
    celda: (x) => <>{x.l.ultimoLatido === null ? '—' : fechaHoraMx(x.l.ultimoLatido)}<span className="adm-sis-sub">{desdeHace(x.l.haceMin)}</span></>,
  },
  {
    id: 'resultado', titulo: 'Cómo le fue',
    celda: (x) => (x.l.ultimoEstado === null ? '—' : <StatusChip tono={CHIP_ULTIMO[x.l.ultimoEstado]?.tono ?? 'neutral'}>{CHIP_ULTIMO[x.l.ultimoEstado]?.etiqueta ?? x.l.ultimoEstado}</StatusChip>),
  },
  {
    id: 'porque', titulo: 'Por qué',
    celda: (x) => { const p = porQueNoCorrio(x.l); return p.causa === 'ninguna' ? '—' : p.texto; },
  },
];

export function VistaCrons({ latidos }: { latidos: Record<CronId, LatidoDetallado> | null }) {
  const lista: Fila[] = latidos === null ? [] : CRONS.map((c) => ({ cron: c, l: latidos[c] }));
  const { sinLatir, conFallo, parciales } = resumenRelojes(lista);
  const malos = [...sinLatir, ...conFallo];
  const guias = lista.map((x) => guiaDeArreglo(x.cron, x.l)).filter((g) => g !== null);
  const nombres = (ids: CronId[]) => ids.map((c) => NOMBRE_RELOJ[c]).join(', ');

  return (
    <MarcoPagina titulo="Relojes" apoyo="Los procesos programados del sistema: cuándo latieron por última vez y, si no corrieron, por qué.">
      {latidos === null ? (
        <EstadoError reintentar>No se pudo leer el pulso de los relojes: la base no respondió. Esto NO significa que estén corriendo: significa que ahora mismo no se sabe.</EstadoError>
      ) : (
        <>
          {/* El rótulo cuenta lo MEDIDO, no una meta. `CRONS.length` sale de la misma constante que vercel.json cruza en `salud.test.ts`. */}
          {malos.length === 0 ? (
            <Aviso tono={parciales.length > 0 ? 'warn' : 'ok'} titulo={`Los ${CRONS.length} relojes latieron dentro de su cadencia`}>
              Ninguno reportó fallo en su última corrida.
              {parciales.length > 0 ? ` ${nombres(parciales)} ${parciales.length === 1 ? 'reportó' : 'reportaron'} corrida parcial: el detalle está abajo.` : ''}
            </Aviso>
          ) : (
            <Aviso tono="error" titulo="Hay relojes que necesitan atención">
              {sinLatir.length > 0 ? <><strong>{sinLatir.length}</strong> de {CRONS.length} relojes no están latiendo como deberían: {nombres(sinLatir)}. </> : null}
              {conFallo.length > 0 ? <>{conFallo.length === 1 ? 'Un reloj late' : `${conFallo.length} relojes laten`} a tiempo pero su última corrida reportó <strong>fallo</strong>: {nombres(conFallo)}.</> : null}
            </Aviso>
          )}

          {guias.length > 0 ? (
            <section className="adm-sis-bloque" aria-labelledby="que-falta">
              <h2 className="adm-sis-titulo" id="que-falta">Qué falta para que corran completos</h2>
              {guias.map((g) => (
                <Aviso key={g.cron} tono="warn" titulo={NOMBRE_RELOJ[g.cron]}>
                  {g.queFalta} {g.quien}
                  <Disclosure titulo="Cómo arreglarlo" variante="linea">
                    <ol className="adm-sis-guia">
                      {g.pasos.map((p) => <li key={p}>{p}</li>)}
                    </ol>
                    {g.dicho ? <p className="adm-sis-nota">Lo que el reloj dejó dicho: {g.dicho}</p> : null}
                  </Disclosure>
                </Aviso>
              ))}
            </section>
          ) : null}

          <section className="adm-sis-bloque" aria-labelledby="relojes-uno-por-uno">
            <h2 className="adm-sis-titulo" id="relojes-uno-por-uno">Uno por uno</h2>
            <TablaLista<Fila>
              etiqueta="Relojes del sistema, uno por uno" columnas={COLUMNAS} filas={lista} idFila={(x) => x.cron} base="/admin/crons" params={{}}
            />
            <p className="adm-sis-nota">
              El pulso lo escribe cada reloj al terminar. Aquí no se dispara ninguno a mano: el reloj de Vercel no se entera y varios reservan filas, así que dos pasadas a la vez se pisan.
              Para apagar uno, su palanca está en Observabilidad.
            </p>
          </section>
        </>
      )}
    </MarcoPagina>
  );
}
