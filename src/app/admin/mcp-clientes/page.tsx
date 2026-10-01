import { revalidatePath } from 'next/cache';
import { PlugZap } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { listarClientesPendientes, decidirCliente, type ClienteParaRevision } from '@/lib/mcp/oauth';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';
import { fechaHoraMx } from '@/lib/formato';
import { BarraPagina } from '../../dashboard/resumen-visual';
import { EstadoVacio, EstadoError } from '../ui/kit';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';

export const dynamic = 'force-dynamic';

/** A NIVEL DE MÓDULO: un server action serializa lo que captura de su closure y
 *  una función no se serializa (server_actions_sin_closures.test.ts). */
async function decidir(
  decision: 'aprobado' | 'rechazado',
  fd: FormData,
): Promise<ResultadoAccion> {
  const s = await requireSuperadmin();
  const clientId = String(fd.get('cliente') ?? '');
  const r = await decidirCliente(clientId, decision, s.userId);
  if (!r.ok) return { error: r.detalle };
  revalidatePath('/admin/mcp-clientes');
  // Bitácora del superadmin: tenant ambiguo por diseño, se firma con el actor.
  await anotarBitacora(
    {
      tenantId: s.tenantId ?? null,
      actor: { id: s.userId },
      accion: decision === 'aprobado' ? 'mcp.cliente_aprobado' : 'mcp.cliente_rechazado',
      entidad: 'mcp_oauth_cliente',
      entidadId: clientId,
      detalle: { tokens_revocados: r.revocados },
    },
    { evento: 'mcp.bitacora' },
  ).catch((e: unknown) => logger.warn('mcp.cliente_bitacora', { err: e instanceof Error ? e.message : String(e) }));
  return {
    ok: decision === 'aprobado'
      ? 'Cliente aprobado: ya puede pedir consentimiento.'
      : `Cliente rechazado. Tokens vivos revocados: ${r.revocados}.`,
  };
}

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
    return decidir('aprobado', fd);
  }
  async function accionRechazar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    return decidir('rechazado', fd);
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
                  <FormaConAviso accion={accionRechazar} boton="Rechazar" columnas="md:grid-cols-1">
                    <input type="hidden" name="cliente" value={c.clientId} />
                  </FormaConAviso>
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
