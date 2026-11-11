import { Send, Inbox } from 'lucide-react';
import type { Entrega } from '@/lib/likida/buzon/entrega_repo';
import type { Recepcion, ConteoBuzon } from '@/lib/likida/buzon/repo';
import type { ConfigEntrega } from '@/lib/likida/buzon/entrega_pura';
import { mxn, numero, fechaHoraMx, pesoArchivo } from '@/lib/formato';
import './proveedores.css';
import { StatusChip, Tarjeta, TablaBase, type ColumnaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import type { AccionProveedores } from './controles';
import { FormaEntrega, BotonEnviarAhora, BotonesLote, BotonDescartar, BotonVerPdf } from './controles_buzon';

// ═══════════════════════════════════════════════════════════════════════════
// LAS DOS SECCIONES NUEVAS DEL BUZÓN (Agente 9): la ENTREGA AL CONTADOR y lo RECIBIDO por correo.
// Sin datos, dicen QUÉ falta; una lectura caída (`null`) lo dice en vez de pintar «nada».
// ═══════════════════════════════════════════════════════════════════════════

const ROTULO_LOTE: Record<Entrega['estado'], { texto: string; tono: TonoEstado }> = {
  pendiente: { texto: 'En cola', tono: 'neutral' },
  enviando: { texto: 'Enviando', tono: 'neutral' },
  enviada: { texto: 'Enviada · sin confirmar', tono: 'warn' },
  entregada: { texto: 'Entregada', tono: 'ok' },
  rebotada: { texto: 'Rebotó', tono: 'bad' },
  fallida: { texto: 'Falló', tono: 'bad' },
  cancelada: { texto: 'Cancelada', tono: 'muted' },
};

const ROTULO_FORMATO = { generico: 'Genérico', sap_b1: 'SAP B1', contpaqi: 'CONTPAQi' } as const;

export function SeccionEntrega({ config, disponible, lotes, sinEntregar, puedeAdministrar, acciones }: {
  /** `null` = la lectura falló: se dice, no se pinta una configuración inventada. */
  config: ConfigEntrega | null;
  /** `false` = la base de este entorno aún no trae la 0531. */
  disponible: boolean;
  lotes: Entrega[] | null;
  sinEntregar: number | null;
  puedeAdministrar: boolean;
  acciones: { guardar: AccionProveedores; enviar: AccionProveedores; reintentar: AccionProveedores; cancelar: AccionProveedores };
}) {
  const columnas: readonly ColumnaBase<Entrega>[] = [
    {
      id: 'creado', titulo: 'Creado', principal: true,
      celda: (l) => (
        <>
          {fechaHoraMx(l.creadoEn)}
          <span className="rv-prov__sub">{l.disparo === 'automatica' ? 'automático' : 'a petición'} · {ROTULO_FORMATO[l.formato]}</span>
        </>
      ),
    },
    { id: 'facturas', titulo: 'Facturas', celda: (l) => <span className="cifra-mono">{numero(l.nFacturas)}</span> },
    { id: 'total', titulo: 'Total', alinear: 'der', celda: (l) => <span className="cifra-mono">{mxn(l.total)}</span> },
    {
      id: 'estado', titulo: 'Estado',
      celda: (l) => {
        const r = ROTULO_LOTE[l.estado];
        return (
          <>
            <StatusChip tono={r.tono}>{r.texto}</StatusChip>
            {l.estado === 'pendiente' && l.intentos > 0 && <span className="rv-prov__sub">intento {l.intentos}, reintenta solo</span>}
            {l.estado === 'rebotada' && <span className="rv-prov__sub" data-tono="bad">El correo rebotó: revisa la dirección del contador; sus facturas volvieron a la cola.</span>}
            {(l.estado === 'fallida' || (l.estado === 'pendiente' && l.error)) && l.error && <span className="rv-prov__sub" data-tono="bad">{l.error}</span>}
          </>
        );
      },
    },
    {
      id: 'acciones', titulo: 'Acciones', alinear: 'der',
      celda: (l) => (puedeAdministrar && (l.estado === 'fallida' || l.estado === 'pendiente') ? (
        <BotonesLote id={l.id} puedeReintentar={l.estado === 'fallida'} puedeCancelar reintentar={acciones.reintentar} cancelar={acciones.cancelar} />
      ) : <span className="rv-prov__sub">—</span>),
    },
  ];
  return (
    <Tarjeta titulo="Entrega al contador" info="proveedores.buzon" estado={config !== null && !disponible ? 'vacio' : config === null ? 'error' : 'ok'} iconoVacio={Send}
      mensaje={config === null ? 'No se pudo leer la configuración de la entrega. Recarga la página; si se repite, avísale a Likida.' : 'Entrega al contador no disponible'}
      detalle="La entrega al contador aún no está disponible en tu cuenta. Avísale a Likida y la habilita. Mientras tanto las aprobadas se descargan en CSV arriba.">
      {config !== null && disponible && (
        <div className="rv-prov__pila">
          <p className="rv-prov__nota">
            Las facturas que tú apruebas salen por correo al contador, con su CSV y un ZIP con el XML y el PDF de cada una.
            La decisión de aprobar sigue siendo de una persona; esto solo ahorra el envío.
          </p>
          {puedeAdministrar ? (
            <FormaEntrega config={config} guardar={acciones.guardar} />
          ) : (
            <p className="rv-prov__nota">
              {config.activo
                ? <>Activa: se entrega a {config.destinatarios.join(', ')} ({ROTULO_FORMATO[config.formato]}{config.automatica ? `, solo, desde las ${config.horaEnvio}:00` : ', a petición'}).</>
                : 'Apagada. Configurarla es una acción del dueño de la flota.'}
            </p>
          )}

          {config.activo && (
            <div className="rv-prov__linea">
              {sinEntregar === null
                ? <span className="rv-prov__nota" data-tono="bad">No se pudo contar lo pendiente de entregar.</span>
                : sinEntregar > 0
                  ? <BotonEnviarAhora enviar={acciones.enviar} disponibles={sinEntregar} />
                  : <span className="rv-prov__nota" data-tono="faint">No hay aprobadas pendientes de entregar.</span>}
            </div>
          )}

          <p className="rv-prov__rotulo">Últimos envíos</p>
          {lotes === null ? (
            <p className="rv-prov__nota" data-tono="bad">No se pudo leer el historial de envíos.</p>
          ) : lotes.length === 0 ? (
            <p className="rv-prov__nota" data-tono="faint">Aún no se ha enviado ningún lote.</p>
          ) : (
            <TablaBase etiqueta="Buzones de proveedores" columnas={columnas} filas={lotes} idFila={(l) => l.id} densa tarjetaMovil />
          )}
        </div>
      )}
    </Tarjeta>
  );
}

const ROTULO_RECEPCION: Record<Recepcion['estado'], { texto: string; tono: TonoEstado }> = {
  procesada: { texto: 'Entró a la bandeja', tono: 'ok' },
  duplicada: { texto: 'Ya la teníamos', tono: 'neutral' },
  revision: { texto: 'Revísala', tono: 'warn' },
  descartada: { texto: 'Descartada', tono: 'muted' },
  ignorada: { texto: 'Ignorada', tono: 'muted' },
  rechazada: { texto: 'Rechazada por seguridad', tono: 'bad' },
  error: { texto: 'Error', tono: 'bad' },
};

export function SeccionRecepcion({ recepciones, conteo, acciones }: {
  recepciones: Recepcion[] | null;
  conteo: ConteoBuzon | null;
  acciones: { descartar: AccionProveedores; verPdf: AccionProveedores };
}) {
  const columnas: readonly ColumnaBase<Recepcion>[] = [
    { id: 'recibido', titulo: 'Recibido', principal: true, celda: (r) => fechaHoraMx(r.recibidoEn) },
    {
      id: 'archivo', titulo: 'Archivo',
      celda: (r) => (
        <>
          <span className="rv-prov__mono-corto" title={r.nombre}>{r.nombre}</span>
          <span className="rv-prov__sub">{r.tipo.toUpperCase()} · {pesoArchivo(r.bytes)}{r.zipOrigen ? ` · dentro de ${r.zipOrigen}` : ''}</span>
        </>
      ),
    },
    {
      id: 'paso', titulo: 'Qué pasó',
      celda: (r) => (
        <>
          <StatusChip tono={ROTULO_RECEPCION[r.estado].tono}>{ROTULO_RECEPCION[r.estado].texto}</StatusChip>
          {r.motivo && <span className="rv-prov__sub">{r.motivo}</span>}
        </>
      ),
    },
    {
      id: 'acciones', titulo: 'Acciones', alinear: 'der',
      celda: (r) => (
        <div className="rv-prov__acciones">
          {r.storageRuta && <BotonVerPdf campo="recepcionId" id={r.id} ver={acciones.verPdf} />}
          {r.estado === 'revision' && r.facturaId === null && <BotonDescartar id={r.id} descartar={acciones.descartar} />}
        </div>
      ),
    },
  ];
  return (
    <Tarjeta titulo="Lo que ha llegado por correo" info="proveedores.buzon"
      estado={recepciones === null || conteo === null ? 'error' : recepciones.length === 0 ? 'vacio' : 'ok'} iconoVacio={Inbox}
      mensaje={recepciones === null || conteo === null ? 'No se pudo leer lo recibido. Recarga la página; si se repite, avísale a Likida.' : 'Aún no llega nada por correo'}
      detalle="Todavía no llega ningún archivo por correo. Cuando un proveedor mande una factura a tu dirección, aparece aquí.">
      {recepciones !== null && conteo !== null && (
        <div className="rv-prov__pila">
          <p className="rv-prov__nota">
            El buzón lee XML, PDF y ZIP. Un PDF sin XML se lee con IA y queda marcado para que lo cotejes antes de aprobar;
            un ZIP se abre con límites de tamaño y un archivo sospechoso se rechaza y se anota aquí con el motivo.
          </p>
          <div className="rv-prov__resumen">
            <span>{numero(conteo.total)} archivos en 30 días</span>
            <span>{numero(conteo.porEstado.procesada)} entraron</span>
            <span>{numero(conteo.porEstado.duplicada)} repetidos</span>
            {conteo.facturasPorRevisar > 0 && <span data-tono="warn">{numero(conteo.facturasPorRevisar)} factura(s) leída(s) de PDF esperan tu cotejo</span>}
            {conteo.porEstado.rechazada > 0 && <span data-tono="bad">{numero(conteo.porEstado.rechazada)} rechazados por seguridad</span>}
          </div>
          <TablaBase etiqueta="Archivos recibidos en el buzón" columnas={columnas} filas={recepciones} idFila={(r) => r.id} densa tarjetaMovil />
        </div>
      )}
    </Tarjeta>
  );
}
