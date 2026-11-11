import Link from 'next/link';
import { Chip, Tarjeta, type TonoChip } from '@/app/ui-v2/componentes';
import { armarListo, resumirListo, ROTULO_COMPROBACION, ROTULO_RESPONSABLE, type EstadoComprobacion, type LecturasListo } from './listo';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

const TONO: Record<EstadoComprobacion, TonoChip> = { listo: 'ok', pendiente: 'neutral', sin_dato: 'warn' };

/**
 * «¿Estoy listo?» — la lista de comprobaciones del día de la conexión. Componente de servidor: recibe las lecturas ya medidas
 * (`listo_lecturas.ts`); una lectura caída aparece como «Sin dato», nunca como «Listo» ni como «Pendiente».
 */
export function SeccionListo({ lecturas, sufijo, t = T_RESTO_ES }: { lecturas: LecturasListo; sufijo: string; t?: TResto }) {
  const cs = armarListo(lecturas, t);
  const r = resumirListo(cs);
  const titulo = r.todoListo ? 'Todo listo para conectar' : `Faltan ${r.pendientes + r.sinDato} de ${r.total} comprobaciones`;
  return (
    <section className="rv-pem__listo">
      <Tarjeta titulo={t('op.estoy_listo_el_dia_de_la')} contenida>
        <p className="rv-pem__listo-titulo">{titulo}</p>
        <p className="rv-pem__listo-apoyo">{t('op.solo_se_muestran_estados_medidos_nunca')}</p>
        <ul className="rv-pem__listo-lista">
          {cs.map((x) => (
            <li key={x.id} className="rv-pem__listo-fila" data-estado={x.estado}>
              <Chip tono={TONO[x.estado]}>{ROTULO_COMPROBACION[x.estado]}</Chip>
              <span className="rv-pem__listo-texto">
                <span className="rv-pem__listo-nombre">{x.titulo}</span>
                <span className="rv-pem__listo-evidencia">{x.evidencia} · {ROTULO_RESPONSABLE[x.responsable]}</span>
              </span>
              {x.href && x.estado !== 'listo' && <Link href={`${x.href}${sufijo}`} className="rv-pem__listo-enlace">{t('op.abrir_2')}</Link>}
            </li>
          ))}
        </ul>
      </Tarjeta>
    </section>
  );
}
