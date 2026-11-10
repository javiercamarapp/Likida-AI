import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Disclosure, StatusChip, type TonoEstado } from '../ui-v2/componentes';
import { MarcaIntegracion, type MarcaId } from '../ui-v2/componentes/marca-integracion';
import './sistema.css';

/** Un renglón de Salud o de Integraciones: lo que se mide, su estado en palabras, qué significa y, aparte y plegado, cómo se arregla (ahí
 *  sí pueden ir los nombres que usa quien configura). Cada renglón está MEDIDO o dice que no lo está. */
export interface RenglonSistema {
  titulo: string;
  /** Marca original del servicio (si la hay). */
  marca?: MarcaId;
  tono: TonoEstado;
  etiqueta: string;
  detalle: string;
  /** Para quien configura: variables o pasos concretos. Va plegado, nunca en el cuerpo. */
  arreglo?: string;
  /** `/ruta` interna se pinta con <Link>; una URL externa abre en otra pestaña. */
  link?: { href: string; texto: string };
}

export function TarjetaRenglon({ r }: { r: RenglonSistema }) {
  return (
    <div className="adm-sis-fila">
      <div className="adm-sis-fila__cab">
        <span className="adm-sis-fila__nombre">{r.marca ? <MarcaIntegracion id={r.marca} tam={16} /> : null}{r.titulo}</span>
        <StatusChip tono={r.tono}>{r.etiqueta}</StatusChip>
      </div>
      <p className="adm-sis-fila__texto">{r.detalle}</p>
      {r.arreglo ? (
        <Disclosure titulo="Cómo arreglarlo" variante="linea">
          <p className="adm-sis-nota">{r.arreglo}</p>
        </Disclosure>
      ) : null}
      {r.link ? (
        r.link.href.startsWith('/') ? (
          <Link href={r.link.href} className="adm-sis-fila__enlace">
            {r.link.texto} <ArrowRight width={12} height={12} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        ) : (
          <a href={r.link.href} target="_blank" rel="noopener noreferrer" className="adm-sis-fila__enlace">
            {r.link.texto} <ExternalLink width={12} height={12} strokeWidth={1.75} aria-hidden="true" />
          </a>
        )
      ) : null}
    </div>
  );
}
