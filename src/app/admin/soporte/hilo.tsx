import { Lock, MessageSquare } from 'lucide-react';
import { fechaHoraMx } from '@/lib/formato';
import type { MensajeHilo } from '@/lib/likida/soporte';
import { StatusChip } from '../../ui-v2/componentes';
import '../sistema.css';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';

/**
 * El hilo de un ticket para el EQUIPO, con las piezas de ui-v2 (el de `admin/ui/hilo-soporte.tsx` sigue sirviendo a /dashboard/soporte
 * hasta su fase). La nota interna se pinta distinta y con su rótulo: este componente NO decide qué se ve (`getHilo(..., { verInternas })`
 * ya excluyó las internas de la consulta del cliente); el candado de aquí es para que quien SÍ las ve no confunda una nota consigo
 * mismo hablándole al cliente.
 */
export function HiloTicket({ mensajes, vacio, t = T_SISTEMA_ES }: { mensajes: MensajeHilo[]; vacio: React.ReactNode; t?: TSistema }) {
  if (mensajes.length === 0) return <p className="adm-sis-nota">{vacio}</p>;
  return (
    <ol className="adm-sis-hilo" aria-label={t('soporte_hilo.mensajes_del_ticket')}>
      {mensajes.map((m) => (
        <li key={m.id} className="adm-sis-msg" data-interna={m.interna ? '' : undefined}>
          <div className="adm-sis-msg__cab">
            {m.interna ? <Lock width={13} height={13} strokeWidth={1.75} aria-hidden="true" /> : <MessageSquare width={13} height={13} strokeWidth={1.75} aria-hidden="true" />}
            {/* El nombre puede faltar (la cuenta se dio de baja). Se dice «—», no se inventa un autor. */}
            <b>{m.autorNombre ?? '—'}</b>
            <span>{m.deLikida ? t('soporte_hilo.likida') : t('soporte_hilo.la_flota')}</span>
            <span>·</span>
            <span>{fechaHoraMx(m.creadoEn)}</span>
            {m.interna ? <StatusChip tono="warn">{t('soporte_hilo.nota_interna')}</StatusChip> : null}
          </div>
          <p className="adm-sis-msg__cuerpo">{m.cuerpo}</p>
        </li>
      ))}
    </ol>
  );
}
