'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Building2, Shuffle, UserPlus } from 'lucide-react';
import { Aviso, Boton, CampoSelect, CampoTexto, Icono } from '../../ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';

// ═══════════════════════════════════════════════════════════════════════════
// Las tres formas de /admin/vendedores: `useActionState` + `useFormStatus`; el error de captura sale VERBATIM (los `DatoInvalido` se
// escribieron para leerse aquí) y los catálogos llegan como PROPS para no importar nada que arrastre `supabaseAdmin` al bundle.
// Fase 6: campos, botón y aviso son las piezas de ui-v2 (sin glifos ni estilos en línea).
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

function Enviar({ icono, texto, textoPendiente, variante = 'primary' }: { icono: React.ReactNode; texto: string; textoPendiente: string; variante?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante={variante} loading={pending} icono={pending ? undefined : icono}>
      {pending ? textoPendiente : texto}
    </Boton>
  );
}

function Resultado({ estado }: { estado: ResultadoForma }) {
  if (!estado) return null;
  return estado.ok ? <Aviso tono="ok">{estado.mensaje}</Aviso> : <Aviso tono="error">{estado.error}</Aviso>;
}

/** Alta manual de un prospecto. Solo la empresa es obligatoria: el censo trae filas con puro nombre y vacante, y el resto se completa vendiendo. */
export function FormaProspecto({ accion, vendedores }: {
  accion: AccionForma;
  vendedores: Array<{ id: string; nombre: string }>;
}) {
  const { t } = useT('admin_sistema', admin_sistemaEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="ven-forma">
      <div className="ven-forma__rejilla">
        <CampoTexto etiqueta={t('vendedores_formas.empresa')} name="empresa" required maxLength={160} placeholder={t('vendedores_formas.transportes_del_norte_sa')} />
        <CampoTexto etiqueta={t('vendedores_formas.vacante_la_senal')} name="vacante" maxLength={160} placeholder={t('vendedores_formas.analista_de_liquidaciones')}
          ayuda={t('vendedores_formas.el_puesto_que_la_empresa_publico')} />
        <CampoTexto etiqueta={t('vendedores_formas.contacto_opcional')} name="contacto" maxLength={120} />
        <CampoTexto etiqueta={t('vendedores_formas.telefono_opcional')} name="telefono" tipo="tel" maxLength={40} inputMode="tel" />
        <CampoTexto etiqueta={t('vendedores_formas.correo_opcional')} name="correo" tipo="email" maxLength={160} />
        <CampoTexto etiqueta={t('vendedores_formas.ciudad_opcional')} name="ciudad" maxLength={120} />
        <CampoSelect etiqueta={t('vendedores_formas.vendedor_opcional')} name="vendedor" defaultValue="">
          <option value="">{t('vendedores_formas.sin_asignar_lo_toma_el_asignador')}</option>
          {vendedores.map((v) => (
            <option key={v.id} value={v.id}>{v.nombre}</option>
          ))}
        </CampoSelect>
        <CampoTexto etiqueta={t('vendedores_formas.notas_opcional')} name="notas" maxLength={2000} />
      </div>
      <Resultado estado={estado} />
      <div className="ven-forma__pie">
        <Enviar icono={<Icono icono={Building2} />} texto={t('vendedores_consola_vendedores.agregar_prospecto')} textoPendiente={t('vendedores_formas.agregando')} />
      </div>
    </form>
  );
}

/** Alta de un vendedor (cuenta de LIKIDA, tenant null). Sin teléfono a propósito: el vendedor no habla con el bot de ninguna flota. */
export function FormaInvitarVendedor({ accion }: { accion: AccionForma }) {
  const { t } = useT('admin_sistema', admin_sistemaEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="ven-forma">
      <div className="ven-forma__rejilla">
        <CampoTexto etiqueta={t('mapa_prospectos_detalle.correo')} name="email" tipo="email" required maxLength={160} placeholder="amigo@correo.com"
          ayuda={t('vendedores_formas.entra_a_vendedor_tecleando_este_correo')} />
        <CampoTexto etiqueta={t('vendedores_formas.nombre_opcional')} name="nombre" maxLength={120} placeholder={t('vendedores_formas.como_quieres_verlo_en_el_tablero')} />
      </div>
      <Resultado estado={estado} />
      <div className="ven-forma__pie">
        <Enviar icono={<Icono icono={UserPlus} />} texto={t('vendedores_consola_vendedores.invitar_vendedor')} textoPendiente={t('vendedores_formas.invitando')} variante="secondary" />
      </div>
    </form>
  );
}

/** El botón del agente asignador. El resultado dice cuántos repartió y a quiénes, o por qué no repartió nada, que también es un resultado. */
export function BotonRepartir({ accion }: { accion: AccionForma }) {
  const { t } = useT('admin_sistema', admin_sistemaEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="ven-forma">
      <div className="ven-forma__pie">
        <Enviar icono={<Icono icono={Shuffle} />} texto={t('vendedores_formas.repartir_pendientes')} textoPendiente={t('vendedores_formas.repartiendo')} variante="secondary" />
      </div>
      <Resultado estado={estado} />
    </form>
  );
}
