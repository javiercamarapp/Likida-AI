import Link from 'next/link';
import { numero } from '@/lib/formato';
import { AccionesEnlace } from './acciones';
import type { NumeroWhatsApp } from '@/lib/likida/arranque_whatsapp';
import { Aviso, EstadoError, MarcaIntegracion, MarcoPagina, Tarjeta } from '@/app/ui-v2/componentes';
import './whatsapp.css';

export interface DatosArranque {
  numero: NumeroWhatsApp;
  nombreFlota: string;
  /** El enlace wa.me con texto prellenado; null si no hay número que enlazar. */
  enlace: string | null;
  /** El SVG del QR (ya armado en el servidor); null si no hay enlace o no cupo. */
  qrSvg: string | null;
  /** Cuántos operadores activos hay y cuántos esperan invitación; null = no se pudo contar. */
  operadores: { activos: number; pendientesDeInvitar: number } | null;
  /** CT-A345-19: el perfil de la flota. Con `cinco_agentes` la guía NO describe el flujo clásico (fotos de tickets, «LISTO», liquidación por el chat). */
  perfil?: 'cinco_agentes' | null;
}

const PASOS_CHOFER = [
  ['Lo das de alta con SU número de WhatsApp', 'En Operadores, uno por uno o con la carga desde Excel. El bot lo reconoce por ese número: si escribe desde otro, no lo reconoce como chofer de tu flota.'],
  ['Guarda el número de Likida y le escribe', 'Con el enlace, el QR o el cartel de abajo. Basta un «Hola» desde el número que diste de alta. Si lo invitas desde Operadores, le llega un mensaje que lo trae solo.'],
  ['Lee el aviso de privacidad', 'En su primer mensaje Likida le pone a la vista el aviso de privacidad —con los datos de tu empresa— antes de tratar nada más.'],
  ['Recibe su viaje y manda las fotos de sus tickets', 'Cuando le asignas un viaje le avisa por WhatsApp. Cada foto de ticket o comprobante se lee, se clasifica y se cuelga del viaje.'],
  ['Escribe «LISTO» y le llega su liquidación', 'Al cerrar el viaje, el motor cuadra gastos contra anticipo y política, y le entrega la liquidación en PDF por el mismo chat.'],
] as const;

/**
 * CT-A345-19: bajo el perfil `cinco_agentes` el chat del chofer NO recibe fotos de tickets para liquidar ni entrega la
 * liquidación por «LISTO»: esas promesas son del flujo clásico y aquí serían falsas. Se dice qué sí hace el chat.
 */
export const PASOS_CHOFER_CINCO_AGENTES: ReadonlyArray<readonly [string, string]> = [
  PASOS_CHOFER[0], PASOS_CHOFER[1], PASOS_CHOFER[2],
  ['Recibe los avisos de su viaje y responde por el mismo chat', 'Los avisos solo salen si el Agente de Conductores está habilitado en tu cuenta; si no, el chofer no recibe nada de Likida aunque esté dado de alta. Confirma el viaje, manda su ubicación y las fotos que se le pidan para el hito que está reportando.'],
  ['«LISTO» y la liquidación por este chat no aplican a tu cuenta', 'Tu cuenta no recibe comprobantes ni cierra liquidaciones por este WhatsApp. Si el chofer manda un ticket o escribe «LISTO», el bot le contesta que entregue sus papeles en tu oficina.'],
];

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
    <MarcoPagina titulo="Equipo" apoyo="A qué número de WhatsApp escribe cada operador y qué pasa después: avisos de viaje, fotos de tickets y liquidación.">
      {n.estado === 'sin_configurar' && (
        <div role="alert">
          <Aviso tono="warn" titulo="El número de WhatsApp de Likida todavía no está configurado para tu cuenta.">
            Sin él no hay un número al que tus choferes puedan escribir, y esta pantalla no va a inventar uno.
            Pídelo desde el <Link href={hrefAyuda} className="rv-wa__enlace">Centro de ayuda</Link>: es un dato que Likida activa en tu cuenta.
          </Aviso>
        </div>
      )}

      {n.estado === 'invalido' && (
        <EstadoError>{`El número de WhatsApp configurado no es válido. ${n.motivo} Avísale a soporte para que lo corrija.`}</EstadoError>
      )}

      {n.estado === 'configurado' && datos.enlace && (
        // El cartel imprimible es el ÚNICO bloque que sale al imprimir (whatsapp.css).
        <div id="cartel-whatsapp">
          <Tarjeta titulo="Escríbele a Likida por WhatsApp" info="whatsapp.cartel">
            {/* A36-R15-06: la leyenda va DENTRO del cartel; el CSS de impresión oculta todo lo de fuera, y un cartel de prueba sin marca se pegaba en los patios. */}
            {n.esPrueba && <p className="rv-wa__prueba">Número de PRUEBA — no escribir, no atiende</p>}
            <div className="rv-wa__cartel">
              {datos.qrSvg && (
                // El SVG lo arma `lib/qr.ts` en el servidor desde un texto que SALE de nuestra configuración (número + nombre de la
                // flota, ya codificados): no es HTML de un usuario.
                <div className="rv-wa__qr" dangerouslySetInnerHTML={{ __html: datos.qrSvg }} />
              )}
              <div className="rv-wa__texto">
                <p className="rv-wa__numero"><MarcaIntegracion id="whatsapp" /> {n.visible}</p>
                <p className="rv-wa__nota">
                  Escanea el código o toca el enlace desde el celular que diste de alta en {datos.nombreFlota}. Se abre el chat con el mensaje
                  ya escrito: solo hay que enviarlo.
                </p>
                <p className="rv-wa__enlace-largo">
                  <a href={datos.enlace} className="rv-wa__enlace" rel="noopener noreferrer">{datos.enlace}</a>
                </p>
              </div>
            </div>
            <div className="rv-wa__acciones"><AccionesEnlace enlace={datos.enlace} esPrueba={n.esPrueba} /></div>
          </Tarjeta>
        </div>
      )}

      {n.estado === 'configurado' && n.esPrueba && (
        <Aviso tono="warn">
          Este es un número de PRUEBA: no atiende a choferes reales. No lo repartas hasta que Likida active el número comercial verificado.
        </Aviso>
      )}

      <Tarjeta titulo="Qué pasa con cada chofer" info="whatsapp.flujo">
        <ol className="rv-wa__pasos">
          {((datos.perfil === 'cinco_agentes' ? PASOS_CHOFER_CINCO_AGENTES : PASOS_CHOFER) as ReadonlyArray<readonly [string, string]>).map(([titulo, detalle]) => (
            <li key={titulo}>
              <p className="rv-wa__paso">{titulo}</p>
              <p className="rv-wa__nota">{detalle}</p>
            </li>
          ))}
        </ol>
      </Tarjeta>

      <Tarjeta titulo="Dónde vas con tus operadores" info="whatsapp.avance">
        {datos.operadores === null ? (
          <p className="rv-wa__nota">No pude contar a tus operadores en este momento.</p>
        ) : datos.operadores.activos === 0 ? (
          <p className="rv-wa__nota">
            Todavía no has dado de alta a ningún operador. <Link href={hrefOperadores} className="rv-wa__enlace">Dalos de alta en Operadores</Link>: es el primer paso.
          </p>
        ) : (
          <p className="rv-wa__nota">
            Tienes <strong>{numero(datos.operadores.activos)}</strong> operadores activos
            {datos.operadores.pendientesDeInvitar > 0
              ? <> y <strong>{numero(datos.operadores.pendientesDeInvitar)}</strong> todavía sin invitación por WhatsApp. <Link href={hrefOperadores} className="rv-wa__enlace">Invítalos desde Operadores</Link>, o mándales el enlace de arriba.</>
              : '. Todos ya fueron invitados.'}
          </p>
        )}
      </Tarjeta>
    </MarcoPagina>
  );
}
