import { getT } from '@/lib/i18n/servidor';
import { type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
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
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import {
  AvisoCompacto, BotonEnlace, CampoFecha, CampoSelect, CampoTexto, EstadoVacio, FilaTarjetas, FormaConAviso, Icono, StatusChip, TablaBase, Tarjeta,
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
const checklist = (tr: Tr): Array<{ que: string; porque: string; cae: boolean }> => [
  {
    que: tr('descargaSat.vista.darDeAltaTus'),
    porque: tr('descargaSat.vista.cuandoPagasConMonedero'),
    cae: true,
  },
  {
    que: tr('descargaSat.vista.darDeAltaTus2'),
    porque: tr('descargaSat.vista.conElAltaHecha'),
    cae: true,
  },
  {
    que: tr('descargaSat.vista.pedirAPase'),
    porque: tr('descargaSat.vista.soloEnEsaModalidad'),
    cae: true,
  },
  {
    que: tr('descargaSat.vista.facturarEnElPortal'),
    porque: tr('descargaSat.vista.yHayPrisaPase'),
    cae: false,
  },
];
export async function VistaDescargaSat({ searchParams, tenantExiste = true }: {
  searchParams: { vista?: string; tenant?: string; rol?: string };
  tenantExiste?: boolean;
}) {
  const { t: tr } = await getT('dinero');
  const { tenantId } = await resolverTenantEfectivo('/dashboard/descarga-sat', searchParams);
  const proveedor = estadoDescargaSat();
  const datos: VistaDescargaSat = tenantExiste
    ? await leerDescargaSat(tenantId)
    : { config: null, solicitudes: [], conteos: null, incompleta: false };
  const hoy = hoyMx(new Date());

  async function guardar(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    // El rol del render NO es el de la acción: se re-gatea adentro, mismo
    // criterio que Políticas y el estímulo de peaje.
    const s = await resolverTenantAtadoOLanza('/dashboard/descarga-sat', searchParams, tenantId);
    if (!puedeVerRuta(s.rol, '/dashboard/descarga-sat')) {
      return { error: tr('descargaSat.vista.tuRolNoPuede') };
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
    return { ok: tr('descargaSat.vista.configuracionGuardadaElSigui') };
  }

  async function verificar(): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoOLanza('/dashboard/descarga-sat', searchParams, tenantId);
    if (!puedeVerRuta(s.rol, '/dashboard/descarga-sat')) {
      return { error: tr('descargaSat.vista.tuRolNoPuede2') };
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
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoOLanza('/dashboard/descarga-sat', searchParams, tenantId);
    if (!puedeVerRuta(s.rol, '/dashboard/descarga-sat')) {
      return { error: tr('descargaSat.vista.tuRolNoPuede3') };
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
    { id: 'periodo', titulo: tr('descargaSat.vista.periodo'), principal: true, celda: (s) => `${fechaMx(s.desde)} → ${fechaMx(s.hasta)}` },
    { id: 'buzon', titulo: tr('descargaSat.vista.buzon'), celda: (s) => s.tipo },
    { id: 'estado', titulo: tr('descargaSat.vista.estado'), celda: (s) => <StatusChip tono="neutral">{s.estado}</StatusChip> },
    // NULL = no se ha ingerido; 0 = se ingirió y no había nada.
    { id: 'nuevos', titulo: tr('descargaSat.vista.cfdiNuevos'), alinear: 'der', celda: (s) => (s.cfdisNuevos === null ? <span className="rv-sat__tenue" title={tr('descargaSat.vista.todaviaNoSeHa')}>—</span> : s.cfdisNuevos) },
    // El mensaje del proveedor TAL CUAL.
    { id: 'sat', titulo: tr('descargaSat.vista.loQueDijoEl'), celda: (s) => <span className="rv-sat__tenue">{s.mensaje ?? ''}</span> },
  ];
  const sufijoBandeja = sufijoTenant(searchParams) ? `&${sufijoTenant(searchParams).slice(1)}` : '';

  const cifrasBase: PropsCifra[] = [
    { etiqueta: tr('descargaSat.vista.cfdiBajadosDelBuzon'), info: 'descarga_sat.bajados', icono: <Icono icono={CloudDownload} />, valor: c?.descargados ?? null, formato: 'entero', nota: tr('descargaSat.vista.foliosFiscalesUnicosEl') },
    { etiqueta: tr('descargaSat.vista.casaronSolosConUn'), info: 'descarga_sat.casados', icono: <Icono icono={Link2} />, valor: c?.casados ?? null, formato: 'entero', nota: tr('descargaSat.vista.quedaronFacturadosSinQue') },
    { etiqueta: tr('descargaSat.vista.esperanQueTuDecidas'), info: 'descarga_sat.ambiguos', icono: <Icono icono={FileQuestion} />, valor: c?.ambiguos ?? null, formato: 'entero', nota: tr('descargaSat.vista.variosGastosEmpatanLikida') },
    { etiqueta: tr('descargaSat.vista.sinGastoQueLes'), info: 'descarga_sat.disponibles', icono: <Icono icono={FileCheck2} />, valor: c?.disponibles ?? null, formato: 'entero', nota: tr('descargaSat.vista.puedeSerUnGasto') },
    { etiqueta: tr('descargaSat.vista.archivadosAProposito'), info: 'descarga_sat.ignorados', icono: <Icono icono={Archive} />, valor: c?.ignorados ?? null, formato: 'entero', nota: tr('descargaSat.vista.consolidadosQueYaEntraron') },
  ];
  const cifras: PropsCifra[] = cifrasBase.map((x) => (x.valor === null ? { ...x, estado: 'vacio', mensaje: tr('descargaSat.vista.noSePudoLeer') } : x));

  // Los avisos de arriba (a lo sumo dos, Rovaq): el proveedor sin configurar y la lectura incompleta. El texto largo de «qué es esto» va en la tarjeta de conexión.
  const avisos = (
    <>
      {!proveedor.configurado && <AvisoCompacto tono="warn" resumen={proveedor.motivo} />}
      {datos.incompleta && (
        <AvisoCompacto tono="warn" resumen={tr('descargaSat.vista.faltanDatosPorCargar')}
          mas={tr('descargaSat.vista.unaOMasLecturas')} />
      )}
    </>
  );

  return (
    <EsqueletoPanelCifras
      titulo="SAT"
      apoyo={tr('descargaSat.vista.losCfdiQueTus')}
      avisos={avisos}
      cifras={cifras}
      etiquetaCifras={tr('descargaSat.vista.buzonDelSat')}
      selloCifras={selloHoy(tr('descargaSat.vista.buzonDelSat'))}
    >
      {/* ── LA PUERTA A LAS FILAS (0243): los cuatro cubos que SÍ son colas de trabajo llevan a su lista, filtrada — el conteo deja de ser una cifra huérfana. */}
      <div className="rv-sat__filas">
        <span className="rv-sat__tenue">{tr('descargaSat.vista.verLasFilas')}</span>
        {([
          ['ambiguo', tr('descargaSat.vista.losQueEsperanTu')],
          ['disponible', tr('descargaSat.vista.losQueNingunGasto')],
          ['casado', tr('descargaSat.vista.losQueYaCuadraron')],
          ['ignorado', tr('descargaSat.vista.losArchivados')],
        ] as const).map(([e, texto]) => (
          <BotonEnlace key={e} href={`/dashboard/descarga-sat/bandeja?estatus=${e}${sufijoBandeja}`} variante="secondary" tamano="sm"
            icono={<Icono icono={Scale3d} />}>
            {texto}
          </BotonEnlace>
        ))}
      </div>

      <FilaTarjetas variante="6-6">
      {/* ── 1. QUÉ FALTA Y QUIÉN LO DESTRABA. Antes que ninguna cifra. */}
      <Tarjeta titulo={tr('descargaSat.vista.losComprobantesQueEl')} info="descarga_sat.intro">
        <div className="rv-sat__bloque">
          <p className="rv-sat__texto">
            {tr('descargaSat.vista.todoCfdiQueUn')}
          </p>
          {/* La pregunta que un contador hace antes de subir nada. */}
          <p className="rv-sat__texto">
            {rico(tr('descargaSat.vista.strongTuEFirma'), { strong: (c) => <strong>{c}</strong> })}
          </p>
          {proveedor.configurado && (
            <p className="rv-sat__texto">
              {tr('descargaSat.vista.proveedorConectadoNoHay', { v: proveedor.proveedor?.toUpperCase() ?? '' })}
            </p>
          )}
        </div>
      </Tarjeta>

      {/* ── 2. EL ESTADO ─────────────────────────────────────────── */}
      <Tarjeta titulo={tr('descargaSat.vista.tuConexion')}>
        {cfg === null ? (
          <EstadoVacio titulo={tr('descargaSat.vista.buzonSinDeclarar')} icono={FileQuestion} contenido>
            {tr('descargaSat.vista.todaviaNoHasDeclarado')}
          </EstadoVacio>
        ) : (
          <div className="rv-sat__bloque">
            <p className="rv-sat__texto">
              RFC {cfg.rfc} {tr('descargaSat.vista.modo')} {cfg.modo === 'webservice'
                ? tr('descargaSat.vista.webService2000002')
                : tr('descargaSat.vista.portal2000Documentos')}
              {' · '}{cfg.activa ? tr('descargaSat.vista.activa') : tr('descargaSat.vista.pausada')}.
              {' '}{tr('descargaSat.vista.efirmaDosPuntos')} {cfg.certificadoNumero
                ? tr('descargaSat.vista.cargadaEnLaBoveda', { certificadoNumero: cfg.certificadoNumero, v: cfg.certificadoVenceEn ? tr('descargaSat.vista.venceEl', { v: fechaMx(cfg.certificadoVenceEn) }) : '' })
                : cfg.verificadaEn
                  ? tr('descargaSat.vista.noSeEncontroEn')
                  : tr('descargaSat.vista.sinVerificarTodavia')}.
              {' '}{tr('descargaSat.vista.ultimaDescarga')} {cfg.ultimaDescargaHasta
                ? tr('descargaSat.vista.hastaEl', { v: fechaMx(cfg.ultimaDescargaHasta) })
                : tr('descargaSat.vista.ningunaTodaviaLaPrimera')}.
            </p>
            <FormaConAviso accion={verificar} boton={tr('descargaSat.vista.verificarMiEFirma')} columnas="md:grid-cols-1">
              <p className="rv-sat__tenue">
                {tr('descargaSat.vista.preguntaAlPacSi')}
              </p>
            </FormaConAviso>
          </div>
        )}
      </Tarjeta>

      </FilaTarjetas>
      <FilaTarjetas variante="6-6">
      {/* ── 3. DECLARAR LA CONEXIÓN ───────────────────────────────── */}
      <Tarjeta titulo={tr('descargaSat.vista.declaraTuBuzon')}>
        <p className="rv-sat__texto">
          {tr('descargaSat.vista.elRfcDelQue')}
        </p>
        <FormaConAviso accion={guardar} boton="Guardar" columnas="md:grid-cols-4">
          <CampoTexto id="rfc" name="rfc" etiqueta={tr('descargaSat.vista.rfcDelBuzon')} defaultValue={cfg?.rfc ?? ''} placeholder="EKU9003173C9" obligatorio />
          <CampoSelect id="modo" name="modo" etiqueta={tr('descargaSat.vista.servicioDelSat')} defaultValue={cfg?.modo ?? 'webservice'}>
            <option value="webservice">{tr('descargaSat.vista.webService200000')}</option>
            <option value="portal">{tr('descargaSat.vista.portal2000Al')}</option>
          </CampoSelect>
          <CampoTexto id="peajeDiasAviso" name="peajeDiasAviso" tipo="number" etiqueta={tr('descargaSat.vista.avisoDeCierreDe')}
            defaultValue={String(cfg?.peajeDiasAviso ?? DIAS_AVISO_DEFECTO)}
            ayuda={tr('descargaSat.vista.de1A25')} />
          <CampoSelect id="activa" name="activa" etiqueta={tr('descargaSat.vista.estado')} defaultValue={cfg?.activa === false ? 'pausada' : 'activa'}>
            <option value="activa">{tr('descargaSat.vista.activaSeDescargaSola')}</option>
            <option value="pausada">{tr('descargaSat.vista.pausadaNoSePide')}</option>
          </CampoSelect>
        </FormaConAviso>
      </Tarjeta>

      {/* ── 4. PEDIR UN RANGO A MANO ──────────────────────────────── */}
      <Tarjeta titulo={tr('descargaSat.vista.pedirUnPeriodoA')}>
        <p className="rv-sat__texto">
          {tr('descargaSat.vista.paraUnPeriodoViejo', { VENTANA_MAX_DIAS })}
        </p>
        <FormaConAviso accion={pedir} boton="Pedir al SAT" columnas="md:grid-cols-3">
          <CampoFecha id="desde" name="desde" etiqueta={tr('descargaSat.vista.desde')} defaultValue={`${hoy.slice(0, 8)}01`} obligatorio />
          <CampoFecha id="hasta" name="hasta" etiqueta={tr('descargaSat.vista.hasta')} defaultValue={hoy} obligatorio />
          <CampoSelect id="tipo" name="tipo" etiqueta={tr('descargaSat.vista.queBuzon')} defaultValue="recibidos">
            <option value="recibidos">{tr('descargaSat.vista.recibidosLoQueTe')}</option>
            <option value="emitidos">{tr('descargaSat.vista.emitidosLoQueTu')}</option>
          </CampoSelect>
        </FormaConAviso>
      </Tarjeta>

      </FilaTarjetas>
      {/* ── 5. LAS SOLICITUDES ────────────────────────────────────── */}
      {datos.solicitudes.length > 0 && (
        // FE-34: "Tus solicitudes" es siempre "las 12 más recientes" (`TOPE_SOLICITUDES`), nunca el historial completo.
        <Tarjeta titulo={datos.solicitudes.length >= TOPE_SOLICITUDES ? tr('descargaSat.vista.tusSolicitudesLasMas', { TOPE_SOLICITUDES }) : tr('descargaSat.vista.tusSolicitudes')}>
          <TablaBase<Solicitud> etiqueta={tr('descargaSat.vista.descargasDelSatPor')} columnas={columnas} filas={datos.solicitudes}
            idFila={(s) => s.id} altoMaximo={false} tarjetaMovil />
        </Tarjeta>
      )}

      {/* ── 6. EL CHECKLIST QUE NADIE MÁS TE VA A DECIR ───────────── */}
      <Tarjeta titulo={tr('descargaSat.vista.paraQueEstosComprobantes')}>
        <p className="rv-sat__texto">
          {tr('descargaSat.vista.laDescargaRecogeLo')}
        </p>
        <ol className="rv-sat__pasos">
          {checklist(tr).map((p, i) => (
            <li key={i} className="rv-sat__paso">
              <p className="rv-sat__que">
                <StatusChip tono={p.cae ? 'ok' : 'warn'}>{p.cae ? tr('descargaSat.vista.caeSolo') : tr('descargaSat.vista.noCaeSolo')}</StatusChip>{' '}
                {p.que}
              </p>
              <p className="rv-sat__texto">{p.porque}</p>
            </li>
          ))}
        </ol>
      </Tarjeta>
    </EsqueletoPanelCifras>
  );
}
