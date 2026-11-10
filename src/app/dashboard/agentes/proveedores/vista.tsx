import { Inbox, Download, Mail } from 'lucide-react';
import './proveedores.css';
import type { FacturaProveedor } from '@/lib/likida/proveedores';
import type { BuzonDeFlota } from '@/lib/correo/buzon_escritura';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
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

/**
 * La ventana del Agente de Proveedores (F6): la bandeja donde el XML del
 * taller espera la decisión de un humano, y el export que sustituye la
 * captura manual en el ERP. El agente prepara y marca (receptor ajeno,
 * duplicados); la persona decide — nunca al revés.
 */
export function VistaAgenteProveedores({
  facturas, rfcFlota, sufijo, acciones, notificaciones, ficha,
  buzon, dominioConfigurado, puedeAdministrarBuzon, entrega, recepcion, params = {},
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
  notificaciones?: React.ReactNode;
}) {
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
    <MarcoPagina titulo="Facturas de proveedores" apoyo="La bandeja donde el XML del taller espera tu decisión, y el export que evita capturarlo a mano en el ERP.">

      <TiraCifras sello={selloHoy('Facturas de proveedores')}>
        <Cifra info="proveedores.esperan_decision" etiqueta="Esperan tu decisión" valor={numero(pendientes.length)}
          tono={pendientes.length > 0 ? 'warn' : undefined} />
        <Cifra info="proveedores.aprobadas" etiqueta="Aprobadas" valor={numero(aprobadas.length)}
          nota={aprobadas.length === 0 ? undefined
            : `${numero(sinExportar)} sin exportar · ${numero(exportadas)} ya exportadas`} />
        <Cifra info="proveedores.rechazadas" etiqueta="Rechazadas" valor={numero(rechazadas.length)} />
        <Cifra info="proveedores.receptor_ajeno" etiqueta="Con receptor ajeno" valor={numero(receptorAjeno)}
          nota="el CFDI no es a tu RFC" tono={receptorAjeno > 0 ? 'bad' : undefined} />
      </TiraCifras>

      {topeTocado && (
        <AvisoCompacto tono="info" resumen={<>
          Las aprobadas, rechazadas y el receptor ajeno se cuentan sobre las {numero(TOPE_FACTURAS)} facturas
          más recientes del buzón — hay más atrás. Las pendientes se leen todas
          {pendientes.length >= TOPE_PENDIENTES ? `, hasta ${numero(TOPE_PENDIENTES)}: hay más por decidir de las que caben aquí` : ''}.
        </>} />
      )}

      <Tarjeta titulo="Subir factura de proveedor" info="proveedores.subir">
        <p className="rv-prov__nota">
          El XML es el dato duro del CFDI — súbelo siempre que lo tengas. Si solo hay
          papel, la foto también entra: la IA lee las cifras y la bandeja la marca para
          revisarse contra el papel antes de aprobar. {rfcFlota
            ? <>Se valida contra el RFC de tu flota ({rfcFlota}).</>
            : <>Tu flota aún no tiene RFC capturado: la validación de receptor queda pendiente y se dice.</>}
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
              Layout estándar de importación — valídalo con tu contador o consultor SAP
              antes del primer import. Lo exportado queda marcado en la bandeja.
            </p>
          </div>
        )}
      </Tarjeta>

      <SeccionBuzon
        buzon={buzon}
        dominioConfigurado={dominioConfigurado}
        puedeAdministrarBuzon={puedeAdministrarBuzon}
        acciones={{ generarBuzon: acciones.generarBuzon, rotarBuzon: acciones.rotarBuzon }}
      />

      {recepcion}

      <Tarjeta titulo="La bandeja" info="proveedores.bandeja">
        <p className="rv-prov__nota">Pendientes arriba; lo decidido queda con su quién y su cuándo</p>
        {facturas.length === 0 ? (
          <EstadoVacio titulo="Sin facturas de proveedor" icono={Inbox} contenido>
            Aún no hay facturas de proveedor — sube el primer XML y aparece aquí
            esperando tu decisión.
          </EstadoVacio>
        ) : (
          <>
            <TablaLista<FacturaProveedor>
              etiqueta="Bandeja de facturas de proveedor"
              columnas={columnasBandeja(acciones)}
              filas={[...pendientes, ...aprobadas, ...rechazadas]}
              idFila={(f) => f.id}
              base="/dashboard/agentes/proveedores"
              params={params}
              orden="local"
              paginacion={{ tamano: 25 }}
              atributosFila={(f) => ({ 'data-estado': f.estado })}
            />
            <div className="rv-tl__sellos">
              <SelloDato tipo="observado" fuente="Buzón de facturas" leidoEn={ahoraMs()} edad={false} />
            </div>
          </>
        )}
      </Tarjeta>

      {entrega}

      <Disclosure titulo="Qué son los CSV de exportación">
      <p className="rv-prov__nota">
        Los CSV usan el layout estándar de importación de facturas de compra (SAP Business
        One por Excel/DTW; variante simple para CONTPAQi) — no una compatibilidad
        certificada: valídalos con tu contador o consultor SAP antes del primer import. La
        escritura directa al Service Layer de SAP B1 se activa con credenciales del cliente —
        este agente no la promete antes de tenerlas.
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
export function SeccionBuzon({ buzon, dominioConfigurado, puedeAdministrarBuzon, acciones }: {
  buzon: BuzonDeFlota | null;
  dominioConfigurado: boolean;
  puedeAdministrarBuzon: boolean;
  acciones: { generarBuzon: AccionProveedores; rotarBuzon: AccionProveedores };
}) {
  return (
    <Tarjeta titulo="Buzón de facturas por correo" info="proveedores.buzon">
      <p className="rv-prov__nota">
        Dale esta dirección a tus proveedores o reenvía ahí sus facturas: los XML adjuntos
        entran solos a esta bandeja, sin subir nada a mano.
      </p>

      {buzon === null ? (
        // La lectura falló. NO se dice "sin buzón": ese estado ofrecería generar uno encima del que quizá ya existe, y rotarlo sin querer.
        <AvisoCompacto tono="error" resumen="No se pudo leer el buzón de la flota ahora mismo. Recarga la página; si se repite, avísale a Likida." />
      ) : !dominioConfigurado ? (
        // Sin RESEND_EMAIL_DOMAIN no hay dirección que enseñar ni que generar: se dice qué falta en vez de armar una que no existe.
        <EstadoVacio titulo="Buzón no disponible" icono={Mail} contenido>
          El dominio de correo no está configurado en este entorno
          (lo configura el equipo de Likida), así que el buzón por
          correo no puede operar. Es configuración del sistema, no de tu flota.
        </EstadoVacio>
      ) : buzon.direccion ? (
        <div className="rv-prov__subir">
          <DireccionBuzon direccion={buzon.direccion} />
          {puedeAdministrarBuzon && <RotarBuzon rotar={acciones.rotarBuzon} />}
        </div>
      ) : (
        <div className="rv-prov__subir">
          <p className="rv-prov__nota">
            Tu flota aún no tiene dirección. Se genera una vez y es única de tu flota — el token
            en la dirección es lo que decide que esas facturas entren aquí y no a otra parte.
          </p>
          {puedeAdministrarBuzon
            ? <GenerarBuzon generar={acciones.generarBuzon} />
            : <p className="rv-prov__nota">Generarla es una acción del dueño de la flota — pídesela a tu administrador.</p>}
        </div>
      )}
    </Tarjeta>
  );
}

const ORDEN_ESTADO = { pendiente: 0, aprobada: 1, rechazada: 2 } as const;

/** Las columnas de la bandeja. Por omisión el orden es el de siempre (pendientes arriba, luego aprobadas y rechazadas); cada cabecera
 *  con dato se puede ordenar (`?orden=total&dir=desc`), y la página (`?pag=2`) vive en la URL junto con tenant/vista/rol. */
function columnasBandeja(acciones: { decidir: AccionProveedores; verPdf?: AccionProveedores }): ColumnaTabla<FacturaProveedor>[] {
  return [
    {
      id: 'fecha', titulo: 'Fecha', corta: true, valor: (f) => f.fecha,
      celda: (f) => (
        <span className="rv-tl__apagado">
          {f.fecha ? fechaCorta(f.fecha) : '—'}
          {/* NULL = fila anterior al rastreo de origen (0108): no se adivina. */}
          {f.origen && <span className="rv-tl__sub">{f.origen === 'correo' ? 'por correo' : 'subida a mano'}</span>}
        </span>
      ),
    },
    {
      id: 'proveedor', titulo: 'Proveedor (RFC)', principal: true, valor: (f) => f.emisorRfc,
      celda: (f) => (
        <>
          <span className="cifra-mono block">{f.emisorRfc ?? 'sin RFC'}</span>
          {f.receptorEsFlota === false && (
            <StatusChip tono="bad">receptor ajeno</StatusChip>
          )}
          {f.receptorEsFlota === null && <span className="rv-tl__sub">receptor sin validar</span>}
        </>
      ),
    },
    {
      id: 'concepto', titulo: 'Concepto', valor: (f) => f.descripcion,
      celda: (f) => (
        <>
          <span className="block truncate max-w-[26ch]" title={f.descripcion ?? undefined}>
            {f.descripcion ?? 'sin descripción en el XML'}
          </span>
          {f.conceptos > 1 && (
            <span className="rv-tl__sub">y {numero(f.conceptos - 1)} concepto{f.conceptos - 1 === 1 ? '' : 's'} más</span>
          )}
          {/* Cifra leída por VISIÓN, no del XML: se dice siempre, con su
              confianza, para que nadie apruebe un OCR como dato duro. */}
          {f.requiereRevision && (
            <StatusChip tono="warn">{f.revisionMotivo ?? 'lectura de PDF: cotéjala antes de aprobar'}</StatusChip>
          )}
          {f.tienePdf && acciones.verPdf && (
            <span className="block mt-1"><BotonVerPdf campo="facturaId" id={f.id} ver={acciones.verPdf} /></span>
          )}
          {f.ocrConfianza !== null && (
            <StatusChip tono="warn">leída de {f.fuenteDatos === 'pdf_texto' || f.fuenteDatos === 'pdf_vision' ? 'PDF' : 'foto'} (OCR {numero(f.ocrConfianza)}) — revisa contra el papel</StatusChip>
          )}
        </>
      ),
    },
    { id: 'total', titulo: 'Total', alinear: 'der', valor: (f) => f.total, celda: (f) => <span className="cifra-mono">{mxn(f.total)}</span> },
    {
      id: 'estado', titulo: 'Estado', corta: true, valor: (f) => ORDEN_ESTADO[f.estado],
      celda: (f) => (<><PillEstado f={f} /><NotaSat estadoSat={f.estadoSat} /></>),
    },
    {
      id: 'decidir', titulo: 'Decidir', alinear: 'der',
      celda: (f) => f.estado === 'pendiente'
        ? <BotonesDecision facturaId={f.id} decidir={acciones.decidir} />
        : <span className="rv-tl__sub rv-tl__der">{f.decididoPor ?? '—'}{f.decididoEn ? ` · ${fechaCorta(f.decididoEn)}` : ''}</span>,
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
function NotaSat({ estadoSat }: { estadoSat: FacturaProveedor['estadoSat'] }) {
  if (estadoSat === 'vigente') return <StatusChip tono="ok">vigente ante el SAT</StatusChip>;
  if (estadoSat === 'cancelado') return <StatusChip tono="bad">CANCELADO ante el SAT</StatusChip>;
  // El SAT no reconoce ese folio fiscal — la señal más fuerte de un CFDI inventado: MISMO tratamiento que 'cancelado'.
  if (estadoSat === 'no_encontrado') return <StatusChip tono="bad">el SAT NO LO ENCUENTRA — folio no reconocido</StatusChip>;
  return <StatusChip tono="muted">{estadoSat === 'pendiente' ? 'SAT sin contestar al ingerir' : 'SAT sin consultar'}</StatusChip>;
}

function PillEstado({ f }: { f: FacturaProveedor }) {
  // «Exportada» no borra la decisión: es una aprobada que YA salió en un CSV (`exportada_en`, 0108): el anti-doble-import visible.
  const cfg: { rotulo: string; tono: TonoEstado } = f.estado === 'aprobada'
    ? f.entregadaEn
      ? { rotulo: 'Entregada al contador', tono: 'ok' }
      : f.exportadaEn
        ? { rotulo: 'Exportada', tono: 'ok' }
        : { rotulo: 'Aprobada', tono: 'ok' }
    : f.estado === 'rechazada'
      ? { rotulo: 'Rechazada', tono: 'muted' }
      : { rotulo: 'Pendiente', tono: 'warn' };
  return <StatusChip tono={cfg.tono}>{cfg.rotulo}</StatusChip>;
}
