import { redirect } from 'next/navigation';
import { Settings, Fuel, Building2 } from 'lucide-react';
import { getConfig } from '@/lib/likida/config';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import {
  guardarAjustesOperativos, guardarRfcsAdicionales, parsearRfcsAdicionales,
  MAX_RFCS_ADICIONALES, mensajeParaPantalla,
} from '@/lib/likida/administracion';
import { validarAjustes } from '@/lib/likida/ajustes_operativos';
import { cuentasDeclaradas } from '@/lib/likida/contabilidad/catalogo';
import { EstadoVacio } from '../../admin/ui/kit';
import { FormaConAviso, type ResultadoAccion } from '../../admin/ui/forma';
import { FormaAjustes, type ResultadoGuardar } from './forma';
import { ajustesIniciales, type EstadoCatalogo } from './inicial';

export const dynamic = 'force-dynamic';

/**
 * Configuración — los parámetros con los que el motor cuadra los viajes de
 * ESTA flota, y desde el 14-ago-2026 EDITABLES.
 *
 * Antes eran 168 líneas sin un solo formulario. Un contralor cuyos
 * tractocamiones rinden 2.4 km/L y no 3.0 tenía el motor calculando mal el
 * diésel esperado de CADA viaje, y su única salida era escribirle a Javier —
 * o sea, Likida era el cuello de botella de su propia operación. El cliente
 * ya puede tunear a sus agentes sin código; esto es lo mismo para el motor.
 *
 * QUÉ SIGUE SIENDO DE LECTURA, Y POR QUÉ:
 *  · El RFC — es identidad fiscal, se captura en el alta y cambiarlo apaga la
 *    validación de receptor de TODOS los CFDI históricos.
 *  · Las unidades calibradas — es un editor de lista (alta/baja por placa) y
 *    merece su propia pantalla en el Registro, no un textarea aquí.
 *  · Los topes de la LEY (estímulos, claves del SAT) — ver `ajustes_operativos.ts`.
 */
export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol, userId } = await resolverTenantEfectivo('/dashboard/configuracion', sp);
  if (!puedeVerRuta(rol, '/dashboard/configuracion')) redirect('/dashboard');

  let config;
  try {
    config = await getConfig(tenantId);
  } catch {
    config = null;
  }

  // Un viaje REAL de la flota para la vista previa. Sin viajes con km
  // capturados NO se inventa uno: la pantalla lo dice y ya.
  const { data: viajeEjemplo } = await supabaseAdmin()
    .from('viaje').select('km_recorridos')
    .eq('tenant_id', tenantId).not('km_recorridos', 'is', null)
    .order('creado_en', { ascending: false }).limit(1).maybeSingle();
  const ejemploKm = typeof viajeEjemplo?.km_recorridos === 'number' && viajeEjemplo.km_recorridos > 0
    ? viajeEjemplo.km_recorridos
    : null;

  const unidades = config ? Object.entries(config.unidades) : [];

  // AUDITORÍA 24, ARQ-3: el catálogo se lee del OVERRIDE de la flota, no de
  // `config` (que trae las cuentas demo fusionadas). Fallar cerrado: una
  // lectura caída no es «no declaró nada», y por eso tiene su propio estado —
  // si se enseñara vacío, el siguiente «Guardar» borraría el catálogo real.
  let cuentas: Record<string, string> | null = null;
  let estadoCatalogo: EstadoCatalogo;
  try {
    cuentas = await cuentasDeclaradas(tenantId);
    estadoCatalogo = cuentas ? 'declarado' : 'sin_declarar';
  } catch {
    estadoCatalogo = 'ilegible';
  }

  async function guardar(_previo: ResultadoGuardar, fd: FormData): Promise<ResultadoGuardar> {
    'use server';
    // Re-gateo ADENTRO: el rol de arriba es del render, no de esta llamada, y
    // una server action es alcanzable sin pasar por la página.
    const s = await resolverTenantEfectivo('/dashboard/configuracion', sp);
    if (!puedeVerRuta(s.rol, '/dashboard/configuracion')) {
      return { ok: false, error: 'Tu rol no puede cambiar la configuración de la flota.' };
    }
    try {
      // La validación del cliente es para avisar; ÉSTA es la que manda.
      const ajustes = validarAjustes({
        rendimientoPorDefecto: String(fd.get('rendimientoPorDefecto') ?? ''),
        factorCarga: String(fd.get('factorCarga') ?? ''),
        precioDieselPorDefecto: String(fd.get('precioDieselPorDefecto') ?? ''),
        umbralDesviacionPct: String(fd.get('umbralDesviacionPct') ?? ''),
        salida: String(fd.get('salida') ?? ''),
        cuentas: String(fd.get('cuentas') ?? ''),
      });
      await guardarAjustesOperativos(s.tenantId, ajustes, { id: userId });
      return { ok: true };
    } catch (e) {
      // Un DatoInvalido sale con su texto tal cual (es culpa de lo capturado);
      // cualquier otra cosa se loguea y sale como falla del sistema, para no
      // acusar al usuario de un error de base de datos.
      return { ok: false, error: mensajeParaPantalla(e, 'guardar los ajustes') };
    }
  }

  // AUDITORÍA 20, hallazgo 7 (MEDIO-BAJO): `rfcsAdicionales` se consumía en el
  // motor y se mostraba en esta misma pantalla, pero NADA en `src/` lo
  // escribía — la única forma de declarar la segunda razón social de la flota
  // era un UPDATE a mano sobre `tenant.config`. Éste es el campo que faltaba.
  const rfcPrincipal = config?.empresa.rfc ?? '';
  async function guardarRfcs(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    // Re-gateo ADENTRO, igual que la acción de arriba: una server action es
    // alcanzable sin pasar por la página, y esto toca la validación fiscal de
    // TODOS los CFDI de gasto de la flota.
    const s = await resolverTenantEfectivo('/dashboard/configuracion', sp);
    if (!puedeVerRuta(s.rol, '/dashboard/configuracion')) {
      return { error: 'Tu rol no puede cambiar la configuración de la flota.' };
    }
    try {
      // El RFC principal se relee CONTRA EL TENANT EFECTIVO, no el del render:
      // un superadmin que abrió con ?tenant= tiene enfrente otra flota, y
      // compararlo contra el RFC de la del render dejaría pasar como
      // "adicional" el RFC principal de la que se está editando.
      const cfg = await getConfig(s.tenantId);
      const rfcs = parsearRfcsAdicionales(String(fd.get('rfcsAdicionales') ?? ''), cfg.empresa.rfc);
      await guardarRfcsAdicionales(s.tenantId, rfcs, { id: userId });
      revalidatePath('/dashboard/configuracion');
      return {
        ok: rfcs.length === 0
          ? 'Listo: esta flota factura con un solo RFC. Los CFDI a nombre de cualquier otro vuelven a salir a revisión.'
          : `Listo: el motor ya acepta CFDI de gasto a nombre de ${rfcs.join(', ')}.`,
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar los RFC adicionales') };
    }
  }

  const inicial = ajustesIniciales(config, cuentas);

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Settings width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Configuración</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Lo que el motor usa para cuadrar tus viajes</span>
        </div>
      </header>

      {config === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudo leer la configuración de esta flota.
        </div>
      ) : (
        <div className="glass-panel overflow-hidden">
          <section className="p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              La empresa
            </h2>
            <div className="card p-4 mt-3 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                <Building2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
              </div>
              <div>
                <div className="text-sm font-mono">{config.empresa.rfc}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  RFC contra el que se valida que un CFDI de gasto sea tuyo. Si no coincide con el receptor del
                  comprobante, el motor lo marca como no verificable. No se edita aquí: cambiarlo apaga esa
                  validación sobre todo tu histórico — se corrige con nosotros.
                </div>
                {config.empresa.rfcsAdicionales && config.empresa.rfcsAdicionales.length > 0 && (
                  <div className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                    También se aceptan: {config.empresa.rfcsAdicionales.join(', ')}
                  </div>
                )}
              </div>
            </div>

            {/* Las OTRAS razones sociales, EDITABLES desde el 29-ago-2026. El
                RFC principal sigue sin formulario (cambiarlo apaga la
                validación de receptor sobre todo el histórico); éstos se
                SUMAN a él y por eso sí son del cliente. */}
            <div className="card p-4 mt-3">
              <h3 className="text-[13px] font-medium">Otras razones sociales que facturas</h3>
              <p className="text-xs mt-1 mb-3" style={{ color: 'var(--muted)' }}>
                Si tu operación factura con más de un RFC (dos empresas del mismo grupo, la razón social
                vieja y la nueva), decláralos aquí y el motor aceptará como tuyos los CFDI de gasto
                timbrados a cualquiera de ellos. Sin esto, salen «a revisar» uno por uno.
                Máximo {MAX_RFCS_ADICIONALES}. Dejarlo vacío y guardar los borra: vuelves a facturar con un
                solo RFC.
              </p>
              <FormaConAviso accion={guardarRfcs} boton="Guardar RFC adicionales" columnas="md:grid-cols-1">
                <div className="flex flex-col gap-1">
                  <label htmlFor="rfcsAdicionales" className="text-xs" style={{ color: 'var(--muted)' }}>
                    RFC adicionales — uno por línea o separados por coma
                  </label>
                  <textarea id="rfcsAdicionales" name="rfcsAdicionales" rows={3} spellCheck={false}
                    defaultValue={(config.empresa.rfcsAdicionales ?? []).join('\n')}
                    placeholder={`Distinto de ${rfcPrincipal}`}
                    className="text-sm rounded-lg px-2.5 py-2 font-mono"
                    style={{ background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
                  <span className="text-xs" style={{ color: 'var(--faint)' }}>
                    Se comprueban forma y dígito verificador, igual que en el alta de la flota. El RFC
                    principal ({rfcPrincipal}) no va aquí.
                  </span>
                </div>
              </FormaConAviso>
            </div>
          </section>

          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
              Ajustes de tu operación
            </h2>
            <FormaAjustes inicial={inicial} ejemploKm={ejemploKm} guardar={guardar} catalogo={estadoCatalogo} />
          </section>

          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Unidades calibradas
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Placas con consumo propio, que le ganan al rendimiento por defecto de arriba.
            </p>
            {unidades.length === 0 ? (
              <div className="mt-3">
                <EstadoVacio icono={<Fuel width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Ninguna placa tiene calibración propia todavía — todas usan el rendimiento por defecto.
                  Darlas de alta una por una todavía se hace con nosotros.
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="py-2.5 font-medium">Placa</th>
                      <th className="py-2.5 font-medium text-right">Rendimiento base</th>
                      <th className="py-2.5 font-medium text-right">Capacidad de tanque</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unidades.map(([placa, u]) => (
                      <tr key={placa} className="border-t" style={{ borderColor: 'var(--line)' }}>
                        <td className="py-3 font-mono">{placa}</td>
                        <td className="py-3 text-right tabular">{u.rendimientoBase} km/L</td>
                        <td className="py-3 text-right tabular">{u.capacidadTanque} L</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
