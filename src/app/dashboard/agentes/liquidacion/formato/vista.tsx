import { ArrowLeft, Upload, Trash2, Save } from 'lucide-react';

// SOLO tipos: el repo importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { ConfigFormatoFlota, TelefonosFlota } from '@/lib/likida/liquidacion_externa/repo';
import { ETIQUETA_CAMPO_RENGLON, ETIQUETA_CAMPO_ENCABEZADO } from '@/lib/likida/liquidacion_externa/formato_flota';
import {
  AvisoCompacto, Boton, BotonEnlace, Casilla, CampoArchivo, CampoSelect, CampoTexto, CampoTextarea, Icono, MarcoPagina, Tarjeta,
} from '@/app/ui-v2/componentes';
import '../liquidacion.css';

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesFormato { subirMuestra: Accion; guardarAjustes: Accion; quitar: Accion; guardarTelefonos?: Accion }

/** Los dos grupos de teléfonos (copia al jefe de flota y aviso de discrepancia): los mismos con o sin formato de Excel. */
function CamposTelefonos({ copia, discrepancia, deshabilitado }: { copia: string[]; discrepancia: string[]; deshabilitado: boolean }) {
  return (
    <div className="rv-liq-dos">
      <CampoTextarea etiqueta="Copia al jefe de flota (WhatsApp, hasta 3)" name="copia" rows={2} defaultValue={copia.join('\n')} placeholder="5512345678" disabled={deshabilitado}
        ayuda="Reciben el resumen y la liga del documento de cada liquidación entregada. La copia lleva cifras: solo los números que pongas aquí." />
      <CampoTextarea etiqueta="Aviso cuando un operador responde «No coincide» (hasta 3)" name="discrepancia" rows={2} defaultValue={discrepancia.join('\n')} placeholder="5512345678" disabled={deshabilitado}
        ayuda="La persona responsable de revisar discrepancias. Si lo dejas vacío, se avisa al jefe de la copia y, sin copia, a quien ve dinero." />
    </div>
  );
}

export function VistaFormatoLiquidacion({ sufijo, aviso, error, config, telefonos, puedeAdministrar, acciones }: {
  sufijo: string; aviso: string | null; error: string | null;
  config: ConfigFormatoFlota | null;
  /** Los teléfonos guardados, con o sin formato (0645). Sin él (`undefined`) se toman del formato, si hay. */
  telefonos?: TelefonosFlota | null; puedeAdministrar: boolean; acciones: AccionesFormato;
}) {
  const f = config?.formato ?? null;
  return (
    <MarcoPagina titulo="Formato de las liquidaciones" apoyo="Tu formato de liquidación: Likida toma el dato del pago y se lo manda al operador con el mismo formato que hoy." acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/liquidacion${sufijo}`} icono={<Icono icono={ArrowLeft} />}>Volver al agente</BotonEnlace>}>
      {aviso && <AvisoCompacto tono="info" resumen={aviso} />}
      {error && <AvisoCompacto tono="error" resumen={error} />}

      <Tarjeta titulo="1. Tu formato" info="liquidacion_formato.formato">
        <p className="rv-liq-sub">
          Tú calculas la liquidación en tu sistema; Likida toma el dato del pago y se lo manda al operador con el mismo formato que hoy
          copias y pegas. Sube el Excel de muestra (el «formatito») y Likida lee sus columnas, sus encabezados y los datos de arriba
          (operador, periodo, folio). Lo que no reconoce no se inventa: te lo dice. Likida no recalcula nada: imprime las cifras que mandas.
        </p>
        {puedeAdministrar ? (
          <form action={acciones.subirMuestra} encType="multipart/form-data" className="rv-liq-acciones rv-liq-acciones--forma">
            <CampoArchivo etiqueta="Excel de muestra (.xlsx)" name="archivo" accept=".xlsx,.xls,.ods,.csv" required />
            <Boton type="submit" variante="primary" icono={<Icono icono={Upload} />}>{f ? 'Reemplazar muestra' : 'Subir muestra'}</Boton>
          </form>
        ) : (
          <p className="rv-liq-sub">Solo el dueño de la flota sube la muestra y cambia el formato.</p>
        )}
      </Tarjeta>

      {!f && (
        <Tarjeta titulo="Sin formato todavía">
          <p className="rv-liq-sub">
            Todavía no hay formato: las liquidaciones salen con el PDF genérico de Likida. No necesitas un Excel de muestra para
            designar a quién se le copia cada liquidación ni quién revisa las discrepancias: captúralos aquí abajo.
          </p>
        </Tarjeta>
      )}

      {!f && acciones.guardarTelefonos && (
        <Tarjeta titulo="2. A quién se le avisa (sin formato de Excel)" info="liquidacion_formato.avisos">
          <form action={acciones.guardarTelefonos} className="rv-liq-config">
            <CamposTelefonos copia={telefonos?.copia ?? []} discrepancia={telefonos?.discrepancia ?? []} deshabilitado={!puedeAdministrar} />
            {puedeAdministrar && (
              <div className="rv-liq-acciones">
                <Boton type="submit" variante="primary" icono={<Icono icono={Save} />}>Guardar teléfonos</Boton>
              </div>
            )}
          </form>
        </Tarjeta>
      )}

      {f && config && (
        <Tarjeta titulo="2. Cómo se imprime" info="liquidacion_formato.impresion">
          <p className="rv-liq-sub">
            Muestra: {config.nombreMuestra ?? '—'}. Cada liquidación que llega genera el PDF y el Excel con estas columnas; por WhatsApp viaja el que elijas.
          </p>
          <form action={acciones.guardarAjustes} className="rv-liq-config">
            <div className="rv-liq-cuatro">
              <CampoTexto etiqueta="Título del documento" name="titulo" defaultValue={f.titulo ?? ''} maxLength={120} placeholder="(el nombre de tu flota)" disabled={!puedeAdministrar} />
              <CampoSelect etiqueta="Documento que viaja por WhatsApp" name="salida" defaultValue={f.salida} disabled={!puedeAdministrar}>
                <option value="pdf">PDF</option>
                <option value="xlsx">Excel</option>
              </CampoSelect>
              <CampoSelect etiqueta="Fechas" name="fechas" defaultValue={f.fechas} disabled={!puedeAdministrar}>
                <option value="dmy">DD/MM/AAAA</option>
                <option value="iso">AAAA-MM-DD</option>
              </CampoSelect>
              <div className="rv-liq-total">
                <Casilla etiqueta="Mostrar la fila de total" name="mostrarTotal" defaultChecked={f.total.mostrar} disabled={!puedeAdministrar} />
                <CampoTexto etiqueta="Etiqueta de la fila de total" name="etiquetaTotal" defaultValue={f.total.etiqueta} maxLength={80} disabled={!puedeAdministrar} />
              </div>
            </div>

            <div>
              <p className="rv-liq-rotulo">Datos de arriba</p>
              {f.datos.length === 0 ? (
                <p className="rv-liq-sub">La muestra no traía datos sobre la tabla (operador, periodo, folio…): el documento lleva solo la tabla.</p>
              ) : (
                <div className="rv-liq-cuatro">
                  {f.datos.map((d, i) => (
                    <CampoTexto key={`${d.campo}-${i}`} etiqueta={`Se llena con: ${ETIQUETA_CAMPO_ENCABEZADO[d.campo]}`} name={`dato_${i}`} defaultValue={d.etiqueta} maxLength={80} disabled={!puedeAdministrar} />
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="rv-liq-rotulo">Columnas de la tabla, en orden</p>
              <div className="rv-liq-cuatro">
                {f.columnas.map((c, i) => (
                  <CampoTexto key={`${c.campo}-${i}`} etiqueta={`Se llena con: ${ETIQUETA_CAMPO_RENGLON[c.campo]}`} name={`col_${i}`} defaultValue={c.encabezado} maxLength={80} disabled={!puedeAdministrar} />
                ))}
              </div>
            </div>

            <CamposTelefonos copia={config.copiaTelefonos} discrepancia={config.discrepanciaTelefonos} deshabilitado={!puedeAdministrar} />

            {puedeAdministrar && (
              <div className="rv-liq-acciones">
                <Boton type="submit" variante="primary" icono={<Icono icono={Save} />}>Guardar cambios</Boton>
                <Boton type="submit" formAction={acciones.quitar} variante="secondary" icono={<Icono icono={Trash2} />}>Quitar el formato</Boton>
              </div>
            )}
          </form>
        </Tarjeta>
      )}
    </MarcoPagina>
  );
}
