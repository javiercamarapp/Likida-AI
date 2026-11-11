'use client';

import { useState, useEffect, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Send, X, RotateCcw, FileText, Trash2, Check } from 'lucide-react';
import './proveedores.css';
import { Boton as BotonV2, Casilla, CampoSelect, CampoTexto, CampoTextarea, Icono } from '@/app/ui-v2/componentes';
import type { AccionProveedores } from './controles';
import type { ConfigEntrega } from '@/lib/likida/buzon/entrega_pura';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

// Los controles de la ENTREGA AL CONTADOR y de la bandeja de recepción (Agente 9). Cada botón es un <form> con su
// server action: el gateo (sesión, rol, tenant) vive en la action, no aquí. Cada uno enseña su error y su aviso.

function Boton({ texto, pendiente, icono, suave }: {
  texto: string; pendiente: string; icono?: React.ReactNode; suave?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <BotonV2 type="submit" tamano="sm" variante={suave ? 'secondary' : 'primary'} loading={pending} icono={icono}>
      {pending ? pendiente : texto}
    </BotonV2>
  );
}

function Mensaje({ estado }: { estado: { error?: string; aviso?: string } | null }) {
  if (!estado) return null;
  if (estado.error) return <p role="alert" className="rv-prov__msg" data-tono="bad">{estado.error}</p>;
  if (estado.aviso) return <p role="status" className="rv-prov__msg">{estado.aviso}</p>;
  return null;
}

function useRefrescarAlAvisar(estado: { aviso?: string } | null) {
  const router = useRouter();
  useEffect(() => { if (estado?.aviso) router.refresh(); }, [estado, router]);
}

/** La configuración de la entrega: quién la recibe, en qué formato y si sale sola. */
export function FormaEntrega({ config, guardar }: { config: ConfigEntrega; guardar: AccionProveedores }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, accion] = useActionState(guardar, null);
  const [activo, setActivo] = useState(config.activo);
  const [automatica, setAutomatica] = useState(config.automatica);
  useRefrescarAlAvisar(estado);
  return (
    <form action={accion} className="rv-prov__forma">
      <Casilla name="activo" checked={activo} onChange={(e) => setActivo(e.target.checked)} etiqueta={tx('rest.entregar_al_contador_las_facturas_aprobadas')}
        ayuda={tx('rest.apagado_como_nace_nada_sale_por')} />
      <CampoTextarea etiqueta={tx('rest.correo_s_del_contador')} ayuda={tx('rest.hasta_5_separados_por_coma_o')} name="destinatarios" defaultValue={config.destinatarios.join('\n')} rows={2} maxLength={600}
        placeholder="contador@tuempresa.mx" />
      <div className="rv-prov__par">
        <CampoSelect etiqueta={tx('rest.formato_del_csv')} name="formato" defaultValue={config.formato}>
          <option value="generico">{tx('rest.generico_excel')}</option>
          <option value="sap_b1">{tx('rest.sap_business_one')}</option>
          <option value="contpaqi">CONTPAQi</option>
        </CampoSelect>
        <Casilla name="incluirZip" defaultChecked={config.incluirZip} etiqueta={tx('rest.incluir_zip_con_xml_y_pdf')} />
      </div>
      <Casilla name="automatica" checked={automatica} onChange={(e) => setAutomatica(e.target.checked)} etiqueta={tx('rest.enviar_solo_una_vez_al_dia')}
        ayuda={tx('rest.si_no_el_lote_sale_cuando')} />
      {automatica && (
        <div className="rv-prov__par">
          <CampoTexto tipo="number" etiqueta={tx('rest.a_partir_de_las_hora_de')} name="horaEnvio" min={0} max={23} defaultValue={config.horaEnvio} />
          <CampoTexto tipo="number" etiqueta={tx('rest.minimo_de_facturas')} name="minFacturas" min={1} max={100} defaultValue={config.minFacturas} />
        </div>
      )}
      <div><Boton texto={tx('rest.guardar')} pendiente={tx('cobranza.formagasto.guardando')} icono={<Icono icono={Check} tam={14} />} /></div>
      <Mensaje estado={estado} />
    </form>
  );
}

export function BotonEnviarAhora({ enviar, disponibles }: { enviar: AccionProveedores; disponibles: number }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, accion] = useActionState(enviar, null);
  useRefrescarAlAvisar(estado);
  return (
    <form action={accion}>
      <Boton texto={`Enviar ahora (${disponibles})`} pendiente={tx('rest.enviando')} icono={<Icono icono={Send} tam={14} />} />
      <Mensaje estado={estado} />
    </form>
  );
}

/** Reintentar (lote fallido) y cancelar (lote que no salió): el id va en el formulario, el tenant en la sesión. */
export function BotonesLote({ id, puedeReintentar, puedeCancelar, reintentar, cancelar }: {
  id: string; puedeReintentar: boolean; puedeCancelar: boolean; reintentar: AccionProveedores; cancelar: AccionProveedores;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  const [eR, aR] = useActionState(reintentar, null);
  const [eC, aC] = useActionState(cancelar, null);
  useRefrescarAlAvisar(eR); useRefrescarAlAvisar(eC);
  return (
    <div className="rv-prov__pila">
      <div className="rv-prov__acciones">
        {puedeReintentar && (
          <form action={aR}><input type="hidden" name="id" value={id} />
            <Boton texto={tx('rest.reintentar')} pendiente="…" suave icono={<Icono icono={RotateCcw} tam={14} />} />
          </form>
        )}
        {puedeCancelar && (
          <form action={aC}><input type="hidden" name="id" value={id} />
            <Boton texto={tx('cobranza.controles.cancelar')} pendiente="…" suave icono={<Icono icono={X} tam={14} />} />
          </form>
        )}
      </div>
      <Mensaje estado={eR ?? eC} />
    </div>
  );
}

export function BotonDescartar({ id, descartar }: { id: string; descartar: AccionProveedores }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, accion] = useActionState(descartar, null);
  useRefrescarAlAvisar(estado);
  return (
    <form action={accion} className="rv-prov__acciones">
      <input type="hidden" name="id" value={id} />
      <Boton texto={tx('rest.descartar')} pendiente="…" suave icono={<Icono icono={Trash2} tam={14} />} />
      <Mensaje estado={estado} />
    </form>
  );
}

/** «Ver PDF»: la action firma una URL de 5 minutos del bucket privado y redirige. `campo` dice qué id viaja. */
export function BotonVerPdf({ campo, id, ver }: { campo: 'facturaId' | 'recepcionId'; id: string; ver: AccionProveedores }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, accion] = useActionState(ver, null);
  return (
    <form action={accion} className="rv-prov__acciones">
      <input type="hidden" name={campo} value={id} />
      <Boton texto={tx('rest.ver_pdf')} pendiente="…" suave icono={<Icono icono={FileText} tam={14} />} />
      <Mensaje estado={estado} />
    </form>
  );
}
