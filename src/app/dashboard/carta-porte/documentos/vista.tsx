import Link from 'next/link';
import { FileInput, TriangleAlert, Mail, MessageCircle, Upload, Download, RotateCcw, Layers } from 'lucide-react';
import { EstadoVacio, EstadoError } from '@/app/admin/ui/kit';
import { BarraPagina } from '../../resumen-visual';
import { fechaHoraMx, numero, pesoArchivo, porcentaje, usd4 } from '@/lib/formato';
import { prioridadEstado, ROTULO_CANAL, ROTULO_ESTADO, ROTULO_FORMATO } from '@/lib/likida/carta_porte_docs/presentacion';
import { MINUTOS_CAPTURA_MANUAL_EMBARQUE, type MetricasAgente } from '@/lib/likida/carta_porte_docs/metricas';
import type { DocumentoFila } from '@/lib/likida/carta_porte_docs/repo';
import { BotonEnvio, CAMPO, ETIQUETA, FormaAccion, type AccionDoc } from './forma_accion';

/**
 * LOS DOCUMENTOS DE TUS CLIENTES — la bandeja del Agente de Carta Porte multi-formato.
 *
 * Cada cliente grande manda la carga en SU formato (PDF, foto, Excel, XML, correo). Aquí entran por
 * tres canales —carga manual, el correo de la flota y WhatsApp—, el agente los lee, y una PERSONA
 * revisa lado a lado y aprueba. Aprobar produce un BORRADOR (viaje + mercancías) y, si lo pides, la
 * exportación al formato que tu cliente espera. Likida NO timbra: lo aprobado sigue el camino de
 * siempre hacia el PAC.
 *
 * Pura props, para poder mirarla con fixtures sin sesión.
 */

export interface PerfilVista {
  id: string; nombre: string; formato: string; versionActiva: number; mapeos: number;
  versiones: Array<{ version: number; nota: string | null; mapeos: number }>;
}
export interface BuzonVista { direccion: string | null; activo: boolean; remitentes: string[]; dominioConfigurado: boolean }
export interface ConfigVista { id: string; nombre: string; formato: 'csv' | 'json'; config: unknown }

export interface DatosDocumentos {
  filas: DocumentoFila[];
  total: number;
  metricas: MetricasAgente;
  perfiles: PerfilVista[];
  clientes: Array<{ id: string; nombre: string }>;
  buzon: BuzonVista | null;
  configs: ConfigVista[];
}

export interface AccionesDocumentos {
  subir: AccionDoc | null;
  procesar: AccionDoc | null;
  activarBuzon: AccionDoc | null;
  guardarRemitentes: AccionDoc | null;
  guardarExport: AccionDoc | null;
  borrarExport: AccionDoc | null;
  volverVersion: AccionDoc | null;
}

const PILL: Record<DocumentoFila['estado'], { fg: string; bg: string }> = {
  por_revisar: { fg: 'var(--warn)', bg: 'var(--warnbg, var(--canvas))' },
  aprobado: { fg: 'var(--ok)', bg: 'var(--okbg)' },
  rechazado: { fg: 'var(--muted)', bg: 'var(--canvas)' },
  fallido: { fg: 'var(--bad)', bg: 'var(--badbg)' },
  recibido: { fg: 'var(--muted)', bg: 'var(--canvas)' },
  procesando: { fg: 'var(--muted)', bg: 'var(--canvas)' },
};

function Cifra({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="card p-3.5 space-y-0.5">
      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{rotulo}</p>
      <p className="cifra-mono text-[19px] font-medium">{valor}</p>
      {nota && <p className="text-[10.5px]" style={{ color: 'var(--faint)' }}>{nota}</p>}
    </div>
  );
}

export function VistaDocumentos({ datos, acciones, sufijo = '', apiSufijo = '' }: {
  datos: DatosDocumentos | null; acciones: AccionesDocumentos; sufijo?: string;
  /** El `?tenant=…` para las descargas (que son GET a /api). */
  apiSufijo?: string;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<FileInput width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Documentos de tus clientes" />
        <div className="px-5 py-5 flex-1 space-y-5">
          <p className="text-[12.5px] max-w-3xl" style={{ color: 'var(--muted)' }}>
            Tus clientes mandan la carga en su propio formato. Aquí llegan —por carga manual, por el correo de tu flota o por
            WhatsApp—, el agente los lee y <strong>una persona revisa y aprueba</strong> lado a lado antes de que nada llegue al viaje.
            Cada corrección enseña al perfil de ese cliente, así que la siguiente vez se lee sin modelo. Likida no timbra: lo aprobado
            es un borrador que sigue el camino de siempre hacia el PAC de tu flota.
          </p>

          <Link href={`/dashboard/carta-porte${sufijo}`} className="text-[12px] font-medium hover:opacity-75 inline-block" style={{ color: 'var(--marca)' }}>
            ← Volver a Carta Porte por viaje
          </Link>

          {datos === null ? (
            <EstadoError mensaje="No pude leer los documentos de tu flota. No se pinta una bandeja vacía sobre una base que no contestó: eso diría «no hay nada que revisar» estando ciego." />
          ) : (
            <>
              <Metricas m={datos.metricas} />
              {acciones.subir && <Subir accion={acciones.subir} clientes={datos.clientes} />}
              <Bandeja datos={datos} acciones={acciones} sufijo={sufijo} />
              <Canales buzon={datos.buzon} acciones={acciones} />
              <Perfiles perfiles={datos.perfiles} acciones={acciones} />
              <Exportacion configs={datos.configs} acciones={acciones} apiSufijo={apiSufijo} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Metricas({ m }: { m: MetricasAgente }) {
  return (
    <section className="space-y-2" aria-label="Métricas del agente">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Cifra rotulo="Documentos recibidos (90 días)" valor={numero(m.recibidos)} nota={`${numero(m.porRevisar)} por revisar · ${numero(m.fallidos)} sin poder leer`} />
        <Cifra rotulo="Aprobados" valor={numero(m.aprobados)} nota={`${numero(m.rechazados)} rechazados`} />
        <Cifra
          rotulo="Aprobados sin corrección"
          valor={m.pctSinCorreccion === null ? '—' : porcentaje(m.pctSinCorreccion, 0)}
          nota={m.pctSinCorreccion === null ? 'Aún no hay aprobados: no se pinta un porcentaje.' : `${numero(m.sinCorreccion)} de ${numero(m.aprobados)} (confirmar un dato no cuenta como corregirlo)`}
        />
        <Cifra
          rotulo="Tiempo ahorrado por embarque"
          valor={m.minutosAhorradosPorEmbarque === null ? '—' : `${numero(m.minutosAhorradosPorEmbarque)} min`}
          nota={m.minutosAhorradosPorEmbarque === null
            ? 'Se calcula con el tiempo de revisión medido; aún no hay aprobados medidos.'
            : `Estimación: ${numero(MINUTOS_CAPTURA_MANUAL_EMBARQUE)} min de captura manual (supuesto) − ${numero(m.minutosRevisionPromedio ?? 0)} min de revisión medidos, en ${numero(m.aprobadosMedidos)} embarques.`}
        />
      </div>
      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
        Costo de IA en el periodo: {usd4(m.costoUsdTotal)}{m.costoUsdPorDocumento !== null ? ` (${usd4(m.costoUsdPorDocumento)} por documento)` : ''}.
        {m.sinModelo > 0 ? ` ${numero(m.sinModelo)} documentos se leyeron sin modelo (XML o perfil del cliente).` : ''}
        {m.aprobadosSinMedir > 0 ? ` ${numero(m.aprobadosSinMedir)} aprobados no tienen tiempo medido y no cuentan en el ahorro.` : ''}
      </p>
    </section>
  );
}

function Subir({ accion, clientes }: { accion: AccionDoc; clientes: Array<{ id: string; nombre: string }> }) {
  return (
    <section className="card p-4 space-y-3 max-w-3xl">
      <h2 className="text-[13px] font-medium flex items-center gap-1.5"><Upload width={14} height={14} strokeWidth={1.75} /> Subir un documento</h2>
      <FormaAccion accion={accion} enctype="multipart/form-data">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="cp-archivo" className={ETIQUETA}>Archivo (PDF, foto, Excel, CSV, XML o correo .eml — hasta 9 MB)</label>
            <input id="cp-archivo" name="archivo" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.xml,.eml,.txt" className={`${CAMPO} py-1.5 h-auto`} style={{ background: 'var(--surface)' }} />
          </div>
          <div>
            <label htmlFor="cp-cliente" className={ETIQUETA}>¿De qué cliente es? (ayuda a reconocer su formato)</label>
            <select id="cp-cliente" name="clienteId" defaultValue="" className={CAMPO} style={{ background: 'var(--surface)' }}>
              <option value="">Sin indicar</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        </div>
        <BotonEnvio etiqueta="Subir y leer" pendiente="Leyendo el documento…" />
      </FormaAccion>
    </section>
  );
}

function Bandeja({ datos, acciones, sufijo }: { datos: DatosDocumentos; acciones: AccionesDocumentos; sufijo: string }) {
  const orden = [...datos.filas].sort((a, b) => prioridadEstado(a.estado) - prioridadEstado(b.estado) || (a.createdAt < b.createdAt ? 1 : -1));
  const cliente = new Map(datos.clientes.map((c) => [c.id, c.nombre]));
  return (
    <section className="space-y-2">
      <h2 className="text-[13px] font-medium">Bandeja de revisión</h2>
      {orden.length === 0 ? (
        <EstadoVacio icono={<FileInput width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          Todavía no ha llegado ningún documento. Sube uno arriba, mándalo al correo de tu flota o reenvíalo por WhatsApp.
        </EstadoVacio>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                {['Estado', 'Archivo', 'Formato · canal', 'Lo que falta', 'Recibido', ''].map((h) => <th key={h} className="px-3 py-2 font-medium text-[11px]">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {orden.map((d) => {
                const p = PILL[d.estado];
                const v = d.validacion;
                return (
                  <tr key={d.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    <td className="px-3 py-2"><span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ color: p.fg, background: p.bg }}>{ROTULO_ESTADO[d.estado]}</span></td>
                    <td className="px-3 py-2 max-w-[260px]">
                      <p className="truncate font-medium">{d.nombreArchivo}</p>
                      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
                        {pesoArchivo(d.bytes)}{d.clienteId && cliente.get(d.clienteId) ? ` · ${cliente.get(d.clienteId)}` : ''}
                        {d.riesgoInyeccion && <span style={{ color: 'var(--warn)' }}> · trae instrucciones para un modelo</span>}
                      </p>
                    </td>
                    <td className="px-3 py-2">{ROTULO_FORMATO[d.formato] ?? d.formato} · {ROTULO_CANAL[d.canal] ?? d.canal}</td>
                    <td className="px-3 py-2">
                      {d.estado === 'por_revisar' && v ? (
                        <span>
                          {v.bloqueos > 0 && <strong style={{ color: 'var(--bad)' }}>{numero(v.bloqueos)} por corregir</strong>}
                          {v.bloqueos > 0 && v.porConfirmar > 0 && ' · '}
                          {v.porConfirmar > 0 && <strong style={{ color: 'var(--warn)' }}>{numero(v.porConfirmar)} por confirmar</strong>}
                          {v.bloqueos === 0 && v.porConfirmar === 0 && <span style={{ color: 'var(--ok)' }}>Listo para aprobar</span>}
                        </span>
                      ) : d.estado === 'fallido' ? (
                        <span style={{ color: 'var(--bad)' }}>{d.ultimoError ?? 'No se pudo leer.'}</span>
                      ) : d.estado === 'aprobado' ? (
                        <span style={{ color: d.viajeId ? 'var(--ok)' : 'var(--warn)' }}>{d.viajeId ? 'Con viaje' : 'Sin viaje todavía'}</span>
                      ) : d.estado === 'rechazado' ? (
                        <span style={{ color: 'var(--muted)' }}>{d.rechazoMotivo}</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fechaHoraMx(d.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      {(d.estado === 'recibido' || (d.estado === 'fallido' && d.intentos < 5)) && acciones.procesar ? (
                        <FormaAccion accion={acciones.procesar} className="inline">
                          <input type="hidden" name="documentoId" value={d.id} />
                          <BotonEnvio variante="secundario" etiqueta={d.estado === 'fallido' ? 'Reintentar' : 'Leer ahora'} pendiente="Leyendo…" icono={<RotateCcw width={13} height={13} strokeWidth={1.75} />} />
                        </FormaAccion>
                      ) : (
                        <Link href={`/dashboard/carta-porte/documentos/${d.id}${sufijo}`} className="text-[12px] font-medium hover:opacity-75" style={{ color: 'var(--marca)' }}>
                          {d.estado === 'por_revisar' ? 'Revisar →' : 'Ver →'}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {datos.filas.length < datos.total && (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Se muestran los {numero(datos.filas.length)} más recientes de {numero(datos.total)}.</p>
      )}
    </section>
  );
}

function Canales({ buzon, acciones }: { buzon: BuzonVista | null; acciones: AccionesDocumentos }) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="card p-4 space-y-2.5">
        <h2 className="text-[13px] font-medium flex items-center gap-1.5"><Mail width={14} height={14} strokeWidth={1.75} /> Correo de tu flota</h2>
        {buzon === null ? (
          <>
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Activa un buzón propio: lo que tus clientes manden ahí (adjuntos o el texto del correo) entra a esta bandeja. El
              correo llega firmado por el proveedor y la flota se identifica por la dirección, nunca por el remitente.
            </p>
            {acciones.activarBuzon && (
              <FormaAccion accion={acciones.activarBuzon}><BotonEnvio etiqueta="Activar buzón" /></FormaAccion>
            )}
          </>
        ) : (
          <>
            {buzon.direccion ? (
              <p className="text-[12.5px]">Dirección: <code className="cifra-mono select-all">{buzon.direccion}</code>{!buzon.activo && <strong style={{ color: 'var(--warn)' }}> (apagado)</strong>}</p>
            ) : (
              <p className="text-[12px] px-3 py-2 rounded-lg" style={{ background: 'var(--warnbg, var(--canvas))', color: 'var(--warn)' }}>
                {buzon.dominioConfigurado ? 'La dirección no se pudo armar.' : 'El dominio de correo de Likida no está configurado en este entorno: el buzón existe pero no hay dirección que dar.'}
              </p>
            )}
            {acciones.guardarRemitentes && (
              <FormaAccion accion={acciones.guardarRemitentes}>
                <label htmlFor="cp-remitentes" className={ETIQUETA}>Remitentes de tus clientes (uno por línea: correo o dominio). Vacío = cualquiera.</label>
                <textarea id="cp-remitentes" name="remitentes" rows={3} defaultValue={buzon.remitentes.join('\n')} className={`${CAMPO} h-auto py-2`} style={{ background: 'var(--surface)' }} />
                <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Un correo de otro remitente entra igual, marcado «remitente no reconocido» para que lo revises.</p>
                <BotonEnvio variante="secundario" etiqueta="Guardar remitentes" />
              </FormaAccion>
            )}
          </>
        )}
      </div>
      <div className="card p-4 space-y-2">
        <h2 className="text-[13px] font-medium flex items-center gap-1.5"><MessageCircle width={14} height={14} strokeWidth={1.75} /> WhatsApp</h2>
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          Quien despacha en tu flota puede reenviar el documento del cliente al número de Likida: un PDF, un Excel o un XML con
          Carta Porte entran solos; una foto debe llevar el pie «carta porte» o «embarque». Funciona en las flotas que activaron el
          buzón. La respuesta llega por el mismo chat con la liga a esta bandeja.
        </p>
      </div>
    </section>
  );
}

function Perfiles({ perfiles, acciones }: { perfiles: PerfilVista[]; acciones: AccionesDocumentos }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[13px] font-medium flex items-center gap-1.5"><Layers width={14} height={14} strokeWidth={1.75} /> Formatos que Likida ya conoce</h2>
      {perfiles.length === 0 ? (
        <p className="text-[12px] max-w-3xl" style={{ color: 'var(--muted)' }}>
          Todavía ninguno. Cuando apruebes el primer Excel, PDF con texto, XML o correo de un cliente, Likida recuerda en qué columna o
          etiqueta viene cada dato y la siguiente vez lo lee sin modelo.
        </p>
      ) : (
        <div className="space-y-2">
          {perfiles.map((p) => (
            <details key={p.id} className="card p-3.5">
              <summary className="cursor-pointer text-[12.5px] select-none">
                <strong>{p.nombre}</strong> <span style={{ color: 'var(--muted)' }}>· {ROTULO_FORMATO[p.formato] ?? p.formato} · versión {p.versionActiva} · {numero(p.mapeos)} campos reconocidos</span>
              </summary>
              <ul className="pt-2.5 space-y-1.5 text-[12px]">
                {p.versiones.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center gap-2">
                    <span className="cifra-mono">v{v.version}</span>
                    <span style={{ color: 'var(--muted)' }}>{v.nota ?? 'Versión inicial'}</span>
                    {v.version === p.versionActiva ? (
                      <span className="text-[11px] font-medium" style={{ color: 'var(--ok)' }}>activa</span>
                    ) : acciones.volverVersion && (
                      <FormaAccion accion={acciones.volverVersion} className="inline">
                        <input type="hidden" name="perfilId" value={p.id} /><input type="hidden" name="version" value={v.version} />
                        <BotonEnvio variante="secundario" etiqueta="Volver a esta" pendiente="…" />
                      </FormaAccion>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

const EJEMPLO_CONFIG = `{
  "porMercancia": true,
  "delimitador": ",",
  "columnas": [
    { "encabezado": "Folio", "campo": "folio_cliente" },
    { "encabezado": "RFC Remitente", "campo": "origen_rfc" },
    { "encabezado": "CP Origen", "campo": "origen_cp" },
    { "encabezado": "Producto", "campo": "mercancia.bienes_transp" },
    { "encabezado": "Peso kg", "campo": "mercancia.peso_kg" },
    { "encabezado": "Sistema", "constante": "LIKIDA" }
  ]
}`;

function Exportacion({ configs, acciones, apiSufijo }: { configs: ConfigVista[]; acciones: AccionesDocumentos; apiSufijo: string }) {
  const liga = (config: string, formato: string) => `/api/export/carta-porte-docs?config=${encodeURIComponent(config)}&formato=${formato}${apiSufijo}`;
  return (
    <section className="space-y-2">
      <h2 className="text-[13px] font-medium flex items-center gap-1.5"><Download width={14} height={14} strokeWidth={1.75} /> Exportar lo aprobado</h2>
      <p className="text-[12px] max-w-3xl" style={{ color: 'var(--muted)' }}>
        Solo salen documentos <strong>aprobados</strong>. El formato exacto que espera tu cliente (por ejemplo Innovativos) todavía no se conoce:
        declara aquí qué columna lleva cada dato y se genera el CSV o JSON a tu medida. Mientras tanto, está el formato estándar de Likida.
      </p>
      <div className="flex flex-wrap gap-2 text-[12px]">
        <a className="hairline rounded-lg px-3 h-8 inline-flex items-center hover:opacity-80" href={liga('estandar', 'csv')}>Estándar · CSV</a>
        <a className="hairline rounded-lg px-3 h-8 inline-flex items-center hover:opacity-80" href={liga('estandar', 'json')}>Estándar · JSON</a>
        {configs.map((c) => (
          <a key={c.id} className="hairline rounded-lg px-3 h-8 inline-flex items-center hover:opacity-80" href={liga(c.id, c.formato)}>{c.nombre} · {c.formato.toUpperCase()}</a>
        ))}
      </div>
      {acciones.guardarExport && (
        <details className="card p-3.5 max-w-3xl">
          <summary className="cursor-pointer text-[12.5px] font-medium select-none">Declarar un formato destino</summary>
          <FormaAccion accion={acciones.guardarExport} className="pt-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="cp-exp-nombre" className={ETIQUETA}>Nombre (si ya existe, se reemplaza)</label>
                <input id="cp-exp-nombre" name="nombre" required maxLength={80} placeholder="Innovativos" className={CAMPO} style={{ background: 'var(--surface)' }} />
              </div>
              <div>
                <label htmlFor="cp-exp-formato" className={ETIQUETA}>Formato</label>
                <select id="cp-exp-formato" name="formato" defaultValue="csv" className={CAMPO} style={{ background: 'var(--surface)' }}>
                  <option value="csv">CSV</option><option value="json">JSON</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="cp-exp-config" className={ETIQUETA}>Mapeo (JSON)</label>
              <textarea id="cp-exp-config" name="config" rows={10} required defaultValue={EJEMPLO_CONFIG} className={`${CAMPO} h-auto py-2 font-mono text-[12px]`} style={{ background: 'var(--surface)' }} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                Campos: los del complemento (<code>origen_cp</code>, <code>destino_rfc</code>…), de mercancía (<code>mercancia.peso_kg</code>…) y de sistema
                (<code>documento.id</code>, <code>documento.archivo</code>, <code>documento.viaje_folio</code>…). <code>porMercancia: false</code> = una fila por documento.
              </p>
            </div>
            <BotonEnvio etiqueta="Guardar formato" />
          </FormaAccion>
          {configs.length > 0 && acciones.borrarExport && (
            <ul className="pt-3 space-y-1 text-[12px]">
              {configs.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span>{c.nombre}</span>
                  <FormaAccion accion={acciones.borrarExport as AccionDoc} className="inline">
                    <input type="hidden" name="id" value={c.id} />
                    <BotonEnvio variante="peligro" etiqueta="Quitar" pendiente="…" />
                  </FormaAccion>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--faint)' }}>
        <TriangleAlert width={12} height={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
        El archivo lo abre Excel: el texto que empieza con = + - @ sale con un apóstrofo delante para que no se ejecute como fórmula.
      </p>
    </section>
  );
}
