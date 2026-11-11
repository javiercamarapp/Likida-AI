import Link from 'next/link';
import { ArrowLeft, Upload, Trash2, KeyRound, Inbox, RefreshCw } from 'lucide-react';
import { numero } from '@/lib/formato';

// SOLO tipos: los módulos importan supabaseAdmin y no deben entrar al bundle de la vista.
import type {
  TagVista, CasetaVista, GeocercaVista, MapeoVista, ArchivoIngestaVista, CursoVista,
} from '@/lib/likida/peajes/datos';
import { SeccionEntradas, type AccionesEntradas, type EntradasVista } from './entradas';
import { SeccionReglasCobro, type ReglasCobroVista } from './reglas-cobro';
import { SeccionTarifario, type TarifarioVista } from './tarifario';
import { SeccionUmbralesAvisos, type UmbralesAvisosVista } from './umbrales-avisos';
import { SeccionCorreoAvisos, type CorreoAvisosVista } from './correo-avisos';
import { SeccionCruceViajes, type CruceViajesVista } from './cruce-viajes';
import { SeccionInmovilizadas, type InmovilizadasConfigVista } from './inmovilizadas';
import { SeccionClasesCobro, type ClasesCobroVista } from './clases-cobro';
import { MarcoPagina, BotonEnlace, EstadoVacio, Icono, StatusChip, TituloRecuadro } from '@/app/ui-v2/componentes';
import '../peajes.css';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesConfiguracion extends AccionesEntradas {
  activarBuzon: Accion; desactivarBuzon: Accion; rotarLlave: Accion; reintentarArchivo: Accion;
  altaTag: Accion; bajaTag: Accion; importarTags: Accion;
  importarCasetas: Accion; estadoCaseta: Accion;
  guardarGeocerca: Accion; estadoGeocerca: Accion;
  importarCursos: Accion; importarCursosDeTabla: Accion; estadoCurso: Accion;
  guardarMapeo: Accion; borrarMapeo: Accion;
}

export interface BuzonVista {
  estado: 'activo' | 'inactivo' | 'ilegible';
  rotacion: number | null;
  /** ¿Está configurado PEAJES_INGESTA_SECRETO en el servidor? Sin él el endpoint rechaza todo. */
  secretoConfigurado: boolean;
  puedeAdministrar: boolean;
  /** La llave de firma de la flota; solo para quien administra y con el buzón activo. */
  llave: string | null;
  url: string;
  flotaId: string;
}

const EJEMPLO_FIRMA = `// Node 18+. LLAVE es el texto de la llave de arriba (tal cual, 64 caracteres); el cuerpo se firma TAL CUAL se manda.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
const cuerpo = JSON.stringify({
  nombre: 'corte-pase.xlsx', proveedor: 'PASE',
  contenido_base64: readFileSync('corte-pase.xlsx').toString('base64'),
});
const ts = Math.floor(Date.now() / 1000);
const firma = 'v1=' + createHmac('sha256', LLAVE)
  .update(\`\${ts}.\${FLOTA_ID}.\${cuerpo}\`).digest('hex');
await fetch(URL, { method: 'POST', body: cuerpo, headers: {
  'content-type': 'application/json', 'x-likida-flota': FLOTA_ID,
  'x-likida-timestamp': String(ts), 'x-likida-firma': firma } });`;


export function VistaConfiguracionPeajes({
  sufijo, aviso, error, agenteApagado, tags, unidades, casetas, geocercas, cursos, convenios, mapeos, archivos, tiposGeocerca, buzon, entradas, acciones, reglasCobro, tarifario, umbralesAvisos, correoAvisos, cruceViajes, inmovilizadas, clasesCobro, superficie,
}: {
  sufijo: string;
  aviso: string | null;
  error: string | null;
  agenteApagado: string | null;
  tags: TagVista[] | null;
  unidades: Array<{ id: string; numeroEconomico: string; placas: string | null }> | null;
  casetas: CasetaVista[] | null;
  geocercas: GeocercaVista[] | null;
  cursos: CursoVista[] | null;
  convenios: Array<{ id: string; nombre: string }> | null;
  mapeos: MapeoVista[] | null;
  archivos: ArchivoIngestaVista[] | null;
  tiposGeocerca: string[];
  buzon: BuzonVista;
  entradas: EntradasVista;
  acciones: AccionesConfiguracion;
  /** Las reglas de la revisión de cobros (clases por caseta, casetas prohibidas, TAGs de baja). Opcional. */
  reglasCobro?: ReglasCobroVista;
  /** El tarifario por caseta y clase (carga y confirmación). Opcional. */
  tarifario?: TarifarioVista;
  /** Umbrales de atípicos, plazo de reclamo, avisos e interruptores. Opcional. */
  umbralesAvisos?: UmbralesAvisosVista;
  /** Correo de los avisos: destinatarios, fecha de corte, interruptor y prueba. Opcional. */
  correoAvisos?: CorreoAvisosVista;
  /** Interruptor del cruce cobro ↔ viaje (por Icident). Opcional. */
  cruceViajes?: CruceViajesVista;
  /** Ventanas de unidades inmovilizadas (carga y borrado). Opcional. */
  inmovilizadas?: InmovilizadasConfigVista;
  /** Clases válidas del utilitario y regla de la clase 1. Opcional. */
  clasesCobro?: ClasesCobroVista;
  /** T-A2-31: con perfil `cinco_agentes` no se pintan geocercas ni cursos (stand-by). Sin la prop: todo, como siempre. */
  superficie?: { gps: boolean; cursos: boolean };
}) {
  return (
    <MarcoPagina titulo="Configuración del conciliador de peajes" apoyo="Buzón, entradas y mapeos con los que el agente concilia el estado de cuenta contra los gastos de los viajes." acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/peajes${sufijo}`} icono={<Icono icono={ArrowLeft} />}>Volver al agente</BotonEnlace>}>
      {aviso && <p role="status" className="rv-pj-caja text-[12px] rv-pj-c-ink">{aviso}</p>}
      {error && <p role="alert" className="rv-pj-caja text-[12px] rv-pj-c-bad">{error}</p>}
      {agenteApagado && <p role="status" className="rv-pj-caja text-[12px] rv-pj-c-warn">{agenteApagado}</p>}

      <SeccionBuzon buzon={buzon} archivos={archivos} acciones={acciones} sufijo={sufijo} />
      <SeccionEntradas entradas={entradas} acciones={acciones} />
      <SeccionMapeo mapeos={mapeos} acciones={acciones} />
      {reglasCobro && <SeccionReglasCobro datos={reglasCobro} />}
      {clasesCobro && <SeccionClasesCobro datos={clasesCobro} />}
      {tarifario && <SeccionTarifario datos={tarifario} />}
      {umbralesAvisos && <SeccionUmbralesAvisos datos={umbralesAvisos} />}
      {correoAvisos && <SeccionCorreoAvisos datos={correoAvisos} />}
      {cruceViajes && <SeccionCruceViajes datos={cruceViajes} />}
      {inmovilizadas && <SeccionInmovilizadas datos={inmovilizadas} />}
      <SeccionTags tags={tags} unidades={unidades} acciones={acciones} />
      <SeccionCasetas casetas={casetas} acciones={acciones} />
      {(superficie?.gps ?? true) && <SeccionGeocercas geocercas={geocercas} tipos={tiposGeocerca} acciones={acciones} />}
      {(superficie?.cursos ?? true) && <SeccionCursos cursos={cursos} unidades={unidades} convenios={convenios} acciones={acciones} />}
    </MarcoPagina>
  );
}

function Titulo({ t, nota, info }: { t: string; nota: React.ReactNode; info: InfoClave }) {
  return (
    <>
      <TituloRecuadro info={info} className="mb-1">{t}</TituloRecuadro>
      <p className="text-[11px] mb-3 rv-pj-c-faint">{nota}</p>
    </>
  );
}

function NoSePudoLeer({ que }: { que: string }) {
  return <p className="text-[12px] mt-3 rv-pj-c-muted">No se pudo leer {que} ahora mismo.</p>;
}

// ── Buzón firmado y archivos recibidos ──────────────────────────────────────
const ETIQUETA_ESTADO: Record<string, string> = { pendiente: 'en cola', procesando: 'procesando', procesada: 'procesado', fallida: 'falló' };

function SeccionBuzon({ buzon, archivos, acciones, sufijo }: { buzon: BuzonVista; archivos: ArchivoIngestaVista[] | null; acciones: AccionesConfiguracion; sufijo: string }) {
  return (
    <section className="rv-tarjeta" id="buzon">
      <Titulo t="Buzón automático del proveedor" info="peajes_config.buzon"
        nota="El sistema del proveedor (o un script de la flota) manda el archivo de cada corte a este buzón firmado y el agente lo importa y lo cruza solo, cada 15 minutos. Sin esto, alguien tiene que subirlo a mano." />
      {!buzon.secretoConfigurado && (
        <p className="text-[12px] mb-3 rv-pj-c-warn">
          Falta configurar la llave del buzón en el servidor: mientras no exista, el buzón rechaza todo envío. Lo configura el equipo de Likida.
        </p>
      )}
      {buzon.estado === 'ilegible' ? (
        <NoSePudoLeer que="el estado del buzón" />
      ) : buzon.estado === 'inactivo' ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] rv-pj-c-muted">Buzón desactivado.</span>
          {buzon.puedeAdministrar
            ? <form action={acciones.activarBuzon}><button type="submit" className="rv-btn rv-btn--primary"><Icono icono={Inbox} /> Activar buzón</button></form>
            : <span className="text-[11px] rv-pj-c-faint">Solo quien administra la flota lo activa.</span>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap text-[12px]">
            <span className="cifra-mono rv-pj-pill" data-tono="ok">activo</span>
            <span className="rv-pj-c-muted">llave n.º {buzon.rotacion}</span>
            {buzon.puedeAdministrar && (
              <>
                <form action={acciones.rotarLlave}>
                  <button type="submit" className="rv-btn rv-btn--secondary" title="La llave anterior deja de servir al instante">
                    <Icono icono={KeyRound} />Rotar llave
                  </button>
                </form>
                <form action={acciones.desactivarBuzon}>
                  <button type="submit" className="rv-btn rv-btn--secondary">Desactivar</button>
                </form>
              </>
            )}
          </div>
          <div className="grid gap-1.5 text-[12px]">
            <Campo etiqueta="URL" valor={buzon.url} />
            <Campo etiqueta="Flota (cabecera x-likida-flota)" valor={buzon.flotaId} />
            {buzon.puedeAdministrar && buzon.llave
              ? <Campo etiqueta="Llave de firma (secreto: no la compartas ni la subas a un repositorio)" valor={buzon.llave} />
              : <p className="rv-pj-c-faint">La llave de firma solo la ve quien administra la flota.</p>}
          </div>
          <details className="text-[12px]">
            <summary className="cursor-pointer rv-pj-c-marca">Cómo firmar un envío (ejemplo)</summary>
            <pre className="rv-pj-codigo">{EJEMPLO_FIRMA}</pre>
            <p className="mt-1.5 rv-pj-c-faint">
              Respuestas: 202 aceptado · 200 ya lo teníamos (el mismo archivo no se duplica) · 401 firma o flota inválida · 413 archivo mayor a 4 MB ·
              429 demasiados envíos o cola llena · 503 reintenta más tarde (agente apagado o falla temporal).
            </p>
          </details>
        </div>
      )}

      <TituloRecuadro nivel="h3" info="peajes_config.archivos_recibidos" className="mt-5 mb-2">Archivos recibidos</TituloRecuadro>
      {archivos === null ? <NoSePudoLeer que="los archivos recibidos" /> : archivos.length === 0 ? (
        <EstadoVacio icono={Inbox} titulo="Aún sin archivos">
          Aún no se ha recibido ningún archivo por el buzón.
        </EstadoVacio>
      ) : (
        <div className="space-y-1.5">
          {archivos.map((a) => (
            <div key={a.id} className="hairline rounded-lg px-2.5 py-2 text-[12px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="truncate font-medium" title={a.nombre}>{a.nombre}</span>
                <span className={a.estado === 'fallida' ? 'rv-pj-c-bad' : a.estado === 'procesada' ? 'rv-pj-c-ok' : 'rv-pj-c-muted'}>{ETIQUETA_ESTADO[a.estado] ?? a.estado}</span>
                <span className="text-[11px] rv-pj-c-faint">
                  {a.proveedor ? `${a.proveedor} · ` : ''}{numero(Math.round(a.bytes / 1024))} KB · {a.recibidaEn.slice(0, 16).replace('T', ' ')} UTC
                  {a.intentos > 0 ? ` · ${a.intentos} intento${a.intentos === 1 ? '' : 's'}` : ''}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {a.desgloseId && (
                    <Link href={`/dashboard/agentes/peajes${sufijo}${sufijo ? '&' : '?'}desglose=${a.desgloseId}`} className="text-[12px] rv-pj-c-marca">Ver desglose</Link>
                  )}
                  {a.reintentable && (
                    <form action={acciones.reintentarArchivo}>
                      <input type="hidden" name="archivo" value={a.id} />
                      {/* A37-A2-01: los archivos de correo/SFTP llegan sin proveedor y su mapeo se busca por proveedor. */}
                      {!a.proveedor && (
                        <input name="proveedor" maxLength={60} placeholder="Proveedor (p. ej. IAVE)" aria-label="Proveedor del archivo" className="hairline rounded px-1.5 py-0.5 text-[11px] w-36 mr-1" />
                      )}
                      <button type="submit" className="rv-btn rv-btn--secondary">
                        <Icono icono={RefreshCw} />Reintentar
                      </button>
                    </form>
                  )}
                </span>
              </div>
              {a.ultimoError && <p className="text-[11px] mt-1 rv-pj-c-bad">{a.ultimoError}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <label className="block">
      <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">{etiqueta}</span>
      <input readOnly value={valor} className="w-full cifra-mono mt-0.5 rv-ctl" />
    </label>
  );
}

// ── Mapeo de columnas ───────────────────────────────────────────────────────
function SeccionMapeo({ mapeos, acciones }: { mapeos: MapeoVista[] | null; acciones: AccionesConfiguracion }) {
  return (
    <section className="rv-tarjeta" id="mapeo">
      <Titulo t="Mapeo de columnas por proveedor" info="peajes_config.mapeo"
        nota={<>El lector detecta las columnas por su nombre. Si un proveedor usa otros encabezados (o el lector te dijo «no encontré la columna…»),
          declara aquí cuál es cuál: por el <b>encabezado exacto</b> («Fecha de cobro») o por la <b>letra de la columna</b> («C»). Fecha, caseta e importe son obligatorios; hora, TAG, unidad y clase, opcionales (si no los declaras, se buscan por nombre: «Tarjeta IDMX», «No. economico», «Clase»).</>} />
      {mapeos === null ? <NoSePudoLeer que="los mapeos" /> : mapeos.length === 0 ? (
        <p className="text-[12px] mb-3 rv-pj-c-muted">Ningún proveedor tiene mapeo: todos se leen por detección automática.</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {mapeos.map((m) => (
            <div key={m.id} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap text-[12px]">
              <span className="font-medium">{m.proveedor}</span>
              <span className="text-[11px] cifra-mono rv-pj-c-muted">
                fecha=«{m.columnas.fecha}» · caseta=«{m.columnas.caseta}» · importe=«{m.columnas.monto}»
                {m.columnas.hora ? ` · hora=«${m.columnas.hora}»` : ''}{m.columnas.tag ? ` · TAG=«${m.columnas.tag}»` : ''}{m.columnas.unidad ? ` · unidad=«${m.columnas.unidad}»` : ''}{m.columnas.clase ? ` · clase=«${m.columnas.clase}»` : ''}
              </span>
              <form action={acciones.borrarMapeo} className="ml-auto">
                <input type="hidden" name="mapeo" value={m.id} />
                <button type="submit" aria-label={`Eliminar el mapeo de ${m.proveedor}`} className="rv-btn rv-btn--secondary"><Icono icono={Trash2} /></button>
              </form>
            </div>
          ))}
        </div>
      )}
      <form action={acciones.guardarMapeo} className="flex items-end gap-2 flex-wrap">
        <Entrada nombre="proveedor" etiqueta="Proveedor" ph="PASE" requerido ancho="w-[110px]" />
        <Entrada nombre="fecha" etiqueta="Fecha" ph="Fecha de cobro" requerido />
        <Entrada nombre="hora" etiqueta="Hora (opc.)" ph="Hora" ancho="w-[100px]" />
        <Entrada nombre="caseta" etiqueta="Caseta" ph="Plaza" requerido ancho="w-[120px]" />
        <Entrada nombre="monto" etiqueta="Importe" ph="Importe" requerido ancho="w-[110px]" />
        <Entrada nombre="tag" etiqueta="TAG (opc.)" ph="No. TAG" ancho="w-[110px]" />
        <Entrada nombre="unidad" etiqueta="Unidad (opc.)" ph="No. economico" ancho="w-[120px]" />
        <Entrada nombre="clase" etiqueta="Clase (opc.)" ph="Clase" ancho="w-[90px]" />
        <button type="submit" className="rv-btn rv-btn--primary">Guardar mapeo</button>
      </form>
      <p className="text-[11px] mt-1.5 rv-pj-c-faint">
        Guardar el mismo proveedor de nuevo reemplaza su mapeo. El archivo REAL de PASE todavía no se ha calibrado aquí: cuando llegue, su mapeo se declara en esta pantalla, sin tocar código.
      </p>
    </section>
  );
}

function Entrada({ nombre, etiqueta, ph, requerido, ancho }: { nombre: string; etiqueta: string; ph: string; requerido?: boolean; ancho?: string }) {
  return (
    <label className="block">
      <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{etiqueta}</span>
      <input name={nombre} placeholder={ph} required={requerido} maxLength={80} className={`${ancho ?? 'w-[140px]'} mt-0.5 rv-ctl`} />
    </label>
  );
}

function SubirCsv({ accion, etiqueta, extra }: { accion: Accion; etiqueta: string; extra?: React.ReactNode }) {
  return (
    <form action={accion} encType="multipart/form-data" className="flex items-center gap-2 flex-wrap">
      <input type="file" name="archivo" accept=".csv,.tsv,.xlsx,.xls,.ods" required aria-label={etiqueta}
        className="text-[12px] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[12px] file:font-medium file:cursor-pointer rv-pj-c-muted" />
      {extra}
      <button type="submit" className="rv-btn rv-btn--primary"><Icono icono={Upload} /> Cargar</button>
    </form>
  );
}

// ── TAGs ────────────────────────────────────────────────────────────────────
function SeccionTags({ tags, unidades, acciones }: { tags: TagVista[] | null; unidades: Array<{ id: string; numeroEconomico: string; placas: string | null }> | null; acciones: AccionesConfiguracion }) {
  return (
    <section className="rv-tarjeta" id="tags">
      <Titulo t="TAGs de telepeaje por unidad" info="peajes_config.tags"
        nota={<>Qué TAG es de qué camión. Con esto el cruce sabe <b>qué unidad pasó</b> aunque el chofer no fotografíe el ticket, desempata entre dos gastos iguales y avisa si el TAG es de otra unidad que la del viaje.
          Carga masiva por CSV con columnas <span className="cifra-mono">tag; unidad; proveedor</span> (unidad = número económico o placas).</>} />
      <SubirCsv accion={acciones.importarTags} etiqueta="CSV de TAGs" />
      <form action={acciones.altaTag} className="flex items-end gap-2 flex-wrap mt-3">
        <Entrada nombre="tag" etiqueta="TAG" ph="IMDM 12345678" requerido />
        <label className="block">
          <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">Unidad</span>
          <select name="unidad" required className="w-[170px] mt-0.5 rv-ctl" defaultValue="">
            <option value="" disabled>Elige…</option>
            {(unidades ?? []).map((u) => <option key={u.id} value={u.id}>{u.numeroEconomico}{u.placas ? ` · ${u.placas}` : ''}</option>)}
          </select>
        </label>
        <Entrada nombre="proveedor" etiqueta="Proveedor (opc.)" ph="PASE" ancho="w-[110px]" />
        <button type="submit" className="rv-btn rv-btn--primary">Agregar TAG</button>
      </form>
      {tags === null ? <NoSePudoLeer que="los TAGs" /> : tags.length === 0 ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">Aún no hay TAGs dados de alta: el cruce no puede casar un cobro con una unidad por su TAG.</p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[320px] overflow-y-auto">
          <p className="text-[11px] rv-pj-c-faint">{numero(tags.length)} TAGs</p>
          {tags.slice(0, 300).map((t) => (
            <div key={t.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12px]">
              <span className="cifra-mono">{t.tagOriginal ?? t.tag}</span>
              <span className="rv-pj-c-muted">→ {t.unidadEconomico ?? 'unidad borrada'}</span>
              {t.proveedor && <span className="text-[11px] rv-pj-c-faint">{t.proveedor}</span>}
              {t.bajaEn ? (
                <span className="text-[11px] rv-pj-c-warn">
                  Baja desde el {t.bajaEn}{t.bajaMotivo ? ` · ${t.bajaMotivo}` : ''}. Un cruce posterior a esa fecha se marca para revisar.
                </span>
              ) : (
                <form action={acciones.bajaTag} className="ml-auto flex items-end gap-1.5 flex-wrap">
                  <input type="hidden" name="tag" value={t.id} />
                  <label className="block">
                    <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">Último día en uso</span>
                    <input type="date" name="fecha" required className="mt-0.5 rv-ctl rv-ctl--fecha" />
                  </label>
                  <Entrada nombre="motivo" etiqueta="Motivo" ph="Unidad siniestrada" ancho="w-[150px]" />
                  <button type="submit" aria-label={`Eliminar el TAG ${t.tag} del uso: se da de baja con fecha y motivo`} className="rv-btn rv-btn--secondary">
                    <Icono icono={Trash2} /> Dar de baja
                  </button>
                </form>
              )}
            </div>
          ))}
          {tags.length > 300 && <p className="text-[11px] rv-pj-c-faint">Se muestran los primeros 300.</p>}
        </div>
      )}
    </section>
  );
}

// ── Casetas ─────────────────────────────────────────────────────────────────
function SeccionCasetas({ casetas, acciones }: { casetas: CasetaVista[] | null; acciones: AccionesConfiguracion }) {
  return (
    <section className="rv-tarjeta" id="casetas">
      <Titulo t="Catálogo de casetas" info="peajes_config.casetas"
        nota={<>Las casetas por NOMBRE (lo único obligatorio), con opcionalmente su carretera, si <b>cobra por pasada</b> (la clase 1 es normal ahí) y sus coordenadas, para validar con el GPS que la unidad estuvo ahí a la hora del cobro
          (distancia Haversine). <b>Nace vacío a propósito</b>: Likida no inventa coordenadas. Acepta la plantilla del catálogo tal cual (sus encabezados largos) o un CSV
          <span className="cifra-mono"> nombre; carretera; por pasada; lat; lng; radio_m; alias; fuente</span> (grados decimales; radio de 50 a 5,000 m, 300 si lo omites;
          alias separados por «|»). Volver a cargar una caseta con el mismo nombre actualiza sus datos; las columnas que no traiga el archivo no se tocan.</>} />
      <SubirCsv accion={acciones.importarCasetas} etiqueta="CSV de casetas"
        extra={<input name="fuente" placeholder="Fuente de las coordenadas" aria-label="Fuente de las coordenadas" maxLength={200} className="w-[230px] rv-ctl" />} />
      {casetas === null ? <NoSePudoLeer que="las casetas" /> : casetas.length === 0 ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">
          Catálogo vacío: el cruce por caseta no puede validar nada y cada línea queda «sin datos» (la caseta no está en el catálogo) — nunca una acusación.
        </p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[320px] overflow-y-auto">
          <p className="text-[11px] rv-pj-c-faint">{numero(casetas.filter((c) => c.activa).length)} activas de {numero(casetas.length)}</p>
          {casetas.slice(0, 300).map((c) => (
            <div key={c.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12px] rv-pj-fila" data-apagada={c.activa ? undefined : ''}>
              <span className="font-medium">{c.nombre}</span>
              <span className="cifra-mono text-[11px] rv-pj-c-muted">{c.lat !== null && c.lng !== null ? `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} · ${c.radioM} m` : 'sin coordenadas · solo por nombre'}</span>
              {c.carretera && <span className="text-[11px] rv-pj-c-muted">{c.carretera}</span>}
              {c.porPasada && <StatusChip tono="ok">por pasada</StatusChip>}
              {c.fuente && <span className="text-[11px] rv-pj-c-faint">{c.fuente}</span>}
              <form action={acciones.estadoCaseta} className="ml-auto">
                <input type="hidden" name="caseta" value={c.id} />
                <input type="hidden" name="activa" value={c.activa ? 'false' : 'true'} />
                <button type="submit" className="rv-btn rv-btn--secondary">{c.activa ? 'Desactivar' : 'Activar'}</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Geocercas ───────────────────────────────────────────────────────────────
function SeccionGeocercas({ geocercas, tipos, acciones }: { geocercas: GeocercaVista[] | null; tipos: string[]; acciones: AccionesConfiguracion }) {
  return (
    <section className="rv-tarjeta" id="geocercas">
      <Titulo t="Geocercas" info="peajes_config.geocercas"
        nota="Círculos (centro y radio) para patios, orígenes, destinos y puntos de interés. Las usan estadías, el briefing y la facturación; hasta hoy nadie podía crearlas desde el panel. Mismo nombre = se actualiza." />
      <form action={acciones.guardarGeocerca} className="flex items-end gap-2 flex-wrap">
        <Entrada nombre="nombre" etiqueta="Nombre" ph="Patio Querétaro" requerido />
        <label className="block">
          <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">Tipo</span>
          <select name="tipo" className="w-[130px] mt-0.5 rv-ctl" defaultValue="punto_interes">
            {tipos.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </label>
        <Entrada nombre="lat" etiqueta="Latitud" ph="20.5888" requerido ancho="w-[100px]" />
        <Entrada nombre="lng" etiqueta="Longitud" ph="-100.3899" requerido ancho="w-[100px]" />
        <Entrada nombre="radio_m" etiqueta="Radio (m)" ph="300" requerido ancho="w-[80px]" />
        <button type="submit" className="rv-btn rv-btn--primary">Guardar geocerca</button>
      </form>
      {geocercas === null ? <NoSePudoLeer que="las geocercas" /> : geocercas.length === 0 ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">Aún no hay geocercas.</p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[280px] overflow-y-auto">
          {geocercas.map((g) => (
            <div key={g.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12px] rv-pj-fila" data-apagada={g.activa ? undefined : ''}>
              <span className="font-medium">{g.nombre}</span>
              <span className="text-[11px] rv-pj-c-faint">{g.tipo.replace('_', ' ')}</span>
              <span className="cifra-mono text-[11px] rv-pj-c-muted">{g.lat.toFixed(5)}, {g.lng.toFixed(5)} · {g.radioM} m</span>
              <form action={acciones.estadoGeocerca} className="ml-auto">
                <input type="hidden" name="geocerca" value={g.id} />
                <input type="hidden" name="activa" value={g.activa ? 'false' : 'true'} />
                <button type="submit" className="rv-btn rv-btn--secondary">{g.activa ? 'Desactivar' : 'Activar'}</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Cursos (rutas autorizadas) ──────────────────────────────────────────────
function SeccionCursos({ cursos, unidades, convenios, acciones }: {
  cursos: CursoVista[] | null;
  unidades: Array<{ id: string; numeroEconomico: string }> | null;
  convenios: Array<{ id: string; nombre: string }> | null;
  acciones: AccionesConfiguracion;
}) {
  const eco = new Map((unidades ?? []).map((u) => [u.id, u.numeroEconomico]));
  const conv = new Map((convenios ?? []).map((c) => [c.id, c.nombre]));
  return (
    <section className="rv-tarjeta" id="cursos">
      <Titulo t="Cursos (rutas autorizadas)" info="peajes_config.cursos"
        nota={<>Las casetas que cada unidad, o cada convenio A→B, puede cruzar. Un pase en una caseta que <b>no</b> está en el curso aparece en el reporte de reclamación como
          «Cruce fuera de curso» (confianza media: el curso lo declara la flota). Sin curso declarado no se reclama nada por este motivo. Carga tu CSV o Excel
          <span className="cifra-mono"> codigo; nombre; unidad; convenio; casetas</span> (una fila por curso; las casetas, en orden de recorrido y separadas por «|»; deben existir en el catálogo de casetas;
          la unidad es su número económico y el convenio, su nombre). Volver a cargar el mismo código lo actualiza. El corredor (<span className="cifra-mono">corredor_wkt</span> + <span className="cifra-mono">buffer_m</span>) se
          acepta, pero el formato real de tus rutas está pendiente: hoy se prueba con datos sintéticos.</>} />
      <SubirCsv accion={acciones.importarCursos} etiqueta="CSV de cursos" />
      <form action={acciones.importarCursosDeTabla} className="mt-2">
        <button type="submit" className="rv-btn rv-btn--secondary">Leer los cursos de mi tabla conectada</button>
      </form>
      {cursos === null ? <NoSePudoLeer que="los cursos" /> : cursos.length === 0 ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">
          Aún no hay cursos: el reporte de reclamación no evalúa «fuera de curso» y lo dice (las líneas se cuentan como «sin curso declarado»).
        </p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[320px] overflow-y-auto">
          <p className="text-[11px] rv-pj-c-faint">{numero(cursos.filter((c) => c.activo).length)} activos de {numero(cursos.length)}</p>
          {cursos.slice(0, 300).map((c) => (
            <div key={c.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12px] rv-pj-fila" data-apagada={c.activo ? undefined : ''}>
              <span className="font-medium">{c.nombre}</span>
              <span className="cifra-mono text-[11px] rv-pj-c-faint">{c.codigo}</span>
              <span className="text-[11px] rv-pj-c-muted">
                {[c.unidadId ? `unidad ${eco.get(c.unidadId) ?? '—'}` : null, c.convenioId ? `convenio ${conv.get(c.convenioId) ?? '—'}` : null].filter(Boolean).join(' · ')}
              </span>
              <span className="text-[11px] rv-pj-c-muted">
                {c.tipo === 'casetas' ? c.casetas.map((k) => k.nombre || '—').join(' → ') : `corredor de ${numero(c.corredor?.length ?? 0)} puntos · ±${numero(c.bufferM ?? 0)} m`}
              </span>
              {(c.vigenteDesde || c.vigenteHasta) && <span className="text-[11px] rv-pj-c-faint">{c.vigenteDesde ?? '…'} a {c.vigenteHasta ?? '…'}</span>}
              <form action={acciones.estadoCurso} className="ml-auto">
                <input type="hidden" name="curso" value={c.id} />
                <input type="hidden" name="activo" value={c.activo ? 'false' : 'true'} />
                <button type="submit" className="rv-btn rv-btn--secondary">{c.activo ? 'Desactivar' : 'Activar'}</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
