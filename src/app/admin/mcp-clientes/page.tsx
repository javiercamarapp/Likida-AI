import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { listarClientesPendientes, type ClienteParaRevision } from '@/lib/mcp/oauth';
import { logger } from '@/lib/logger';
import { fechaHoraMx } from '@/lib/formato';
import { Aviso, EstadoError, EstadoVacio, Tarjeta } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { FormaRechazarCliente } from './forma-rechazar';
import { decidirYAnotar } from './decidir';
import { uniformes } from '@/app/admin/cifras-uniformes';
import '../sistema.css';
import { getT } from '@/lib/i18n/servidor';
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
  const { t } = await getT('admin_sistema');
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

  const totalTokens = pendientes === null ? null : pendientes.reduce((n, c) => n + (c.tokensVivos ?? 0), 0);
  return (
    <EsqueletoTablaMaestra
      titulo={t('mcp_clientes.titulo')}
      apoyo={t('mcp_clientes.apoyo')}
      etiquetaCifras={t('mcp_clientes.cola')}
      cifras={uniformes([
        pendientes === null
          ? { etiqueta: t('mcp_clientes.por_aprobar'), valor: null, estado: 'error' as const, mensaje: t('mcp_clientes.no_se_pudo_leer_corto') }
          : { etiqueta: t('mcp_clientes.por_aprobar'), valor: pendientes.length, formato: 'entero' as const, tono: pendientes.length > 0 ? 'warn' as const : undefined },
        totalTokens === null
          ? { etiqueta: t('mcp_clientes.accesos_vivos'), valor: null, estado: 'error' as const, mensaje: t('mcp_clientes.no_se_pudo_leer_corto') }
          : { etiqueta: t('mcp_clientes.accesos_vivos'), valor: totalTokens, formato: 'entero' as const, nota: t('mcp_clientes.accesos_nota') },
      ])}
      avisos={(
        <Aviso tono="info">
          {t('mcp_clientes.aviso')}
        </Aviso>
      )}
    >
      {pendientes === null ? (
        <EstadoError reintentar>{t('mcp_clientes.error_lectura')}</EstadoError>
      ) : pendientes.length === 0 ? (
        <Tarjeta titulo={t('mcp_clientes.cola_aprobacion')}>
          <EstadoVacio titulo={t('mcp_clientes.vacio_titulo')}>
            {t('mcp_clientes.vacio_texto')}
          </EstadoVacio>
        </Tarjeta>
      ) : (
        <div className="rv-mcp-lista">
          {pendientes.map((c) => (
            <Tarjeta key={c.clientId} titulo={c.nombre ?? t('mcp_clientes.sin_nombre')}>
              <div className="rv-mcp-cuerpo">
                <p className="rv-mcp-nota">
                  {t('mcp_clientes.registrado', { fecha: fechaHoraMx(c.creadoEn) })}{' '}
                  <strong>{c.anfitriones.join(', ') || t('mcp_clientes.direccion_invalida')}</strong>
                </p>
                <ul className="rv-mcp-uris">
                  {c.redirectUris.map((u) => <li key={u}>{u}</li>)}
                </ul>
                <div className="rv-mcp-acciones">
                  <FormaConAviso accion={accionAprobar} boton={t('mcp_clientes.aprobar')} columnas="md:grid-cols-1">
                    <input type="hidden" name="cliente" value={c.clientId} />
                  </FormaConAviso>
                  <FormaRechazarCliente
                    accion={accionRechazar}
                    clientId={c.clientId}
                    nombre={c.nombre ?? t('mcp_clientes.sin_nombre')}
                    tokensVivos={c.tokensVivos}
                  />
                </div>
              </div>
            </Tarjeta>
          ))}
        </div>
      )}
    </EsqueletoTablaMaestra>
  );
}

export const metadata: Metadata = { title: 'Clientes MCP' };
