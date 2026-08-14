import { KeyRound } from 'lucide-react';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { fechaMx, fechaHoraMx } from '@/lib/formato';
import { AREAS_DE_LLAVE, type LlaveListada } from '@/lib/auth/llave-api-escritura';
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
  // Tachada pero VISIBLE: ocultar una llave revocada borraría de la pantalla
  // la evidencia de qué se revocó y cuándo — el renglón es la auditoría.
  const tachado = revocada ? { textDecoration: 'line-through' as const, color: 'var(--faint)' } : undefined;

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
        ) : (
          <FormaRevocar accion={revocarLlave} id={l.id} nombre={l.nombre} />
        )}
      </td>
    </tr>
  );
}
