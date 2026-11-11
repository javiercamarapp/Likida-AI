import { revalidatePath } from 'next/cache';
import { Archive, CloudDownload, FileCheck2, FileQuestion, Link2, Scale3d } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { exigirStepUpAccion } from '@/lib/auth/stepup';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { estadoDescargaSat } from '@/lib/likida/sat_descarga';
import { leerDescargaSat, TOPE_SOLICITUDES, type VistaDescargaSat } from '@/lib/likida/sat_descarga/lectura';
import {
  guardarConfigDescarga, verificarCredencial, pedirRangoManual,
} from '@/lib/likida/sat_descarga/escritura';
import { VENTANA_MAX_DIAS } from '@/lib/likida/sat_descarga/ciclo';
import { DIAS_AVISO_DEFECTO } from '@/lib/likida/sat_descarga/peaje_cierre';
import { fechaMx, hoyMx } from '@/lib/formato';
import { sufijoTenant } from '../sufijo';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import {
  AvisoCompacto, BotonEnlace, CampoFecha, CampoSelect, CampoTexto, EstadoVacio, FormaConAviso, Icono, MarcoPagina, StatusChip, TablaBase, Tarjeta,
  type ColumnaBase, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import './descarga-sat.css';

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
    const s = await resolverTenantAtadoOLanza('/dashboard/descarga-sat', searchParams, tenantId);
    if (!puedeVerRuta(s.rol, '/dashboard/descarga-sat')) {
      return { error: 'Tu rol no puede configurar la descarga del SAT.' };
    }
    // R7-A3: declarar OTRO RFC para el buzón del SAT (o el primero) exige segundo factor reciente. Se compara contra lo guardado ahora;
    // si no se pudo leer, se cierra. Pausar/reanudar o ajustar el aviso con el mismo RFC no lo pide.
    // `leerDescargaSat` no lanza: marca `incompleta` cuando alguna lectura falló (no se prueba que el RFC sea el mismo → cierra).
    const vigente = await leerDescargaSat(s.tenantId);
    if (vigente.incompleta || (vigente.config?.rfc ?? '').trim().toUpperCase() !== t(fd.get('rfc')).toUpperCase()) {
      const pasoMfa = await exigirStepUpAccion(s.rol, 'perfil_fiscal', { tenantId: s.tenantId, userId: s.userId });
      if (pasoMfa) return { error: pasoMfa };
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
    const s = await resolverTenantAtadoOLanza('/dashboard/descarga-sat', searchParams, tenantId);
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
    const s = await resolverTenantAtadoOLanza('/dashboard/descarga-sat', searchParams, tenantId);
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
  type Solicitud = (typeof datos.solicitudes)[number];
  const columnas: ColumnaBase<Solicitud>[] = [
    { id: 'periodo', titulo: 'Periodo', principal: true, celda: (s) => `${fechaMx(s.desde)} → ${fechaMx(s.hasta)}` },
    { id: 'buzon', titulo: 'Buzón', celda: (s) => s.tipo },
    { id: 'estado', titulo: 'Estado', celda: (s) => <StatusChip tono="neutral">{s.estado}</StatusChip> },
    // NULL = no se ha ingerido; 0 = se ingirió y no había nada.
    { id: 'nuevos', titulo: 'CFDI nuevos', alinear: 'der', celda: (s) => (s.cfdisNuevos === null ? <span className="rv-sat__tenue" title="Todavía no se ha ingerido">—</span> : s.cfdisNuevos) },
    // El mensaje del proveedor TAL CUAL.
    { id: 'sat', titulo: 'Lo que dijo el SAT', celda: (s) => <span className="rv-sat__tenue">{s.mensaje ?? ''}</span> },
  ];
  const sufijoBandeja = sufijoTenant(searchParams) ? `&${sufijoTenant(searchParams).slice(1)}` : '';

  return (
    <MarcoPagina titulo="SAT" apoyo="Los CFDI que tus proveedores ya timbraron a tu RFC, bajados del buzón del SAT y cruzados contra el ticket.">
      {/* ── 1. QUÉ FALTA Y QUIÉN LO DESTRABA. Antes que ninguna cifra. */}
      <Tarjeta titulo="Los comprobantes que el comercio ya te timbró, sin entrar a ningún portal" info="descarga_sat.intro">
        <div className="rv-sat__bloque">
          <p className="rv-sat__texto">
            Todo CFDI que un proveedor timbró a tu RFC ya está en tu buzón del SAT. Esto lo baja
            en bloque y lo cruza contra los tickets que tus operadores mandaron por WhatsApp.
          </p>
          {/* La pregunta que un contador hace antes de subir nada. */}
          <p className="rv-sat__texto">
            <strong>Tu e.firma no se guarda en Likida.</strong>{' '}
            Se carga en la bóveda del PAC —en el portal del PAC, igual que tu CSD del
            timbrado— y desde aquí solo se mandan solicitudes con tu RFC. Likida no la
            recibe, no la transporta y no la guarda: lo único que queda de ella aquí es su
            número de referencia y su vigencia. El CSD del timbrado NO sirve para descargar:
            el SAT exige la e.firma.
          </p>
          {!proveedor.configurado && <AvisoCompacto tono="warn" resumen={proveedor.motivo} />}
          {proveedor.configurado && (
            <p className="rv-sat__texto">
              Proveedor conectado: {proveedor.proveedor?.toUpperCase()}. No hay ambiente de
              pruebas para descarga masiva (ni el SAT ni el proveedor lo ofrecen): la primera
              solicitud va contra tu buzón real.
            </p>
          )}
        </div>
      </Tarjeta>

      {datos.incompleta && (
        <AvisoCompacto tono="warn" resumen="Faltan datos por cargar: esta pantalla está incompleta."
          mas="Una o más lecturas no respondieron. Lo que ves puede no ser todo: reintenta antes de capturar encima." />
      )}

      {/* CINCO cubos, no cuatro: `descargados` se reparte ENTERO entre los otros cuatro (casado + ambiguo + disponible + ignorado son el dominio completo del CHECK de la 0231). Con cuatro tarjetas las cifras no sumaban el total de la primera. null ≠ 0: si la consulta se cayó, la tarjeta lo dice. */}
      <TiraCifras sello={selloHoy('Buzón del SAT')}>
        <Cifra icono={<Icono icono={CloudDownload} />}
          etiqueta="CFDI bajados del buzón" info="descarga_sat.bajados" valor={c?.descargados ?? null}
          mensaje="no se pudo leer" nota="Folios fiscales únicos: el mismo no entra dos veces" />
        <Cifra icono={<Icono icono={Link2} />}
          etiqueta="Casaron solos con un gasto" info="descarga_sat.casados" valor={c?.casados ?? null}
          mensaje="no se pudo leer" nota="Quedaron facturados sin que nadie entrara a un portal" />
        <Cifra icono={<Icono icono={FileQuestion} />}
          etiqueta="Esperan que tú decidas" info="descarga_sat.ambiguos" valor={c?.ambiguos ?? null}
          mensaje="no se pudo leer" nota="Varios gastos empatan: Likida no adivina cuál es" />
        <Cifra icono={<Icono icono={FileCheck2} />}
          etiqueta="Sin gasto que les corresponda" info="descarga_sat.disponibles" valor={c?.disponibles ?? null}
          mensaje="no se pudo leer" nota="Puede ser un gasto que nadie reportó — eso también es hallazgo" />
        <Cifra icono={<Icono icono={Archive} />}
          etiqueta="Archivados a propósito" info="descarga_sat.ignorados" valor={c?.ignorados ?? null}
          mensaje="no se pudo leer" nota="Consolidados que ya entraron por su propio camino — no se pierden, se archivan" />
      </TiraCifras>

      {/* ── LA PUERTA A LAS FILAS (0243): los cuatro cubos que SÍ son colas de trabajo llevan a su lista, filtrada — el conteo deja de ser una cifra huérfana. */}
      <div className="rv-sat__filas">
        <span className="rv-sat__tenue">Ver las filas:</span>
        {([
          ['ambiguo', 'los que esperan tu decisión'],
          ['disponible', 'los que ningún gasto reclama'],
          ['casado', 'los que ya cuadraron'],
          ['ignorado', 'los archivados'],
        ] as const).map(([e, texto]) => (
          <BotonEnlace key={e} href={`/dashboard/descarga-sat/bandeja?estatus=${e}${sufijoBandeja}`} variante="secondary" tamano="sm"
            icono={<Icono icono={Scale3d} />}>
            {texto}
          </BotonEnlace>
        ))}
      </div>

      {/* ── 2. EL ESTADO ─────────────────────────────────────────── */}
      <Tarjeta titulo="Tu conexión">
        {cfg === null ? (
          <EstadoVacio titulo="Buzón sin declarar" icono={FileQuestion} contenido>
            Todavía no has declarado de qué RFC se descarga el buzón. Decláralo abajo — sin eso
            no se pide nada, y Likida jamás adivina un RFC.
          </EstadoVacio>
        ) : (
          <div className="rv-sat__bloque">
            <p className="rv-sat__texto">
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
              <p className="rv-sat__tenue">
                Pregunta al PAC si tu e.firma sigue en su bóveda y guarda solo su referencia y su
                vigencia. No sube nada ni descarga nada.
              </p>
            </FormaConAviso>
          </div>
        )}
      </Tarjeta>

      {/* ── 3. DECLARAR LA CONEXIÓN ───────────────────────────────── */}
      <Tarjeta titulo="Declara tu buzón">
        <p className="rv-sat__texto">
          El RFC del que se descarga puede NO ser el mismo con el que emites: aquí va el de la
          razón social que RECIBE las facturas. Cópialo de tu constancia.
        </p>
        <FormaConAviso accion={guardar} boton="Guardar" columnas="md:grid-cols-4">
          <CampoTexto id="rfc" name="rfc" etiqueta="RFC del buzón" defaultValue={cfg?.rfc ?? ''} placeholder="EKU9003173C9" obligatorio />
          <CampoSelect id="modo" name="modo" etiqueta="Servicio del SAT" defaultValue={cfg?.modo ?? 'webservice'}>
            <option value="webservice">Web service — 200,000 CFDI, hasta 6 días</option>
            <option value="portal">Portal — 2,000 al día, ~48 h</option>
          </CampoSelect>
          <CampoTexto id="peajeDiasAviso" name="peajeDiasAviso" tipo="number" etiqueta="Aviso de cierre de peaje (días antes)"
            defaultValue={String(cfg?.peajeDiasAviso ?? DIAS_AVISO_DEFECTO)}
            ayuda="De 1 a 25. El aviso del último día del mes sale siempre, además de éste." />
          <CampoSelect id="activa" name="activa" etiqueta="Estado" defaultValue={cfg?.activa === false ? 'pausada' : 'activa'}>
            <option value="activa">Activa — se descarga sola cada 6 h</option>
            <option value="pausada">Pausada — no se pide nada</option>
          </CampoSelect>
        </FormaConAviso>
      </Tarjeta>

      {/* ── 4. PEDIR UN RANGO A MANO ──────────────────────────────── */}
      <Tarjeta titulo="Pedir un periodo a mano">
        <p className="rv-sat__texto">
          Para un periodo viejo que el barrido automático no va a alcanzar pronto. Máximo{' '}
          {VENTANA_MAX_DIAS} días por solicitud. El SAT tarda: la solicitud queda abierta y
          Likida la revisa sola cada 6 horas. Cada solicitud consume el tope diario de tu RFC,
          así que un rango que ya está en curso se rechaza en vez de pedirse dos veces.
        </p>
        <FormaConAviso accion={pedir} boton="Pedir al SAT" columnas="md:grid-cols-3">
          <CampoFecha id="desde" name="desde" etiqueta="Desde" defaultValue={`${hoy.slice(0, 8)}01`} obligatorio />
          <CampoFecha id="hasta" name="hasta" etiqueta="Hasta" defaultValue={hoy} obligatorio />
          <CampoSelect id="tipo" name="tipo" etiqueta="Qué buzón" defaultValue="recibidos">
            <option value="recibidos">Recibidos — lo que te timbraron (el que te sirve)</option>
            <option value="emitidos">Emitidos — lo que tú facturaste</option>
          </CampoSelect>
        </FormaConAviso>
      </Tarjeta>

      {/* ── 5. LAS SOLICITUDES ────────────────────────────────────── */}
      {datos.solicitudes.length > 0 && (
        // FE-34: "Tus solicitudes" es siempre "las 12 más recientes" (`TOPE_SOLICITUDES`), nunca el historial completo.
        <Tarjeta titulo={datos.solicitudes.length >= TOPE_SOLICITUDES ? `Tus solicitudes — las ${TOPE_SOLICITUDES} más recientes` : 'Tus solicitudes'}>
          <TablaBase<Solicitud> etiqueta="Descargas del SAT por periodo" columnas={columnas} filas={datos.solicitudes}
            idFila={(s) => s.id} altoMaximo={false} tarjetaMovil />
        </Tarjeta>
      )}

      {/* ── 6. EL CHECKLIST QUE NADIE MÁS TE VA A DECIR ───────────── */}
      <Tarjeta titulo="Para que estos comprobantes lleguen solos, tu flota tiene que…">
        <p className="rv-sat__texto">
          La descarga recoge lo que el comercio YA timbró a tu RFC. Si el comercio no sabe tu
          RFC, o tu contrato no es del tipo que timbra por periodo, no hay nada que recoger —
          aunque el TAG esté activo y cruzando todos los días.
        </p>
        <ol className="rv-sat__pasos">
          {CHECKLIST.map((p, i) => (
            <li key={i} className="rv-sat__paso">
              <p className="rv-sat__que">
                <StatusChip tono={p.cae ? 'ok' : 'warn'}>{p.cae ? 'Cae solo' : 'NO cae solo'}</StatusChip>{' '}
                {p.que}
              </p>
              <p className="rv-sat__texto">{p.porque}</p>
            </li>
          ))}
        </ol>
      </Tarjeta>
    </MarcoPagina>
  );
}
