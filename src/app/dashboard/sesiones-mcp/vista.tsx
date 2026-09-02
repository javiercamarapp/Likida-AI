import { PlugZap } from 'lucide-react';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { fechaMx, fechaHoraMx } from '@/lib/formato';
import type { ClienteMcpConectado, SesionMcpUsuario } from '@/lib/mcp/sesiones';
import { FormaCortar, type AccionForma } from './forma';

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

const ROL_LABEL: Record<string, string> = {
  flota_admin: 'Dueño / Admin de flota',
  encargado: 'Encargado',
  contador: 'Contador',
};

/** El rótulo del cliente. El nombre lo eligió quien se registró por DCR, no
 *  Likida — la pantalla de consentimiento ya lo advierte y aquí se sostiene
 *  la misma advertencia en vez de presentarlo como un hecho verificado. */
function rotuloCliente(c: ClienteMcpConectado): string {
  return c.cliente ?? 'Cliente MCP sin nombre';
}

export function TablaClientesMcp({ clientes }: { clientes: ClienteMcpConectado[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left" style={{ color: 'var(--muted)' }}>
            <th className="px-3 py-2 font-medium">Cliente</th>
            <th className="px-3 py-2 font-medium">Conectado</th>
            <th className="px-3 py-2 font-medium">Último uso</th>
            <th className="px-3 py-2 font-medium">Vence</th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.familia} className="border-t" style={{ borderColor: 'var(--line2)' }}>
              <td className="px-3 py-2 font-medium">{rotuloCliente(c)}</td>
              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                {fechaMx(c.otorgadoEn)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                {/* La verdad, no un guion: "nunca" es la respuesta a "¿lo puedo
                    cortar sin romperle nada a nadie?". */}
                {c.ultimoUsoEn === null ? 'nunca' : fechaHoraMx(c.ultimoUsoEn)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                {fechaHoraMx(c.expiraEn)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ListaSesionesMcp({ sesiones, cortarSesiones }: {
  sesiones: SesionMcpUsuario[];
  cortarSesiones: AccionForma;
}) {
  if (sesiones.length === 0) {
    return (
      <EstadoVacio icono={<PlugZap width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
        Nadie de tu flota tiene hoy un cliente MCP conectado — ni Claude ni ChatGPT
        están leyendo estos datos desde fuera del panel. Cuando alguien autorice uno,
        aparece aquí con su último uso y con el botón para cortarlo.
      </EstadoVacio>
    );
  }

  return (
    <div className="space-y-3">
      {sesiones.map((s) => (
        <TarjetaUsuarioMcp key={s.userId} s={s} cortarSesiones={cortarSesiones} />
      ))}
    </div>
  );
}

function TarjetaUsuarioMcp({ s, cortarSesiones }: {
  s: SesionMcpUsuario;
  cortarSesiones: AccionForma;
}) {
  const quien = s.nombre ?? s.email ?? 'Usuario de la flota';

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[13px] font-medium">{quien}</p>
          <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {s.email ?? 'sin correo en el padrón'} · {ROL_LABEL[s.rol] ?? s.rol}
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
            {/* El rol del TOKEN, no el de hoy: es el que decide qué lee el
                cliente MCP mientras el acceso siga vivo. */}
            El acceso lee lo que ve el rol con el que se autorizó
            ({ROL_LABEL[s.rol] ?? s.rol}), nunca escribe.
          </p>
        </div>
        <FormaCortar accion={cortarSesiones} usuarioId={s.userId} quien={quien} cuantos={s.clientes.length} />
      </div>
      <TablaClientesMcp clientes={s.clientes} />
    </div>
  );
}
