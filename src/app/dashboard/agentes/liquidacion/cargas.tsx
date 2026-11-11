import { FileUp, Users } from 'lucide-react';
import { AvisoCompacto, Boton, CampoArchivo, CampoTexto, Icono, Tarjeta } from '@/app/ui-v2/componentes';
import './liquidacion.css';

// ═══════════════════════════════════════════════════════════════════════════
// CARGAS POR ARCHIVO DEL AGENTE DE LIQUIDACIÓN POR CORREO (Ola 1 · A1).
//
// Mientras el sistema de transporte del cliente no dé su API, la oficina puede:
//   1. subir el export de bitácoras (CSV/Excel, una fila por concepto) — entra por el MISMO camino que `POST /v1/liquidaciones-
//      externas/desgloses`: idempotente, con las mismas guardas (póliza, neto negativo, tipo de operador…) y el mismo Excel;
//   2. subir los correos de los operadores y sus coordinadores (`numero_empleado;correo;coordinador_nombre;coordinador_correo`):
//      nunca crea operadores, solo pone su correo y su coordinador.
// Server component sin JavaScript de cliente: un formulario por carga, el resultado vuelve en el aviso de la página.
// ═══════════════════════════════════════════════════════════════════════════

export interface AccionesCargas {
  desgloses: (fd: FormData) => Promise<void>;
  contactos: (fd: FormData) => Promise<void>;
}


export function SeccionCargas({ acciones, aviso, error, detalle, puedeCargar }: {
  acciones: AccionesCargas; aviso: string | null; error: string | null; detalle: string | null; puedeCargar: boolean;
}) {
  return (
    <div id="cargas">
      <Tarjeta titulo="Cargar desde un archivo">
        <p className="rv-liq-sub">
          Mientras tu sistema no mande los desgloses solo, puedes subirlos aquí. Repetir un archivo es seguro: lo ya recibido se reconoce y no se envía dos veces.
        </p>
        {aviso && <AvisoCompacto tono="info" resumen={aviso} />}
        {error && <AvisoCompacto tono="error" resumen={error} />}
        {detalle && <p className="rv-liq-sub rv-liq-pre">{detalle}</p>}
        {!puedeCargar ? (
          <p className="rv-liq-sub">Solo el dueño de la flota sube archivos.</p>
        ) : (
          <div className="rv-liq-dos">
            <form action={acciones.desgloses} className="rv-liq-forma">
              {/* sin-info: título de una forma dentro del recuadro, no de un recuadro */}
              <h3 className="rv-liq-forma__titulo"><Icono icono={FileUp} /> Desgloses (export de bitácoras)</h3>
              <p className="rv-liq-sub">
                CSV o Excel, una fila por concepto: bitácora, nº de empleado, desde, hasta, tipo (percepción/deducción), concepto y monto;
                opcionales: terminal, nº de liquidación, nº de pago, póliza, unidad, vale, neto y tipo de operador. Una bitácora sin póliza no se envía.
                Si el envío está activo, cada desglose nuevo sale a sus destinatarios, salvo los anteriores a la fecha de corte (se guardan sin enviar).
              </p>
              <CampoArchivo etiqueta="Archivo de desgloses" name="archivo" accept=".csv,.txt,.xlsx,.xls" required />
              <p className="rv-liq-sub">
                Primero pulsa «Ver vista previa»: cuenta «N desgloses / M correos» sin guardar ni enviar nada. Para subir de verdad, vuelve a elegir
                el archivo, escribe M en «Correos que saldrán» y pulsa «Subir y enviar» (con 0 correos no hace falta escribirlo).
              </p>
              <CampoTexto etiqueta="Correos que saldrán (el número de la vista previa)" name="correos" inputMode="numeric" autoComplete="off" pattern="[0-9]*" />
              <div className="rv-liq-acciones">
                <Boton type="submit" name="paso" value="previa" variante="secondary">Ver vista previa</Boton>
                <Boton type="submit" name="paso" value="subir" variante="primary">Subir y enviar</Boton>
              </div>
            </form>
            <form action={acciones.contactos} className="rv-liq-forma">
              {/* sin-info: título de una forma dentro del recuadro, no de un recuadro */}
              <h3 className="rv-liq-forma__titulo"><Icono icono={Users} /> Correos de operadores y coordinadores</h3>
              <p className="rv-liq-sub">
                CSV o Excel con las columnas <code>numero_empleado;correo;coordinador_nombre;coordinador_correo</code>. Solo pone el correo y el
                coordinador de operadores que YA existen (no crea a nadie); una celda vacía no borra lo que ya había.
              </p>
              <CampoArchivo etiqueta="Archivo de correos" name="archivo" accept=".csv,.txt,.xlsx,.xls" required />
              <Boton type="submit" variante="primary">Subir correos</Boton>
            </form>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
