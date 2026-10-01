import Link from 'next/link';
import { QrCode, MessageCircle, TriangleAlert, Smartphone } from 'lucide-react';
import { numero } from '@/lib/formato';
import { EstadoError } from '@/app/admin/ui/kit';
import { BarraPagina } from '../resumen-visual';
import { AccionesEnlace } from './acciones';
import type { NumeroWhatsApp } from '@/lib/likida/arranque_whatsapp';

export interface DatosArranque {
  numero: NumeroWhatsApp;
  nombreFlota: string;
  /** El enlace wa.me con texto prellenado; null si no hay número que enlazar. */
  enlace: string | null;
  /** El SVG del QR (ya armado en el servidor); null si no hay enlace o no cupo. */
  qrSvg: string | null;
  /** Cuántos operadores activos hay y cuántos esperan invitación; null = no se pudo contar. */
  operadores: { activos: number; pendientesDeInvitar: number } | null;
}

const PASOS_CHOFER = [
  ['Lo das de alta con SU número de WhatsApp', 'En Operadores, uno por uno o con la carga desde Excel. El bot lo reconoce por ese número: si escribe desde otro, no lo reconoce como chofer de tu flota.'],
  ['Guarda el número de Likida y le escribe', 'Con el enlace, el QR o el cartel de abajo. Basta un «Hola» desde el número que diste de alta. Si lo invitas desde Operadores, le llega un mensaje que lo trae solo.'],
  ['Lee el aviso de privacidad', 'En su primer mensaje Likida le pone a la vista el aviso de privacidad —con los datos de tu empresa— antes de tratar nada más.'],
  ['Recibe su viaje y manda las fotos de sus tickets', 'Cuando le asignas un viaje le avisa por WhatsApp. Cada foto de ticket o comprobante se lee, se clasifica y se cuelga del viaje.'],
  ['Escribe «LISTO» y le llega su liquidación', 'Al cerrar el viaje, el motor cuadra gastos contra anticipo y política, y le entrega la liquidación en PDF por el mismo chat.'],
] as const;

/**
 * LA GUÍA DE ARRANQUE DEL CHOFER (W2 «producto»). Responde la pregunta que ninguna
 * pantalla contestaba —«¿a qué número le escribe mi chofer?»— y le da al dueño
 * tres formas de repartirlo: el enlace, el QR y un cartel para imprimir.
 */
export function VistaArranqueWhatsApp({ datos, hrefOperadores, hrefAyuda }: {
  datos: DatosArranque;
  hrefOperadores: string;
  hrefAyuda: string;
}) {
  const n = datos.numero;
  return (
    <main className="h-full">
      {/* El cartel imprimible es el ÚNICO bloque que sale al imprimir. */}
      <style>{`@media print { body * { visibility: hidden !important; } #cartel-whatsapp, #cartel-whatsapp * { visibility: visible !important; } #cartel-whatsapp { position: fixed; inset: 0; margin: 0; padding: 32px; border: 0 !important; box-shadow: none !important; background: #fff !important; color: #000 !important; } }`}</style>
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Smartphone width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="WhatsApp de tus operadores"
        />
        <div className="px-5 py-5 flex-1 space-y-4">
          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
            Todo el ciclo —avisos de viaje, fotos de tickets, liquidación— ocurre por WhatsApp. Esta es la pantalla para
            arrancar a tus choferes: a qué número escribirle y qué pasa después.
          </p>

          {n.estado === 'sin_configurar' && (
            <section className="card p-4" role="alert">
              <p className="flex items-start gap-2 text-[13px] font-medium" style={{ color: 'var(--warn)' }}>
                <TriangleAlert aria-hidden width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                El número de WhatsApp de Likida todavía no está configurado para tu cuenta.
              </p>
              <p className="mt-1 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                Sin él no hay un número al que tus choferes puedan escribir, y esta pantalla no va a inventar uno.
                Pídelo desde el <Link href={hrefAyuda} className="underline">Centro de ayuda</Link>: es un dato que Likida activa en tu cuenta.
              </p>
            </section>
          )}

          {n.estado === 'invalido' && (
            <EstadoError mensaje={`El número de WhatsApp configurado no es válido. ${n.motivo} Avísale a soporte para que lo corrija.`} />
          )}

          {n.estado === 'configurado' && datos.enlace && (
            <section id="cartel-whatsapp" aria-labelledby="titulo-cartel" className="card p-5">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                {datos.qrSvg && (
                  // El SVG lo arma `lib/qr.ts` en el servidor desde un texto que SALE de
                  // nuestra configuración (número + nombre de la flota, ya codificados):
                  // no es HTML de un usuario.
                  <div className="shrink-0 self-center rounded-lg" style={{ background: '#fff', padding: 4, border: '1px solid var(--line)' }}
                    dangerouslySetInnerHTML={{ __html: datos.qrSvg }} />
                )}
                <div className="min-w-0 space-y-2">
                  <h2 id="titulo-cartel" className="font-display text-[16px] font-semibold flex items-center gap-1.5">
                    <MessageCircle aria-hidden width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
                    Escríbele a Likida por WhatsApp
                  </h2>
                  <p className="font-display text-[26px] font-semibold tabular" style={{ color: 'var(--ink)' }}>{n.visible}</p>
                  <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                    Escanea el código o toca el enlace desde el celular que diste de alta en {datos.nombreFlota}. Se abre el chat con el mensaje
                    ya escrito: solo hay que enviarlo.
                  </p>
                  <p className="break-all text-[12px]" style={{ color: 'var(--faint)' }}>
                    <a href={datos.enlace} className="underline" rel="noopener noreferrer">{datos.enlace}</a>
                  </p>
                </div>
              </div>
              <div className="mt-4 print:hidden"><AccionesEnlace enlace={datos.enlace} /></div>
            </section>
          )}

          {n.estado === 'configurado' && n.esPrueba && (
            <p role="alert" className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>
              <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              Este es un número de PRUEBA: no atiende a choferes reales. No lo repartas hasta que Likida active el número comercial verificado.
            </p>
          )}

          <section aria-labelledby="titulo-flujo" className="card p-4">
            <h2 id="titulo-flujo" className="font-display text-[15px] font-semibold mb-3">Qué pasa con cada chofer</h2>
            <ol className="space-y-3">
              {PASOS_CHOFER.map(([titulo, detalle], i) => (
                <li key={titulo} className="flex items-start gap-3">
                  <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                    style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}>{i + 1}</span>
                  <div>
                    <p className="text-[13px] font-medium">{titulo}</p>
                    <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{detalle}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="titulo-estado" className="card p-4">
            <h2 id="titulo-estado" className="font-display text-[15px] font-semibold mb-1">Dónde vas con tus operadores</h2>
            {datos.operadores === null ? (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No pude contar a tus operadores en este momento.</p>
            ) : datos.operadores.activos === 0 ? (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                Todavía no has dado de alta a ningún operador. <Link href={hrefOperadores} className="underline">Dalos de alta en Operadores</Link>: es el primer paso.
              </p>
            ) : (
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                Tienes <strong style={{ color: 'var(--ink)' }}>{numero(datos.operadores.activos)}</strong> operadores activos
                {datos.operadores.pendientesDeInvitar > 0
                  ? <> y <strong style={{ color: 'var(--ink)' }}>{numero(datos.operadores.pendientesDeInvitar)}</strong> todavía sin invitación por WhatsApp. <Link href={hrefOperadores} className="underline">Invítalos desde Operadores</Link>, o mándales el enlace de arriba.</>
                  : '. Todos ya fueron invitados.'}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
