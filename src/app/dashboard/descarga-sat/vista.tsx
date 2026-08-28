import { revalidatePath } from 'next/cache';
import { Archive, CloudDownload, FileCheck2, FileQuestion, Link2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { estadoDescargaSat } from '@/lib/likida/sat_descarga';
import { leerDescargaSat, type VistaDescargaSat } from '@/lib/likida/sat_descarga/lectura';
import {
  guardarConfigDescarga, verificarCredencial, pedirRangoManual,
} from '@/lib/likida/sat_descarga/escritura';
import { VENTANA_MAX_DIAS } from '@/lib/likida/sat_descarga/ciclo';
import { DIAS_AVISO_DEFECTO } from '@/lib/likida/sat_descarga/peaje_cierre';
import { fechaMx, hoyMx } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../resumen-visual';
import { StatCard, EstadoVacio } from '../../admin/ui/kit';
import { FormaConAviso, Campo, Selector, type ResultadoAccion } from '../../admin/ui/forma';

/**
 * DESCARGA DEL SAT (0231) — la pantalla del contralor.
 *
 * LO QUE ESTA PANTALLA TIENE QUE DECIR AUNQUE INCOMODE:
 *
 *  1. QUÉ FALTA Y QUIÉN LO DESTRABA. Sin contrato del PAC no hay descarga, y
 *     eso es acto de Javier; sin e.firma en la bóveda del PAC tampoco, y eso
 *     es acto de la flota. Un "no configurado" a secas manda al contralor a
 *     abrir un ticket para que le digan lo que la pantalla ya sabía.
 *  2. QUE LA e.firma NO VIVE AQUÍ. Es la pregunta que un contador va a hacer
 *     antes de subir nada, y la respuesta vende: su firma electrónica se queda
 *     en la bóveda del PAC, igual que su CSD.
 *  3. QUÉ NO CAE SOLO. La descarga recoge lo que el comercio ya timbró. Lo que
 *     exige un alta previa (TeleVía) o una modalidad concreta (PASE mensual)
 *     NO llega aunque el TAG esté activo — y eso el contralor lo tiene que
 *     accionar. Ése es el checklist de abajo, y es honestidad y venta a la vez.
 *
 * NULL NO ES CERO en ninguna tarjeta: "no se ha descargado nunca" y "se
 * descargó y no había nada" son cosas distintas, y en esta pantalla las dos
 * pasan.
 */

const t = (v: FormDataEntryValue | null): string => String(v ?? '').trim();

/** Lo que la flota tiene que hacer POR SU CUENTA para que estos comprobantes
 *  lleguen solos. Verificado en las fuentes de cada proveedor. */
const CHECKLIST: Array<{ que: string; porque: string; cae: boolean }> = [
  {
    que: 'Dar de alta tus datos fiscales con el emisor de tu monedero de combustible (Edenred/Ticket Car, Efectivale, Pluxee, Shell, Petro-7…).',
    porque: 'Cuando pagas con monedero, la gasolinera NO te factura a ti (RMF 3.3.1.7): le factura al emisor. Tu comprobante deducible es el CFDI del EMISOR con complemento ECC, y ése sí llega solo al buzón — Likida lo concilia carga por carga.',
    cae: true,
  },
  {
    que: 'Dar de alta tus datos fiscales en TeleVía (alta única).',
    porque: 'Con el alta hecha, TeleVía timbra un CFDI mensual por tus cruces y llega al buzón a partir del 5º día hábil. SIN el alta no recibes nada, aunque el TAG esté activo y cruzando.',
    cae: true,
  },
  {
    que: 'Pedir a PASE el cambio a modalidad POSPAGO MENSUAL.',
    porque: 'Solo en esa modalidad PASE timbra por periodo y el CFDI cae al buzón. En prepago se factura la RECARGA desde su portal, y en pospago por cruce hay que seleccionar los cruces a mano.',
    cae: true,
  },
  {
    que: 'Facturar en el portal lo que no cae solo: PASE prepago, PASE pospago por cruce y, muy probablemente, IAVE/CAPUFE.',
    porque: 'Y hay prisa: PASE extingue el derecho a facturar el ÚLTIMO DÍA DEL MES EN CURSO. Por eso Likida te avisa antes del cierre con la lista de cruces sin CFDI, en vez de enseñártelos a mes vencido cuando ya no se puede.',
    cae: false,
  },
];

export async function VistaDescargaSat({ searchParams, tenantExiste = true }: {
  searchParams: { vista?: string; tenant?: string; rol?: string };
  tenantExiste?: boolean;
}) {
  const { tenantId } = await resolverTenantEfectivo('/dashboard/descarga-sat', searchParams);
  const proveedor = estadoDescargaSat();
  const datos: VistaDescargaSat = tenantExiste
    ? await leerDescargaSat(tenantId)
    : { config: null, solicitudes: [], conteos: null, incompleta: false };
  const hoy = hoyMx(new Date());

  async function guardar(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    // El rol del render NO es el de la acción: se re-gatea adentro, mismo
    // criterio que Políticas y el estímulo de peaje.
    const s = await resolverTenantEfectivo('/dashboard/descarga-sat', searchParams);
    if (!puedeVerRuta(s.rol, '/dashboard/descarga-sat')) {
      return { error: 'Tu rol no puede configurar la descarga del SAT.' };
    }
    try {
      await guardarConfigDescarga(s.tenantId, {
        rfc: t(fd.get('rfc')),
        modo: t(fd.get('modo')) || 'webservice',
        peajeDiasAviso: Number(t(fd.get('peajeDiasAviso')) || DIAS_AVISO_DEFECTO),
        activa: t(fd.get('activa')) !== 'pausada',
      }, { id: s.userId });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar la configuración de descarga') };
    }
    revalidatePath('/dashboard/descarga-sat');
    return { ok: 'Configuración guardada. El siguiente barrido (cada 6 horas) la usa tal cual.' };
  }

  async function verificar(): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/descarga-sat', searchParams);
    if (!puedeVerRuta(s.rol, '/dashboard/descarga-sat')) {
      return { error: 'Tu rol no puede verificar la e.firma de la flota.' };
    }
    try {
      const r = await verificarCredencial(s.tenantId, { id: s.userId });
      revalidatePath('/dashboard/descarga-sat');
      // El mensaje del proveedor TAL CUAL cuando dice que no: "no se pudo
      // verificar" no le dice a nadie que le falta subir su e.firma.
      return r.ok ? { ok: r.mensaje } : { error: r.mensaje };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'verificar la e.firma con el proveedor') };
    }
  }

  async function pedir(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/descarga-sat', searchParams);
    if (!puedeVerRuta(s.rol, '/dashboard/descarga-sat')) {
      return { error: 'Tu rol no puede pedir descargas al SAT.' };
    }
    try {
      const r = await pedirRangoManual(s.tenantId, {
        desde: t(fd.get('desde')),
        hasta: t(fd.get('hasta')),
        tipo: t(fd.get('tipo')) === 'emitidos' ? 'emitidos' : 'recibidos',
      }, { id: s.userId });
      revalidatePath('/dashboard/descarga-sat');
      return r.ok ? { ok: r.mensaje } : { error: r.mensaje };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'pedir el rango al SAT') };
    }
  }

  const cfg = datos.config;
  const c = datos.conteos;

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<CloudDownload width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Descarga del SAT"
        />

        <div className="px-5 pb-5 pt-3 space-y-3">
          {/* ── 1. QUÉ FALTA Y QUIÉN LO DESTRABA. Antes que ninguna cifra. */}
          <section className="card p-4">
            <div className="flex items-start gap-2">
              <ShieldCheck size={16} style={{ color: 'var(--marca)' }} aria-hidden className="mt-0.5 shrink-0" />
              <div className="space-y-1.5">
                <h2 className="font-display text-[15px] font-semibold m-0">
                  Los comprobantes que el comercio ya te timbró, sin entrar a ningún portal
                </h2>
                <p className="text-[12.5px] m-0" style={{ color: 'var(--muted)' }}>
                  Todo CFDI que un proveedor timbró a tu RFC ya está en tu buzón del SAT. Esto lo baja
                  en bloque y lo cruza contra los tickets que tus operadores mandaron por WhatsApp.
                </p>
                {/* La pregunta que un contador hace antes de subir nada. */}
                <p className="text-[12.5px] m-0">
                  <strong>Tu e.firma no se guarda en Likida.</strong>{' '}
                  <span style={{ color: 'var(--muted)' }}>
                    Se carga en la bóveda del PAC —en el portal del PAC, igual que tu CSD del
                    timbrado— y desde aquí solo se mandan solicitudes con tu RFC. Likida no la
                    recibe, no la transporta y no la guarda: lo único que queda de ella aquí es su
                    número de referencia y su vigencia. El CSD del timbrado NO sirve para descargar:
                    el SAT exige la e.firma.
                  </span>
                </p>
                {!proveedor.configurado && (
                  <p className="text-[12.5px] m-0 pt-1" style={{ color: 'var(--warn)' }}>
                    <TriangleAlert size={13} className="inline mb-0.5 mr-1" aria-hidden />
                    {proveedor.motivo}
                  </p>
                )}
                {proveedor.configurado && (
                  <p className="text-[12.5px] m-0 pt-1" style={{ color: 'var(--muted)' }}>
                    Proveedor conectado: {proveedor.proveedor?.toUpperCase()}. No hay ambiente de
                    pruebas para descarga masiva (ni el SAT ni el proveedor lo ofrecen): la primera
                    solicitud va contra tu buzón real.
                  </p>
                )}
              </div>
            </div>
          </section>

          {datos.incompleta && (
            <div className="card p-4 flex items-start gap-3" style={{ borderColor: 'var(--warn)' }}>
              <span className="inline-block w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: 'var(--warn)' }} />
              <div>
                <p className="text-sm font-semibold m-0">Faltan datos por cargar — esta pantalla está incompleta</p>
                <p className="text-xs mt-1 m-0" style={{ color: 'var(--muted)' }}>
                  Una o más lecturas no respondieron. Lo que ves puede no ser todo: reintenta antes
                  de capturar encima.
                </p>
              </div>
            </div>
          )}

          {/* ── 2. EL ESTADO Y LAS CIFRAS ─────────────────────────────── */}
          <section className="card p-3">
            <TituloSeccion>Tu conexión</TituloSeccion>
            {cfg === null ? (
              <div className="mt-2">
                <EstadoVacio icono={<FileQuestion width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Todavía no has declarado de qué RFC se descarga el buzón. Decláralo abajo — sin eso
                  no se pide nada, y Likida jamás adivina un RFC.
                </EstadoVacio>
              </div>
            ) : (
              <>
                <p className="text-[12.5px] mt-2 mb-2" style={{ color: 'var(--muted)' }}>
                  RFC {cfg.rfc} · modo {cfg.modo === 'webservice'
                    ? 'web service (200,000 CFDI por petición, el SAT tarda hasta 6 días)'
                    : 'portal (2,000 documentos al día, ~48 h)'}
                  {' · '}{cfg.activa ? 'activa' : 'PAUSADA'}.
                  {' '}e.firma: {cfg.certificadoNumero
                    ? `cargada en la bóveda del proveedor (ref. ${cfg.certificadoNumero}${cfg.certificadoVenceEn ? `, vence el ${fechaMx(cfg.certificadoVenceEn)}` : ''})`
                    : cfg.verificadaEn
                      ? 'NO se encontró en la bóveda del proveedor — la sube tu contador en el portal del PAC'
                      : 'sin verificar todavía'}.
                  {' '}Última descarga: {cfg.ultimaDescargaHasta
                    ? `hasta el ${fechaMx(cfg.ultimaDescargaHasta)}`
                    : 'ninguna todavía — la primera solicitud abre una ventana de 90 días hacia atrás'}.
                </p>
                <FormaConAviso accion={verificar} boton="Verificar mi e.firma con el proveedor" columnas="md:grid-cols-1">
                  <p className="text-[12px] m-0" style={{ color: 'var(--faint)' }}>
                    Pregunta al PAC si tu e.firma sigue en su bóveda y guarda solo su referencia y su
                    vigencia. No sube nada ni descarga nada.
                  </p>
                </FormaConAviso>
              </>
            )}

            {/* CINCO cubos, no cuatro: `descargados` se reparte ENTERO entre
                los otros cuatro (casado + ambiguo + disponible + ignorado son
                el dominio completo del CHECK de la 0231). Con cuatro tarjetas
                las cifras no sumaban el total de la primera y el contralor no
                tenía dónde averiguar a dónde se fue la diferencia. */}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
              {/* null ≠ 0: si la consulta se cayó, la tarjeta lo dice. */}
              <StatCard icono={<CloudDownload width={15} height={15} strokeWidth={1.75} />}
                etiqueta="CFDI bajados del buzón" valor={c?.descargados ?? null}
                sinDato="no se pudo leer" nota="Folios fiscales únicos: el mismo no entra dos veces" />
              <StatCard icono={<Link2 width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Casaron solos con un gasto" valor={c?.casados ?? null}
                sinDato="no se pudo leer" nota="Quedaron facturados sin que nadie entrara a un portal" />
              <StatCard icono={<FileQuestion width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Esperan que tú decidas" valor={c?.ambiguos ?? null}
                sinDato="no se pudo leer" nota="Varios gastos empatan: Likida no adivina cuál es" />
              <StatCard icono={<FileCheck2 width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Sin gasto que les corresponda" valor={c?.disponibles ?? null}
                sinDato="no se pudo leer" nota="Puede ser un gasto que nadie reportó — eso también es hallazgo" />
              <StatCard icono={<Archive width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Archivados a propósito" valor={c?.ignorados ?? null}
                sinDato="no se pudo leer" nota="Consolidados que ya entraron por su propio camino — no se pierden, se archivan" />
            </div>
          </section>

          {/* ── 3. DECLARAR LA CONEXIÓN ───────────────────────────────── */}
          <section className="card p-3">
            <TituloSeccion>Declara tu buzón</TituloSeccion>
            <p className="text-[12.5px] mt-1 mb-2" style={{ color: 'var(--muted)' }}>
              El RFC del que se descarga puede NO ser el mismo con el que emites: aquí va el de la
              razón social que RECIBE las facturas. Cópialo de tu constancia.
            </p>
            <FormaConAviso accion={guardar} boton="Guardar" columnas="md:grid-cols-4">
              <Campo nombre="rfc" etiqueta="RFC del buzón" valorInicial={cfg?.rfc ?? ''} placeholder="EKU9003173C9" requerido />
              <Selector nombre="modo" etiqueta="Servicio del SAT" valorInicial={cfg?.modo ?? 'webservice'} opciones={[
                { valor: 'webservice', texto: 'Web service — 200,000 CFDI, hasta 6 días' },
                { valor: 'portal', texto: 'Portal — 2,000 al día, ~48 h' },
              ]} />
              <Campo nombre="peajeDiasAviso" etiqueta="Aviso de cierre de peaje (días antes)" tipo="number"
                valorInicial={String(cfg?.peajeDiasAviso ?? DIAS_AVISO_DEFECTO)}
                ayuda="De 1 a 25. El aviso del último día del mes sale siempre, además de éste." />
              <Selector nombre="activa" etiqueta="Estado" valorInicial={cfg?.activa === false ? 'pausada' : 'activa'} opciones={[
                { valor: 'activa', texto: 'Activa — se descarga sola cada 6 h' },
                { valor: 'pausada', texto: 'Pausada — no se pide nada' },
              ]} />
            </FormaConAviso>
          </section>

          {/* ── 4. PEDIR UN RANGO A MANO ──────────────────────────────── */}
          <section className="card p-3">
            <TituloSeccion>Pedir un periodo a mano</TituloSeccion>
            <p className="text-[12.5px] mt-1 mb-2" style={{ color: 'var(--muted)' }}>
              Para un periodo viejo que el barrido automático no va a alcanzar pronto. Máximo{' '}
              {VENTANA_MAX_DIAS} días por solicitud. El SAT tarda: la solicitud queda abierta y
              Likida la revisa sola cada 6 horas. Cada solicitud consume el tope diario de tu RFC,
              así que un rango que ya está en curso se rechaza en vez de pedirse dos veces.
            </p>
            <FormaConAviso accion={pedir} boton="Pedir al SAT" columnas="md:grid-cols-3">
              <Campo nombre="desde" etiqueta="Desde" tipo="date" valorInicial={`${hoy.slice(0, 8)}01`} requerido />
              <Campo nombre="hasta" etiqueta="Hasta" tipo="date" valorInicial={hoy} requerido />
              <Selector nombre="tipo" etiqueta="Qué buzón" valorInicial="recibidos" opciones={[
                { valor: 'recibidos', texto: 'Recibidos — lo que te timbraron (el que te sirve)' },
                { valor: 'emitidos', texto: 'Emitidos — lo que tú facturaste' },
              ]} />
            </FormaConAviso>
          </section>

          {/* ── 5. LAS SOLICITUDES ────────────────────────────────────── */}
          {datos.solicitudes.length > 0 && (
            <section className="card p-3">
              <TituloSeccion>Tus solicitudes</TituloSeccion>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }}>
                      <th className="text-left font-medium py-1">Periodo</th>
                      <th className="text-left font-medium py-1">Buzón</th>
                      <th className="text-left font-medium py-1">Estado</th>
                      <th className="text-right font-medium py-1">CFDI nuevos</th>
                      <th className="text-left font-medium py-1 pl-3">Lo que dijo el SAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.solicitudes.map((s) => (
                      <tr key={s.id} className="align-top">
                        <td className="py-1 whitespace-nowrap">{fechaMx(s.desde)} → {fechaMx(s.hasta)}</td>
                        <td className="py-1">{s.tipo}</td>
                        <td className="py-1">{s.estado}</td>
                        {/* NULL = no se ha ingerido; 0 = se ingirió y no había nada. */}
                        <td className="py-1 text-right tabular-nums">
                          {s.cfdisNuevos === null
                            ? <span style={{ color: 'var(--faint)' }} title="Todavía no se ha ingerido">—</span>
                            : s.cfdisNuevos}
                        </td>
                        {/* El mensaje del proveedor TAL CUAL. */}
                        <td className="py-1 pl-3" style={{ color: 'var(--muted)' }}>{s.mensaje ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── 6. EL CHECKLIST QUE NADIE MÁS TE VA A DECIR ───────────── */}
          <section className="card p-3">
            <TituloSeccion>Para que estos comprobantes lleguen solos, tu flota tiene que…</TituloSeccion>
            <p className="text-[12.5px] mt-1 mb-2" style={{ color: 'var(--muted)' }}>
              La descarga recoge lo que el comercio YA timbró a tu RFC. Si el comercio no sabe tu
              RFC, o tu contrato no es del tipo que timbra por periodo, no hay nada que recoger —
              aunque el TAG esté activo y cruzando todos los días.
            </p>
            <ol className="mt-2 space-y-2 list-none p-0 m-0">
              {CHECKLIST.map((p, i) => (
                <li key={i} className="hairline rounded-lg p-2.5" style={{ background: 'var(--surface)' }}>
                  <p className="text-[13px] font-medium m-0">
                    <span style={{ color: p.cae ? 'var(--marca)' : 'var(--warn)' }}>
                      {p.cae ? 'Cae solo · ' : 'NO cae solo · '}
                    </span>
                    {p.que}
                  </p>
                  <p className="text-[12px] mt-1 m-0" style={{ color: 'var(--muted)' }}>{p.porque}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </main>
  );
}
