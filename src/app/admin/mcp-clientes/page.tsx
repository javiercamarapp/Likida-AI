import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { listarClientesPendientes, type ClienteParaRevision } from '@/lib/mcp/oauth';
import { logger } from '@/lib/logger';
import { fechaHoraMx } from '@/lib/formato';
import { EstadoError, EstadoVacio, MarcoPagina, Tarjeta } from '@/app/ui-v2/componentes';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { FormaRechazarCliente } from './forma-rechazar';
import { decidirYAnotar } from './decidir';
import './mcp-clientes.css';

export const dynamic = 'force-dynamic';

/**
 * CLIENTES OAUTH DEL MCP PENDIENTES DE APROBACIÓN (0440).
 *
 * El registro dinámico (RFC 7591) es abierto, y un cliente cuya redirect_uri no
 * está en un host conocido (claude.ai, chatgpt.com…) o loopback NO puede recibir
 * consentimiento ni canjear códigos hasta que el superadmin lo apruebe aquí.
 * Aprobar un host desconocido es dar a ese dominio la posibilidad de recibir
 * accesos de lectura de CUALQUIER flota cuyo usuario consienta: la pantalla dice
 * a dónde irá el código y se aprueba solo lo que se reconoce.
 *
 * El chequeo de superadmin se repite en cada server action (un action es un
 * endpoint POST: que la página lo haya comprobado no dice nada de quién manda
 * el POST).
 */
export default async function McpClientesPage() {
  await requireSuperadmin();

  async function accionAprobar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    return decidirYAnotar('aprobado', fd);
  }
  async function accionRechazar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    return decidirYAnotar('rechazado', fd);
  }

  let pendientes: ClienteParaRevision[] | null = null;
  try {
    pendientes = await listarClientesPendientes();
  } catch (e) {
    logger.error('admin.mcp_clientes.lectura', { err: e instanceof Error ? e.message : String(e) });
  }

  return (
    <MarcoPagina titulo="Clientes MCP por aprobar" apoyo="Clientes que se registraron por su cuenta y esperan tu decisión antes de recibir acceso.">
      <div className="rv-mcp-lista">
        {pendientes === null ? (
          <EstadoError>No se pudo leer la cola. No significa que no haya clientes por aprobar: la consulta falló.</EstadoError>
        ) : pendientes.length === 0 ? (
          <EstadoVacio titulo="Sin clientes MCP pendientes">
            Los de hosts conocidos (Claude, ChatGPT) y loopback se aprueban solos.
          </EstadoVacio>
        ) : (
          pendientes.map((c) => (
            <Tarjeta key={c.clientId} titulo={c.nombre ?? 'Sin nombre'}>
              <div className="rv-mcp-cuerpo">
                <p className="rv-mcp-nota">
                  Registrado {fechaHoraMx(c.creadoEn)}. El nombre lo declaró quien se registró. Devolvería el código a:{' '}
                  <strong>{c.anfitriones.join(', ') || 'dirección inválida'}</strong>
                </p>
                <ul className="rv-mcp-uris">
                  {c.redirectUris.map((u) => <li key={u}>{u}</li>)}
                </ul>
                <div className="rv-mcp-acciones">
                  <FormaConAviso accion={accionAprobar} boton="Aprobar" columnas="md:grid-cols-1">
                    <input type="hidden" name="cliente" value={c.clientId} />
                  </FormaConAviso>
                  <FormaRechazarCliente
                    accion={accionRechazar}
                    clientId={c.clientId}
                    nombre={c.nombre ?? 'Sin nombre'}
                    tokensVivos={c.tokensVivos}
                  />
                </div>
              </div>
            </Tarjeta>
          ))
        )}
      </div>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Clientes MCP' };
