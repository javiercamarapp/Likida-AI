'use client';

import { useActionState } from 'react';
import { Power } from 'lucide-react';
import { StatusChip } from '../../ui-v2/componentes';
import { Aviso, type ResultadoAccion, type AccionDeForma } from '../ui/forma';
import { ControlApagar } from '../ui/control-apagar';
import { fechaHoraMx } from '@/lib/formato';
import { etiquetaInterruptor } from './etiquetas';
import '../sistema.css';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';

// ═══════════════════════════════════════════════════════════════════════════
// LOS TOGGLES DEL KILL SWITCH — la parte de /admin/observabilidad que Javier
// va a tocar desde el teléfono en pleno incidente.
//
// UNA FILA, UN FORMULARIO, UN `useActionState`: el patrón de FormaConAviso
// (ui/forma.tsx) pero por renglón — apagar Cobranza no puede compartir estado
// de "guardando…" con Facturas, porque en un incidente se tocan dos palancas
// seguidas y un spinner compartido escondería cuál ya respondió.
//
// EL MOTIVO ES OBLIGATORIO AL APAGAR, desde el HTML (`required`) hasta el
// CHECK de la 0110: apagar sin decir por qué deja una bomba sin nota. El
// botón se deshabilita mientras corre — la palanca no es idempotente en su
// FIRMA (quién/cuándo), y el doble clic escribiría dos entradas de bitácora.
//
// ESTE COMPONENTE NO DECIDE PERMISOS: el server action que recibe re-gatea
// superadmin adentro (patrón de administracion.ts) — aquí solo se pinta.
// ═══════════════════════════════════════════════════════════════════════════

export interface InterruptorParaUi {
  id: string;
  apagado: boolean;
  motivo: string | null;
  cambiadoPorNombre: string | null;
  cambiadoEn: string | null;
}

export function SeccionInterruptores({
  interruptores,
  accion,
}: {
  interruptores: InterruptorParaUi[];
  accion: AccionDeForma;
}) {
  // 'global' primero y apagados arriba: en un incidente, lo tocado se busca
  // antes que lo intacto.
  const orden = [...interruptores].sort((a, b) =>
    Number(b.apagado) - Number(a.apagado) || Number(b.id === 'global') - Number(a.id === 'global'));

  return (
    <div className="adm-sis-bloque">
      {orden.map((i) => <FilaInterruptor key={i.id} interruptor={i} accion={accion} />)}
    </div>
  );
}

function FilaInterruptor({ interruptor: i, accion }: { interruptor: InterruptorParaUi; accion: AccionDeForma }) {
  const { t, idioma } = useT('admin_sistema', admin_sistemaEs);
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);

  return (
    <div className="adm-sis-fila">
      <div className="adm-sis-fila__cab">
        <div className="adm-sis-bloque">
          <span className="adm-sis-fila__nombre">
            <Power width={13} height={13} strokeWidth={1.75} aria-hidden="true" />
            {etiquetaInterruptor(i.id, t)}
          </span>
          {/* Quién y cuándo, VISIBLES: una palanca sin firma a la vista invita a preguntar en el chat "¿quién apagó esto?" en pleno incidente. */}
          <span className="adm-sis-fila__texto">
            {i.apagado && i.motivo ? <>{t('observabilidad_interruptores_ui.motivo', { motivo: i.motivo })}</> : null}
            {i.cambiadoEn
              ? <>{t(i.apagado ? 'observabilidad_interruptores_ui.apagado_por' : 'observabilidad_interruptores_ui.ultimo_cambio_por', { quien: i.cambiadoPorNombre ?? t('observabilidad_interruptores_ui.cuenta_borrada'), cuando: fechaHoraMx(i.cambiadoEn, idioma) })}</>
              : t('observabilidad_interruptores_ui.nunca_se_ha_tocado_encendido_por')}
          </span>
        </div>

        <div className="adm-sis-acciones">
          <StatusChip tono={i.apagado ? 'bad' : 'ok'}>{i.apagado ? t('observabilidad_interruptores_ui.apagado_estado') : t('observabilidad_interruptores_ui.encendido')}</StatusChip>
          <ControlApagar id={i.id} apagado={i.apagado} pendiente={pendiente} enviar={enviar} />
        </div>
      </div>
      <Aviso estado={estado} />
    </div>
  );
}
