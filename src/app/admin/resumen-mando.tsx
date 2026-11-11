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
  const s = semaforoSalud(await entradaSemaforo());
  const guardia = s.guardiaHaceMin !== null ? `Guardia: hace ${numero(s.guardiaHaceMin)} min` : 'Guardia: sin dato';
  if (s.causas.length === 0) {
    return (
      <Aviso tono={TONO_AVISO[s.nivel]} titulo={s.titulo} acciones={<StatusChip tono={s.guardiaHaceMin !== null ? 'neutral' : 'muted'}>{guardia}</StatusChip>}>
        Ninguna alarma viva y todas las fuentes se leyeron.
      </Aviso>
    );
  }
  // Aviso COMPACTO: la frase de estado y cuántas señales son; la lista completa (puede traer decenas de nombres) queda plegada.
  const n = s.causas.length;
  return (
    <AvisoCompacto
      tono={TONO_AVISO[s.nivel]}
      resumen={<><strong>{s.titulo}.</strong> {n === 1 ? 'Una señal pide revisión.' : `${numero(n)} señales piden revisión.`}</>}
      etiquetaMas={n === 1 ? 'Ver el detalle' : `Ver las ${numero(n)} señales`}
      mas={(
        <>
          <ul className="adm-res-semaforo-causas">
            {s.causas.map((c) => <li key={c.texto}>{c.texto} <Link href={c.href}>Ver</Link></li>)}
          </ul>
          <p className="adm-res-pie">{guardia}</p>
        </>
      )}
    />
  );
}

/** 2. ¿Qué espera mi decisión? Máximo 5 filas, la más urgente arriba. */
export async function BloqueTuTurno() {
  const t = armarTuTurno(await entradaTuTurno(), ahoraMs());
  if (t.filas.length === 0 && t.ciegas.length > 0) {
    return <Tarjeta titulo="Tu turno" estado="error" mensaje={`No se pudo leer: ${t.ciegas.join(', ')}.`} reintentar />;
  }
  if (t.filas.length === 0) {
    return <Tarjeta titulo="Tu turno" estado="vacio" mensaje="Nada espera tu decisión" detalle="Cuando algo necesite tu visto bueno aparece aquí, la más urgente primero." />;
  }
  return (
    <Tarjeta titulo="Tu turno" elevar entra="tarjeta" acciones={<BotonEnlace tamano="sm" variante="ghost" href="/admin/tu-turno">Ver todo</BotonEnlace>}>
      <ul className="adm-res-lista">
        {t.filas.map((f) => (
          <li key={f.clave} className="adm-res-fila">
            <div className="adm-res-fila__texto">
              <span className="adm-res-fila__titulo">{f.titulo}</span>
              {f.detalle ? <span className="adm-res-fila__detalle">{f.detalle}</span> : null}
            </div>
            <StatusChip tono={f.urgencia === 'neutral' ? 'neutral' : f.urgencia}>{f.etiqueta}</StatusChip>
            {f.href ? <BotonEnlace tamano="sm" variante="secondary" href={f.href}>{f.accion}</BotonEnlace> : <StatusChip tono="muted">Sin pantalla</StatusChip>}
          </li>
        ))}
      </ul>
      {t.total > MAX_TU_TURNO ? <p className="adm-res-pie">Mostrando {MAX_TU_TURNO} de {numero(t.total)}.</p> : null}
      {t.ciegas.length > 0 ? <p className="adm-res-pie">No se pudo leer: {t.ciegas.join(', ')}. Puede haber más pendientes.</p> : null}
    </Tarjeta>
  );
}

/** 4. ¿Qué pasó con el dinero? Gasto de IA, con lo que no se mide dicho como tal. */
export async function BloqueCaja() {
  const [r, mes] = await Promise.all([resumenNegocio(), costoIaMes()]);
  if (r === null && mes === null) return <Tarjeta titulo="Caja y clientes" estado="error" reintentar />;
  return (
    <Tarjeta titulo="Caja y clientes" elevar entra="tarjeta">
      <dl className="adm-res-pares">
        <dt>{mes ? `Gasto de IA en ${mes.etiquetaMes}` : 'Gasto de IA del mes'}</dt>
        <dd>{mes ? usd(mes.mesUsd) : '—'}</dd>
        <dt>Gasto de IA histórico</dt>
        <dd>{r ? usd(r.costoIaUsd) : '—'}</dd>
        <dt>Costo de IA por liquidación</dt>
        <dd>sin medir</dd>
        <dt>Cobranza vencida</dt>
        <dd>sin medir</dd>
      </dl>
      <p className="adm-res-pie">
        {r && r.tendenciaCosto !== null ? `Tendencia semanal del costo de IA: ${r.tendenciaCosto > 0 ? '+' : ''}${r.tendenciaCosto} %. ` : ''}
        Lo que dice «sin medir» no tiene todavía una fuente que lo calcule; no se rellena con ceros.
        {' '}<Link href="/admin/costos-facturacion">Ver costos de IA</Link>
      </p>
    </Tarjeta>
  );
}

const pctRevision = (v: number | null) => (v === null ? 'sin medir' : porcentaje(v * 100, 0));
const msP95 = (v: number | null) => (v === null ? 'sin medir' : v >= 1000 ? `${numero(Math.round(v / 100) / 10)} s` : `${numero(v)} ms`);

const COLUMNAS_CALIDAD: ColumnaBase<FilaCalidad>[] = [
  { id: 'agente', titulo: 'Agente', principal: true, celda: (f) => f.nombre },
  { id: 'nivel', titulo: 'Autonomía', celda: (f) => <span title={NOMBRE_NIVEL[f.nivel]}>{f.nivel} · {NOMBRE_NIVEL[f.nivel]}</span> },
  { id: 'estado', titulo: 'Estado real', celda: (f) => <StatusChip tono={TONO_ESTADO_REAL[f.estado]}>{ROTULO_ESTADO_REAL[f.estado]}</StatusChip> },
  { id: 'revision', titulo: 'Revisión humana', alinear: 'der', celda: (f) => pctRevision(f.revisionHumana) },
  { id: 'p95', titulo: 'p95 de corrida', alinear: 'der', celda: (f) => msP95(f.p95Ms) },
  { id: 'corridas', titulo: 'Corridas (30 d)', alinear: 'der', celda: (f) => (f.corridas === null ? 'sin dato' : numero(f.corridas)) },
];

/** 5. ¿Quién trabaja bien? Una fila por agente; lo que no se mide dice «sin medir». */
export async function BloqueCalidad() {
  const [cal, p] = await Promise.all([calidadAgentes(), parados()]);
  const filas = filasCalidad(cal ? cal.agentes : null, p ? p.parados : null, (id) => agentePorId(id)?.nombre ?? null);
  const ilegible = cal === null && p === null;
  return (
    <section aria-labelledby="res-calidad">
      <h2 id="res-calidad" className="rv-recuadro-tit__texto">Calidad de los agentes</h2>
      {cal && cal.errores.length > 0 ? <AvisoCompacto tono="warn" resumen="Alguna fuente de calidad no se pudo leer: sus columnas dicen «sin dato», no cero." /> : null}
      <TablaBase
        etiqueta="Calidad de los agentes"
        columnas={COLUMNAS_CALIDAD}
        filas={filas}
        idFila={(f) => f.agente}
        estado={ilegible ? 'error' : 'ok'}
        mensajeError="No disponible ahora. No es cero."
        vacio={{ titulo: 'Sin agentes medidos', texto: 'Aparecen aquí cuando corren o cuando se les envían piezas.' }}
        densa tarjetaMovil
      />
    </section>
  );
}

/** 6. Plataforma y qué cambió: plegado, para correlacionar causas. */
export async function BloquePlataforma() {
  const [s, d, q, { t: tMon }] = await Promise.all([slos(), despliegues(), quema(), getT('monitoreo')]);
  return (
    <Disclosure titulo="Plataforma y qué cambió" resumen={d.estado === 'ok' ? `${d.anotaciones.length} despliegues en 30 días` : 'despliegues sin medir'}>
      <h3 className="rv-recuadro-tit__texto">Objetivos de servicio</h3>
      {s === null ? <p className="adm-res-pie">No disponible ahora. No es cero.</p> : (
        <ul className="adm-res-lista">
          {s.map((x) => (
            <li key={x.clave} className="adm-res-fila">
              <div className="adm-res-fila__texto">
                <span className="adm-res-fila__titulo">{x.nombre}</span>
                <span className="adm-res-fila__detalle">Objetivo {x.objetivo} · {x.medido} · {x.ventana}</span>
              </div>
              <StatusChip tono={x.cumple === null ? 'muted' : x.cumple ? 'ok' : 'bad'}>{x.cumple === null ? 'Sin muestra' : x.cumple ? 'Cumple' : 'No cumple'}</StatusChip>
            </li>
          ))}
        </ul>
      )}
      <QuemaSlo evaluaciones={q} t={tMon} />
      <h3 className="rv-recuadro-tit__texto">Despliegues recientes</h3>
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
      <p className="adm-res-pie"><Link href="/admin/salud-sistema">Salud del sistema</Link> · <Link href="/admin/crons">Relojes</Link></p>
    </Disclosure>
  );
}
