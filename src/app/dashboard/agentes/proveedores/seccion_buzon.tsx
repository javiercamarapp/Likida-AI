import { Send, Inbox } from 'lucide-react';
import type { Entrega } from '@/lib/likida/buzon/entrega_repo';
import type { Recepcion, ConteoBuzon } from '@/lib/likida/buzon/repo';
import type { ConfigEntrega } from '@/lib/likida/buzon/entrega_pura';
import { mxn, numero, fechaHoraMx, pesoArchivo } from '@/lib/formato';
import './proveedores.css';
import { StatusChip, Tarjeta, TablaBase, type ColumnaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import type { AccionProveedores } from './controles';
import { FormaEntrega, BotonEnviarAhora, BotonesLote, BotonDescartar, BotonVerPdf } from './controles_buzon';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// LAS DOS SECCIONES NUEVAS DEL BUZÓN (Agente 9): la ENTREGA AL CONTADOR y lo RECIBIDO por correo.
// Sin datos, dicen QUÉ falta; una lectura caída (`null`) lo dice en vez de pintar «nada».
// ═══════════════════════════════════════════════════════════════════════════

const rotuloLote = (tx: TAgentes = TR_ES.t): Record<Entrega['estado'], { texto: string; tono: TonoEstado }> => ({
  pendiente: { texto: tx('rest.en_cola'), tono: 'neutral' },
  enviando: { texto: tx('rest.enviando_2'), tono: 'neutral' },
  enviada: { texto: tx('rest.enviada_sin_confirmar'), tono: 'warn' },
  entregada: { texto: tx('rest.entregada'), tono: 'ok' },
  rebotada: { texto: tx('rest.reboto'), tono: 'bad' },
  fallida: { texto: tx('rest.fallo'), tono: 'bad' },
  cancelada: { texto: tx('rest.cancelada'), tono: 'muted' },
});

const rotuloFormato = (tx: TAgentes = TR_ES.t) => ({ generico: tx('rest.generico'), sap_b1: 'SAP B1', contpaqi: tx('rest.contpaqi') } as const);

export function SeccionEntrega({ config, disponible, lotes, sinEntregar, puedeAdministrar, acciones, tr = TR_ES }: {
  /** `null` = la lectura falló: se dice, no se pinta una configuración inventada. */
  config: ConfigEntrega | null;
  /** `false` = la base de este entorno aún no trae la 0531. */
  disponible: boolean;
  lotes: Entrega[] | null;
  sinEntregar: number | null;
  puedeAdministrar: boolean;
  acciones: { guardar: AccionProveedores; enviar: AccionProveedores; reintentar: AccionProveedores; cancelar: AccionProveedores }; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const columnas: readonly ColumnaBase<Entrega>[] = [
    {
      id: 'creado', titulo: tx('rest.creado'), principal: true,
      celda: (l) => (
        <>
          {fechaHoraMx(l.creadoEn)}
          <span className="rv-prov__sub">{l.disparo === 'automatica' ? tx('rest.automatico') : tx('rest.a_peticion')} · {rotuloFormato(tx)[l.formato]}</span>
        </>
      ),
    },
    { id: 'facturas', titulo: tx('rest.facturas'), celda: (l) => <span className="rv-cifra">{numero(l.nFacturas)}</span> },
    { id: 'total', titulo: tx('proveedores.vista.total'), alinear: 'der', celda: (l) => <span className="rv-cifra">{mxn(l.total)}</span> },
    {
      id: 'estado', titulo: tx('proveedores.vista.estado'),
      celda: (l) => {
        const r = rotuloLote(tx)[l.estado];
        return (
          <>
            <StatusChip tono={r.tono}>{r.texto}</StatusChip>
            {l.estado === 'pendiente' && l.intentos > 0 && <span className="rv-prov__sub">{tx('rest.intento_reintenta_solo', { intentos: l.intentos })}</span>}
            {l.estado === 'rebotada' && <span className="rv-prov__sub" data-tono="bad">{tx('rest.el_correo_reboto_revisa_la_direccion')}</span>}
            {(l.estado === 'fallida' || (l.estado === 'pendiente' && l.error)) && l.error && <span className="rv-prov__sub" data-tono="bad">{l.error}</span>}
          </>
        );
      },
    },
    {
      id: 'acciones', titulo: tx('rest.acciones'), alinear: 'der',
      celda: (l) => (puedeAdministrar && (l.estado === 'fallida' || l.estado === 'pendiente') ? (
        <BotonesLote id={l.id} puedeReintentar={l.estado === 'fallida'} puedeCancelar reintentar={acciones.reintentar} cancelar={acciones.cancelar} />
      ) : <span className="rv-prov__sub">—</span>),
    },
  ];
  return (
    <Tarjeta titulo={tx('rest.entrega_al_contador')} info="proveedores.buzon" estado={config !== null && !disponible ? 'vacio' : config === null ? 'error' : 'ok'} iconoVacio={Send}
      mensaje={config === null ? tx('rest.no_se_pudo_leer_la_configuracion_3') : tx('rest.entrega_al_contador_no_disponible')}
      detalle={tx('rest.la_entrega_al_contador_aun_no_2')}>
      {config !== null && disponible && (
        <div className="rv-prov__pila">
          <p className="rv-prov__nota">{tx('rest.las_facturas_que_tu_apruebas_salen')}</p>
          {puedeAdministrar ? (
            <FormaEntrega config={config} guardar={acciones.guardar} />
          ) : (
            <p className="rv-prov__nota">
              {config.activo
                ? <>{tx('rest.activa_se_entrega_a', { config: config.destinatarios.join(', ') })}{rotuloFormato(tx)[config.formato]}{config.automatica ? `, solo, desde las ${config.horaEnvio}:00` : tx('rest.a_peticion_2')}).</>
                : tx('rest.apagada_configurarla_es_una_accion_del')}
            </p>
          )}

          {config.activo && (
            <div className="rv-prov__linea">
              {sinEntregar === null
                ? <span className="rv-prov__nota" data-tono="bad">{tx('rest.no_se_pudo_contar_lo_pendiente')}</span>
                : sinEntregar > 0
                  ? <BotonEnviarAhora enviar={acciones.enviar} disponibles={sinEntregar} />
                  : <span className="rv-prov__nota" data-tono="faint">{tx('rest.no_hay_aprobadas_pendientes_de_entregar')}</span>}
            </div>
          )}

          <p className="rv-prov__rotulo">{tx('rest.ultimos_envios')}</p>
          {lotes === null ? (
            <p className="rv-prov__nota" data-tono="bad">{tx('rest.no_se_pudo_leer_el_historial')}</p>
          ) : lotes.length === 0 ? (
            <p className="rv-prov__nota" data-tono="faint">{tx('rest.aun_no_se_ha_enviado_ningun')}</p>
          ) : (
            <TablaBase etiqueta={tx('rest.buzones_de_proveedores')} columnas={columnas} filas={lotes} idFila={(l) => l.id} densa tarjetaMovil />
          )}
        </div>
      )}
    </Tarjeta>
  );
}

const rotuloRecepcion = (tx: TAgentes = TR_ES.t): Record<Recepcion['estado'], { texto: string; tono: TonoEstado }> => ({
  procesada: { texto: tx('rest.entro_a_la_bandeja'), tono: 'ok' },
  duplicada: { texto: tx('rest.ya_la_teniamos'), tono: 'neutral' },
  revision: { texto: tx('rest.revisala'), tono: 'warn' },
  descartada: { texto: tx('rest.descartada'), tono: 'muted' },
  ignorada: { texto: tx('rest.ignorada'), tono: 'muted' },
  rechazada: { texto: tx('rest.rechazada_por_seguridad'), tono: 'bad' },
  error: { texto: tx('rest.error'), tono: 'bad' },
});

export function SeccionRecepcion({ recepciones, conteo, acciones, tr = TR_ES }: {
  recepciones: Recepcion[] | null;
  conteo: ConteoBuzon | null;
  acciones: { descartar: AccionProveedores; verPdf: AccionProveedores }; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const columnas: readonly ColumnaBase<Recepcion>[] = [
    { id: 'recibido', titulo: tx('rest.recibido'), principal: true, celda: (r) => fechaHoraMx(r.recibidoEn) },
    {
      id: 'archivo', titulo: tx('rest.archivo'),
      celda: (r) => (
        <>
          <span className="rv-prov__mono-corto" title={r.nombre}>{r.nombre}</span>
          <span className="rv-prov__sub">{r.tipo.toUpperCase()} · {pesoArchivo(r.bytes)}{r.zipOrigen ? ` · dentro de ${r.zipOrigen}` : ''}</span>
        </>
      ),
    },
    {
      id: 'paso', titulo: tx('conductores.vista.que_paso'),
      celda: (r) => (
        <>
          <StatusChip tono={rotuloRecepcion(tx)[r.estado].tono}>{rotuloRecepcion(tx)[r.estado].texto}</StatusChip>
          {r.motivo && <span className="rv-prov__sub">{r.motivo}</span>}
        </>
      ),
    },
    {
      id: 'acciones', titulo: tx('rest.acciones'), alinear: 'der',
      celda: (r) => (
        <div className="rv-prov__acciones">
          {r.storageRuta && <BotonVerPdf campo="recepcionId" id={r.id} ver={acciones.verPdf} />}
          {r.estado === 'revision' && r.facturaId === null && <BotonDescartar id={r.id} descartar={acciones.descartar} />}
        </div>
      ),
    },
  ];
  return (
    <Tarjeta titulo={tx('rest.lo_que_ha_llegado_por_correo')} info="proveedores.buzon"
      estado={recepciones === null || conteo === null ? 'error' : recepciones.length === 0 ? 'vacio' : 'ok'} iconoVacio={Inbox}
      mensaje={recepciones === null || conteo === null ? tx('rest.no_se_pudo_leer_lo_recibido') : tx('rest.aun_no_llega_nada_por_correo')}
      detalle={tx('rest.todavia_no_llega_ningun_archivo_por')}>
      {recepciones !== null && conteo !== null && (
        <div className="rv-prov__pila">
          <p className="rv-prov__nota">{tx('rest.el_buzon_lee_xml_pdf_y')}</p>
          <div className="rv-prov__resumen">{ricoT(tx('rest.e0_archivos_en_30_dias_e0', { numero: numero(conteo.total), numero2: numero(conteo.porEstado.procesada), numero3: numero(conteo.porEstado.duplicada) }), { e0: (c) => <span>{c}</span>, e1: (c) => <span>{c}</span>, e2: (c) => <span>{c}</span> })}{conteo.facturasPorRevisar > 0 && <span data-tono="warn">{numero(conteo.facturasPorRevisar)}{' '}{tx('rest.factura_s_leida_s_de_pdf')}</span>}
            {conteo.porEstado.rechazada > 0 && <span data-tono="bad">{numero(conteo.porEstado.rechazada)}{' '}{tx('rest.rechazados_por_seguridad')}</span>}
          </div>
          <TablaBase etiqueta={tx('rest.archivos_recibidos_en_el_buzon')} columnas={columnas} filas={recepciones} idFila={(r) => r.id} densa tarjetaMovil />
        </div>
      )}
    </Tarjeta>
  );
}
