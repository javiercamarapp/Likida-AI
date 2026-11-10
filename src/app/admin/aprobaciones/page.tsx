import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import {
  bandejaPendiente, aprobadasSinEnviar, ultimasResueltas,
  rebotesRecientes, correosSuprimidos,
  aprobarPieza, rechazarPieza, enviarPiezaPorCorreo, liberarEnvioAmbiguo,
  type PiezaEnCola,
} from '@/lib/likida/agentes/cola';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { fechaHoraMx } from '@/lib/formato';
import {
  contarVencidas, vaciarVencidas, leerResumenBandeja, normalizarParametros,
} from '@/lib/admin/cola-aprobacion';
import { ahoraMs } from '@/lib/saludo';
import { Aviso, MarcoPagina, StatusChip, Tarjeta } from '../../ui-v2/componentes';
import { FormaPieza, FormaEnvio, FormaLiberarAmbiguo, type ResultadoPieza } from './forma-pieza';
import { RebotesYBajas } from './rebotes';
import { LimpiezaLote, type ResultadoConteo, type ResultadoVaciado } from './lote';
import { VistasAprobaciones, type VistaAprobaciones } from './vistas';
import { leerEsperadas, leerParametrosLote } from './lote-parametros';
import '../bandeja.css';

export const dynamic = 'force-dynamic';

const VISTAS: readonly VistaAprobaciones[] = ['aprobar', 'enviar', 'historial'];

export default async function PaginaAprobaciones({ searchParams }: { searchParams?: Promise<{ vista?: string }> } = {}) {
  await requireSuperadmin();
  const sp = (await searchParams) ?? {};
  const inicial: VistaAprobaciones = VISTAS.find((v) => v === sp.vista) ?? 'aprobar';

  // Cada lectura cae POR SU LADO: la urgente caída no esconde la normal ni
  // al revés, y "no se pudo leer" jamás se pinta como "no hay nada".
  const [urgente, normal, porEnviar, resueltas, rebotes, suprimidos, estadoBandeja] = await Promise.all([
    bandejaPendiente('urgente').then((p) => ({ ok: p as PiezaEnCola[] | null, error: null as string | null })).catch((e) => ({ ok: null, error: String(e instanceof Error ? e.message : e) })),
    bandejaPendiente('normal').then((p) => ({ ok: p as PiezaEnCola[] | null, error: null as string | null })).catch((e) => ({ ok: null, error: String(e instanceof Error ? e.message : e) })),
    aprobadasSinEnviar().catch(() => null),
    ultimasResueltas(8).catch(() => null),
    // `null` = no se pudo leer, y la sección lo DICE. Aplastarlo a lista
    // vacía diría «no hay rebotes», que es la conclusión tranquilizadora
    // que hace que nadie vuelva a mirar.
    rebotesRecientes(15).catch(() => null),
    correosSuprimidos(25).catch(() => null),
    leerResumenBandeja(ahoraMs()),
  ]);

  async function accionResolver(_previo: ResultadoPieza, fd: FormData): Promise<ResultadoPieza> {
    'use server';
    const s = await requireSuperadmin();
    const id = String(fd.get('pieza') ?? '');
    const operacion = String(fd.get('operacion') ?? '');
    try {
      if (operacion === 'aprobar') {
        const edicion = String(fd.get('cuerpoEditado') ?? '').trim();
        // A37-S05-08: con el modo edición activo el campo SÍ viaja; si llega vacío NO se aprueba el
        // borrador original (el operador pudo borrarlo para neutralizar el correo): se rechaza con error.
        if (fd.has('cuerpoEditado') && !edicion) {
          return { error: 'El cuerpo editado está vacío: escribe el texto que debe salir, o rechaza la pieza. No se aprobó nada.' };
        }
        await aprobarPieza(id, s.userId, edicion || undefined);
        revalidatePath('/admin/aprobaciones');
        return { ok: edicion ? 'Aprobada con tu edición — esa versión es la que sale.' : 'Aprobada tal cual. El envío es el paso siguiente, abajo.' };
      }
      if (operacion === 'rechazar') {
        await rechazarPieza(id, s.userId, String(fd.get('motivo') ?? ''));
        revalidatePath('/admin/aprobaciones');
        return { ok: 'Rechazada con motivo — quedó en la bitácora.' };
      }
      return { error: 'Esa operación no existe: aprobar o rechazar, ni una más.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, operacion === 'rechazar' ? 'rechazar la pieza' : 'aprobar la pieza') };
    }
  }

  async function accionEnviar(_previo: ResultadoPieza, fd: FormData): Promise<ResultadoPieza> {
    'use server';
    const s = await requireSuperadmin();
    try {
      const r = await enviarPiezaPorCorreo(String(fd.get('pieza') ?? ''), s.userId);
      revalidatePath('/admin/aprobaciones');
      return { ok: `Enviada a ${r.destinatario} — Resend la aceptó (${r.providerId}) y el contacto quedó en el historial del prospecto.` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'enviar la pieza') };
    }
  }

  // A36-R11-01: salida del callejón del envío ambiguo. Quien aprieta el botón
  // afirma que verificó en Resend que el correo NO salió.
  async function accionLiberar(_previo: ResultadoPieza, fd: FormData): Promise<ResultadoPieza> {
    'use server';
    const s = await requireSuperadmin();
    try {
      const r = await liberarEnvioAmbiguo(String(fd.get('pieza') ?? ''), s.userId);
      revalidatePath('/admin/aprobaciones');
      return r.reservaLiberada
        ? { ok: 'Liberada: vuelve a «Aprobadas por enviar» y se puede reintentar (misma llave de idempotencia).' }
        : { ok: 'Liberada, pero NO se pudo borrar su reserva de cadencia: el reintento puede rebotar hasta pasadas 48 h. Avisa a soporte.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'liberar el envío ambiguo') };
    }
  }

  // ── Vaciado por lotes (auditoría admin, P0). Contar NO escribe; ejecutar re-cuenta y se niega si la cifra cambió. ──
  async function accionContarLote(_previo: ResultadoConteo, fd: FormData): Promise<ResultadoConteo> {
    'use server';
    await requireSuperadmin();
    try {
      const params = leerParametrosLote(fd);
      normalizarParametros(params); // rechaza 0 días, límites absurdos y tipos mal formados antes de tocar la base
      const resumen = await contarVencidas(params);
      return {
        resumen,
        entrada: { dias: String(fd.get('dias') ?? ''), limite: String(fd.get('limite') ?? ''), tipos: String(fd.get('tipos') ?? '') },
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'contar las piezas vencidas') };
    }
  }

  async function accionVaciarLote(_previo: ResultadoVaciado, fd: FormData): Promise<ResultadoVaciado> {
    'use server';
    const s = await requireSuperadmin();
    try {
      const params = leerParametrosLote(fd);
      normalizarParametros(params);
      const esperadas = leerEsperadas(fd);
      if (esperadas === null) return { error: 'Falta la cifra contada: cuenta primero y confirma sobre ese conteo. No se archivó nada.' };
      // Re-cuenta en el servidor: si la bandeja cambió desde que se contó, NO se ejecuta a ciegas.
      const ahora = await contarVencidas(params);
      if (ahora.enElLote !== esperadas) {
        return { error: `La bandeja cambió: contaste ${esperadas} y ahora el lote sería de ${ahora.enElLote}. Vuelve a contar. No se archivó nada.` };
      }
      const r = await vaciarVencidas(s.userId, { ...params, dryRun: false });
      revalidatePath('/admin/aprobaciones');
      const resto = r.restantes > 0 ? ` Quedan ${r.restantes} vencidas para otro lote.` : '';
      const bitacora = r.bitacoraEscrita === false ? ' OJO: el lote se archivó pero la bitácora no pudo escribirse; avisa a soporte.' : ' Quedó firmado en la bitácora.';
      return { ok: `Archivadas ${r.resueltas} piezas vencidas.${resto}${bitacora}` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'archivar las piezas vencidas') };
    }
  }

  function bandeja(titulo: string, r: { ok: PiezaEnCola[] | null; error: string | null }, urgenteBandeja: boolean) {
    return (
      <Tarjeta
        titulo={r.ok !== null ? `${titulo} (${r.ok.length})` : titulo}
        estado={r.error !== null ? 'error' : r.ok !== null && r.ok.length === 0 ? 'vacio' : 'ok'}
        mensaje={r.error !== null
          ? 'No se pudo leer ESTA bandeja — no significa que esté vacía. La otra bandeja lee por su lado.'
          : urgenteBandeja ? 'Nada urgente esperando' : 'Nada pendiente'}
        detalle={urgenteBandeja
          ? 'Así debe verse casi siempre: lo urgente se resuelve en minutos.'
          : 'Las piezas llegan aquí cuando un agente redacta algo que necesita tu aprobación.'}
        acciones={urgenteBandeja ? <StatusChip tono="warn">SLA en minutos</StatusChip> : undefined}
      >
        <div className="bj-cola">
          {r.ok?.map((p) => <FormaPieza key={p.id} pieza={p} accion={accionResolver} />)}
        </div>
      </Tarjeta>
    );
  }

  const porAprobar = (
    <>
      {estadoBandeja?.frenaAlRunner && (
        <Aviso tono="error" titulo="La bandeja está frenando a los agentes.">
          Con {estadoBandeja.pendientes} piezas pendientes el runner no fabrica más: aprobar es humano. Resuelve las piezas o limpia las vencidas abajo.
        </Aviso>
      )}
      {bandeja('Urgente — respuesta a ads y SLA en minutos', urgente, true)}
      {bandeja('Normal — prospección y contenido (20-40/día)', normal, false)}
      <LimpiezaLote contar={accionContarLote} vaciar={accionVaciarLote} bandeja={estadoBandeja} />
    </>
  );

  // ── LA COLA DE SALIDA: aprobada ≠ enviada ────────────────────────────────
  // El envío es un click APARTE con claim anti-doble-click, y sale la versión final (la edición humana manda). Resend ACEPTA ≠ el
  // prospecto RECIBIÓ — el id del proveedor es la prueba de salida; delivery/bounce es la capa siguiente, declarada.
  const paraEnviar = (
    <Tarjeta
      titulo={porEnviar !== null ? `Aprobadas por enviar (${porEnviar.length})` : 'Aprobadas por enviar'}
      estado={porEnviar === null ? 'error' : porEnviar.length === 0 ? 'vacio' : 'ok'}
      mensaje={porEnviar === null ? 'No se pudo leer la cola de salida — no significa que esté vacía.' : 'Nada aprobado esperando envío'}
      detalle="Las piezas aprobadas que salen por correo aparecen aquí; el resto de los tipos son informes y terminan al aprobarse."
    >
      <div className="bj-cola">
        {porEnviar?.map((p) => <FormaEnvio key={p.id} pieza={p} accion={accionEnviar} />)}
      </div>
    </Tarjeta>
  );

  const historial = (
    <>
      <Tarjeta
        titulo="Últimas resueltas"
        estado={resueltas === null ? 'error' : resueltas.length === 0 ? 'vacio' : 'ok'}
        mensaje={resueltas === null ? 'No se pudo leer el historial — no significa que esté vacío.' : 'Aún no se resuelve ninguna pieza'}
      >
        <div className="bj-cola">
          {resueltas?.map((p) => (
            <div key={p.id} className="bj-item__fila">
              <StatusChip tono={p.estado === 'aprobado' ? 'ok' : 'bad'}>
                {p.estado === 'aprobado' ? (p.cuerpoFinal ? 'Aprobada con edición' : 'Aprobada') : 'Rechazada'}
              </StatusChip>
              <span>{p.titulo}</span>
              <span className="bj-item__meta">{p.agente}</span>
              {p.resueltoPorEmail && <span className="bj-item__meta">por {p.resueltoPorEmail}</span>}
              {p.enviadoEn && (
                p.providerMessageId
                  ? <span className="bj-sub" data-tono="ok">enviada {fechaHoraMx(p.enviadoEn)}</span>
                  // La inconsistencia VISIBLE: enviada estampada sin prueba del proveedor (el proceso murió entre envío y guardado).
                  : <span className="bj-sub" data-tono="warn">enviada SIN prueba del proveedor — revisar</span>
              )}
              {/* A36-R11-01: el motivo («AMBIGUO… verificar en Resend») se ve también con enviado_en puesto, y hay salida:
                  confirmar que NO salió y reintentar. */}
              {p.enviadoEn && !p.providerMessageId && p.envioError && (
                <span className="bj-sub" data-tono="warn">{p.envioError}</span>
              )}
              {p.enviadoEn && !p.providerMessageId && p.envioError?.startsWith('AMBIGUO') && (
                <FormaLiberarAmbiguo pieza={p} accion={accionLiberar} />
              )}
              {!p.enviadoEn && p.envioError && <span className="bj-sub" data-tono="bad">envío falló: reintentable</span>}
            </div>
          ))}
        </div>
      </Tarjeta>
      {/* REBOTES Y QUEJAS: el webhook de Resend (0124) llevaba meses escribiendo `entrega_estado` y llenando `correo_suprimido` (0217)
          y NINGÚN .tsx lo pintaba. Aquí porque es la misma tabla, el mismo operador y la misma sesión: quien aprueba lo que sale es
          quien tiene que ver qué no llegó. Sin botón de «reactivar»: suprimir es para siempre (0217). */}
      <RebotesYBajas rebotes={rebotes} suprimidos={suprimidos} />
    </>
  );

  return (
    <MarcoPagina titulo="Aprobaciones" apoyo="Lo que los agentes redactan y espera tu firma antes de salir.">
      <VistasAprobaciones
        inicial={inicial}
        conteos={{
          aprobar: urgente.ok !== null && normal.ok !== null ? urgente.ok.length + normal.ok.length : null,
          enviar: porEnviar !== null ? porEnviar.length : null,
        }}
        porAprobar={porAprobar}
        porEnviar={paraEnviar}
        historial={historial}
      />
      <Aviso tono="info">
        El candado es de la base de datos, no de esta pantalla: es imposible que cualquier código envíe una pieza no aprobada,
        y cada resolución queda firmada por quien la tomó. Rechazar exige motivo — un rechazo sin motivo es una pieza que se vuelve a proponer igual.
      </Aviso>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Aprobaciones' };
