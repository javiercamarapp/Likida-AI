import Link from 'next/link';
import {
  Play, Power, PowerOff, GitPullRequest, Inbox, ListChecks, Image as ImageIcon, Bot,
} from 'lucide-react';
// SOLO tipos: lib/admin/bus importa supabaseAdmin y no debe entrar al bundle.
import type { EstadoBus, ResultadoPrs, RutinaBus } from '@/lib/admin/bus';
import { totalEscalacionesLegible, type BandejaEscalaciones } from '@/lib/admin/escalaciones';
import type { AgentesParados } from '@/lib/admin/agentes-parados';
import type { ResumenBandejaCola } from '@/lib/admin/cola-aprobacion';
import type { PiezaEnCola } from '@/lib/likida/agentes/cola';
import { fechaHoraMx, numero } from '@/lib/formato';
import {
  Aviso, Boton, BotonEnlace, CampoTextarea, Disclosure, EstadoVacio, FilaTarjetas, MarcoPagina, StatusChip, TablaBase, Tarjeta,
  clasesBoton, type ColumnaBase,
} from '../../ui-v2/componentes';
import { BotonConfirmar } from '../../ui-v2/componentes/confirmar';
import { TiraCifras } from '../../ui-v2/graficas';
import { contarPorCausa, etiquetaCausa } from '../escalaciones/agentes-parados';
import { BotonEnvio } from './boton_envio';
import '../bandeja.css';

const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

/** El tope de piezas pendientes que trae `leerEstadoBus` (lib/admin/bus.ts).
 *  Se declara aquí porque es la vista quien tiene que confesarlo: con la cola
 *  llena, "(50)" se lee como el total del buzón (FE-13). */
const TOPE_PIEZAS = 50;

/** "hace 3 h" — mismo formato que la bandeja de escalaciones. */
function edadDe(desdeIso: string, ahora: number): string {
  const horas = (ahora - new Date(desdeIso).getTime()) / 3_600_000;
  if (Number.isNaN(horas)) return '—';
  if (horas < 1) return 'hace menos de 1 h';
  if (horas < 48) return `hace ${Math.floor(horas)} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

const NOMBRE_ORDEN: Record<string, string> = {
  correr_ahora: 'correr ahora',
  kill_switch_on: 'apagar todas',
  kill_switch_off: 'encender todas',
  editar_encargo: 'editar encargo',
  nota: 'nota',
};

export type AccionForm = (fd: FormData) => Promise<void>;

/** El resumen de «Agentes que no corrieron» para Tu turno; el detalle y el porqué de cada uno viven en Escalaciones. */
function TarjetaAgentesParados({ parados, cola }: { parados: AgentesParados | null | undefined; cola: ResumenBandejaCola | null | undefined }) {
  if (parados === null || parados === undefined) {
    return (
      <Tarjeta titulo="Agentes que no corrieron" estado="error"
        mensaje="No se pudo leer el catálogo de agentes o sus corridas. No es que no haya agentes parados." />
    );
  }
  if (parados.parados.length === 0) {
    return (
      <Tarjeta titulo="Agentes que no corrieron" estado="vacio" mensaje="Ningún agente parado"
        detalle={`Los ${numero(parados.habilitados)} agentes habilitados corrieron en las últimas ${numero(parados.umbralHoras)} h.`} />
    );
  }
  const causas = contarPorCausa(parados.parados).slice(0, 3);
  return (
    <Tarjeta titulo="Agentes que no corrieron"
      acciones={<BotonEnlace href="/admin/escalaciones#agentes-parados" variante="secondary" tamano="sm">Ver cuáles y por qué</BotonEnlace>}>
      <ul className="bj-lista">
        <li>
          <span className="bj-lista__texto">
            {numero(parados.parados.length)} de {numero(parados.habilitados)} agentes habilitados llevan más de {numero(parados.umbralHoras)} h sin correr
          </span>
        </li>
        {causas.map((c) => (
          <li key={c.causa ?? 'sin-dato'}>
            <span className="bj-lista__texto">{etiquetaCausa(c.causa) ?? 'Sin dato del motivo'}</span>
            <span className="bj-lista__apoyo">{numero(c.n)}</span>
          </li>
        ))}
      </ul>
      {cola?.frenaAlRunner && (
        <Aviso tono="error" titulo="La bandeja de aprobación los frena."
          acciones={<BotonEnlace href="/admin/aprobaciones" variante="secondary" tamano="sm">Ir a Aprobaciones</BotonEnlace>}>
          {numero(cola.pendientes)} piezas pendientes esperan tu decisión; el tope del runner no se toca.
        </Aviso>
      )}
    </Tarjeta>
  );
}

/**
 * La VISTA de "Tu turno" — todo el cuerpo de la bandeja, sin auth ni fetch
 * (eso vive en page.tsx). Server component a propósito: los formularios usan
 * server actions que llegan por props, patrón de agentes/peajes.
 */
export function VistaTuTurno({
  bus, escalaciones, envios, prs, ahora, aviso, error, sesionNombre,
  accionPieza, accionOrden, parados, cola,
}: {
  bus: EstadoBus;
  escalaciones: BandejaEscalaciones;
  envios: PiezaEnCola[];
  prs: ResultadoPrs;
  ahora: number;
  aviso?: string;
  error?: string;
  sesionNombre: string;
  accionPieza: AccionForm;
  accionOrden: AccionForm;
  /** «Agentes que no corrieron» (`getAgentesParados`); `null` = no se pudo leer, `undefined` = la página no lo pidió. */
  parados?: AgentesParados | null;
  cola?: ResumenBandejaCola | null;
}) {
  // ADM-4: tres de las seis fuentes vienen topadas; el total sale de los conteos REALES. Lectura caída = null («—»), nunca 0.
  const totalEscalaciones = totalEscalacionesLegible(escalaciones);
  const piezasSinDato = bus.errores.some((e) => /pieza/i.test(e));

  const columnasRutinas: ColumnaBase<RutinaBus>[] = [
    { id: 'rutina', titulo: 'Rutina', principal: true, celda: (r) => r.nombre },
    { id: 'horario', titulo: 'Horario', celda: (r) => r.horario || '—' },
    { id: 'ultima', titulo: 'Última corrida', celda: (r) => (r.ultimaCorrida ? fechaHoraMx(r.ultimaCorrida.inicio) : 'sin corridas en el bus') },
    {
      id: 'veredicto', titulo: 'Veredicto',
      celda: (r) => (r.ultimaCorrida ? (
        <>
          {r.ultimaCorrida.exitCode !== null && (
            <StatusChip tono={r.ultimaCorrida.exitCode === 0 ? 'ok' : 'bad'}>{r.ultimaCorrida.exitCode === 0 ? 'ok' : `exit ${r.ultimaCorrida.exitCode}`}</StatusChip>
          )}{' '}
          {r.ultimaCorrida.veredicto ?? '—'}
          {r.ultimaCorrida.prUrl && <>{' '}<a href={r.ultimaCorrida.prUrl} target="_blank" rel="noreferrer">PR</a></>}
        </>
      ) : '—'),
    },
    {
      id: 'accion', titulo: 'Acción', alinear: 'der',
      celda: (r) => (
        <form action={accionOrden}>
          <input type="hidden" name="tipo" value="correr_ahora" />
          <input type="hidden" name="rutina" value={r.nombre} />
          <BotonEnvio><Play {...ICONO} /> Correr ahora</BotonEnvio>
        </form>
      ),
    },
  ];

  return (
    <MarcoPagina titulo="Tu turno" apoyo="Todo lo que espera tu decisión, de todas las fuentes.">
      {aviso && <Aviso tono="ok">{aviso}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}
      {bus.errores.length > 0 && (
        <Aviso tono="warn" titulo="Fuentes que no se pudieron leer (no son ceros).">{bus.errores.join(' · ')}</Aviso>
      )}

      {/* Cifras REALES de lo que espera a un humano. Una fuente que no se pudo leer es «—», no un cero. */}
      <TiraCifras
        etiqueta="Lo que espera tu turno"
        items={[
          {
            etiqueta: 'Piezas para tu tap', icono: <ImageIcon {...ICONO} />, formato: 'entero',
            valor: piezasSinDato ? null : bus.piezasPendientes.length,
            nota: piezasSinDato ? 'No se pudo leer la cola de piezas' : bus.piezasPendientes.length >= TOPE_PIEZAS ? `Se cuentan las ${TOPE_PIEZAS} más recientes; hay más detrás` : undefined,
          },
          { etiqueta: 'Envíos por aprobar', icono: <ListChecks {...ICONO} />, valor: envios.length, formato: 'entero' },
          {
            etiqueta: 'PRs esperando tu merge', icono: <GitPullRequest {...ICONO} />, formato: 'entero',
            valor: prs.estado === 'ok' ? prs.prs.length : null,
            nota: prs.estado === 'ok' ? undefined : prs.estado === 'sin_token' ? 'Falta el acceso a GitHub' : 'GitHub no contestó',
          },
          {
            etiqueta: 'Escalaciones', icono: <Inbox {...ICONO} />, valor: totalEscalaciones, formato: 'entero',
            nota: totalEscalaciones === null ? 'No se pudo leer ninguna fuente' : undefined,
          },
        ]}
      />

      {/* ── 1 · Piezas de las rutinas — el tap de publicar ────────────────── */}
      <section className="bj-bloque" aria-labelledby="tt-piezas">
        {/* FE-13: `leerEstadoBus` trae 50 piezas pendientes como tope. Con la cola llena, "(50)" se lee como el total. */}
        <h2 className="bj-titulo" id="tt-piezas">
          Piezas para tu tap ({bus.piezasPendientes.length}{bus.piezasPendientes.length >= TOPE_PIEZAS ? '+' : ''})
        </h2>
        {bus.piezasPendientes.length >= TOPE_PIEZAS && (
          <p className="bj-nota">Se listan las {TOPE_PIEZAS} más recientes — hay más esperando detrás.</p>
        )}
        {bus.piezasPendientes.length === 0 ? (
          <EstadoVacio titulo="No hay piezas esperando">
            Las rutinas de la Mac las suben aquí al terminar (si la Mac aún no corre el bus, instala <code>bus.sh</code> — ver el esqueleto de autonomía).
          </EstadoVacio>
        ) : (
          <div className="bj-piezas">
            {bus.piezasPendientes.map((p) => (
              <article key={p.id} className="bj-pieza">
                <div className="bj-pieza__marco">
                  {p.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL firmada de storage, dominio propio
                    <img src={p.mediaUrl} alt={p.titulo} loading="lazy" />
                  ) : (
                    <span><ImageIcon {...ICONO} /> Sin imagen</span>
                  )}
                </div>
                <div className="bj-pieza__cuerpo">
                  <div className="bj-pieza__meta">
                    <StatusChip tono="neutral">{p.tipo}</StatusChip>
                    <span>{p.rutina}</span>
                    <span className="bj-pieza__edad">{edadDe(p.creadoEn, ahora)}</span>
                  </div>
                  <h3 className="bj-pieza__titulo" title={p.titulo}>{p.titulo}</h3>
                  {p.copyMd && (
                    <details className="bj-pieza__copy">
                      <summary>Ver el copy</summary>
                      <pre>{p.copyMd}</pre>
                    </details>
                  )}
                  <div className="bj-pieza__acciones">
                    {/* Acción principal sólida y secundaria discreta: aprobar publica, descartar no. */}
                    <form action={accionPieza}>
                      <input type="hidden" name="pieza" value={p.id} />
                      <input type="hidden" name="accion" value="aprobada" />
                      <Boton type="submit" variante="primary" tamano="sm">Aprobar</Boton>
                    </form>
                    <form action={accionPieza}>
                      <input type="hidden" name="pieza" value={p.id} />
                      <input type="hidden" name="accion" value="descartada" />
                      <Boton type="submit" variante="ghost" tamano="sm">Descartar</Boton>
                    </form>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <FilaTarjetas variante="6-6">
        {/* ── 2 · Envíos redactados (0117) — dinero directo, se resuelven en Aprobaciones ─ */}
        <Tarjeta
          titulo={`Envíos por aprobar (${envios.length})`}
          estado={envios.length === 0 ? 'vacio' : 'ok'} mensaje="Nada redactado esperando tu firma"
          acciones={<BotonEnlace href="/admin/aprobaciones" variante="secondary" tamano="sm">Revisar y aprobar en la cola</BotonEnlace>}
        >
          <ul className="bj-lista">
            {envios.slice(0, 5).map((p) => (
              <li key={p.id}>
                <StatusChip tono={p.prioridad === 'urgente' ? 'warn' : 'neutral'}>{p.prioridad}</StatusChip>
                <span className="bj-lista__texto">{p.titulo}</span>
                <span className="bj-lista__apoyo">{p.prospectoEmpresa ?? p.agente}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>

        {/* ── 4 · Escalaciones — el top; la cola completa vive en su pantalla ── */}
        <Tarjeta
          titulo={`Escalaciones (${totalEscalaciones === null ? '—' : totalEscalaciones})`}
          estado={totalEscalaciones === null ? 'error' : totalEscalaciones === 0 ? 'vacio' : 'ok'}
          mensaje={totalEscalaciones === null ? 'No se pudo leer ninguna fuente de escalaciones. No es cero.' : 'Nada escalado a un humano ahora mismo'}
          acciones={<BotonEnlace href="/admin/escalaciones" variante="secondary" tamano="sm">La cola completa</BotonEnlace>}
        >
          <ul className="bj-lista">
            {escalaciones.cola.slice(0, 5).map((it, i) => (
              <li key={`${it.fuente}-${i}`}>
                <StatusChip tono={it.vence && new Date(it.vence).getTime() < ahora ? 'bad' : 'neutral'}>{it.fuente}</StatusChip>
                {it.href ? <Link className="bj-lista__texto" href={it.href}>{it.titulo}</Link> : <span className="bj-lista__texto">{it.titulo}</span>}
                <span className="bj-lista__apoyo">{edadDe(it.desde, ahora)}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      </FilaTarjetas>

      <FilaTarjetas variante="6-6">
        {/* ── 3 · PRs — la aprobación de CÓDIGO es el merge, no un botón aquí ── */}
        {prs.estado === 'sin_token' ? (
          <Tarjeta titulo="PRs esperando tu merge" estado="vacio" mensaje="Falta la llave de GitHub"
            detalle="Sin GITHUB_TOKEN en Vercel esta sección no puede ver los PRs — es una de tus llaves pendientes, no un cero." />
        ) : prs.estado === 'error' ? (
          <Tarjeta titulo="PRs esperando tu merge" estado="error"
            mensaje="GitHub no contestó — no se sabe cuántos PRs esperan (que no es lo mismo que ninguno)." />
        ) : (
          <Tarjeta titulo="PRs esperando tu merge" estado={prs.prs.length === 0 ? 'vacio' : 'ok'} mensaje="No hay PRs abiertos">
            <ul className="bj-lista">
              {prs.prs.map((pr) => (
                <li key={pr.numero}>
                  <GitPullRequest {...ICONO} aria-hidden="true" />
                  <a className="bj-lista__texto" href={pr.url} target="_blank" rel="noreferrer">#{pr.numero} · {pr.titulo}</a>
                  <span className="bj-lista__apoyo">{edadDe(pr.creadoEn, ahora)}</span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}

        {/* ── Agentes que no corrieron y por qué (P0 de visibilidad) ──────── */}
        <TarjetaAgentesParados parados={parados} cola={cola} />
      </FilaTarjetas>

      {/* ── 5 · Las rutinas de la Mac — estado y mando ───────────────────── */}
      <section className="bj-bloque" aria-labelledby="tt-rutinas">
        <div className="bj-titulo-fila">
          <h2 className="bj-titulo" id="tt-rutinas">Rutinas de la Mac ({bus.rutinas.length})</h2>
          <div className="bj-acciones">
            <form action={accionOrden}>
              <input type="hidden" name="tipo" value="kill_switch_on" />
              {/* A37-S08-03: un toque accidental apagaba TODAS las rutinas. */}
              <BotonConfirmar
                etiqueta="Apagar todas" icono={<PowerOff {...ICONO} />} tono="peligro"
                etiquetaConfirmar="Sí, apagar todas" titulo="Apagar todas las rutinas"
                descripcion={`Se encola la orden de apagado: la Mac detiene las ${bus.rutinas.length} rutinas en su siguiente latido (≤5 min) hasta que las enciendas.`}
                className={clasesBoton('danger', 'sm')}
              />
            </form>
            <form action={accionOrden}>
              <input type="hidden" name="tipo" value="kill_switch_off" />
              <BotonConfirmar
                etiqueta="Encender todas" icono={<Power {...ICONO} />} tono="normal"
                etiquetaConfirmar="Sí, encender todas" titulo="Encender todas las rutinas"
                descripcion={`Se encola la orden de encendido: la Mac reactiva las ${bus.rutinas.length} rutinas en su siguiente latido (≤5 min). Pueden gastar modelo y publicar.`}
                className={clasesBoton('secondary', 'sm')}
              />
            </form>
          </div>
        </div>
        {bus.killSwitchPendiente && (
          <p className="bj-nota">Hay una orden de apagado/encendido esperando el latido de la Mac.</p>
        )}
        {bus.rutinas.length === 0 ? (
          <EstadoVacio titulo="Sin rutinas sembradas" icono={Bot}>
            La Mac aún no siembra el catálogo — corre <code>bus.sh sembrar-catalogo</code> una vez.
          </EstadoVacio>
        ) : (
          <>
            <TablaBase etiqueta="Rutinas programadas" columnas={columnasRutinas} filas={bus.rutinas} idFila={(r) => r.nombre} densa />
            {/* ── EL EDITOR DE RUTINAS (Fase D, cerrado 17-ago-2026) ────────
                El encargo se edita AQUÍ y viaja como orden editar_encargo: la Mac abre un PR chico con el cambio — jamás escritura
                directa. Solo rutinas con encargo sembrado se pueden editar (sin el texto original no hay qué pre-llenar ni qué PR). */}
            {bus.rutinas.filter((r) => r.encargoMd).map((r) => (
              <Disclosure key={`ed-${r.nombre}`} titulo={`Editar encargo · ${r.nombre}`}>
                <form action={accionOrden} className="bj-item__forma">
                  <input type="hidden" name="tipo" value="editar_encargo" />
                  <input type="hidden" name="rutina" value={r.nombre} />
                  <CampoTextarea etiqueta={`Encargo de ${r.nombre}`} etiquetaOculta name="contenido" defaultValue={r.encargoMd} required maxLength={20000} rows={12} />
                  <div className="bj-item__fila">
                    <BotonEnvio variante="primary">Encolar el cambio (la Mac abre el PR)</BotonEnvio>
                    <p className="bj-nota">Nada se escribe directo: apruebas el PR en GitHub y el sembrado nocturno actualiza el catálogo.</p>
                  </div>
                </form>
              </Disclosure>
            ))}
          </>
        )}
      </section>

      {/* ── 6 · Órdenes recientes — el acuse de la Mac ───────────────────── */}
      <Tarjeta titulo="Órdenes recientes" estado={bus.ordenesRecientes.length === 0 ? 'vacio' : 'ok'} mensaje="Aún no has ordenado nada por el bus">
        <ul className="bj-lista">
          {bus.ordenesRecientes.map((o) => (
            <li key={o.id}>
              <StatusChip tono={o.estado === 'hecha' ? 'ok' : o.estado === 'fallida' ? 'bad' : 'neutral'}>{o.estado}</StatusChip>
              <span>{NOMBRE_ORDEN[o.tipo] ?? o.tipo}{o.rutina ? ` · ${o.rutina}` : ''}</span>
              <span className="bj-lista__apoyo">{edadDe(o.creadoEn, ahora)}</span>
              {o.resultado && <span className="bj-lista__texto bj-lista__apoyo">— {o.resultado}</span>}
            </li>
          ))}
        </ul>
      </Tarjeta>

      <p className="bj-nota">
        Sesión: {sesionNombre} · Las órdenes las ejecuta la Mac en su latido (≤5 min) y firma el
        resultado aquí. Esta pantalla nunca toca la Mac directo.
      </p>
    </MarcoPagina>
  );
}
