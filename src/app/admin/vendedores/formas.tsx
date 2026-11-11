'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Building2, Shuffle, UserPlus } from 'lucide-react';
import { Aviso, Boton, CampoSelect, CampoTexto, Icono } from '../../ui-v2/componentes';

// ═══════════════════════════════════════════════════════════════════════════
// Las tres formas de /admin/vendedores: `useActionState` + `useFormStatus`; el error de captura sale VERBATIM (los `DatoInvalido` se
// escribieron para leerse aquí) y los catálogos llegan como PROPS para no importar nada que arrastre `supabaseAdmin` al bundle.
// Fase 6: campos, botón y aviso son las piezas de ui-v2 (sin glifos ni estilos en línea).
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

function Enviar({ icono, texto, textoPendiente }: { icono: React.ReactNode; texto: string; textoPendiente: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={pending ? undefined : icono}>
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
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="ven-forma">
      <div className="ven-forma__rejilla">
        <CampoTexto etiqueta="Empresa" name="empresa" required maxLength={160} placeholder="Transportes del Norte SA" />
        <CampoTexto etiqueta="Vacante (la señal)" name="vacante" maxLength={160} placeholder="Analista de liquidaciones"
          ayuda="El puesto que la empresa publicó: es el dolor nombrado por ellos mismos." />
        <CampoTexto etiqueta="Contacto (opcional)" name="contacto" maxLength={120} />
        <CampoTexto etiqueta="Teléfono (opcional)" name="telefono" tipo="tel" maxLength={40} inputMode="tel" />
        <CampoTexto etiqueta="Correo (opcional)" name="correo" tipo="email" maxLength={160} />
        <CampoTexto etiqueta="Ciudad (opcional)" name="ciudad" maxLength={120} />
        <CampoSelect etiqueta="Vendedor (opcional)" name="vendedor" defaultValue="">
          <option value="">Sin asignar: lo toma el asignador</option>
          {vendedores.map((v) => (
            <option key={v.id} value={v.id}>{v.nombre}</option>
          ))}
        </CampoSelect>
        <CampoTexto etiqueta="Notas (opcional)" name="notas" maxLength={2000} />
      </div>
      <Resultado estado={estado} />
      <div className="ven-forma__pie">
        <Enviar icono={<Icono icono={Building2} />} texto="Agregar prospecto" textoPendiente="Agregando…" />
      </div>
    </form>
  );
}

/** Alta de un vendedor (cuenta de LIKIDA, tenant null). Sin teléfono a propósito: el vendedor no habla con el bot de ninguna flota. */
export function FormaInvitarVendedor({ accion }: { accion: AccionForma }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="ven-forma">
      <div className="ven-forma__rejilla">
        <CampoTexto etiqueta="Correo" name="email" tipo="email" required maxLength={160} placeholder="amigo@correo.com"
          ayuda="Entra a /vendedor tecleando este correo en el login: le llega un enlace mágico, sin contraseña." />
        <CampoTexto etiqueta="Nombre (opcional)" name="nombre" maxLength={120} placeholder="Como quieres verlo en el tablero" />
      </div>
      <Resultado estado={estado} />
      <div className="ven-forma__pie">
        <Enviar icono={<Icono icono={UserPlus} />} texto="Invitar vendedor" textoPendiente="Invitando…" />
      </div>
    </form>
  );
}

/** El botón del agente asignador. El resultado dice cuántos repartió y a quiénes, o por qué no repartió nada, que también es un resultado. */
export function BotonRepartir({ accion }: { accion: AccionForma }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="ven-forma">
      <div className="ven-forma__pie">
        <Enviar icono={<Icono icono={Shuffle} />} texto="Repartir pendientes" textoPendiente="Repartiendo…" />
      </div>
      <Resultado estado={estado} />
    </form>
  );
}
