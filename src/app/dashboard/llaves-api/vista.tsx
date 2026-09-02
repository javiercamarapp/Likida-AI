import { KeyRound } from 'lucide-react';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { fechaMx, fechaHoraMx } from '@/lib/formato';
import { AREAS_DE_LLAVE, llaveVencida, type LlaveListada } from '@/lib/auth/llave-api-escritura';
import { FormaRevocar, type AccionForma } from './forma';

/**
 * La lista de llaves, PURA PROPS — separada de la página (que es la puerta y
 * las server actions) con el mismo corte que Facturación e Integraciones: lo
 * presentacional se puede mirar con fixtures sin sesión, y la verificación de
 * render del repo depende de eso.
 */

const ROTULO_AREA: Record<string, string> = Object.fromEntries(
  AREAS_DE_LLAVE.map((a) => [a.valor, a.rotulo]),
);

export function ListaLlaves({ llaves, revocarLlave }: {
  llaves: LlaveListada[];
  revocarLlave: AccionForma;
}) {
  if (llaves.length === 0) {
    return (
      <EstadoVacio icono={<KeyRound width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
        Todavía no hay una sola llave emitida, así que nada fuera de este panel puede
        leer los datos de la flota — ni el TMS ni un tablero. Emite la primera aquí
        abajo: se enseña completa <strong>una sola vez</strong> y de ahí en adelante
        solo se guarda su huella.
      </EstadoVacio>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left" style={{ color: 'var(--muted)' }}>
            <th className="px-3 py-2 font-medium">Pista</th>
            <th className="px-3 py-2 font-medium">Nombre</th>
            <th className="px-3 py-2 font-medium">Área</th>
            <th className="px-3 py-2 font-medium">Creada</th>
            <th className="px-3 py-2 font-medium">Vence</th>
            <th className="px-3 py-2 font-medium">Último uso</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {llaves.map((l) => (
            <RenglonLlave key={l.id} l={l} revocarLlave={revocarLlave} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RenglonLlave({ l, revocarLlave }: {
  l: LlaveListada;
  revocarLlave: AccionForma;
}) {
  const revocada = l.revocadaEn !== null;
  // SEG-8: una llave VENCIDA ya no sirve —`resolverLlave` la rechaza con el
  // mismo 401 que una revocada—, así que se lee igual de muerta en la lista.
  const vencida = llaveVencida(l.expiraEn);
  const muerta = revocada || vencida;
  // Tachada pero VISIBLE: ocultar una llave revocada borraría de la pantalla
  // la evidencia de qué se revocó y cuándo — el renglón es la auditoría.
  const tachado = muerta ? { textDecoration: 'line-through' as const, color: 'var(--faint)' } : undefined;

  return (
    <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
      <td className="px-3 py-2 cifra-mono whitespace-nowrap" style={tachado ?? { color: 'var(--muted)' }}>
        {l.prefijo}…
      </td>
      <td className="px-3 py-2 font-medium" style={tachado}>{l.nombre}</td>
      <td className="px-3 py-2" style={tachado}>{ROTULO_AREA[l.area] ?? l.area}</td>
      <td className="px-3 py-2 whitespace-nowrap" style={tachado ?? { color: 'var(--muted)' }}>
        {fechaMx(l.creadaEn)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap" style={tachado ?? { color: 'var(--muted)' }}>
        {/* "no caduca" es la verdad de `expira_en` null, y una verdad
            incómoda a propósito: una llave eterna se ve como lo que es. */}
        {l.expiraEn === null ? 'no caduca' : fechaMx(l.expiraEn)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap" style={tachado ?? { color: 'var(--muted)' }}>
        {/* La verdad, no un guion: "nunca" es la respuesta a "¿la puedo
            revocar sin romperle nada a nadie?". */}
        {l.ultimoUsoEn === null ? 'nunca' : fechaHoraMx(l.ultimoUsoEn)}
      </td>
      <td className="px-3 py-2">
        {revocada ? (
          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
            style={{ color: 'var(--muted)', background: 'var(--canvas)' }}>
            revocada el {fechaMx(l.revocadaEn)}
          </span>
        ) : vencida ? (
          // Vencida pero NO revocada: se deja el botón, porque revocarla sella
          // la fila y deja constancia de que ya nadie la va a resucitar.
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
              style={{ color: 'var(--bad)', background: 'var(--badbg)' }}>
              vencida el {fechaMx(l.expiraEn)}
            </span>
            <FormaRevocar accion={revocarLlave} id={l.id} nombre={l.nombre} />
          </div>
        ) : (
          <FormaRevocar accion={revocarLlave} id={l.id} nombre={l.nombre} />
        )}
      </td>
    </tr>
  );
}
