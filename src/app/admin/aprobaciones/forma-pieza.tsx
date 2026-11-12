'use client';

import { useActionState, useState } from 'react';
import { Check, PencilLine, X } from 'lucide-react';
import { fechaHoraMx } from '@/lib/formato';
import { Boton, CampoTexto, CampoTextarea, StatusChip, clasesBoton } from '../../ui-v2/componentes';
import { BotonConfirmar } from '../../ui-v2/componentes/confirmar';
import { paresLegibles } from '../valor-legible';
import type { PiezaEnCola } from '@/lib/likida/agentes/cola';
import '../bandeja.css';

import { useT } from '@/lib/i18n/proveedor';
import { admin_inicio as admin_inicioEs } from '@/lib/i18n/es/admin_inicio';
export type ResultadoPieza = { ok?: string; error?: string } | null;
export type AccionPieza = (previo: ResultadoPieza, fd: FormData) => Promise<ResultadoPieza>;

/**
 * UNA pieza de la cola con sus TRES acciones — aprobar tal cual, editar y
 * aprobar (el textarea aparece al pedirlo y la versión editada es la que
 * sale), rechazar con motivo obligatorio. El borrador se muestra COMPLETO:
 * aprobar algo que no se leyó entero no es aprobación.
 */
export function FormaPieza({ pieza, accion }: { pieza: PiezaEnCola; accion: AccionPieza }) {
  const { t } = useT('admin_inicio', admin_inicioEs);
  const [estado, enviar, pendiente] = useActionState<ResultadoPieza, FormData>(accion, null);
  const [editando, setEditando] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  // Objetos → resumen legible; null/vacío → se omite (nunca «[object Object]» ni «null»).
  const paresFuentes = paresLegibles(pieza.fuentes);

  if (estado?.ok) {
    return <div className="bj-item bj-item--hecha" role="status">{estado.ok}</div>;
  }

  return (
    <div className="bj-item">
      <div className="bj-item__cab">
        <span className="bj-item__titulo">{pieza.titulo}</span>
        <StatusChip tono="neutral">{pieza.tipo}</StatusChip>
        <span className="bj-item__meta">{pieza.agente}</span>
        {pieza.prospectoEmpresa && <span className="bj-item__meta">→ {pieza.prospectoEmpresa}</span>}
        <span className="bj-item__fecha">{fechaHoraMx(pieza.creadoEn)}</span>
      </div>

      {/* El borrador COMPLETO, con scroll propio — nunca truncado. */}
      <pre className="bj-item__borrador">{pieza.cuerpo}</pre>

      {paresFuentes.length > 0 && (
        <p className="bj-nota">Fuentes: {paresFuentes.map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
      )}

      {estado?.error && <p className="bj-item__aviso" role="alert">{estado.error}</p>}

      <form action={enviar} className="bj-item__forma">
        <input type="hidden" name="pieza" value={pieza.id} />
        {editando && (
          <CampoTextarea etiqueta={t('aprobaciones_forma_pieza.texto_que_debe_salir')} etiquetaOculta name="cuerpoEditado" defaultValue={pieza.cuerpo} rows={6} />
        )}
        {rechazando && (
          <CampoTexto etiqueta={t('aprobaciones_forma_pieza.motivo_del_rechazo')} etiquetaOculta obligatorio name="motivo"
            placeholder={t('aprobaciones_forma_pieza.motivo_del_rechazo_obligatorio')} />
        )}
        <div className="bj-item__fila">
          {!rechazando && (
            <Boton type="submit" name="operacion" value="aprobar" variante="primary" tamano="sm" disabled={pendiente}
              icono={<Check width={13} height={13} strokeWidth={1.75} />}>
              {editando ? t('aprobaciones_forma_pieza.aprobar_con_mi_edicion') : t('aprobaciones_forma_pieza.aprobar_tal_cual')}
            </Boton>
          )}
          {!editando && !rechazando && (
            <Boton variante="secondary" tamano="sm" onClick={() => setEditando(true)} icono={<PencilLine width={13} height={13} strokeWidth={1.75} />}>
              
              {t('aprobaciones_forma_pieza.editar_y_aprobar')}
            </Boton>
          )}
          {rechazando ? (
            <>
              <Boton type="submit" name="operacion" value="rechazar" variante="danger" tamano="sm" disabled={pendiente}
                icono={<X width={13} height={13} strokeWidth={1.75} />}>
                Rechazar
              </Boton>
              <Boton variante="secondary" tamano="sm" onClick={() => setRechazando(false)}>Cancelar</Boton>
            </>
          ) : (
            <Boton variante="ghost" tamano="sm" onClick={() => { setRechazando(true); setEditando(false); }}
              icono={<X width={13} height={13} strokeWidth={1.75} />}>
              Rechazar…
            </Boton>
          )}
        </div>
      </form>
    </div>
  );
}

/** AGB-4 (auditoría 24, 1-sep-2026): réplica de `TIPOS_ENVIABLES` de cola.ts
 *  — solo COSMÉTICA (esconder el botón), no el candado real. El candado que
 *  de verdad importa es el de servidor: `aprobadasSinEnviar` ya excluye estos
 *  tipos de la lista, y `enviarPiezaPorCorreo` los rechaza aunque de algún
 *  modo llegaran aquí (página vieja sin recargar). No se importa la constante
 *  real porque `cola.ts` es un módulo de servidor (supabaseAdmin) y este
 *  archivo es 'use client'. Mantener en sincronía con cola.ts si cambia. */
const TIPOS_ENVIABLES_UI = new Set(['correo_frio', 'correo_seguimiento']);

/**
 * El paso de ENVÍO de una aprobada (0120): un click aparte con claim
 * anti-doble-click en el servidor. Dice a quién sale y con qué versión;
 * sin correo del prospecto, lo dice en vez de ofrecer un botón muerto. Un
 * tipo INTERNO (ficha/brief/propuesta — AGB-4) tampoco ofrece botón: esas
 * piezas son un expediente sobre el prospecto, no algo que se le manda.
 *
 * AUDITORÍA ADVERSARIAL, HALLAZGO MEDIO: "Enviar por correo" manda un correo
 * REAL a un prospecto externo vía Resend con un solo clic — efecto
 * irreversible FUERA del sistema (a diferencia de "Rechazar" en `FormaPieza`,
 * que ya exige un paso intermedio propio para revelar el motivo). Se envuelve
 * con el ÚNICO sistema de confirmación del repo (`admin/ui/confirmar`,
 * DESIGN.md §3), mismo molde que `FormaRechazarCliente` (admin/mcp-clientes,
 * PR #583): `BotonConfirmar`/`DialogoConfirmar` con `tono="peligro"`, y el
 * diálogo DICE a qué correo y a quién se va a enviar — no "¿estás seguro?" a
 * secas.
 */
export function FormaEnvio({ pieza, accion }: { pieza: PiezaEnCola; accion: AccionPieza }) {
  const { t } = useT('admin_inicio', admin_inicioEs);
  const [estado, enviar, pendiente] = useActionState<ResultadoPieza, FormData>(accion, null);
  const enviable = TIPOS_ENVIABLES_UI.has(pieza.tipo);

  if (estado?.ok) {
    return <div className="bj-item bj-item--hecha" role="status">{estado.ok}</div>;
  }
  return (
    <div className="bj-item bj-item--envio">
      <span className="bj-item__titulo">{pieza.titulo}</span>
      {pieza.cuerpoFinal && <StatusChip tono="neutral">{t('aprobaciones_forma_pieza.con_edicion')}</StatusChip>}
      <span className="bj-item__meta">
        {pieza.prospectoEmpresa ? `→ ${pieza.prospectoEmpresa}` : 'sin prospecto'}
        {pieza.prospectoCorreo ? ` · ${pieza.prospectoCorreo}` : ''}
      </span>
      {pieza.envioError && (
        <span className="bj-sub" data-tono="bad">último intento: {pieza.envioError}</span>
      )}
      {estado?.error && <span className="bj-sub" data-tono="bad" role="alert">{estado.error}</span>}
      <form action={enviar} className="ml-auto shrink-0">
        <input type="hidden" name="pieza" value={pieza.id} />
        {!enviable ? (
          <span className="bj-item__meta">{t('aprobaciones_forma_pieza.pieza_interna_no_se')}</span>
        ) : pieza.prospectoCorreo ? (
          <BotonConfirmar
            etiqueta={pendiente ? t('aprobaciones_forma_pieza.enviando') : t('aprobaciones_forma_pieza.enviar_por_correo')}
            tono="peligro"
            deshabilitado={pendiente}
            etiquetaConfirmar="Sí, enviar"
            titulo={t('aprobaciones_forma_pieza.enviar_por_correo')}
            descripcion={t('aprobaciones_forma_pieza.se_va_a_mandar', { titulo: pieza.titulo, prospectoEmpresa: pieza.prospectoEmpresa ? `${pieza.prospectoEmpresa} — ` : '' })
              + `${pieza.prospectoCorreo}. Resend lo entrega al instante — es un correo real a un prospecto externo, `
              + 'y no hay botón para deshacerlo.'}
            className={clasesBoton('primary', 'sm')}
          />
        ) : (
          <span className="bj-item__meta">{t('aprobaciones_forma_pieza.sin_correo_capturado_se')}</span>
        )}
      </form>
    </div>
  );
}

/**
 * A36-R11-01 — salida del envío AMBIGUO (timeout de Resend). Solo se ofrece
 * cuando la pieza tiene `enviado_en`, no tiene id del proveedor y su error
 * empieza con «AMBIGUO». Confirmar = afirmar que se verificó en Resend que el
 * correo NO salió; el diálogo lo dice sin rodeos.
 */
export function FormaLiberarAmbiguo({ pieza, accion }: { pieza: PiezaEnCola; accion: AccionPieza }) {
  const { t } = useT('admin_inicio', admin_inicioEs);
  const [estado, liberar, pendiente] = useActionState<ResultadoPieza, FormData>(accion, null);
  if (estado?.ok) return <span className="bj-sub" data-tono="ok" role="status">{estado.ok}</span>;
  return (
    <form action={liberar} className="inline-flex items-center gap-2">
      <input type="hidden" name="pieza" value={pieza.id} />
      <BotonConfirmar
        etiqueta={pendiente ? t('aprobaciones_forma_pieza.liberando') : t('aprobaciones_forma_pieza.confirmar_que_no_salio')}
        tono="peligro"
        deshabilitado={pendiente}
        etiquetaConfirmar="Sí, verifiqué en Resend que no salió"
        titulo={t('aprobaciones_forma_pieza.liberar_el_envio_ambiguo')}
        descripcion={t('aprobaciones_forma_pieza.verifica_primero_en_resend', { titulo: pieza.titulo })}
        className={clasesBoton('primary', 'sm')}
      />
      {estado?.error && <span className="bj-sub" data-tono="bad" role="alert">{estado.error}</span>}
    </form>
  );
}
