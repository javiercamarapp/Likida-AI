import { NotaVacia, NotasAgrupadas } from './nota-vacia';
import './fin16c.css';

interface CajaSaber { titulo: string; items: readonly string[] }

/** «Qué se sabe / Qué no se sabe» como DOS notas compactas (icono + sello semántico + texto) en una fila que se acomoda al ancho:
 *  sustituye a las dos cajas altas del esqueleto de cifras. Lo observado va en verde con su sello; lo que no se sabe, en ámbar con el suyo.
 *  El estado siempre lo dice el texto del sello: el color nunca va solo. Un grupo sin elementos no se pinta. */
export function SaberesNotas({ seSabe, noSeSabe }: { seSabe: CajaSaber; noSeSabe: CajaSaber }) {
  return (
    <NotasAgrupadas className="fin16c-saberes">
      {seSabe.items.length > 0 ? <NotaVacia tono="ok" sello={seSabe.titulo} className="fin16c-saber">{seSabe.items.join(' · ')}</NotaVacia> : null}
      {noSeSabe.items.length > 0 ? <NotaVacia tono="warn" sello={noSeSabe.titulo} className="fin16c-saber">{noSeSabe.items.join(' · ')}</NotaVacia> : null}
    </NotasAgrupadas>
  );
}
