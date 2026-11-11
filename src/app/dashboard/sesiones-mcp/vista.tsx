import { PlugZap } from 'lucide-react';
import { fechaMx, fechaHoraMx } from '@/lib/formato';
import type { ClienteMcpConectado, SesionMcpUsuario } from '@/lib/mcp/sesiones';
import { ROL_LABEL, type RolAppUser } from '@/lib/auth/provisionar';
import { EstadoVacio, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import { FormaCortar, type AccionForma } from './forma';
import './sesiones-mcp.css';

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

const COLUMNAS: ColumnaBase<ClienteMcpConectado>[] = [
  { id: 'cliente', titulo: 'Cliente', principal: true, celda: (c) => rotuloCliente(c) },
  { id: 'conectado', titulo: 'Conectado', celda: (c) => <span className="rv-mcp__tenue">{fechaMx(c.otorgadoEn)}</span> },
  {
    id: 'uso', titulo: 'Último uso',
    // La verdad, no un guion: "nunca" es la respuesta a "¿lo puedo cortar sin romperle nada a nadie?".
    celda: (c) => <span className="rv-mcp__tenue">{c.ultimoUsoEn === null ? 'nunca' : fechaHoraMx(c.ultimoUsoEn)}</span>,
  },
  { id: 'vence', titulo: 'Vence', celda: (c) => <span className="rv-mcp__tenue">{fechaHoraMx(c.expiraEn)}</span> },
];

export function TablaClientesMcp({ clientes }: { clientes: ClienteMcpConectado[] }) {
  return <TablaBase etiqueta="Sesiones MCP conectadas" columnas={COLUMNAS} filas={clientes} idFila={(c) => c.familia} densa altoMaximo={false} tarjetaMovil />;
}

export function ListaSesionesMcp({ sesiones, cortarSesiones }: {
  sesiones: SesionMcpUsuario[];
  cortarSesiones: AccionForma;
}) {
  if (sesiones.length === 0) {
    return (
      <EstadoVacio icono={PlugZap} titulo="Nadie tiene un cliente conectado">
        Ni Claude ni ChatGPT están leyendo estos datos desde fuera del panel. Cuando alguien autorice uno,
        aparece aquí con su último uso y con el botón para cortarlo.
      </EstadoVacio>
    );
  }

  return (
    <div className="rv-mcp__lista">
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
  const rol = ROL_LABEL[s.rol as RolAppUser] ?? s.rol;

  return (
    <Tarjeta titulo={quien} info="mi_perfil.clientes_mcp">
      <div className="rv-mcp__cab">
        <div>
          <p className="rv-mcp__detalle">{s.email ?? 'sin correo en el padrón'} · {rol}</p>
          <p className="rv-mcp__nota">
            {/* El rol del TOKEN, no el de hoy: es el que decide qué lee el
                cliente MCP mientras el acceso siga vivo. */}
            El acceso lee lo que ve el rol con el que se autorizó ({rol}), nunca escribe.
          </p>
        </div>
        <FormaCortar accion={cortarSesiones} usuarioId={s.userId} quien={quien} cuantos={s.clientes.length} />
      </div>
      <TablaClientesMcp clientes={s.clientes} />
    </Tarjeta>
  );
}
