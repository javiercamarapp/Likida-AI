import { KeyRound } from 'lucide-react';
import { fechaMx, fechaHoraMx } from '@/lib/formato';
import { AREAS_DE_LLAVE, llaveVencida, type LlaveListada } from '@/lib/auth/llave-api-escritura';
import { EstadoVacio, StatusChip, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import { FormaRevocar, type AccionForma } from './forma';
import './llaves-api.css';

/**
 * La lista de llaves, PURA PROPS — separada de la página (que es la puerta y
 * las server actions) con el mismo corte que Facturación e Integraciones: lo
 * presentacional se puede mirar con fixtures sin sesión, y la verificación de
 * render del repo depende de eso.
 */

const ROTULO_AREA: Record<string, string> = Object.fromEntries(
  AREAS_DE_LLAVE.map((a) => [a.valor, a.rotulo]),
);

// SEG-8: una llave VENCIDA ya no sirve —`resolverLlave` la rechaza con el mismo 401 que una revocada—, así que se lee igual de
// muerta en la lista. Tachada pero VISIBLE: ocultar una llave revocada borraría de la pantalla la evidencia de qué se revocó y cuándo.
const muerta = (l: LlaveListada): boolean => l.revocadaEn !== null || llaveVencida(l.expiraEn);

export function ListaLlaves({ llaves, revocarLlave }: {
  llaves: LlaveListada[];
  revocarLlave: AccionForma;
}) {
  if (llaves.length === 0) {
    return (
      <EstadoVacio icono={KeyRound} titulo="Aún no hay llaves emitidas">
        Nada fuera de este panel puede leer los datos de la flota, ni el TMS ni un tablero. Emite la primera aquí
        abajo: se enseña completa <strong>una sola vez</strong> y de ahí en adelante solo se guarda su huella.
      </EstadoVacio>
    );
  }

  const columnas: ColumnaBase<LlaveListada>[] = [
    { id: 'pista', titulo: 'Pista', celda: (l) => <span className={muerta(l) ? 'rv-lla__muerta cifra-mono' : 'rv-lla__tenue cifra-mono'}>{l.prefijo}…</span> },
    { id: 'nombre', titulo: 'Nombre', principal: true, celda: (l) => <span className={muerta(l) ? 'rv-lla__muerta' : undefined}>{l.nombre}</span> },
    { id: 'area', titulo: 'Área', celda: (l) => <span className={muerta(l) ? 'rv-lla__muerta' : undefined}>{ROTULO_AREA[l.area] ?? l.area}</span> },
    { id: 'creada', titulo: 'Creada', celda: (l) => <span className={muerta(l) ? 'rv-lla__muerta' : 'rv-lla__tenue'}>{fechaMx(l.creadaEn)}</span> },
    {
      id: 'vence', titulo: 'Vence',
      // "no caduca" es la verdad de `expira_en` null, y una verdad incómoda a propósito: una llave eterna se ve como lo que es.
      celda: (l) => <span className={muerta(l) ? 'rv-lla__muerta' : 'rv-lla__tenue'}>{l.expiraEn === null ? 'no caduca' : fechaMx(l.expiraEn)}</span>,
    },
    {
      id: 'uso', titulo: 'Último uso',
      // La verdad, no un guion: "nunca" es la respuesta a "¿la puedo revocar sin romperle nada a nadie?".
      celda: (l) => <span className={muerta(l) ? 'rv-lla__muerta' : 'rv-lla__tenue'}>{l.ultimoUsoEn === null ? 'nunca' : fechaHoraMx(l.ultimoUsoEn)}</span>,
    },
    { id: 'estado', titulo: 'Estado', celda: (l) => <EstadoLlave l={l} revocarLlave={revocarLlave} /> },
  ];

  return <TablaBase etiqueta="Llaves de API" columnas={columnas} filas={llaves} idFila={(l) => l.id} altoMaximo={false} tarjetaMovil />;
}

function EstadoLlave({ l, revocarLlave }: { l: LlaveListada; revocarLlave: AccionForma }) {
  if (l.revocadaEn !== null) return <StatusChip tono="muted">{`revocada el ${fechaMx(l.revocadaEn)}`}</StatusChip>;
  if (llaveVencida(l.expiraEn)) {
    // Vencida pero NO revocada: se deja el botón, porque revocarla sella la fila y deja constancia de que ya nadie la va a resucitar.
    return (
      <div className="rv-lla__fila">
        <StatusChip tono="bad">{`vencida el ${fechaMx(l.expiraEn)}`}</StatusChip>
        <FormaRevocar accion={revocarLlave} id={l.id} nombre={l.nombre} />
      </div>
    );
  }
  return <FormaRevocar accion={revocarLlave} id={l.id} nombre={l.nombre} />;
}
