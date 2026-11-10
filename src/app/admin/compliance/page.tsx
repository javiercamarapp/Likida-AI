import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { resolverSolicitudArco } from '@/lib/likida/repo';
import { fechaMx, hoyMx, numero } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { traerTodo, conteo } from '@/lib/likida/pg';
import { logger } from '@/lib/logger';
import { getSolicitudesArcoPendientes } from '@/lib/admin/escalaciones';
import { agregarDiasHabiles } from '@/lib/admin/dias-habiles';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { BotonEnlace, CampoTextarea, Disclosure, EstadoError, EstadoVacio, MarcoPagina, StatusChip, Tarjeta, type TonoEstado } from '../../ui-v2/componentes';
import { TiraCifras } from '../../ui-v2/graficas';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import '../sistema.css';

export const dynamic = 'force-dynamic';

const ETIQUETA_TIPO: Record<string, string> = {
  acceso: 'Acceso', rectificacion: 'Rectificación', cancelacion: 'Cancelación', oposicion: 'Oposición',
};
/** El estado de la solicitud como chip: resuelta en verde, pendiente en ámbar, improcedente en neutro. Un estado fuera del catálogo se
 *  pinta crudo en neutro: visible, no roto. */
const CHIP_ARCO: Record<string, { tono: TonoEstado; etiqueta: string }> = {
  recibida: { tono: 'warn', etiqueta: 'Recibida' },
  en_proceso: { tono: 'warn', etiqueta: 'En proceso' },
  resuelta: { tono: 'ok', etiqueta: 'Resuelta' },
  improcedente: { tono: 'neutral', etiqueta: 'Improcedente' },
};

/**
 * Compliance y datos — la flota ve sus solicitudes ARCO (registradas cuando un operador escribe PRIVACIDAD por WhatsApp) y responde la
 * que le toca. AUDITORÍA 14: las solicitudes se registraban pero nadie podía verlas; la responsable obligada a contestar en 20 días
 * hábiles (LFPDPPP art. 31) estaba ciega.
 *
 * F7: la pantalla se rehízo con ui-v2 SIN tocar la lógica de ARCO. Lo pendiente va en tarjetas con su formulario DENTRO (cada
 * respuesta se envía tal cual al titular), lo ya resuelto en una tabla paginada. Una lectura caída se dice; no se pinta como «sin
 * solicitudes».
 */
export default async function CompliancePage({ searchParams }: { searchParams?: Promise<{ pagina?: string }> } = {}) {
  // A39-S05-01/S06-01: puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  async function accionResolver(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    await requireSuperadmin();
    const solicitudId = String(fd.get('solicitudId') ?? '');
    const resolucion = String(fd.get('resolucion') ?? '').trim();
    if (!solicitudId) return { error: 'Falta la solicitud.' };
    if (resolucion.length < 5) return { error: 'Escribe la respuesta que se entrega al titular (qué se resolvió y cómo).' };
    // El tenant: la solicitud se resuelve bajo la flota responsable. Se busca
    // el tenant de la solicitud para no depender del orden del listado.
    //
    // ADM-10 (auditoría 24, MEDIO): el `error` de esta lectura se descartaba
    // — una base caída y una solicitud inexistente se pintaban con el MISMO
    // mensaje ("La solicitud no existe."), que es "fallar cerrado" pero
    // mintiendo sobre el porqué: quien lo lee busca la solicitud a mano y no
    // la encuentra porque la lectura ni siquiera corrió.
    const { data: sol, error: errSol } = await supabaseAdmin().from('solicitud_arco').select('tenant_id').eq('id', solicitudId).maybeSingle();
    if (errSol) return { error: `No se pudo leer la solicitud — ${errSol.message}. Intenta de nuevo.` };
    if (!sol?.tenant_id) return { error: 'La solicitud no existe.' };
    let r: { enviada: boolean; error?: string };
    try {
      r = await resolverSolicitudArco(sol.tenant_id as string, solicitudId, resolucion);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'resolver la solicitud') };
    }
    revalidatePath('/admin/compliance');
    // A37-S05-04: el resultado del envío NO se descarta — la pantalla no
    // afirma un WhatsApp que no salió (mismo texto que /dashboard/arco).
    return r.enviada
      ? { ok: 'Solicitud resuelta y la respuesta se envió al titular por WhatsApp.' }
      : { ok: `Solicitud resuelta. La respuesta NO se pudo enviar por WhatsApp${r.error ? ` (${r.error})` : ''} — entrégala al titular por otro canal.` };
  }

  let lectura: { solicitudes: SolicitudArcoPanel[]; pendientesVencen: number } | null;
  try {
    lectura = await datosDeCompliance();
  } catch (e) {
    logger.error('admin.compliance', { err: e instanceof Error ? e.message : String(e) });
    lectura = null;
  }
  const solicitudes = lectura?.solicitudes ?? [];
  // Lo más próximo a vencer primero (el plazo legal es lo que ordena el trabajo).
  const pendientes = solicitudes.filter((s) => s.estado === 'recibida' || s.estado === 'en_proceso').sort((a, b) => a.venceEn.localeCompare(b.venceEn));
  const resueltas = solicitudes.filter((s) => s.estado !== 'recibida' && s.estado !== 'en_proceso');
  // AUDITORÍA 15, CRÍTICO: la pantalla vive en /admin (superadmin), cuyo tenant de sesión es null — filtrar por tenant dejaba la
  // pantalla SIEMPRE vacía. El superadmin ve TODAS las flotas, con la flota en cada solicitud.
  const hoy = hoyMx(new Date(ahoraMs()));
  const pagina = Math.max(1, Number.parseInt((await searchParams)?.pagina ?? '1', 10) || 1);

  const columnas: ColumnaTabla<SolicitudArcoPanel>[] = [
    { id: 'recibida', titulo: 'Recibida', corta: true, celda: (s) => fechaMx(s.recibidaEn) },
    { id: 'flota', titulo: 'Flota', principal: true, celda: (s) => s.flotaNombre },
    { id: 'derecho', titulo: 'Derecho', celda: (s) => ETIQUETA_TIPO[s.tipo] ?? s.tipo },
    { id: 'estado', titulo: 'Estado', celda: (s) => { const c = CHIP_ARCO[s.estado] ?? { tono: 'neutral' as TonoEstado, etiqueta: s.estado }; return <StatusChip tono={c.tono}>{c.etiqueta}</StatusChip>; } },
    { id: 'resolucion', titulo: 'Resolución', celda: (s) => s.resolucion ?? '—' },
  ];

  return (
    <MarcoPagina titulo="Compliance y datos" apoyo="Las solicitudes de derechos de los titulares (ARCO): quién pide qué y cuánto falta para contestar.">
      <TiraCifras etiqueta="Solicitudes ARCO" items={lectura === null ? [
        { etiqueta: 'Por responder', valor: null, estado: 'error', mensaje: 'No se pudieron leer las solicitudes.', reintentar: true },
        { etiqueta: 'Vencen pronto', valor: null, estado: 'error', mensaje: 'No se pudieron leer las solicitudes.', reintentar: true },
      ] : [
        { etiqueta: 'Por responder', valor: pendientes.length, formato: 'entero', tono: pendientes.length > 0 ? 'warn' : undefined, nota: 'Recibidas o en proceso, de todas las flotas.' },
        { etiqueta: 'Vencen pronto', valor: lectura.pendientesVencen, formato: 'entero', tono: lectura.pendientesVencen > 0 ? 'bad' : undefined, nota: 'Plazo en 5 días hábiles o menos.' },
      ]} />

      {lectura === null ? (
        <EstadoError reintentar>No se pudieron leer las solicitudes ARCO. Esto NO quiere decir que no haya ninguna: la responsable tiene 20 días hábiles para contestar y una pendiente puede estar corriendo sin verse.</EstadoError>
      ) : solicitudes.length === 0 ? (
        <EstadoVacio titulo="Ninguna solicitud ARCO registrada">
          Cuando un operador escribe PRIVACIDAD por WhatsApp, la solicitud queda registrada aquí y la flota, que es la responsable, tiene 20 días hábiles para responder.
        </EstadoVacio>
      ) : (
        <>
          <section className="adm-sis-bloque" aria-labelledby="arco-pendientes">
            <h2 className="adm-sis-titulo" id="arco-pendientes">Por responder</h2>
            {pendientes.length === 0 ? (
              <EstadoVacio titulo="Nada por responder">Todas las solicitudes registradas ya tienen su respuesta.</EstadoVacio>
            ) : pendientes.map((s) => {
              const chip = CHIP_ARCO[s.estado] ?? { tono: 'neutral' as TonoEstado, etiqueta: s.estado };
              const vencida = s.venceEn < hoy;
              return (
                <Tarjeta key={s.id} titulo={`${ETIQUETA_TIPO[s.tipo] ?? s.tipo} · ${s.flotaNombre}`}
                  acciones={<><StatusChip tono={chip.tono}>{chip.etiqueta}</StatusChip>{vencida ? <StatusChip tono="bad">Vencida</StatusChip> : null}</>}>
                  <ul className="adm-sis-lista">
                    <li><span>Recibida</span><span>{fechaMx(s.recibidaEn)}</span></li>
                    <li><span>Vence</span><span>{fechaMx(s.venceEn)}</span></li>
                    <li><span>Titular</span><span>{s.operadorNombre ?? '—'}<span className="adm-sis-sub">{s.titularRef}</span></span></li>
                  </ul>
                  {s.tipo === 'cancelacion' || s.tipo === 'oposicion' ? (
                    // A37-S05-04: una cancelación se EJECUTA (anonimiza al titular) y una oposición lleva su propio trámite; ninguna se
                    // cierra con texto. La ejecución real vive en /dashboard/arco.
                    <div className="adm-sis-acciones">
                      <BotonEnlace href={`/dashboard/arco?tenant=${encodeURIComponent(s.tenantId)}`} variante="secondary" tamano="sm">
                        {s.tipo === 'cancelacion' ? 'Ejecutar cancelación en la bandeja ARCO' : 'Atender la oposición en la bandeja ARCO'}
                      </BotonEnlace>
                    </div>
                  ) : (
                    <FormaConAviso accion={accionResolver} boton="Responder" columnas="md:grid-cols-1">
                      <input type="hidden" name="solicitudId" value={s.id} />
                      <CampoTextarea etiqueta="Respuesta al titular" name="resolucion" obligatorio rows={3}
                        placeholder="Qué se resolvió y cómo"
                        ayuda="Se envía tal cual por WhatsApp al titular. Escribe lo que quieres que lea." />
                    </FormaConAviso>
                  )}
                </Tarjeta>
              );
            })}
          </section>

          <section className="adm-sis-bloque" aria-labelledby="arco-resueltas">
            <h2 className="adm-sis-titulo" id="arco-resueltas">Ya resueltas</h2>
            <TablaLista<SolicitudArcoPanel>
              etiqueta="Solicitudes de derechos de los titulares resueltas" columnas={columnas} filas={resueltas} idFila={(s) => s.id}
              base="/admin/compliance" params={{ pagina: pagina > 1 ? String(pagina) : undefined }} paginacion={{ tamano: 25 }}
              vacio={{ titulo: 'Aún no hay resueltas', texto: 'Aparecen aquí en cuanto se contesta la primera.' }}
            />
          </section>
        </>
      )}

      <Disclosure titulo="Lo que aún no existe aquí" resumen="Retención de comprobantes y avisos por versión">
        <p className="adm-sis-nota">
          La retención de comprobantes (CFF art. 30: conservar cinco años) y el catálogo de avisos de privacidad por versión siguen sin flujo construido; se dejan dichos en lugar de inventarlos.
          Las solicitudes ARCO sí están operativas: las registra el webhook cuando un operador escribe PRIVACIDAD, se resuelven aquí y la respuesta se intenta enviar al titular por WhatsApp (la plantilla de respuesta está en revisión de Meta).
        </p>
      </Disclosure>
    </MarcoPagina>
  );
}

// ── Datos del server component (sin hooks de cliente) ───────────────────────
interface SolicitudArcoPanel {
  id: string; tipo: string; estado: string; titularRef: string; recibidaEn: string;
  venceEn: string; resueltaEn: string | null; resolucion: string | null;
  operadorNombre: string | null; flotaNombre: string; tenantId: string;
}

async function datosDeCompliance(): Promise<{ solicitudes: SolicitudArcoPanel[]; pendientesVencen: number }> {
  const { getSessionTenant } = await import('@/lib/auth/session');
  const s = await getSessionTenant();
  if (!s) return { solicitudes: [], pendientesVencen: 0 };
  // El superadmin ve TODAS las flotas (su tenant es null por diseño). La
  // columna de flota viene del join con tenant.
  const [solicitudes, pendientes] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => supabaseAdmin().from('solicitud_arco').select(
        'id, tipo, canal, estado, titular_ref, recibida_en, vence_en, resuelta_en, resolucion, tenant_id, operador:operador_id(nombre), flota:tenant_id(nombre)', conteo(d),
      ).order('recibida_en', { ascending: false }).order('id', { ascending: false }).range(d, h),
      'compliance.todas',
    ),
    // La MISMA lectura de pendientes que la bandeja de escalaciones —
    // extraída a lib/admin/escalaciones.ts para no contarlas dos veces con
    // dos consultas que puedan divergir.
    getSolicitudesArcoPendientes(),
  ]);
  const mapeadas = solicitudes.map((f) => ({
    id: f.id as string,
    tipo: f.tipo as string,
    canal: (f.canal as string | null) ?? 'whatsapp',
    estado: f.estado as string,
    titularRef: (f.titular_ref as string | null) ?? '',
    recibidaEn: f.recibida_en as string,
    venceEn: f.vence_en as string,
    resueltaEn: (f.resuelta_en as string | null) ?? null,
    resolucion: (f.resolucion as string | null) ?? null,
    operadorNombre: ((f.operador as { nombre?: string } | null)?.nombre) ?? null,
    flotaNombre: ((f.flota as { nombre?: string } | null)?.nombre) ?? '—',
    tenantId: (f.tenant_id as string | null) ?? '',
  }));
  // DAT-08 (auditoría prod): el corte era el día UTC. De 18:00 a 24:00 hora de
  // México el "dentro de 5 días" era en realidad dentro de 6, y el plazo del
  // art. 31 de la LFPDPPP se cuenta en días de México.
  const corte = agregarDiasHabiles(hoyMx(new Date(ahoraMs())), 5);
  const vence = pendientes.filter((p) => p.venceEn <= corte).length;
  return { solicitudes: mapeadas as SolicitudArcoPanel[], pendientesVencen: vence };
}

export const metadata: Metadata = { title: 'Compliance & Datos' };
