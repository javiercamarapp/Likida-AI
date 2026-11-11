import Link from 'next/link';
import { Aviso, AvisoCompacto, BotonEnlace, Disclosure, StatusChip, Tarjeta, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import { fechaHoraMx, numero, porcentaje, usd } from '@/lib/formato';
import {
  armarTuTurno, filasCalidad, semaforoSalud, ROTULO_ESTADO_REAL, TONO_ESTADO_REAL, MAX_TU_TURNO, type FilaCalidad,
} from '@/lib/admin/centro-mando';
import { agentePorId } from '@/lib/likida/agentes/notificaciones';
import { NOMBRE_NIVEL } from '@/lib/likida/agentes/autonomia';
import { ahoraMs } from '@/lib/saludo';
import { getT } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { QuemaSlo } from './quema-slo';
import { quema, calidadAgentes, costoIaMes, despliegues, entradaSemaforo, entradaTuTurno, parados, resumenNegocio, slos } from './resumen-lecturas';
import './resumen.css';

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUES DEL CENTRO DE MANDO (PLAN §10.1). Cada uno lee lo suyo y va en su propio <Suspense> (`consola.tsx`): uno lento no bloquea a
// los demás. Una lectura caída se DICE («No disponible ahora. No es cero.»), jamás se pinta como 0 ni como «todo bien».
// ═══════════════════════════════════════════════════════════════════════════

const TONO_AVISO = { verde: 'ok', amarillo: 'warn', rojo: 'error' } as const;

/** 1. ¿Estoy bien? Verde, amarillo o rojo, con la causa y a dónde ir. */
export async function BloqueSemaforo() {
  const { t: ta } = await getT('admin_inicio');
  const s = semaforoSalud(await entradaSemaforo());
  const guardia = s.guardiaHaceMin !== null ? ta('resumen_mando.guardia_hace_min', { guardiaHaceMin: numero(s.guardiaHaceMin) }) : ta('resumen_mando.guardia_sin_dato');
  if (s.causas.length === 0) {
    return (
      <Aviso tono={TONO_AVISO[s.nivel]} titulo={s.titulo} acciones={<StatusChip tono={s.guardiaHaceMin !== null ? 'neutral' : 'muted'}>{guardia}</StatusChip>}>
        
        {ta('resumen_mando.ninguna_alarma_viva_y')}
      </Aviso>
    );
  }
  // Aviso COMPACTO: la frase de estado y cuántas señales son; la lista completa (puede traer decenas de nombres) queda plegada.
  const n = s.causas.length;
  return (
    <AvisoCompacto
      tono={TONO_AVISO[s.nivel]}
      resumen={<><strong>{s.titulo}.</strong> {n === 1 ? ta('resumen_mando.una_senal_pide_revision') : ta('resumen_mando.senales_piden_revision', { n: numero(n) })}</>}
      etiquetaMas={n === 1 ? ta('resumen_mando.ver_el_detalle') : ta('resumen_mando.ver_las_senales', { n: numero(n) })}
      mas={(
        <>
          <ul className="adm-res-semaforo-causas">
            {s.causas.map((c) => <li key={c.texto}>{c.texto} <Link href={c.href}>{ta('resumen.ver')}</Link></li>)}
          </ul>
          <p className="adm-res-pie">{guardia}</p>
        </>
      )}
    />
  );
}

/** 2. ¿Qué espera mi decisión? Máximo 5 filas, la más urgente arriba. */
export async function BloqueTuTurno() {
  const { t: ta } = await getT('admin_inicio');
  const t = armarTuTurno(await entradaTuTurno(), ahoraMs());
  if (t.filas.length === 0 && t.ciegas.length > 0) {
    return <Tarjeta titulo={ta('resumen_mando.tu_turno')} estado="error" mensaje={ta('resumen_mando.no_se_pudo_leer', { ciegas: t.ciegas.join(', ') })} reintentar />;
  }
  if (t.filas.length === 0) {
    return <Tarjeta titulo={ta('resumen_mando.tu_turno')} estado="vacio" mensaje={ta('resumen_mando.nada_espera_tu_decision')} detalle={ta('resumen_mando.cuando_algo_necesite_tu')} />;
  }
  return (
    <Tarjeta titulo={ta('resumen_mando.tu_turno')} elevar entra="tarjeta" acciones={<BotonEnlace tamano="sm" variante="ghost" href="/admin/tu-turno">{ta('resumen_mando.ver_todo')}</BotonEnlace>}>
      <ul className="adm-res-lista">
        {t.filas.map((f) => (
          <li key={f.clave} className="adm-res-fila">
            <div className="adm-res-fila__texto">
              <span className="adm-res-fila__titulo">{f.titulo}</span>
              {f.detalle ? <span className="adm-res-fila__detalle">{f.detalle}</span> : null}
            </div>
            <StatusChip tono={f.urgencia === 'neutral' ? 'neutral' : f.urgencia}>{f.etiqueta}</StatusChip>
            {f.href ? <BotonEnlace tamano="sm" variante="secondary" href={f.href}>{f.accion}</BotonEnlace> : <StatusChip tono="muted">{ta('resumen_mando.sin_pantalla')}</StatusChip>}
          </li>
        ))}
      </ul>
      {t.total > MAX_TU_TURNO ? <p className="adm-res-pie">{ta('resumen.mostrando_de', { max: MAX_TU_TURNO, total: numero(t.total) })}</p> : null}
      {t.ciegas.length > 0 ? <p className="adm-res-pie">{ta('resumen.no_leer_mas', { ciegas: t.ciegas.join(', ') })}</p> : null}
    </Tarjeta>
  );
}

/** 4. ¿Qué pasó con el dinero? Gasto de IA, con lo que no se mide dicho como tal. */
export async function BloqueCaja() {
  const { t: ta } = await getT('admin_inicio');
  const [r, mes] = await Promise.all([resumenNegocio(), costoIaMes()]);
  if (r === null && mes === null) return <Tarjeta titulo={ta('resumen_mando.caja_y_clientes')} estado="error" reintentar />;
  return (
    <Tarjeta titulo={ta('resumen_mando.caja_y_clientes')} elevar entra="tarjeta">
      <dl className="adm-res-pares">
        <dt>{mes ? ta('resumen_mando.gasto_de_ia_en', { etiquetaMes: mes.etiquetaMes }) : ta('resumen_mando.gasto_de_ia_del')}</dt>
        <dd>{mes ? usd(mes.mesUsd) : '—'}</dd>
        <dt>{ta('resumen_mando.gasto_de_ia_historico')}</dt>
        <dd>{r ? usd(r.costoIaUsd) : '—'}</dd>
        <dt>{ta('resumen_mando.costo_de_ia_por')}</dt>
        <dd>{ta('resumen.sin_medir')}</dd>
        <dt>{ta('resumen_mando.cobranza_vencida')}</dt>
        <dd>{ta('resumen.sin_medir')}</dd>
      </dl>
      <p className="adm-res-pie">
        {r && r.tendenciaCosto !== null ? ta('resumen_mando.tendencia_semanal_del_costo', { tendenciaCosto: r.tendenciaCosto > 0 ? '+' : '', tendenciaCosto2: r.tendenciaCosto }) : ''}
        
        {ta('resumen_mando.lo_que_dice_sin')}
        {' '}<Link href="/admin/costos-facturacion">{ta('resumen_mando.ver_costos_de_ia')}</Link>
      </p>
    </Tarjeta>
  );
}

const pctRevision = (v: number | null, ta: TrDe<'admin_inicio'>) => (v === null ? ta('resumen.sin_medir') : porcentaje(v * 100, 0));
const msP95 = (v: number | null, ta: TrDe<'admin_inicio'>) => (v === null ? ta('resumen.sin_medir') : v >= 1000 ? `${numero(Math.round(v / 100) / 10)} s` : `${numero(v)} ms`);

const columnasCalidad = (ta: TrDe<'admin_inicio'>): ColumnaBase<FilaCalidad>[] => [
  { id: 'agente', titulo: ta('resumen_mando.agente'), principal: true, celda: (f) => f.nombre },
  { id: 'nivel', titulo: ta('resumen_mando.autonomia'), celda: (f) => <span title={NOMBRE_NIVEL[f.nivel]}>{f.nivel} · {NOMBRE_NIVEL[f.nivel]}</span> },
  { id: 'estado', titulo: ta('resumen_mando.estado_real'), celda: (f) => <StatusChip tono={TONO_ESTADO_REAL[f.estado]}>{ROTULO_ESTADO_REAL[f.estado]}</StatusChip> },
  { id: 'revision', titulo: ta('resumen_mando.revision_humana'), alinear: 'der', celda: (f) => pctRevision(f.revisionHumana, ta) },
  { id: 'p95', titulo: 'p95 de corrida', alinear: 'der', celda: (f) => msP95(f.p95Ms, ta) },
  { id: 'corridas', titulo: ta('resumen_mando.corridas_30_d'), alinear: 'der', celda: (f) => (f.corridas === null ? ta('resumen.sin_dato') : numero(f.corridas)) },
];

/** 5. ¿Quién trabaja bien? Una fila por agente; lo que no se mide dice «sin medir». */
export async function BloqueCalidad() {
  const { t: ta } = await getT('admin_inicio');
  const [cal, p] = await Promise.all([calidadAgentes(), parados()]);
  const filas = filasCalidad(cal ? cal.agentes : null, p ? p.parados : null, (id) => agentePorId(id)?.nombre ?? null);
  const ilegible = cal === null && p === null;
  return (
    <section aria-labelledby="res-calidad">
      <h2 id="res-calidad" className="rv-recuadro-tit__texto">{ta('resumen_mando.calidad_de_los_agentes')}</h2>
      {cal && cal.errores.length > 0 ? <AvisoCompacto tono="warn" resumen="Alguna fuente de calidad no se pudo leer: sus columnas dicen «sin dato», no cero." /> : null}
      <TablaBase
        etiqueta={ta('resumen_mando.calidad_de_los_agentes')}
        columnas={columnasCalidad(ta)}
        filas={filas}
        idFila={(f) => f.agente}
        estado={ilegible ? 'error' : 'ok'}
        mensajeError="No disponible ahora. No es cero."
        vacio={{ titulo: ta('resumen_mando.sin_agentes_medidos'), texto: ta('resumen_mando.aparecen_aqui_cuando_corren') }}
        densa tarjetaMovil
      />
    </section>
  );
}

/** 6. Plataforma y qué cambió: plegado, para correlacionar causas. */
export async function BloquePlataforma() {
  const { t: ta } = await getT('admin_inicio');
  const [s, d, q, { t: tMon }] = await Promise.all([slos(), despliegues(), quema(), getT('monitoreo')]);
  return (
    <Disclosure titulo={ta('resumen_mando.plataforma_y_que_cambio')} resumen={d.estado === 'ok' ? ta('resumen_mando.despliegues_en_30_dias', { length: d.anotaciones.length }) : ta('resumen_mando.despliegues_sin_medir')}>
      <h3 className="rv-recuadro-tit__texto">{ta('resumen_mando.objetivos_de_servicio')}</h3>
      {s === null ? <p className="adm-res-pie">{ta('resumen_mando.no_disponible_ahora_no')}</p> : (
        <ul className="adm-res-lista">
          {s.map((x) => (
            <li key={x.clave} className="adm-res-fila">
              <div className="adm-res-fila__texto">
                <span className="adm-res-fila__titulo">{x.nombre}</span>
                <span className="adm-res-fila__detalle">Objetivo {x.objetivo} · {x.medido} · {x.ventana}</span>
              </div>
              <StatusChip tono={x.cumple === null ? 'muted' : x.cumple ? 'ok' : 'bad'}>{x.cumple === null ? ta('resumen_mando.sin_muestra') : x.cumple ? ta('resumen_mando.cumple') : ta('resumen_mando.no_cumple')}</StatusChip>
            </li>
          ))}
        </ul>
      )}
      <QuemaSlo evaluaciones={q} t={tMon} />
      <h3 className="rv-recuadro-tit__texto">{ta('resumen_mando.despliegues_recientes')}</h3>
      {d.estado === 'ok' ? (
        <ul className="adm-res-lista">
          {d.anotaciones.slice(0, 5).map((a) => (
            <li key={a.sha} className="adm-res-fila">
              <div className="adm-res-fila__texto">
                <span className="adm-res-fila__titulo">{a.etiqueta}</span>
                <span className="adm-res-fila__detalle">{fechaHoraMx(a.instante)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="adm-res-pie">{d.nota}</p>
      <p className="adm-res-pie"><Link href="/admin/salud-sistema">{ta('resumen_mando.salud_del_sistema')}</Link> · <Link href="/admin/crons">Relojes</Link></p>
    </Disclosure>
  );
}
