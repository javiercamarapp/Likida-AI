import { Send, Inbox, TriangleAlert } from 'lucide-react';
import type { Entrega } from '@/lib/likida/buzon/entrega_repo';
import type { Recepcion, ConteoBuzon } from '@/lib/likida/buzon/repo';
import type { ConfigEntrega } from '@/lib/likida/buzon/entrega_pura';
import { mxn, numero, fechaHoraMx, pesoArchivo } from '@/lib/formato';
import { EstadoVacio } from '@/app/admin/ui/kit';
import type { AccionProveedores } from './controles';
import { FormaEntrega, BotonEnviarAhora, BotonesLote, BotonDescartar, BotonVerPdf } from './controles_buzon';

// ═══════════════════════════════════════════════════════════════════════════
// LAS DOS SECCIONES NUEVAS DEL BUZÓN (Agente 9): la ENTREGA AL CONTADOR y lo RECIBIDO por correo.
// Sin datos, dicen QUÉ falta; una lectura caída (`null`) lo dice en vez de pintar «nada».
// ═══════════════════════════════════════════════════════════════════════════

const ROTULO_LOTE: Record<Entrega['estado'], { texto: string; color: string; fondo: string }> = {
  pendiente: { texto: 'En cola', color: 'var(--muted)', fondo: 'var(--canvas)' },
  enviando: { texto: 'Enviando', color: 'var(--muted)', fondo: 'var(--canvas)' },
  enviada: { texto: 'Enviada · sin confirmar', color: 'var(--warn)', fondo: 'var(--warnbg)' },
  entregada: { texto: 'Entregada', color: 'var(--ok)', fondo: 'var(--okbg)' },
  rebotada: { texto: 'Rebotó', color: 'var(--bad)', fondo: 'var(--badbg)' },
  fallida: { texto: 'Falló', color: 'var(--bad)', fondo: 'var(--badbg)' },
  cancelada: { texto: 'Cancelada', color: 'var(--faint)', fondo: 'var(--canvas)' },
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
  return (
    <section className="card p-4">
      <h2 className="font-display text-[15px] font-semibold mb-1">Entrega al contador</h2>
      <p className="text-[11px] mb-3 max-w-xl" style={{ color: 'var(--faint)' }}>
        Las facturas que tú apruebas salen por correo al contador, con su CSV y un ZIP con el XML y el PDF de cada una.
        La decisión de aprobar sigue siendo de una persona; esto solo ahorra el envío.
      </p>

      {config === null ? (
        <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>
          No se pudo leer la configuración de la entrega. Recarga la página; si se repite, avísale a Likida.
        </p>
      ) : !disponible ? (
        <EstadoVacio icono={<Send width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          La entrega al contador aún no está disponible en este entorno (falta aplicar la migración 0531).
          Mientras tanto las aprobadas se descargan en CSV arriba.
        </EstadoVacio>
      ) : (
        <div className="space-y-5">
          {puedeAdministrar ? (
            <FormaEntrega config={config} guardar={acciones.guardar} />
          ) : (
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
              {config.activo
                ? <>Activa: se entrega a {config.destinatarios.join(', ')} ({ROTULO_FORMATO[config.formato]}{config.automatica ? `, solo, desde las ${config.horaEnvio}:00` : ', a petición'}).</>
                : 'Apagada. Configurarla es una acción del dueño de la flota.'}
            </p>
          )}

          {config.activo && (
            <div className="flex items-center gap-3 flex-wrap">
              {sinEntregar === null
                ? <span className="text-[12px]" style={{ color: 'var(--bad)' }}>No se pudo contar lo pendiente de entregar.</span>
                : sinEntregar > 0
                  ? <BotonEnviarAhora enviar={acciones.enviar} disponibles={sinEntregar} />
                  : <span className="text-[12px]" style={{ color: 'var(--faint)' }}>No hay aprobadas pendientes de entregar.</span>}
            </div>
          )}

          <div>
            <h3 className="etiqueta-mono text-[10px] uppercase mb-2" style={{ color: 'var(--faint)' }}>Últimos envíos</h3>
            {lotes === null ? (
              <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>No se pudo leer el historial de envíos.</p>
            ) : lotes.length === 0 ? (
              <p className="text-[12px]" style={{ color: 'var(--faint)' }}>Aún no se ha enviado ningún lote.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--faint)' }}>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Creado</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Facturas</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pr-4 text-right">Total</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Estado</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotes.map((l) => {
                      const r = ROTULO_LOTE[l.estado];
                      return (
                        <tr key={l.id} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                          <td className="py-2" style={{ color: 'var(--muted)' }}>
                            {fechaHoraMx(l.creadoEn)}
                            <span className="block text-[10.5px]" style={{ color: 'var(--faint)' }}>
                              {l.disparo === 'automatica' ? 'automático' : 'a petición'} · {ROTULO_FORMATO[l.formato]}
                            </span>
                          </td>
                          <td className="py-2 cifra-mono">{numero(l.nFacturas)}</td>
                          <td className="py-2 pr-4 text-right cifra-mono">{mxn(l.total)}</td>
                          <td className="py-2">
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ color: r.color, background: r.fondo }}>{r.texto}</span>
                            {l.estado === 'pendiente' && l.intentos > 0 && (
                              <span className="block text-[10.5px]" style={{ color: 'var(--faint)' }}>intento {l.intentos}, reintenta solo</span>
                            )}
                            {l.estado === 'rebotada' && (
                              <span className="block text-[10.5px]" style={{ color: 'var(--bad)' }}>
                                El correo rebotó: revisa la dirección del contador; sus facturas volvieron a la cola.
                              </span>
                            )}
                            {(l.estado === 'fallida' || (l.estado === 'pendiente' && l.error)) && l.error && (
                              <span className="block text-[10.5px] max-w-[34ch]" style={{ color: 'var(--bad)' }}>{l.error}</span>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            {puedeAdministrar && (l.estado === 'fallida' || l.estado === 'pendiente') ? (
                              <BotonesLote id={l.id} puedeReintentar={l.estado === 'fallida'} puedeCancelar
                                reintentar={acciones.reintentar} cancelar={acciones.cancelar} />
                            ) : <span className="text-[11px]" style={{ color: 'var(--faint)' }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const ROTULO_RECEPCION: Record<Recepcion['estado'], { texto: string; color: string }> = {
  procesada: { texto: 'Entró a la bandeja', color: 'var(--ok)' },
  duplicada: { texto: 'Ya la teníamos', color: 'var(--muted)' },
  revision: { texto: 'Revísala', color: 'var(--warn)' },
  descartada: { texto: 'Descartada', color: 'var(--faint)' },
  ignorada: { texto: 'Ignorada', color: 'var(--faint)' },
  rechazada: { texto: 'Rechazada por seguridad', color: 'var(--bad)' },
  error: { texto: 'Error', color: 'var(--bad)' },
};

export function SeccionRecepcion({ recepciones, conteo, acciones }: {
  recepciones: Recepcion[] | null;
  conteo: ConteoBuzon | null;
  acciones: { descartar: AccionProveedores; verPdf: AccionProveedores };
}) {
  return (
    <section className="card p-4">
      <h2 className="font-display text-[15px] font-semibold mb-1">Lo que ha llegado por correo</h2>
      <p className="text-[11px] mb-3 max-w-xl" style={{ color: 'var(--faint)' }}>
        El buzón lee XML, PDF y ZIP. Un PDF sin XML se lee con IA y queda marcado para que lo cotejes antes de aprobar;
        un ZIP se abre con límites de tamaño y un archivo sospechoso se rechaza y se anota aquí con el motivo.
      </p>
      {recepciones === null || conteo === null ? (
        <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>No se pudo leer lo recibido. Recarga la página; si se repite, avísale a Likida (en un entorno sin la migración 0530 aplicada es lo esperado).</p>
      ) : recepciones.length === 0 ? (
        <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          Todavía no llega ningún archivo por correo. Cuando un proveedor mande una factura a tu dirección, aparece aquí.
        </EstadoVacio>
      ) : (
        <>
          <div className="flex gap-4 flex-wrap text-[12px] mb-3" style={{ color: 'var(--muted)' }}>
            <span>{numero(conteo.total)} archivos en 30 días</span>
            <span>{numero(conteo.porEstado.procesada)} entraron</span>
            <span>{numero(conteo.porEstado.duplicada)} repetidos</span>
            {conteo.facturasPorRevisar > 0 && (
              <span className="inline-flex items-center gap-1" style={{ color: 'var(--warn)' }}>
                <TriangleAlert width={11} height={11} strokeWidth={2} /> {numero(conteo.facturasPorRevisar)} factura(s) leída(s) de PDF esperan tu cotejo
              </span>
            )}
            {conteo.porEstado.rechazada > 0 && <span style={{ color: 'var(--bad)' }}>{numero(conteo.porEstado.rechazada)} rechazados por seguridad</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left" style={{ color: 'var(--faint)' }}>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Recibido</th>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Archivo</th>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Qué pasó</th>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {recepciones.map((r) => {
                  const e = ROTULO_RECEPCION[r.estado];
                  return (
                    <tr key={r.id} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                      <td className="py-2" style={{ color: 'var(--muted)' }}>{fechaHoraMx(r.recibidoEn)}</td>
                      <td className="py-2">
                        <span className="block truncate max-w-[30ch]" title={r.nombre}>{r.nombre}</span>
                        <span className="block text-[10.5px]" style={{ color: 'var(--faint)' }}>
                          {r.tipo.toUpperCase()} · {pesoArchivo(r.bytes)}{r.zipOrigen ? ` · dentro de ${r.zipOrigen}` : ''}
                        </span>
                      </td>
                      <td className="py-2">
                        <span className="font-medium" style={{ color: e.color }}>{e.texto}</span>
                        {r.motivo && <span className="block text-[10.5px] max-w-[46ch]" style={{ color: 'var(--faint)' }}>{r.motivo}</span>}
                      </td>
                      <td className="py-2 text-right">
                        <div className="inline-flex gap-1.5 flex-wrap justify-end">
                          {r.storageRuta && <BotonVerPdf campo="recepcionId" id={r.id} ver={acciones.verPdf} />}
                          {r.estado === 'revision' && r.facturaId === null && <BotonDescartar id={r.id} descartar={acciones.descartar} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
