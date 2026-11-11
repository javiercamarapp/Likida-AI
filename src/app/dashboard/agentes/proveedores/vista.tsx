import { Inbox, Download, Mail } from 'lucide-react';
import './proveedores.css';
import type { FacturaProveedor } from '@/lib/likida/proveedores';
import type { BuzonDeFlota } from '@/lib/correo/buzon_escritura';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { AvisoCompacto, Boton, Disclosure, EstadoVacio, Icono, MarcoPagina, StatusChip, Tarjeta, type TonoEstado } from '@/app/ui-v2/componentes';
import { SelloDato, TablaLista, type ColumnaTabla, type ParamsURL } from '@/app/ui-v2/datos';
import { ahoraMs } from '@/lib/saludo';


/** El tope de `listarFacturasProveedor` que usa la página — declarado aquí
 *  porque es la vista la que tiene que confesarlo (FE-13). Si la página
 *  cambia su límite, este número cambia con él. */
const TOPE_FACTURAS = 100;
/** Tope de pendientes que la página lee APARTE de las recientes (A37-S15-02). */
const TOPE_PENDIENTES = 500;
import { BotonVerPdf } from './controles_buzon';
import {
  SubirFactura, SubirFotoFactura, BotonesDecision, DireccionBuzon, GenerarBuzon, RotarBuzon,
  type AccionProveedores,
} from './controles';
import { TR_ES, type TrAgentes, rico, selloHoyTr } from '../i18n-agentes';

/**
 * La ventana del Agente de Proveedores (F6): la bandeja donde el XML del
 * taller espera la decisión de un humano, y el export que sustituye la
 * captura manual en el ERP. El agente prepara y marca (receptor ajeno,
 * duplicados); la persona decide — nunca al revés.
 */
export function VistaAgenteProveedores({
  facturas, rfcFlota, sufijo, acciones, notificaciones, ficha,
  buzon, dominioConfigurado, puedeAdministrarBuzon, entrega, recepcion, params = {}, tr = TR_ES,
}: {
  /** Los parámetros de la URL (`searchParams`): la bandeja ordena y pagina por ellos (`orden`, `dir`, `pag`) y los conserva todos. */
  params?: ParamsURL;
  facturas: FacturaProveedor[];
  rfcFlota: string | null;
  sufijo: string;
  acciones: {
    subirFactura: AccionProveedores; subirFoto: AccionProveedores; decidir: AccionProveedores;
    generarBuzon: AccionProveedores; rotarBuzon: AccionProveedores;
    /** «Ver PDF» de una factura del buzón (URL firmada). Sin ella no se pinta el botón. */
    verPdf?: AccionProveedores;
  };
  /** La entrega al contador y lo recibido por correo (Agente 9), ya renderizadas por la página: ReactNode y no
   *  datos, porque esas secciones traen el repositorio del buzón (`supabaseAdmin`). */
  entrega?: React.ReactNode;
  recepcion?: React.ReactNode;
  /** La ficha de corridas ya renderizada (`FichaCorridas`). ReactNode y no
   *  datos por la misma razón que las notificaciones: esta vista no debe
   *  importar el módulo de corridas, que trae `supabaseAdmin`. */
  ficha?: React.ReactNode;
  /** El buzón de intake, o `null` si su lectura falló — la sección lo dice en
   *  vez de fingir que no hay buzón. */
  buzon: BuzonDeFlota | null;
  /** ¿Hay `RESEND_EMAIL_DOMAIN`? Sin él no existe dirección que enseñar NI
   *  que generar, y la sección lo dice en vez de armar una que no existe. */
  dominioConfigurado: boolean;
  /** Generar/rotar es CONTROL (`puedeAdministrar`), no dato: el botón solo se
   *  pinta al dueño — y la server action lo vuelve a comprobar de todos modos. */
  puedeAdministrarBuzon: boolean;
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  // FE-13: `listarFacturasProveedor` trae las `TOPE_FACTURAS` más recientes.
  // Los cuatro KPIs de abajo se calculan sobre ESAS, así que cuando la lectura
  // viene llena hay que decirlo — si no, "Esperan tu decisión: 100" se lee
  // como el total del buzón y puede ser el tope tocado.
  const topeTocado = facturas.length >= TOPE_FACTURAS;
  const pendientes = facturas.filter((f) => f.estado === 'pendiente');
  const aprobadas = facturas.filter((f) => f.estado === 'aprobada');
  const rechazadas = facturas.filter((f) => f.estado === 'rechazada');
  const receptorAjeno = pendientes.filter((f) => f.receptorEsFlota === false).length;
  const sinExportar = aprobadas.filter((f) => f.exportadaEn === null).length;
  const exportadas = aprobadas.length - sinExportar;

  return (
    <MarcoPagina titulo={tx('proveedores.vista.facturas_de_proveedores')} apoyo={tx('proveedores.vista.la_bandeja_donde_el_xml')}>

      <TiraCifras sello={selloHoyTr(tr, tx('proveedores.vista.sello_facturas_de_proveedores'))}>
        <Cifra info="proveedores.esperan_decision" etiqueta={tx('proveedores.vista.esperan_tu_decision')} valor={numero(pendientes.length)}
          tono={pendientes.length > 0 ? 'warn' : undefined} />
        <Cifra info="proveedores.aprobadas" etiqueta={tx('proveedores.vista.aprobadas')} valor={numero(aprobadas.length)}
          nota={aprobadas.length === 0 ? undefined
            : tx('proveedores.vista.sin_exportar_ya_exportadas', { sinExportar: numero(sinExportar), exportadas: numero(exportadas) })} />
        <Cifra info="proveedores.rechazadas" etiqueta={tx('proveedores.vista.rechazadas')} valor={numero(rechazadas.length)} />
        <Cifra info="proveedores.receptor_ajeno" etiqueta={tx('proveedores.vista.con_receptor_ajeno')} valor={numero(receptorAjeno)}
          nota={tx('proveedores.vista.el_cfdi_no_es_a')} tono={receptorAjeno > 0 ? 'bad' : undefined} />
      </TiraCifras>

      {topeTocado && (
        <AvisoCompacto tono="info" resumen={<>
          {tx('proveedores.vista.las_aprobadas_rechazadas_y_el', { TOPE_FACTURAS: numero(TOPE_FACTURAS), hasta: pendientes.length >= TOPE_PENDIENTES ? tx('proveedores.vista.hasta_hay_mas_por_decidir', { TOPE_PENDIENTES: numero(TOPE_PENDIENTES) }) : '' })}
        </>} />
      )}

      <Tarjeta titulo={tx('proveedores.vista.subir_factura_de_proveedor')} info="proveedores.subir">
        <p className="rv-prov__nota">
          {rico(tx('proveedores.vista.el_xml_es_el_dato'), { rfc: rfcFlota
            ? <>{tx('proveedores.vista.rfc_valida', { rfc: rfcFlota })}</>
            : <>{tx('proveedores.vista.tu_flota_aun_no_tiene')}</> })}
        </p>
        <div className="rv-prov__subir">
          <SubirFactura subirFactura={acciones.subirFactura} />
          <SubirFotoFactura subirFoto={acciones.subirFoto} />
        </div>
        {aprobadas.length > 0 && (
          <div className="rv-prov__export">
            <BotonExport href={linkExport(sufijo, 'sap_b1')} rotulo="Exportar aprobadas (CSV SAP B1)" />
            <BotonExport href={linkExport(sufijo, 'contpaqi')} rotulo="Exportar aprobadas (CSV CONTPAQi)" />
            <p className="rv-prov__nota">
              {tx('proveedores.vista.layout_estandar_de_importacion_valid')}
            </p>
          </div>
        )}
      </Tarjeta>

      <SeccionBuzon tr={tr}
        buzon={buzon}
        dominioConfigurado={dominioConfigurado}
        puedeAdministrarBuzon={puedeAdministrarBuzon}
        acciones={{ generarBuzon: acciones.generarBuzon, rotarBuzon: acciones.rotarBuzon }}
      />

      {recepcion}

      <Tarjeta titulo={tx('proveedores.vista.la_bandeja')} info="proveedores.bandeja">
        <p className="rv-prov__nota">{tx('proveedores.vista.pendientes_arriba_lo_decidido_queda')}</p>
        {facturas.length === 0 ? (
          <EstadoVacio titulo={tx('proveedores.vista.sin_facturas_de_proveedor')} icono={Inbox} contenido>
            {tx('proveedores.vista.aun_no_hay_facturas_de')}
          </EstadoVacio>
        ) : (
          <>
            <TablaLista<FacturaProveedor>
              etiqueta={tx('proveedores.vista.bandeja_de_facturas_de_proveedor')}
              columnas={columnasBandeja(acciones, tr)}
              filas={[...pendientes, ...aprobadas, ...rechazadas]}
              idFila={(f) => f.id}
              base="/dashboard/agentes/proveedores"
              params={params}
              orden="local"
              paginacion={{ tamano: 25 }}
              atributosFila={(f) => ({ 'data-estado': f.estado })}
            />
            <div className="rv-tl__sellos">
              <SelloDato tipo="observado" fuente={tx('proveedores.vista.buzon_de_facturas')} leidoEn={ahoraMs()} edad={false} />
            </div>
          </>
        )}
      </Tarjeta>

      {entrega}

      <Disclosure titulo={tx('proveedores.vista.que_son_los_csv_de')}>
      <p className="rv-prov__nota">
        {tx('proveedores.vista.los_csv_usan_el_layout')}
      </p>
      </Disclosure>

      {ficha}

      {notificaciones}
    </MarcoPagina>
  );
}

/**
 * EL BUZÓN DE INTAKE (C1, auditoría 4): la dirección de correo de la flota a
 * la que los proveedores mandan —o el contador reenvía— sus facturas, y los
 * XML adjuntos entran solos a esta bandeja (`api/correo/entrante`).
 *
 * La columna `tenant.buzon_token` existía desde la 0095 y el webhook la leía,
 * pero NADIE la escribía: 0 flotas con buzón en producción. Esta sección es
 * quien la llena. Exportada para poder probar su gateo por render.
 */
export function SeccionBuzon({ buzon, dominioConfigurado, puedeAdministrarBuzon, acciones, tr = TR_ES }: {
  buzon: BuzonDeFlota | null;
  dominioConfigurado: boolean;
  puedeAdministrarBuzon: boolean;
  acciones: { generarBuzon: AccionProveedores; rotarBuzon: AccionProveedores }; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  return (
    <Tarjeta titulo={tx('proveedores.vista.buzon_de_facturas_por_correo')} info="proveedores.buzon">
      <p className="rv-prov__nota">
        {tx('proveedores.vista.dale_esta_direccion_a_tus')}
      </p>

      {buzon === null ? (
        // La lectura falló. NO se dice "sin buzón": ese estado ofrecería generar uno encima del que quizá ya existe, y rotarlo sin querer.
        <AvisoCompacto tono="error" resumen={tx('proveedores.vista.no_se_pudo_leer_el')} />
      ) : !dominioConfigurado ? (
        // Sin RESEND_EMAIL_DOMAIN no hay dirección que enseñar ni que generar: se dice qué falta en vez de armar una que no existe.
        <EstadoVacio titulo={tx('proveedores.vista.buzon_no_disponible')} icono={Mail} contenido>
          {tx('proveedores.vista.el_dominio_de_correo_no')}
        </EstadoVacio>
      ) : buzon.direccion ? (
        <div className="rv-prov__subir">
          <DireccionBuzon direccion={buzon.direccion} />
          {puedeAdministrarBuzon && <RotarBuzon rotar={acciones.rotarBuzon} />}
        </div>
      ) : (
        <div className="rv-prov__subir">
          <p className="rv-prov__nota">
            {tx('proveedores.vista.tu_flota_aun_no_tiene_2')}
          </p>
          {puedeAdministrarBuzon
            ? <GenerarBuzon generar={acciones.generarBuzon} />
            : <p className="rv-prov__nota">{tx('proveedores.vista.generarla_es_una_accion_del')}</p>}
        </div>
      )}
    </Tarjeta>
  );
}

const ORDEN_ESTADO = { pendiente: 0, aprobada: 1, rechazada: 2 } as const;

/** Las columnas de la bandeja. Por omisión el orden es el de siempre (pendientes arriba, luego aprobadas y rechazadas); cada cabecera
 *  con dato se puede ordenar (`?orden=total&dir=desc`), y la página (`?pag=2`) vive en la URL junto con tenant/vista/rol. */
function columnasBandeja(acciones: { decidir: AccionProveedores; verPdf?: AccionProveedores }, tr: TrAgentes): ColumnaTabla<FacturaProveedor>[] {
  const { t: tx } = tr;
  const idioma = tr.idioma;
  return [
    {
      id: 'fecha', titulo: tx('proveedores.vista.fecha'), corta: true, valor: (f) => f.fecha,
      celda: (f) => (
        <span className="rv-tl__apagado">
          {f.fecha ? fechaCorta(f.fecha, idioma) : '—'}
          {/* NULL = fila anterior al rastreo de origen (0108): no se adivina. */}
          {f.origen && <span className="rv-tl__sub">{f.origen === 'correo' ? 'por correo' : 'subida a mano'}</span>}
        </span>
      ),
    },
    {
      id: 'proveedor', titulo: tx('proveedores.vista.proveedor_rfc'), principal: true, valor: (f) => f.emisorRfc,
      celda: (f) => (
        <>
          <span className="cifra-mono block">{f.emisorRfc ?? tx('proveedores.vista.sin_rfc')}</span>
          {f.receptorEsFlota === false && (
            <StatusChip tono="bad">{tx('proveedores.vista.receptor_ajeno')}</StatusChip>
          )}
          {f.receptorEsFlota === null && <span className="rv-tl__sub">{tx('proveedores.vista.receptor_sin_validar')}</span>}
        </>
      ),
    },
    {
      id: 'concepto', titulo: tx('proveedores.vista.concepto'), valor: (f) => f.descripcion,
      celda: (f) => (
        <>
          <span className="block truncate max-w-[26ch]" title={f.descripcion ?? undefined}>
            {f.descripcion ?? tx('proveedores.vista.sin_descripcion_en_el_xml')}
          </span>
          {f.conceptos > 1 && (
            <span className="rv-tl__sub">{tr.tp('proveedores.vista.y_concepto_mas', f.conceptos - 1, { n: numero(f.conceptos - 1) })}</span>
          )}
          {/* Cifra leída por VISIÓN, no del XML: se dice siempre, con su
              confianza, para que nadie apruebe un OCR como dato duro. */}
          {f.requiereRevision && (
            <StatusChip tono="warn">{f.revisionMotivo ?? tx('proveedores.vista.lectura_de_pdf_cotejala_antes')}</StatusChip>
          )}
          {f.tienePdf && acciones.verPdf && (
            <span className="block mt-1"><BotonVerPdf campo="facturaId" id={f.id} ver={acciones.verPdf} /></span>
          )}
          {f.ocrConfianza !== null && (
            <StatusChip tono="warn">{tx('proveedores.vista.leida_de_ocr_revisa_contra', { fuente: f.fuenteDatos === 'pdf_texto' || f.fuenteDatos === 'pdf_vision' ? tx('proveedores.vista.fuente_pdf') : tx('proveedores.vista.fuente_foto'), ocrConfianza: numero(f.ocrConfianza) })}</StatusChip>
          )}
        </>
      ),
    },
    { id: 'total', titulo: tx('proveedores.vista.total'), alinear: 'der', valor: (f) => f.total, celda: (f) => <span className="cifra-mono">{mxn(f.total, idioma)}</span> },
    {
      id: 'estado', titulo: tx('proveedores.vista.estado'), corta: true, valor: (f) => ORDEN_ESTADO[f.estado],
      celda: (f) => (<><PillEstado f={f} tr={tr} /><NotaSat estadoSat={f.estadoSat} tr={tr} /></>),
    },
    {
      id: 'decidir', titulo: tx('proveedores.vista.decidir'), alinear: 'der',
      celda: (f) => f.estado === 'pendiente'
        ? <BotonesDecision facturaId={f.id} decidir={acciones.decidir} />
        : <span className="rv-tl__sub rv-tl__der">{f.decididoPor ?? '—'}{f.decididoEn ? ` · ${fechaCorta(f.decididoEn, idioma)}` : ''}</span>,
    },
  ];
}

/** El link del export arrastrando el `?tenant=`/`?vista=`/`?rol=` de la
 *  previsualización — perderlo mandaría el CSV de otra flota. */
function linkExport(sufijo: string, formato: 'sap_b1' | 'contpaqi'): string {
  return `/api/export/facturas-proveedor${sufijo ? `${sufijo}&` : '?'}formato=${formato}`;
}

/** CT-SEG-17: exportar MARCA las facturas como exportadas, así que es un formulario POST y no un enlace GET. */
function BotonExport({ href, rotulo }: { href: string; rotulo: string }) {
  return (
    <form method="post" action={href}>
      <Boton type="submit" variante="secondary" tamano="sm" icono={<Icono icono={Download} tam={14} />}>{rotulo}</Boton>
    </form>
  );
}

/** El estatus ante el SAT, consultado AL INGERIR. null = fila anterior a la
 *  0108 (no se consultó y se dice); 'pendiente' = se intentó y el SAT no
 *  contestó. Un CFDI cancelado grita: aprobarlo mandaría al ERP una factura
 *  que el SAT ya no reconoce. */
function NotaSat({ estadoSat, tr = TR_ES }: { estadoSat: FacturaProveedor['estadoSat']; tr?: TrAgentes; }) {
  const { t: tx } = tr;
  if (estadoSat === 'vigente') return <StatusChip tono="ok">{tx('proveedores.vista.vigente_ante_el_sat')}</StatusChip>;
  if (estadoSat === 'cancelado') return <StatusChip tono="bad">{tx('proveedores.vista.cancelado_ante_el_sat')}</StatusChip>;
  // El SAT no reconoce ese folio fiscal — la señal más fuerte de un CFDI inventado: MISMO tratamiento que 'cancelado'.
  if (estadoSat === 'no_encontrado') return <StatusChip tono="bad">{tx('proveedores.vista.el_sat_no_lo_encuentra')}</StatusChip>;
  return <StatusChip tono="muted">{estadoSat === 'pendiente' ? tx('proveedores.vista.sat_sin_contestar_al_ingerir') : tx('proveedores.vista.sat_sin_consultar')}</StatusChip>;
}

function PillEstado({ f, tr = TR_ES }: { f: FacturaProveedor; tr?: TrAgentes }) {
  const { t: tx } = tr;
  // «Exportada» no borra la decisión: es una aprobada que YA salió en un CSV (`exportada_en`, 0108): el anti-doble-import visible.
  const cfg: { rotulo: string; tono: TonoEstado } = f.estado === 'aprobada'
    ? f.entregadaEn
      ? { rotulo: tx('proveedores.vista.est_entregada'), tono: 'ok' }
      : f.exportadaEn
        ? { rotulo: tx('proveedores.vista.est_exportada'), tono: 'ok' }
        : { rotulo: tx('proveedores.vista.est_aprobada'), tono: 'ok' }
    : f.estado === 'rechazada'
      ? { rotulo: tx('proveedores.vista.est_rechazada'), tono: 'muted' }
      : { rotulo: tx('proveedores.vista.est_pendiente'), tono: 'warn' };
  return <StatusChip tono={cfg.tono}>{cfg.rotulo}</StatusChip>;
}
