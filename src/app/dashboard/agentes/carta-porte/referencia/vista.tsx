import { ArrowLeft } from 'lucide-react';
import '../carta-porte.css';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import { numero } from '@/lib/formato';
import type { ClienteRef, Tablero } from '@/lib/likida/carta_porte_docs/referencia_cliente';
import { REFERENCIA_MAX } from '@/lib/likida/carta_porte_docs/referencia_cliente';
import { BotonEnvio, FormaAccion, type AccionDoc } from '../../../carta-porte/documentos/forma_accion';
import { Aviso, BotonEnlace, CampoTexto, EstadoError, EstadoVacio, Icono, MarcoPagina, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';

export interface VerComo { tenant?: string; rol?: string; vista?: string; /** La flota pintada, firmada (MX-002). */ flota?: string }

function Ocultos({ ver }: { ver: VerComo }) {
  return (
    <>
      {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
      {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
      {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
      {ver.flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={ver.flota} />}
    </>
  );
}

export function VistaReferencia({ tablero, clientes, exigen, folios, truncado, sufijo, ver, acciones }: {
  /** `null` = la lectura falló (se dice, no se pinta «sin pendientes»). */
  tablero: Tablero | null;
  clientes: ClienteRef[];
  exigen: ReadonlySet<string>;
  folios: Record<string, string | null>;
  truncado: boolean;
  sufijo: string;
  ver: VerComo;
  acciones: { capturar: AccionDoc; exigencia: AccionDoc };
}) {
  return (
    <MarcoPagina titulo="Referencia del cliente" apoyo="Algunos clientes necesitan su referencia para cobrar: aquí ves los viajes ya cargados que no la traen." acciones={<BotonEnlace tamano="sm" href={`/dashboard/agentes/carta-porte${sufijo}`} icono={<Icono icono={ArrowLeft} tam={14} />}>Volver al agente de Carta Porte</BotonEnlace>}>
      <Aviso tono="info">Es un aviso para quien la pide: no frena el viaje ni el timbrado, y la referencia no va dentro de la Carta Porte.</Aviso>

      {tablero === null ? (
        <EstadoError>No se pudieron leer los viajes. Intenta de nuevo; no significa que no haya pendientes.</EstadoError>
      ) : tablero.total === 0 ? (
        <EstadoVacio titulo="Sin viajes pendientes de referencia" contenido>
          {exigen.size === 0 ? 'Ningún cliente exige referencia todavía. Enciende la regla abajo para los que sí.' : 'No hay viajes cargados sin referencia de los clientes que la exigen.'}
        </EstadoVacio>
      ) : (
        <section aria-label="Pendientes" className="rv-cp__pila">
          <p className="rv-cp__nota"><strong>{numero(tablero.total)}</strong> {tablero.total === 1 ? 'viaje' : 'viajes'} sin referencia{truncado ? ' (la lectura llegó a su tope: faltan los más antiguos)' : ''}.</p>
          {tablero.clientes.map((c) => (
            <Tarjeta key={c.clienteId} titulo={`${c.clienteNombre} · ${numero(c.pendientes)} · el más antiguo lleva ${numero(c.masAntiguoHoras)} h`} info="carta_porte_referencia.pendientes_cliente">
              <ul className="rv-cp__filas">
                {c.viajes.slice(0, 50).map((v) => (
                  <li key={v.viajeId}>
                    <FormaAccion accion={acciones.capturar} className="rv-cp__fila">
                      <Ocultos ver={ver} />
                      <input type="hidden" name="viajeId" value={v.viajeId} />
                      <CampoTexto id={`ref-${v.viajeId}`} etiqueta={`Viaje ${folios[v.viajeId] ?? v.viajeId.slice(0, 8)} · ${numero(v.antiguedadHoras)} h`} ayuda="Referencia del cliente"
                        name="referencia" maxLength={REFERENCIA_MAX} placeholder="Referencia del cliente" />
                      <BotonEnvio variante="secundario" etiqueta="Guardar" pendiente="Guardando…" />
                    </FormaAccion>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          ))}
        </section>
      )}

      <Tarjeta titulo="Clientes que exigen referencia" info="carta_porte_referencia.exigen" estado={clientes.length === 0 ? 'vacio' : 'ok'} mensaje="Aún no hay clientes" detalle="Aún no hay clientes en la flota.">
        <ul className="rv-cp__filas">
          {clientes.map((c) => (
            <li key={c.id}>
              <FormaAccion accion={acciones.exigencia} className="rv-cp__fila">
                <Ocultos ver={ver} />
                <input type="hidden" name="clienteId" value={c.id} />
                <input type="hidden" name="exige" value={exigen.has(c.id) ? '0' : '1'} />
                <span className="rv-cp__nota"><strong>{c.nombre}</strong> · <StatusChip tono={exigen.has(c.id) ? 'info' : 'muted'}>{exigen.has(c.id) ? 'la exige' : 'no la exige'}</StatusChip></span>
                <BotonEnvio variante="secundario" etiqueta={exigen.has(c.id) ? 'Dejar de exigir' : 'Exigir'} pendiente="Guardando…" />
              </FormaAccion>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </MarcoPagina>
  );
}
