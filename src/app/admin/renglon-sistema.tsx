import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Disclosure, StatusChip, TablaBase, type ColumnaBase, type TonoEstado } from '../ui-v2/componentes';
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

function EnlaceRenglon({ link }: { link: NonNullable<RenglonSistema['link']> }) {
  return link.href.startsWith('/') ? (
    <Link href={link.href} className="adm-sis-fila__enlace">
      {link.texto} <ArrowRight width={12} height={12} strokeWidth={1.75} aria-hidden="true" />
    </Link>
  ) : (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className="adm-sis-fila__enlace">
      {link.texto} <ExternalLink width={12} height={12} strokeWidth={1.75} aria-hidden="true" />
    </a>
  );
}

/** El semáforo por servicio como TABLA de 40 px (cabecera negra, un servicio por fila) en vez de una rejilla de tarjetas de 150-350 px.
 *  Lo que cuesta arreglar (nombres de variables) queda plegado y aparte, nunca en el cuerpo. `columnas` trae los rótulos del diccionario. */
export function TablaRenglones({ renglones, etiqueta, columnas, rotuloArreglo, rotuloEnlace }: {
  renglones: readonly RenglonSistema[];
  etiqueta: string;
  columnas: { servicio: string; estado: string; significa: string; enlace: string };
  rotuloArreglo: (n: number) => string;
  rotuloEnlace?: string;
}) {
  const cols: ColumnaBase<RenglonSistema>[] = [
    { id: 'servicio', titulo: columnas.servicio, principal: true, celda: (r) => <span className="adm-sis-fila__nombre">{r.marca ? <MarcaIntegracion id={r.marca} tam={16} /> : null}{r.titulo}</span> },
    { id: 'estado', titulo: columnas.estado, celda: (r) => <StatusChip tono={r.tono}>{r.etiqueta}</StatusChip> },
    { id: 'significa', titulo: columnas.significa, celda: (r) => <span className="adm-sis-celda-texto" title={r.detalle}>{r.detalle}</span> },
    { id: 'enlace', titulo: rotuloEnlace ?? columnas.enlace, alinear: 'der', celda: (r) => (r.link ? <EnlaceRenglon link={r.link} /> : null) },
  ];
  const conArreglo = renglones.filter((r) => r.arreglo);
  return (
    <div className="adm-sis-bloque">
      <TablaBase etiqueta={etiqueta} columnas={cols} filas={renglones} idFila={(r) => r.titulo} tarjetaMovil altoMaximo={false} />
      {conArreglo.length > 0 ? (
        <Disclosure variante="linea" titulo={rotuloArreglo(conArreglo.length)}>
          <ul className="adm-sis-lista">
            {conArreglo.map((r) => <li key={r.titulo}><span>{r.titulo}</span><span>{r.arreglo}</span></li>)}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}
