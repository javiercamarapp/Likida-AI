import Link from 'next/link';
import { ScrollText, TriangleAlert, Sparkles, Mail, MessageCircle, LayoutDashboard } from 'lucide-react';
import type { EstadoCartaPorte } from '@/lib/likida/carta_porte_datos';
import { numero } from '@/lib/formato';
import { BarraPagina } from '../../resumen-visual';
import { EstadoError, EstadoVacio } from '@/app/admin/ui/kit';
import { DireccionBuzon } from '../proveedores/controles';

/**
 * La ventana del Agente de Carta Porte (Fases B-C del blueprint): los conteos
 * del semáforo, la COLA de «falta declarar» (los viajes donde el agente está
 * esperando una respuesta del jefe), y la carta de lo que entiende — que es
 * la verdad del código, no marketing.
 *
 * Área `operacion` como su pantalla hermana /dashboard/carta-porte: cero
 * pesos, y su usuario diario es el jefe de tráfico. Pura props.
 */
/** El buzón de correo de la flota tal como lo pinta el bloque «Cómo mandarme documentos». */
export interface BuzonCartaPorteVista { direccion: string | null; activo: boolean; remitentes: string[]; dominioConfigurado: boolean }

/**
 * La frase que dice que los grupos NO son un canal. Exportada para que la prueba
 * la distinga de cualquier otra mención: «grupo» solo puede aparecer aquí.
 */
export const FRASE_SIN_GRUPOS = 'Los grupos de WhatsApp no se pueden leer: pide a tus clientes que escriban al correo o reenvíalos tú.';

export function VistaAgenteCartaPorte({ datos, sufijo = '', notificaciones, buzon = null }: {
  datos: EstadoCartaPorte | null;
  sufijo?: string;
  notificaciones?: React.ReactNode;
  /** `null` = la flota aún no activa su buzón; `'no_leido'` = la lectura falló (no se finge «sin buzón»). */
  buzon?: BuzonCartaPorteVista | null | 'no_leido';
}) {
  const conteo = (n: 'si' | 'no' | 'falta_declarar') =>
    datos === null ? null : datos.viajes.filter((v) => v.decision.necesita === n).length;
  const armables = datos === null ? null : datos.viajes.filter((v) => v.borrador.borrador !== null && v.borrador.fallas.length === 0).length;
  const cola = datos === null ? [] : datos.viajes.filter((v) => v.decision.necesita === 'falta_declarar');

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ScrollText width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Carta Porte en automático"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <p className="text-[12.5px] max-w-3xl" style={{ color: 'var(--muted)' }}>
            Al despachar un viaje, este agente corre el árbol legal (RMF 2.7.7) y le pregunta al jefe
            por WhatsApp exactamente lo que falta declarar — o le da el veredicto con fundamento. Nunca
            afirma «no necesitas» por su cuenta, nunca inventa un dato del complemento y nunca timbra:
            prepara el borrador y lo valida contra lo que el PAC rechazaría seguro.
          </p>

          {datos === null ? (
            <EstadoError mensaje="No se pudieron leer los viajes en curso. Sin lectura no se pintan conteos: un cero fingido aquí diría «todo en regla»." />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tarjeta rotulo="Viajes en curso" valor={datos.total} />
                <Tarjeta rotulo="Esperan declaración" valor={conteo('falta_declarar')} tono="var(--bad)" />
                <Tarjeta rotulo="Necesitan complemento" valor={conteo('si')} tono="var(--warn)" />
                <Tarjeta rotulo="Borradores sin fallas" valor={armables} tono="var(--ok)" />
              </div>

              <section className="card p-4 space-y-3">
                <h2 className="font-display text-[15px] font-semibold">Esperando al jefe</h2>
                {cola.length === 0 ? (
                  <EstadoVacio icono={<ScrollText width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                    Nada pendiente de declarar: cada viaje en curso ya tiene su veredicto (o no hay
                    viajes). Al despachar uno nuevo, el agente pregunta solo.
                  </EstadoVacio>
                ) : (
                  <ul className="space-y-2 text-[12.5px]">
                    {cola.map((v) => (
                      <li key={v.viajeId} className="flex flex-wrap items-start gap-x-3 gap-y-0.5">
                        <span className="cifra-mono font-medium">{v.folio ?? v.viajeId.slice(0, 8)}</span>
                        <span style={{ color: 'var(--muted)' }}>
                          {v.origen && v.destino ? `${v.origen} → ${v.destino}` : 'sin ruta capturada'}
                        </span>
                        <span className="inline-flex items-start gap-1" style={{ color: 'var(--warn)' }}>
                          <TriangleAlert width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                          {v.decision.pendientes.join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <Link href={`/dashboard/carta-porte${sufijo}`} className="inline-block text-[12px] font-medium hover:opacity-75" style={{ color: 'var(--marca)' }}>
                  Declarar y capturar en la pantalla de Carta Porte →
                </Link>
                {datos.viajes.length < datos.total && (
                  <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
                    Los conteos por veredicto salen de los {numero(datos.viajes.length)} viajes más
                    próximos de {numero(datos.total)} en curso.
                  </p>
                )}
              </section>
            </>
          )}

          <ComoMandarDocumentos buzon={buzon} sufijo={sufijo} />

          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
            Lo que el agente aprende de cada cliente —productos, remitentes, destinatarios y su número interno— vive en el{' '}
            <Link href={`/dashboard/agentes/carta-porte/catalogo${sufijo}`} className="font-medium hover:opacity-75" style={{ color: 'var(--marca)' }}>catálogo del cliente →</Link>
          </p>

          <section className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
              <h2 className="font-display text-[15px] font-semibold">Lo que hace, y lo que jamás hará</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-4 text-[12.5px]">
              <div>
                <div className="etiqueta-mono text-[10px] uppercase mb-1.5" style={{ color: 'var(--faint)' }}>Al despachar</div>
                <p style={{ color: 'var(--muted)' }}>
                  Corre el árbol legal y pregunta por WhatsApp: «¿la ruta pisa carretera federal?» con
                  botones, y si la unidad cabe en la excepción del C2, el radio («radio F-123 25»).
                  Cada declaración queda firmada con quién y cuándo.
                </p>
              </div>
              <div>
                <div className="etiqueta-mono text-[10px] uppercase mb-1.5" style={{ color: 'var(--faint)' }}>Con lo capturado</div>
                <p style={{ color: 'var(--muted)' }}>
                  Arma el borrador del complemento (37 datos, partidos 19 del cliente / 18 del
                  transportista) y lo pasa por las validaciones que el PAC rechaza seguro — «te faltó
                  esto, antes de salir» en vez de «rebotó el timbrado con el viaje entregado».
                </p>
              </div>
              <div>
                <div className="etiqueta-mono text-[10px] uppercase mb-1.5" style={{ color: 'var(--faint)' }}>Jamás</div>
                <p style={{ color: 'var(--muted)' }}>
                  No afirma «no necesitas Carta Porte» sin tu declaración firmada; no inventa claves del
                  SAT ni el número de permiso SICT (faltante = faltante); y no timbra — el CFDI lo emite
                  tu PAC de siempre.
                </p>
              </div>
            </div>
          </section>

          {notificaciones}
        </div>
      </div>
    </main>
  );
}

function Tarjeta({ rotulo, valor, tono }: { rotulo: string; valor: number | null; tono?: string }) {
  return (
    <div className="card p-4">
      <div className="etiqueta-mono text-[10px] uppercase mb-1" style={{ color: 'var(--faint)' }}>{rotulo}</div>
      <div className="cifra-mono text-[22px] font-semibold" style={tono && valor !== null && valor > 0 ? { color: tono } : undefined}>
        {valor === null ? '—' : numero(valor)}
      </div>
    </div>
  );
}

/**
 * Los tres caminos por los que llega un documento (el correo oficial del cliente
 * es el principal; el WhatsApp es 1:1 con la oficina, nunca un grupo) y, con el
 * buzón sin activar, el estado vacío que dice cómo empezar.
 */
function ComoMandarDocumentos({ buzon, sufijo }: { buzon: BuzonCartaPorteVista | null | 'no_leido'; sufijo: string }) {
  const panel = `/dashboard/carta-porte/documentos${sufijo}`;
  return (
    <section className="card p-4 space-y-3" aria-labelledby="cp-como-mandar">
      <h2 id="cp-como-mandar" className="font-display text-[15px] font-semibold">Cómo mandarme documentos</h2>
      <div className="grid md:grid-cols-3 gap-4 text-[12.5px]">
        <div className="space-y-1.5">
          <div className="etiqueta-mono text-[10px] uppercase flex items-center gap-1" style={{ color: 'var(--faint)' }}>
            <Mail width={12} height={12} strokeWidth={1.75} /> 1 · Correo (el medio oficial)
          </div>
          {buzon === 'no_leido' ? (
            <EstadoError mensaje="No se pudo leer el buzón de tu flota. Sin lectura no se enseña una dirección: una inventada se perdería." />
          ) : buzon === null ? (
            <EstadoVacio icono={<Mail width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Aún no tienes buzón. Actívalo en el panel de documentos y aquí verás la dirección para
              que tus clientes (o tú) reenvíen los embarques.
            </EstadoVacio>
          ) : buzon.direccion ? (
            <>
              <DireccionBuzon direccion={buzon.direccion} />
              {!buzon.activo && <p style={{ color: 'var(--warn)' }}>El buzón está apagado: lo que llegue no se leerá hasta encenderlo en el panel.</p>}
              <p style={{ color: 'var(--muted)' }}>
                Los adjuntos (PDF, Excel, XML, foto) y el texto del correo entran solos a la bandeja.
              </p>
              <p style={{ color: 'var(--muted)' }}>
                {buzon.remitentes.length > 0
                  ? `Remitentes de tus clientes reconocidos: ${buzon.remitentes.join(', ')}. Uno distinto entra igual, marcado «remitente no reconocido».`
                  : 'Remitentes reconocidos: cualquiera (puedes limitarlos a los correos de tus clientes en el panel).'}
              </p>
            </>
          ) : (
            <p style={{ color: 'var(--warn)' }}>
              {buzon.dominioConfigurado ? 'La dirección no se pudo armar.' : 'El dominio de correo de Likida no está configurado en este entorno: el buzón existe pero no hay dirección que dar.'}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="etiqueta-mono text-[10px] uppercase flex items-center gap-1" style={{ color: 'var(--faint)' }}>
            <MessageCircle width={12} height={12} strokeWidth={1.75} /> 2 · WhatsApp 1:1 de la oficina
          </div>
          <p style={{ color: 'var(--muted)' }}>
            Quien despacha reenvía el archivo al número de Likida, o pega el texto del embarque empezando
            con la palabra «carta porte». Una foto debe llevar ese mismo pie.
          </p>
        </div>
        <div className="space-y-1.5">
          <div className="etiqueta-mono text-[10px] uppercase flex items-center gap-1" style={{ color: 'var(--faint)' }}>
            <LayoutDashboard width={12} height={12} strokeWidth={1.75} /> 3 · El panel
          </div>
          <p style={{ color: 'var(--muted)' }}>Sube el archivo a mano en la bandeja de documentos.</p>
          <Link href={panel} className="inline-block text-[12px] font-medium hover:opacity-75" style={{ color: 'var(--marca)' }}>
            Abrir la bandeja de documentos →
          </Link>
        </div>
      </div>
      <p className="text-[12px] font-medium">{FRASE_SIN_GRUPOS}</p>
    </section>
  );
}
