'use client';

import { useActionState, useState } from 'react';
import { Boton, CampoSelect, CampoTexto, Disclosure, StatusChip, TablaBase, type ColumnaBase } from '../../ui-v2/componentes';
import { Aviso, type ResultadoAccion, type AccionDeForma } from '../ui/forma';
import { fechaHoraMx } from '@/lib/formato';
import { etiquetaInterruptor } from './etiquetas';
import '../sistema.css';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';

// ═══════════════════════════════════════════════════════════════════════════
// EL KILL SWITCH — la parte de /admin/observabilidad que Javier va a tocar desde el teléfono en pleno incidente.
//
// F26 (ronda 2): ya NO es una tarjeta con su botón rojo por cada uno de los 61 interruptores. Rovaq tiene UNA sola acción de peligro por
// zona: aquí hay UN «Apagar un interruptor» (elige cuál y escribe el motivo) y una tabla compacta de lo que está apagado, cuya única
// acción por fila es «Encender» (no es peligrosa). El inventario completo vive plegado, en filas de 40 px.
//
// EL MOTIVO ES OBLIGATORIO AL APAGAR, desde el HTML (`required`) hasta el CHECK de la 0110: apagar sin decir por qué deja una bomba sin
// nota. El botón se deshabilita mientras corre — la palanca no es idempotente en su FIRMA (quién/cuándo) y el doble clic escribiría dos
// entradas de bitácora. Los `name` de siempre se conservan (`id`, `operacion`, `motivo`).
//
// ESTE COMPONENTE NO DECIDE PERMISOS: el server action que recibe re-gatea superadmin adentro (patrón de administracion.ts).
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
  const { t } = useT('admin_sistema', admin_sistemaEs);
  // 'global' primero y apagados arriba: en un incidente, lo tocado se busca antes que lo intacto.
  const orden = [...interruptores].sort((a, b) =>
    Number(b.apagado) - Number(a.apagado) || Number(b.id === 'global') - Number(a.id === 'global'));
  const apagados = orden.filter((i) => i.apagado);
  const encendidos = orden.filter((i) => !i.apagado);

  return (
    <div className="adm-sis-bloque">
      <FormaApagar encendidos={encendidos} accion={accion} />

      {apagados.length > 0 ? (
        <TablaInterruptores filas={apagados} accion={accion} etiqueta={t('observabilidad_interruptores_ui.tabla_apagados')} />
      ) : (
        <p className="adm-sis-nota adm-sis-linea-estado">
          <StatusChip tono="ok">{t('observabilidad_interruptores_ui.todo_encendido')}</StatusChip>
          {t('observabilidad_interruptores_ui.ninguno_apagado', { n: interruptores.length })}
        </p>
      )}

      <Disclosure variante="linea" titulo={t('observabilidad_interruptores_ui.inventario', { n: interruptores.length })}>
        <TablaInterruptores filas={orden} accion={accion} etiqueta={t('observabilidad_interruptores_ui.tabla_todos')} />
      </Disclosure>
    </div>
  );
}

/** UNA acción de peligro: «Apagar un interruptor». El formulario (cuál + motivo) se abre al pedirlo, igual que el motivo de siempre. */
function FormaApagar({ encendidos, accion }: { encendidos: InterruptorParaUi[]; accion: AccionDeForma }) {
  const { t } = useT('admin_sistema', admin_sistemaEs);
  const [pidiendo, setPidiendo] = useState(false);
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);

  return (
    <div className="adm-sis-bloque">
      {pidiendo ? (
        <form action={enviar} className="adm-sis-apagar">
          <input type="hidden" name="operacion" value="apagar" />
          <CampoSelect etiqueta={t('observabilidad_interruptores_ui.cual')} etiquetaOculta name="id" required defaultValue="">
            <option value="" disabled>{t('observabilidad_interruptores_ui.elige_cual')}</option>
            {encendidos.map((i) => <option key={i.id} value={i.id}>{etiquetaInterruptor(i.id, t)}</option>)}
          </CampoSelect>
          <CampoTexto name="motivo" required autoFocus etiqueta={t('observabilidad_interruptores_ui.motivo_del_apagado')} etiquetaOculta placeholder={t('observabilidad_interruptores_ui.motivo_obligatorio')} className="adm-sis-apagar__motivo" />
          <Boton type="submit" variante="danger" tamano="sm" disabled={pendiente}>{pendiente ? t('observabilidad_interruptores_ui.guardando') : t('observabilidad_interruptores_ui.confirmar_apagado')}</Boton>
          <Boton type="button" variante="ghost" tamano="sm" onClick={() => setPidiendo(false)}>{t('observabilidad_interruptores_ui.cancelar')}</Boton>
        </form>
      ) : (
        <div className="adm-sis-acciones">
          <Boton type="button" variante="danger" tamano="sm" disabled={encendidos.length === 0} onClick={() => setPidiendo(true)}>{t('observabilidad_interruptores_ui.apagar_uno')}</Boton>
        </div>
      )}
      <Aviso estado={estado} />
    </div>
  );
}

/** Encender no es peligroso: un botón discreto por fila apagada, con su propio `useActionState` (dos palancas seguidas no comparten spinner). */
function FormaEncender({ id, accion }: { id: string; accion: AccionDeForma }) {
  const { t } = useT('admin_sistema', admin_sistemaEs);
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  return (
    <form action={enviar} className="adm-sis-encender">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="operacion" value="encender" />
      <Boton type="submit" variante="secondary" tamano="sm" disabled={pendiente}>{pendiente ? t('observabilidad_interruptores_ui.guardando') : t('observabilidad_interruptores_ui.encender')}</Boton>
      <Aviso estado={estado} />
    </form>
  );
}

function TablaInterruptores({ filas, accion, etiqueta }: { filas: InterruptorParaUi[]; accion: AccionDeForma; etiqueta: string }) {
  const { t, idioma } = useT('admin_sistema', admin_sistemaEs);
  const columnas: ColumnaBase<InterruptorParaUi>[] = [
    { id: 'interruptor', titulo: t('observabilidad_interruptores_ui.col_interruptor'), principal: true, celda: (i) => etiquetaInterruptor(i.id, t) },
    { id: 'estado', titulo: t('observabilidad_interruptores_ui.col_estado'), celda: (i) => <StatusChip tono={i.apagado ? 'bad' : 'ok'}>{i.apagado ? t('observabilidad_interruptores_ui.apagado_estado') : t('observabilidad_interruptores_ui.encendido')}</StatusChip> },
    {
      // Quién y cuándo, VISIBLES: una palanca sin firma a la vista invita a preguntar en el chat "¿quién apagó esto?" en pleno incidente.
      id: 'firma', titulo: t('observabilidad_interruptores_ui.col_firma'),
      celda: (i) => (
        <>
          {i.apagado && i.motivo ? <>{t('observabilidad_interruptores_ui.motivo', { motivo: i.motivo })} </> : null}
          {i.cambiadoEn
            ? t(i.apagado ? 'observabilidad_interruptores_ui.apagado_por' : 'observabilidad_interruptores_ui.ultimo_cambio_por', { quien: i.cambiadoPorNombre ?? t('observabilidad_interruptores_ui.cuenta_borrada'), cuando: fechaHoraMx(i.cambiadoEn, idioma) })
            : t('observabilidad_interruptores_ui.nunca_se_ha_tocado_encendido_por')}
        </>
      ),
    },
    { id: 'accion', titulo: t('observabilidad_interruptores_ui.col_accion'), tituloOculto: true, alinear: 'der', celda: (i) => (i.apagado ? <FormaEncender id={i.id} accion={accion} /> : null) },
  ];
  return <TablaBase etiqueta={etiqueta} columnas={columnas} filas={filas} idFila={(i) => i.id} densa tarjetaMovil altoMaximo={filas.length > 12} />;
}
