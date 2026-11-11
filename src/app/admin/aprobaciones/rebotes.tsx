import { fechaHoraMx } from '@/lib/formato';
// SOLO TIPOS de `cola.ts`: ese módulo importa `supabaseAdmin`, y esta vista
// tiene que poder renderizarse en una prueba sin base — mismo criterio que
// `unidades/forma.tsx` con `operacion.ts`.
import type { PiezaEnCola, CorreoSuprimido } from '@/lib/likida/agentes/cola';
import { Tarjeta } from '../../ui-v2/componentes/tarjeta';
import { StatusChip } from '../../ui-v2/componentes/status-chip';
import '../bandeja.css';

/**
 * REBOTES Y BAJAS — lo que Resend ya sabía y nadie enseñaba.
 *
 * Dos listas juntas porque cuentan la misma historia en dos tiempos: la pieza
 * que rebotó (el hecho) y la dirección que por eso quedó suprimida (la
 * consecuencia). Cada una cae por su lado; `null` se pinta como «no se pudo
 * leer», jamás como «no hay».
 *
 * Exportada para poder probar el render sin Next (patrón
 * `seccion-credenciales.test.tsx`).
 */
export function RebotesYBajas({ rebotes, suprimidos }: {
  rebotes: PiezaEnCola[] | null;
  suprimidos: CorreoSuprimido[] | null;
}) {
  return (
    <Tarjeta titulo={rebotes !== null ? `Rebotes, quejas y bajas (${rebotes.length})` : 'Rebotes, quejas y bajas'}>
      <p className="bj-nota">
        Lo que el proveedor reportó DESPUÉS de aceptar el envío. Un rebote no es un correo
        perdido: es reputación del dominio, y es lo que decide si llegan los siguientes.
      </p>

      {rebotes === null ? (
        <p className="bj-item__aviso" role="alert">
          No se pudieron leer los rebotes ahora mismo — eso NO significa que no haya.
        </p>
      ) : rebotes.length === 0 ? (
        <p className="bj-nota">
          Ninguna pieza enviada ha rebotado ni recibido queja. Con envíos recientes, así debe
          verse; sin envíos, esto no dice nada todavía.
        </p>
      ) : (
        <ul className="bj-lista">
          {rebotes.map((p) => (
            <li key={p.id}>
              {/* Queja de spam y rebote NO son lo mismo y no se funden: el rebote suele ser una dirección muerta; la queja es una
                  persona que marcó el correo, y esa pesa mucho más. */}
              <StatusChip tono="bad">{p.entregaEstado === 'queja' ? 'Queja de spam' : 'Rebotó'}</StatusChip>
              <span className="bj-lista__texto">{p.prospectoCorreo ?? p.titulo}</span>
              {p.prospectoEmpresa && <span className="bj-lista__apoyo">{p.prospectoEmpresa}</span>}
              {p.entregaEventoEn && <span className="bj-lista__apoyo">{fechaHoraMx(p.entregaEventoEn)}</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="bj-item__titulo">Lista de bajas — a estas direcciones ya no se escribe</p>
      {suprimidos === null ? (
        <p className="bj-item__aviso" role="alert">
          No se pudo leer la lista de bajas. El enviador la consulta aparte y falla cerrado, así
          que un fallo aquí NO significa que alguien vaya a recibir correo de más.
        </p>
      ) : suprimidos.length === 0 ? (
        <p className="bj-nota">Nadie en la lista de bajas todavía.</p>
      ) : (
        <ul className="bj-lista">
          {suprimidos.map((s) => (
            <li key={s.correo}>
              <span className="bj-lista__texto">{s.correo}</span>
              <span className="bj-lista__apoyo">{s.motivo}</span>
              <span className="bj-lista__apoyo">{fechaHoraMx(s.creadoEn)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="bj-nota">
        Aquí no hay botón para reactivar a nadie: suprimir es para siempre y quitar una fila es
        una decisión manual sobre la base.
      </p>
    </Tarjeta>
  );
}

/**
 * /admin/aprobaciones — la cola de aprobación genérica (0117 + 0120). DOS
 * bandejas con CONSULTA PROPIA cada una (auditoría externa: la urgente tiene
 * SLA en minutos y no puede depender de la salud de la normal), la cola de
 * salida (aprobadas → envío REAL por Resend, con claim anti-doble-click), y
 * las tres acciones por pieza — ni una más.
 */
