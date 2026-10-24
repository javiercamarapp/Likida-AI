import { PlugZap } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { listarClientesPendientes, type ClienteParaRevision } from '@/lib/mcp/oauth';
import { logger } from '@/lib/logger';
import { fechaHoraMx } from '@/lib/formato';
import { BarraPagina } from '../../dashboard/resumen-visual';
import { EstadoVacio, EstadoError } from '../ui/kit';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { FormaRechazarCliente } from './forma-rechazar';
import { decidirYAnotar } from './decidir';

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
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<PlugZap width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Clientes MCP por aprobar"
        />
        <div className="px-5 py-5 flex-1 space-y-3">
          {pendientes === null ? (
            <EstadoError mensaje="No se pudo leer la cola. No significa que no haya clientes por aprobar: la consulta falló." />
          ) : pendientes.length === 0 ? (
            <EstadoVacio>
              No hay clientes MCP pendientes. Los de hosts conocidos (Claude, ChatGPT) y loopback se aprueban solos.
            </EstadoVacio>
          ) : (
            pendientes.map((c) => (
              <section key={c.clientId} className="card p-4 space-y-2">
                <p className="text-sm">
                  <strong>{c.nombre ?? 'Sin nombre'}</strong> — registrado {fechaHoraMx(c.creadoEn)}
                </p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  El nombre lo declaró quien se registró. Devolvería el código a:{' '}
                  <strong>{c.anfitriones.join(', ') || 'dirección inválida'}</strong>
                </p>
                <ul className="text-xs list-disc pl-5 break-all" style={{ color: 'var(--muted)' }}>
                  {c.redirectUris.map((u) => <li key={u}>{u}</li>)}
                </ul>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
              </section>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
