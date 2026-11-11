import Link from 'next/link';
import { Chip, Tarjeta, type TonoChip } from '@/app/ui-v2/componentes';
import { armarListo, resumirListo, ROTULO_COMPROBACION, ROTULO_RESPONSABLE, type EstadoComprobacion, type LecturasListo } from './listo';

const TONO: Record<EstadoComprobacion, TonoChip> = { listo: 'ok', pendiente: 'neutral', sin_dato: 'warn' };

/**
 * «¿Estoy listo?» — la lista de comprobaciones del día de la conexión. Componente de servidor: recibe las lecturas ya medidas
 * (`listo_lecturas.ts`); una lectura caída aparece como «Sin dato», nunca como «Listo» ni como «Pendiente».
 */
export function SeccionListo({ lecturas, sufijo }: { lecturas: LecturasListo; sufijo: string }) {
  const cs = armarListo(lecturas);
  const r = resumirListo(cs);
  const titulo = r.todoListo ? 'Todo listo para conectar' : `Faltan ${r.pendientes + r.sinDato} de ${r.total} comprobaciones`;
  return (
    <section className="rv-pem__listo">
      <Tarjeta titulo="¿Estoy listo? El día de la conexión" contenida>
        <p className="rv-pem__listo-titulo">{titulo}</p>
        <p className="rv-pem__listo-apoyo">
          Solo se muestran estados medidos, nunca valores de tu cuenta. «Sin dato» significa que no se pudo comprobar ahora; no es lo mismo que «pendiente».
        </p>
        <ul className="rv-pem__listo-lista">
          {cs.map((x) => (
            <li key={x.id} className="rv-pem__listo-fila" data-estado={x.estado}>
              <Chip tono={TONO[x.estado]}>{ROTULO_COMPROBACION[x.estado]}</Chip>
              <span className="rv-pem__listo-texto">
                <span className="rv-pem__listo-nombre">{x.titulo}</span>
                <span className="rv-pem__listo-evidencia">{x.evidencia} · {ROTULO_RESPONSABLE[x.responsable]}</span>
              </span>
              {x.href && x.estado !== 'listo' && <Link href={`${x.href}${sufijo}`} className="rv-pem__listo-enlace">Abrir</Link>}
            </li>
          ))}
        </ul>
      </Tarjeta>
    </section>
  );
}
