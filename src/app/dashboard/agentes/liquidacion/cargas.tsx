import { FileUp, Users } from 'lucide-react';

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

const CSS_INPUT = 'hairline text-[12.5px] px-2.5 py-1.5 rounded-lg w-full';
const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';

export function SeccionCargas({ acciones, aviso, error, detalle, puedeCargar }: {
  acciones: AccionesCargas; aviso: string | null; error: string | null; detalle: string | null; puedeCargar: boolean;
}) {
  return (
    <section className="card p-4 space-y-3" id="cargas" aria-labelledby="titulo-cargas">
      <h2 id="titulo-cargas" className="font-display text-[15px] font-semibold">Cargar desde un archivo</h2>
      <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
        Mientras tu sistema no mande los desgloses solo, puedes subirlos aquí. Repetir un archivo es seguro: lo ya recibido se reconoce y no se envía dos veces.
      </p>
      {aviso && <p role="status" className="text-[12.5px] rounded-lg px-3 py-2" style={{ color: 'var(--ink)', background: 'var(--canvas)' }}>{aviso}</p>}
      {error && <p role="alert" className="text-[12.5px] rounded-lg px-3 py-2" style={{ color: 'var(--bad)', background: 'var(--badbg)' }}>{error}</p>}
      {detalle && <p className="text-[12px] whitespace-pre-line" style={{ color: 'var(--muted)' }}>{detalle}</p>}
      {!puedeCargar ? (
        <p className="text-[12px]" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota sube archivos.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          <form action={acciones.desgloses} className="space-y-2">
            <h3 className="text-[13px] font-medium inline-flex items-center gap-1.5"><FileUp width={14} height={14} strokeWidth={1.75} /> Desgloses (export de bitácoras)</h3>
            <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
              CSV o Excel, una fila por concepto: bitácora, nº de empleado, desde, hasta, tipo (percepción/deducción), concepto y monto;
              opcionales: terminal, nº de liquidación, nº de pago, póliza, unidad, vale, neto y tipo de operador. Una bitácora sin póliza no se envía.
              Si el envío está activo, cada desglose nuevo sale a sus destinatarios, salvo los anteriores a la fecha de corte (se guardan sin enviar).
            </p>
            <input type="file" name="archivo" accept=".csv,.txt,.xlsx,.xls" required className={CSS_INPUT} style={{ background: 'var(--surface)' }} />
            <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
              Primero pulsa «Ver vista previa»: cuenta «N desgloses / M correos» sin guardar ni enviar nada. Para subir de verdad, vuelve a elegir
              el archivo, escribe M en «Correos que saldrán» y pulsa «Subir y enviar» (con 0 correos no hace falta escribirlo).
            </p>
            <label className="block text-[12px]">
              <span style={{ color: 'var(--muted)' }}>Correos que saldrán (el número de la vista previa)</span>
              <input type="text" inputMode="numeric" name="correos" autoComplete="off" pattern="[0-9]*" className={CSS_INPUT} style={{ background: 'var(--surface)' }} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" name="paso" value="previa" className={`rv-btn rv-btn--secondary ${CSS_BOTON}`} style={{ background: 'var(--canvas)', color: 'var(--ink)' }}>Ver vista previa</button>
              <button type="submit" name="paso" value="subir" className={`rv-btn rv-btn--primary ${CSS_BOTON}`} style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>Subir y enviar</button>
            </div>
          </form>
          <form action={acciones.contactos} className="space-y-2">
            <h3 className="text-[13px] font-medium inline-flex items-center gap-1.5"><Users width={14} height={14} strokeWidth={1.75} /> Correos de operadores y coordinadores</h3>
            <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
              CSV o Excel con las columnas <code>numero_empleado;correo;coordinador_nombre;coordinador_correo</code>. Solo pone el correo y el
              coordinador de operadores que YA existen (no crea a nadie); una celda vacía no borra lo que ya había.
            </p>
            <input type="file" name="archivo" accept=".csv,.txt,.xlsx,.xls" required className={CSS_INPUT} style={{ background: 'var(--surface)' }} />
            <button type="submit" className={`rv-btn rv-btn--primary ${CSS_BOTON}`} style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>Subir correos</button>
          </form>
        </div>
      )}
    </section>
  );
}
