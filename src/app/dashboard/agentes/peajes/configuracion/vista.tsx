import Link from 'next/link';
import { Settings2, ArrowLeft, Upload, Trash2, KeyRound, Inbox, RefreshCw } from 'lucide-react';
import { BarraPagina } from '../../../resumen-visual';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { numero } from '@/lib/formato';
// SOLO tipos: los módulos importan supabaseAdmin y no deben entrar al bundle de la vista.
import type {
  TagVista, CasetaVista, GeocercaVista, MapeoVista, ArchivoIngestaVista,
} from '@/lib/likida/peajes/datos';

import { SeccionEntradas, type AccionesEntradas, type EntradasVista } from './entradas';

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesConfiguracion extends AccionesEntradas {
  activarBuzon: Accion; desactivarBuzon: Accion; rotarLlave: Accion; reintentarArchivo: Accion;
  altaTag: Accion; bajaTag: Accion; importarTags: Accion;
  importarCasetas: Accion; estadoCaseta: Accion;
  guardarGeocerca: Accion; estadoGeocerca: Accion;
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

const CSS_INPUT = 'hairline text-[12.5px] px-2.5 py-1.5 rounded-lg';
const ESTILO_INPUT = { background: 'var(--surface)', color: 'var(--ink)' } as const;
const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
const CSS_SECUNDARIO = 'hairline text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]';
const ESTILO_SECUNDARIO = { background: 'var(--surface)', color: 'var(--muted)' } as const;

export function VistaConfiguracionPeajes({
  sufijo, aviso, error, agenteApagado, tags, unidades, casetas, geocercas, mapeos, archivos, tiposGeocerca, buzon, entradas, acciones,
}: {
  sufijo: string;
  aviso: string | null;
  error: string | null;
  agenteApagado: string | null;
  tags: TagVista[] | null;
  unidades: Array<{ id: string; numeroEconomico: string; placas: string | null }> | null;
  casetas: CasetaVista[] | null;
  geocercas: GeocercaVista[] | null;
  mapeos: MapeoVista[] | null;
  archivos: ArchivoIngestaVista[] | null;
  tiposGeocerca: string[];
  buzon: BuzonVista;
  entradas: EntradasVista;
  acciones: AccionesConfiguracion;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Settings2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Configuración del conciliador de peajes"
          derecha={
            <Link href={`/dashboard/agentes/peajes${sufijo}`} className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70" style={{ color: 'var(--marca)' }}>
              <ArrowLeft width={12} height={12} strokeWidth={2} /> Volver al agente
            </Link>
          }
        />
        <div className="px-5 py-5 flex-1 space-y-4">
          {aviso && <p role="status" className="card p-3 text-[12.5px]" style={{ color: 'var(--ink)' }}>{aviso}</p>}
          {error && <p role="alert" className="card p-3 text-[12.5px]" style={{ color: 'var(--bad)' }}>{error}</p>}
          {agenteApagado && <p role="status" className="card p-3 text-[12px]" style={{ color: 'var(--warn)' }}>{agenteApagado}</p>}

          <SeccionBuzon buzon={buzon} archivos={archivos} acciones={acciones} sufijo={sufijo} />
          <SeccionEntradas entradas={entradas} acciones={acciones} />
          <SeccionMapeo mapeos={mapeos} acciones={acciones} />
          <SeccionTags tags={tags} unidades={unidades} acciones={acciones} />
          <SeccionCasetas casetas={casetas} acciones={acciones} />
          <SeccionGeocercas geocercas={geocercas} tipos={tiposGeocerca} acciones={acciones} />
        </div>
      </div>
    </main>
  );
}

function Titulo({ t, nota }: { t: string; nota: React.ReactNode }) {
  return (
    <>
      <h2 className="font-display text-[15px] font-semibold mb-1">{t}</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>{nota}</p>
    </>
  );
}

function NoSePudoLeer({ que }: { que: string }) {
  return <p className="text-[12.5px] mt-3" style={{ color: 'var(--muted)' }}>No se pudo leer {que} ahora mismo.</p>;
}

// ── Buzón firmado y archivos recibidos ──────────────────────────────────────
const ETIQUETA_ESTADO: Record<string, string> = { pendiente: 'en cola', procesando: 'procesando', procesada: 'procesado', fallida: 'falló' };

function SeccionBuzon({ buzon, archivos, acciones, sufijo }: { buzon: BuzonVista; archivos: ArchivoIngestaVista[] | null; acciones: AccionesConfiguracion; sufijo: string }) {
  return (
    <section className="card p-4" id="buzon">
      <Titulo t="Buzón automático del proveedor"
        nota="El sistema del proveedor (o un script de la flota) manda el archivo de cada corte a este buzón firmado y el agente lo importa y lo cruza solo, cada 15 minutos. Sin esto, alguien tiene que subirlo a mano." />
      {!buzon.secretoConfigurado && (
        <p className="text-[12px] mb-3" style={{ color: 'var(--warn)' }}>
          Falta PEAJES_INGESTA_SECRETO en el servidor (mínimo 32 caracteres): mientras no exista, el buzón rechaza todo envío. Lo configura quien administra Likida.
        </p>
      )}
      {buzon.estado === 'ilegible' ? (
        <NoSePudoLeer que="el estado del buzón" />
      ) : buzon.estado === 'inactivo' ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Buzón desactivado.</span>
          {buzon.puedeAdministrar
            ? <form action={acciones.activarBuzon}><button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}><Inbox width={13} height={13} strokeWidth={2} /> Activar buzón</button></form>
            : <span className="text-[11px]" style={{ color: 'var(--faint)' }}>Solo quien administra la flota lo activa.</span>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
            <span className="cifra-mono px-2 py-0.5 rounded-md" style={{ background: 'var(--canvas)', color: 'var(--ok)' }}>activo</span>
            <span style={{ color: 'var(--muted)' }}>llave n.º {buzon.rotacion}</span>
            {buzon.puedeAdministrar && (
              <>
                <form action={acciones.rotarLlave}>
                  <button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO} title="La llave anterior deja de servir al instante">
                    <KeyRound width={12} height={12} strokeWidth={2} className="inline mr-1" />Rotar llave
                  </button>
                </form>
                <form action={acciones.desactivarBuzon}>
                  <button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>Desactivar</button>
                </form>
              </>
            )}
          </div>
          <div className="grid gap-1.5 text-[12px]">
            <Campo etiqueta="URL" valor={buzon.url} />
            <Campo etiqueta="Flota (cabecera x-likida-flota)" valor={buzon.flotaId} />
            {buzon.puedeAdministrar && buzon.llave
              ? <Campo etiqueta="Llave de firma (secreto: no la compartas ni la subas a un repositorio)" valor={buzon.llave} />
              : <p style={{ color: 'var(--faint)' }}>La llave de firma solo la ve quien administra la flota.</p>}
          </div>
          <details className="text-[12px]">
            <summary className="cursor-pointer" style={{ color: 'var(--marca)' }}>Cómo firmar un envío (ejemplo)</summary>
            <pre className="mt-2 p-3 rounded-lg overflow-x-auto text-[11px]" style={{ background: 'var(--canvas)', color: 'var(--ink)' }}>{EJEMPLO_FIRMA}</pre>
            <p className="mt-1.5" style={{ color: 'var(--faint)' }}>
              Respuestas: 202 aceptado · 200 ya lo teníamos (el mismo archivo no se duplica) · 401 firma o flota inválida · 413 archivo mayor a 4 MB ·
              429 demasiados envíos o cola llena · 503 reintenta más tarde (agente apagado o falla temporal).
            </p>
          </details>
        </div>
      )}

      <h3 className="etiqueta-mono text-[10px] uppercase mt-5 mb-2" style={{ color: 'var(--faint)' }}>Archivos recibidos</h3>
      {archivos === null ? <NoSePudoLeer que="los archivos recibidos" /> : archivos.length === 0 ? (
        <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          Aún no se ha recibido ningún archivo por el buzón.
        </EstadoVacio>
      ) : (
        <div className="space-y-1.5">
          {archivos.map((a) => (
            <div key={a.id} className="hairline rounded-lg px-2.5 py-2 text-[12.5px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="truncate font-medium" title={a.nombre}>{a.nombre}</span>
                <span style={{ color: a.estado === 'fallida' ? 'var(--bad)' : a.estado === 'procesada' ? 'var(--ok)' : 'var(--muted)' }}>{ETIQUETA_ESTADO[a.estado] ?? a.estado}</span>
                <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
                  {a.proveedor ? `${a.proveedor} · ` : ''}{numero(Math.round(a.bytes / 1024))} KB · {a.recibidaEn.slice(0, 16).replace('T', ' ')} UTC
                  {a.intentos > 0 ? ` · ${a.intentos} intento${a.intentos === 1 ? '' : 's'}` : ''}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {a.desgloseId && (
                    <Link href={`/dashboard/agentes/peajes${sufijo}${sufijo ? '&' : '?'}desglose=${a.desgloseId}`} className="text-[12px]" style={{ color: 'var(--marca)' }}>Ver desglose</Link>
                  )}
                  {a.reintentable && (
                    <form action={acciones.reintentarArchivo}>
                      <input type="hidden" name="archivo" value={a.id} />
                      <button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>
                        <RefreshCw width={11} height={11} strokeWidth={2} className="inline mr-1" />Reintentar
                      </button>
                    </form>
                  )}
                </span>
              </div>
              {a.ultimoError && <p className="text-[11.5px] mt-1" style={{ color: 'var(--bad)' }}>{a.ultimoError}</p>}
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
      <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{etiqueta}</span>
      <input readOnly value={valor} className={`${CSS_INPUT} w-full cifra-mono mt-0.5`} style={ESTILO_INPUT} />
    </label>
  );
}

// ── Mapeo de columnas ───────────────────────────────────────────────────────
function SeccionMapeo({ mapeos, acciones }: { mapeos: MapeoVista[] | null; acciones: AccionesConfiguracion }) {
  return (
    <section className="card p-4" id="mapeo">
      <Titulo t="Mapeo de columnas por proveedor"
        nota={<>El lector detecta las columnas por su nombre. Si un proveedor usa otros encabezados (o el lector te dijo «no encontré la columna…»),
          declara aquí cuál es cuál: por el <b>encabezado exacto</b> («Fecha de cobro») o por la <b>letra de la columna</b> («C»). Fecha, caseta e importe son obligatorios; hora y TAG, opcionales.</>} />
      {mapeos === null ? <NoSePudoLeer que="los mapeos" /> : mapeos.length === 0 ? (
        <p className="text-[12.5px] mb-3" style={{ color: 'var(--muted)' }}>Ningún proveedor tiene mapeo: todos se leen por detección automática.</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {mapeos.map((m) => (
            <div key={m.id} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap text-[12.5px]">
              <span className="font-medium">{m.proveedor}</span>
              <span className="text-[11.5px] cifra-mono" style={{ color: 'var(--muted)' }}>
                fecha=«{m.columnas.fecha}» · caseta=«{m.columnas.caseta}» · importe=«{m.columnas.monto}»
                {m.columnas.hora ? ` · hora=«${m.columnas.hora}»` : ''}{m.columnas.tag ? ` · TAG=«${m.columnas.tag}»` : ''}
              </span>
              <form action={acciones.borrarMapeo} className="ml-auto">
                <input type="hidden" name="mapeo" value={m.id} />
                <button type="submit" aria-label={`Eliminar el mapeo de ${m.proveedor}`} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}><Trash2 width={12} height={12} strokeWidth={2} /></button>
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
        <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Guardar mapeo</button>
      </form>
      <p className="text-[11px] mt-1.5" style={{ color: 'var(--faint)' }}>
        Guardar el mismo proveedor de nuevo reemplaza su mapeo. El archivo REAL de PASE todavía no se ha calibrado aquí: cuando llegue, su mapeo se declara en esta pantalla, sin tocar código.
      </p>
    </section>
  );
}

function Entrada({ nombre, etiqueta, ph, requerido, ancho }: { nombre: string; etiqueta: string; ph: string; requerido?: boolean; ancho?: string }) {
  return (
    <label className="block">
      <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>{etiqueta}</span>
      <input name={nombre} placeholder={ph} required={requerido} maxLength={80} className={`${CSS_INPUT} ${ancho ?? 'w-[140px]'} mt-0.5`} style={ESTILO_INPUT} />
    </label>
  );
}

function SubirCsv({ accion, etiqueta, extra }: { accion: Accion; etiqueta: string; extra?: React.ReactNode }) {
  return (
    <form action={accion} encType="multipart/form-data" className="flex items-center gap-2 flex-wrap">
      <input type="file" name="archivo" accept=".csv,.tsv,.xlsx,.xls,.ods" required aria-label={etiqueta}
        className="text-[12.5px] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[12.5px] file:font-medium file:cursor-pointer"
        style={{ color: 'var(--muted)' }} />
      {extra}
      <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}><Upload width={13} height={13} strokeWidth={2} /> Cargar</button>
    </form>
  );
}

// ── TAGs ────────────────────────────────────────────────────────────────────
function SeccionTags({ tags, unidades, acciones }: { tags: TagVista[] | null; unidades: Array<{ id: string; numeroEconomico: string; placas: string | null }> | null; acciones: AccionesConfiguracion }) {
  return (
    <section className="card p-4" id="tags">
      <Titulo t="TAGs de telepeaje por unidad"
        nota={<>Qué TAG es de qué camión. Con esto el cruce sabe <b>qué unidad pasó</b> aunque el chofer no fotografíe el ticket, desempata entre dos gastos iguales y avisa si el TAG es de otra unidad que la del viaje.
          Carga masiva por CSV con columnas <span className="cifra-mono">tag; unidad; proveedor</span> (unidad = número económico o placas).</>} />
      <SubirCsv accion={acciones.importarTags} etiqueta="CSV de TAGs" />
      <form action={acciones.altaTag} className="flex items-end gap-2 flex-wrap mt-3">
        <Entrada nombre="tag" etiqueta="TAG" ph="IMDM 12345678" requerido />
        <label className="block">
          <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Unidad</span>
          <select name="unidad" required className={`${CSS_INPUT} w-[170px] mt-0.5`} style={ESTILO_INPUT} defaultValue="">
            <option value="" disabled>Elige…</option>
            {(unidades ?? []).map((u) => <option key={u.id} value={u.id}>{u.numeroEconomico}{u.placas ? ` · ${u.placas}` : ''}</option>)}
          </select>
        </label>
        <Entrada nombre="proveedor" etiqueta="Proveedor (opc.)" ph="PASE" ancho="w-[110px]" />
        <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Agregar TAG</button>
      </form>
      {tags === null ? <NoSePudoLeer que="los TAGs" /> : tags.length === 0 ? (
        <p className="text-[12.5px] mt-3" style={{ color: 'var(--muted)' }}>Aún no hay TAGs dados de alta: el cruce no puede casar un cobro con una unidad por su TAG.</p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[320px] overflow-y-auto">
          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>{numero(tags.length)} TAGs</p>
          {tags.slice(0, 300).map((t) => (
            <div key={t.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 text-[12.5px]">
              <span className="cifra-mono">{t.tagOriginal ?? t.tag}</span>
              <span style={{ color: 'var(--muted)' }}>→ {t.unidadEconomico ?? 'unidad borrada'}</span>
              {t.proveedor && <span className="text-[11px]" style={{ color: 'var(--faint)' }}>{t.proveedor}</span>}
              <form action={acciones.bajaTag} className="ml-auto">
                <input type="hidden" name="tag" value={t.id} />
                <button type="submit" aria-label={`Eliminar el TAG ${t.tag}`} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}><Trash2 width={12} height={12} strokeWidth={2} /></button>
              </form>
            </div>
          ))}
          {tags.length > 300 && <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Se muestran los primeros 300.</p>}
        </div>
      )}
    </section>
  );
}

// ── Casetas ─────────────────────────────────────────────────────────────────
function SeccionCasetas({ casetas, acciones }: { casetas: CasetaVista[] | null; acciones: AccionesConfiguracion }) {
  return (
    <section className="card p-4" id="casetas">
      <Titulo t="Catálogo de casetas con coordenadas"
        nota={<>Dónde queda cada caseta, para validar con el GPS que la unidad estuvo ahí a la hora del cobro (distancia Haversine). <b>Nace vacío a propósito</b>:
          Likida no inventa coordenadas — cárgalas con tu propio CSV <span className="cifra-mono">nombre; lat; lng; radio_m; alias; fuente</span> (grados decimales; radio de 50 a 5,000 m, 300 si lo omites;
          alias separados por «|»). Volver a cargar una caseta con el mismo nombre actualiza sus coordenadas.</>} />
      <SubirCsv accion={acciones.importarCasetas} etiqueta="CSV de casetas"
        extra={<input name="fuente" placeholder="Fuente de las coordenadas" aria-label="Fuente de las coordenadas" maxLength={200} className={`${CSS_INPUT} w-[230px]`} style={ESTILO_INPUT} />} />
      {casetas === null ? <NoSePudoLeer que="las casetas" /> : casetas.length === 0 ? (
        <p className="text-[12.5px] mt-3" style={{ color: 'var(--muted)' }}>
          Catálogo vacío: el cruce por caseta no puede validar nada y cada línea queda «sin datos» (la caseta no está en el catálogo) — nunca una acusación.
        </p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[320px] overflow-y-auto">
          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>{numero(casetas.filter((c) => c.activa).length)} activas de {numero(casetas.length)}</p>
          {casetas.slice(0, 300).map((c) => (
            <div key={c.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12.5px]" style={c.activa ? undefined : { opacity: 0.55 }}>
              <span className="font-medium">{c.nombre}</span>
              <span className="cifra-mono text-[11.5px]" style={{ color: 'var(--muted)' }}>{c.lat.toFixed(5)}, {c.lng.toFixed(5)} · {c.radioM} m</span>
              {c.fuente && <span className="text-[11px]" style={{ color: 'var(--faint)' }}>{c.fuente}</span>}
              <form action={acciones.estadoCaseta} className="ml-auto">
                <input type="hidden" name="caseta" value={c.id} />
                <input type="hidden" name="activa" value={c.activa ? 'false' : 'true'} />
                <button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>{c.activa ? 'Desactivar' : 'Activar'}</button>
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
    <section className="card p-4" id="geocercas">
      <Titulo t="Geocercas"
        nota="Círculos (centro y radio) para patios, orígenes, destinos y puntos de interés. Las usan estadías, el briefing y la facturación; hasta hoy nadie podía crearlas desde el panel. Mismo nombre = se actualiza." />
      <form action={acciones.guardarGeocerca} className="flex items-end gap-2 flex-wrap">
        <Entrada nombre="nombre" etiqueta="Nombre" ph="Patio Querétaro" requerido />
        <label className="block">
          <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Tipo</span>
          <select name="tipo" className={`${CSS_INPUT} w-[130px] mt-0.5`} style={ESTILO_INPUT} defaultValue="punto_interes">
            {tipos.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </label>
        <Entrada nombre="lat" etiqueta="Latitud" ph="20.5888" requerido ancho="w-[100px]" />
        <Entrada nombre="lng" etiqueta="Longitud" ph="-100.3899" requerido ancho="w-[100px]" />
        <Entrada nombre="radio_m" etiqueta="Radio (m)" ph="300" requerido ancho="w-[80px]" />
        <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Guardar geocerca</button>
      </form>
      {geocercas === null ? <NoSePudoLeer que="las geocercas" /> : geocercas.length === 0 ? (
        <p className="text-[12.5px] mt-3" style={{ color: 'var(--muted)' }}>Aún no hay geocercas.</p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[280px] overflow-y-auto">
          {geocercas.map((g) => (
            <div key={g.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12.5px]" style={g.activa ? undefined : { opacity: 0.55 }}>
              <span className="font-medium">{g.nombre}</span>
              <span className="text-[11px]" style={{ color: 'var(--faint)' }}>{g.tipo.replace('_', ' ')}</span>
              <span className="cifra-mono text-[11.5px]" style={{ color: 'var(--muted)' }}>{g.lat.toFixed(5)}, {g.lng.toFixed(5)} · {g.radioM} m</span>
              <form action={acciones.estadoGeocerca} className="ml-auto">
                <input type="hidden" name="geocerca" value={g.id} />
                <input type="hidden" name="activa" value={g.activa ? 'false' : 'true'} />
                <button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>{g.activa ? 'Desactivar' : 'Activar'}</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
