import { fechaHoraMx } from '@/lib/formato';
// SOLO TIPOS de `cola.ts`: ese módulo importa `supabaseAdmin`, y esta vista
// tiene que poder renderizarse en una prueba sin base — mismo criterio que
// `unidades/forma.tsx` con `operacion.ts`.
import type { PiezaEnCola, CorreoSuprimido } from '@/lib/likida/agentes/cola';
import { Tarjeta } from '../../ui-v2/componentes/tarjeta';
import { StatusChip } from '../../ui-v2/componentes/status-chip';
import '../bandeja.css';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { trAdminInicioEs } from '@/lib/i18n/tr_admin';
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
export function RebotesYBajas({ rebotes, suprimidos, t = trAdminInicioEs }: {
  rebotes: PiezaEnCola[] | null;
  suprimidos: CorreoSuprimido[] | null; t?: TrDe<'admin_inicio'>;
}) {
  return (
    <Tarjeta titulo={rebotes !== null ? t('aprobaciones_rebotes.rebotes_quejas_y_bajas', { length: rebotes.length }) : t('aprobaciones_rebotes.rebotes_quejas_y_bajas_2')}>
      <p className="bj-nota">
        
        {t('aprobaciones_rebotes.lo_que_el_proveedor')}
      </p>

      {rebotes === null ? (
        <p className="bj-item__aviso" role="alert">
          
          {t('aprobaciones_rebotes.no_se_pudieron_leer')}
        </p>
      ) : rebotes.length === 0 ? (
        <p className="bj-nota">
          
          {t('aprobaciones_rebotes.ninguna_pieza_enviada_ha')}
        </p>
      ) : (
        <ul className="bj-lista">
          {rebotes.map((p) => (
            <li key={p.id}>
              {/* Queja de spam y rebote NO son lo mismo y no se funden: el rebote suele ser una dirección muerta; la queja es una
                  persona que marcó el correo, y esa pesa mucho más. */}
              <StatusChip tono="bad">{p.entregaEstado === 'queja' ? t('aprobaciones_rebotes.queja_de_spam') : t('aprobaciones_rebotes.reboto')}</StatusChip>
              <span className="bj-lista__texto">{p.prospectoCorreo ?? p.titulo}</span>
              {p.prospectoEmpresa && <span className="bj-lista__apoyo">{p.prospectoEmpresa}</span>}
              {p.entregaEventoEn && <span className="bj-lista__apoyo">{fechaHoraMx(p.entregaEventoEn)}</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="bj-item__titulo">{t('aprobaciones_rebotes.lista_de_bajas_a')}</p>
      {suprimidos === null ? (
        <p className="bj-item__aviso" role="alert">
          
          {t('aprobaciones_rebotes.no_se_pudo_leer')}
        </p>
      ) : suprimidos.length === 0 ? (
        <p className="bj-nota">{t('aprobaciones_rebotes.nadie_en_la_lista')}</p>
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
        
        {t('aprobaciones_rebotes.aqui_no_hay_boton')}
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
