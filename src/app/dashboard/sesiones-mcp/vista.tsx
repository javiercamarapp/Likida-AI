import { fechaMx, fechaHoraMx } from '@/lib/formato';
import type { ClienteMcpConectado, SesionMcpUsuario } from '@/lib/mcp/sesiones';
import { ROL_LABEL, type RolAppUser } from '@/lib/auth/provisionar';
import { TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import { FormaCortar, type AccionForma } from './forma';
import './sesiones-mcp.css';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

/**
 * La lista de sesiones MCP, PURA PROPS — mismo corte que `ListaLlaves` en
 * llaves-api: la página es la puerta y las server actions, esto se puede mirar
 * con fixtures sin sesión, y la verificación de render del repo depende de eso.
 *
 * Se comparte entre las DOS pantallas del hallazgo H3 (auditoría de
 * dashboards, 29-ago-2026):
 *   · /dashboard/mi-perfil  → `TablaClientesMcp`, mis propias conexiones;
 *   · /dashboard/sesiones-mcp → `ListaSesionesMcp`, las de toda la flota.
 * Una copia por pantalla se desincroniza y termina siendo dos productos.
 */

/** El rótulo del cliente. El nombre lo eligió quien se registró por DCR, no
 *  Likida — la pantalla de consentimiento ya lo advierte y aquí se sostiene
 *  la misma advertencia en vez de presentarlo como un hecho verificado. */
function rotuloCliente(c: ClienteMcpConectado): string {
  return c.cliente ?? 'Cliente MCP sin nombre';
}

const columnas = (t: TResto = T_RESTO_ES): ColumnaBase<ClienteMcpConectado>[] => ([
  { id: 'cliente', titulo: t('cfg.cliente'), principal: true, celda: (c) => rotuloCliente(c) },
  { id: 'conectado', titulo: t('cfg.conectado'), celda: (c) => <span className="rv-mcp__tenue">{fechaMx(c.otorgadoEn)}</span> },
  {
    id: 'uso', titulo: t('llaves.ultimo_uso'),
    // La verdad, no un guion: "nunca" es la respuesta a "¿lo puedo cortar sin romperle nada a nadie?".
    celda: (c) => <span className="rv-mcp__tenue">{c.ultimoUsoEn === null ? 'nunca' : fechaHoraMx(c.ultimoUsoEn)}</span>,
  },
  { id: 'vence', titulo: t('llaves.vence'), celda: (c) => <span className="rv-mcp__tenue">{fechaHoraMx(c.expiraEn)}</span> },
]);

export function TablaClientesMcp({ clientes, t = T_RESTO_ES }: { clientes: ClienteMcpConectado[]; t?: TResto }) {
  return <TablaBase etiqueta={t('cfg.sesiones_mcp_conectadas')} columnas={columnas(t)} filas={clientes} idFila={(c) => c.familia} densa altoMaximo={false} tarjetaMovil />;
}

export function ListaSesionesMcp({ sesiones, cortarSesiones, t = T_RESTO_ES }: {
  sesiones: SesionMcpUsuario[];
  cortarSesiones: AccionForma; t?: TResto;
}) {
  const cols: ColumnaBase<SesionMcpUsuario>[] = [
    {
      id: 'persona', titulo: t('e26.mcp_persona'), principal: true,
      celda: (s) => (
        <span className="rv-mcp__persona">
          <strong>{s.nombre ?? s.email ?? t('cfg.usuario_de_la_flota')}</strong>
          <span className="rv-mcp__tenue">{s.email ?? t('cfg.sin_correo_en_el_padron')}</span>
        </span>
      ),
    },
    { id: 'rol', titulo: t('e26.mcp_rol'), celda: (s) => ROL_LABEL[s.rol as RolAppUser] ?? s.rol },
    {
      id: 'clientes', titulo: t('e26.mcp_clientes'),
      celda: (s) => (
        <span className="rv-mcp__clientes">
          {s.clientes.map((c) => (
            <span key={c.familia} className="rv-mcp__cliente">{rotuloCliente(c)} <span className="rv-mcp__tenue">· {t('llaves.vence')} {fechaMx(c.expiraEn)}</span></span>
          ))}
        </span>
      ),
    },
    {
      id: 'uso', titulo: t('e26.mcp_ultimo_uso'),
      // La verdad, no un guion: «nunca» es la respuesta a «¿lo puedo cortar sin romperle nada a nadie?».
      celda: (s) => <span className="rv-mcp__tenue">{s.ultimoUsoEn === null ? t('e26.mcp_nunca') : fechaHoraMx(s.ultimoUsoEn)}</span>,
    },
    {
      id: 'accion', titulo: t('e26.mcp_acceso'), alinear: 'der',
      celda: (s) => <FormaCortar accion={cortarSesiones} usuarioId={s.userId} quien={s.nombre ?? s.email ?? t('cfg.usuario_de_la_flota')} cuantos={s.clientes.length} />,
    },
  ];
  // El vacío vive DENTRO de su tarjeta (Rovaq: nunca suelto sobre el lienzo).
  if (sesiones.length === 0) {
    return <Tarjeta titulo={t('cfg.sesiones_mcp_conectadas')} estado="vacio" mensaje={t('cfg.nadie_tiene_un_cliente_conectado')} detalle={t('cfg.ni_claude_ni_chatgpt_estan_leyendo')} contenida />;
  }
  return (
    <TablaBase
      etiqueta={t('cfg.sesiones_mcp_conectadas')} columnas={cols} filas={sesiones} idFila={(s) => s.userId} tarjetaMovil altoMaximo={false}
    />
  );
}
