import { CircleCheck, CircleDashed, TriangleAlert, ExternalLink, ShieldAlert } from 'lucide-react';
import { fechaCorta } from '@/lib/formato';
import type { EstadoVinculo } from '@/lib/likida/facturacion/vinculo_portal';
import { ControlesRelogin, type AccionRelogin, type EstadoRelogin } from './relogin-controles';

// ════════════════════════════════════════════════════════════════════════════
// EL ESTADO DEL VÍNCULO, POR PORTAL — la pantalla que faltaba.
//
// Hasta ahora, un portal que pedía cuenta se veía en la cola del jefe ticket
// por ticket («Este portal se captura con tu sesión») y en ningún sitio se
// podía ver el PORTAL: si está vinculado, desde cuándo, y si se cayó. Con la
// sesión persistente encendida eso pasa a ser lo que hay que mirar — un
// portal vinculado factura solo diez tickets y no aparece en ninguna cola,
// hasta el día en que su sesión caduca y aparecen los diez de golpe.
//
// LAS REGLAS DE LA CASA QUE ESTA TABLA CUMPLE:
//
//   · `vinculos === null` NO es «ninguno vinculado»: es «no se pudo leer», y
//     se dice con esas palabras. Pintar «sin vincular» sobre una lectura
//     caída mandaría al contralor a re-vincular trece portales que están
//     bien (misma regla que `guardadas === null` en seccion-credenciales).
//   · Ninguna fecha se inventa. Un portal sin fila no enseña fecha, enseña
//     «nadie ha entrado todavía».
//   · El botón lleva al portal REAL del catálogo, no a un modal que promete
//     una vinculación remota que hoy no existe.
// ════════════════════════════════════════════════════════════════════════════

const PILDORA: Record<EstadoVinculo, { rotulo: string; fg: string; bg: string; Icono: typeof CircleCheck }> = {
  vinculado: { rotulo: 'Vinculado', fg: 'var(--ok)', bg: 'var(--okbg)', Icono: CircleCheck },
  caducada: { rotulo: 'Sesión caducada', fg: 'var(--warn)', bg: 'var(--warnbg)', Icono: TriangleAlert },
  sin_vincular: { rotulo: 'Sin vincular', fg: 'var(--muted)', bg: 'var(--canvas)', Icono: CircleDashed },
};

export interface FilaPortal {
  clave: string;
  nombre: string;
  /** La URL del portal, del catálogo. Es a donde lleva «Vincular ahora». */
  portal: string;
  estado: EstadoVinculo;
  /** ISO del último login humano que produjo sesión, si lo hubo. */
  vinculadaEn: string | null;
  /** ISO de cuándo el portal rechazó la sesión guardada, si pasó. */
  caducadaEn: string | null;
  /** Qué se vio, en palabras. Nunca una cookie. */
  motivo: string | null;
  /**
   * El permiso de re-login automático de ESTE portal (0233). `null` = no se
   * pudo leer, y los controles lo dicen — misma regla que `vinculos`.
   */
  relogin: EstadoRelogin | null;
}

export function SeccionPortales({ filas, vinculos, autorizarRelogin, revocarRelogin }: {
  filas: FilaPortal[];
  /** `false` = la lectura del estado falló. NO es «ninguno vinculado». */
  vinculos: boolean;
  /** Server actions del permiso. Re-verifican sesión, rol y flota ADENTRO. */
  autorizarRelogin: AccionRelogin;
  revocarRelogin: AccionRelogin;
}) {
  const caducados = filas.filter((f) => f.estado === 'caducada');

  return (
    <section className="card p-4">
      <h2 className="font-display text-[15px] font-semibold">Tus portales</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        Portales que piden tu cuenta. Entras UNA vez y el agente factura solo hasta que el portal
        cierre la sesión — Likida nunca guarda ni teclea tu contraseña, solo la sesión que dejas abierta.
      </p>

      {!vinculos ? (
        <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>
          No se pudo leer el estado de tus portales ahora mismo. No es que no tengas ninguno vinculado:
          es que esta pantalla está ciega. Recarga en un momento.
        </p>
      ) : filas.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Ninguno de los comercios de tus tickets pide cuenta de portal — no hay nada que vincular.
        </p>
      ) : (
        <>
          {caducados.length > 0 && (
            <div className="flex items-start gap-2 mb-3 rounded-lg p-2.5" style={{ background: 'var(--warnbg)' }}>
              <ShieldAlert width={14} height={14} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }} />
              <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
                {caducados.length === 1
                  ? `Se cayó la sesión de ${caducados[0].nombre}: sus tickets están esperando a que entres una vez.`
                  : `Se cayeron ${caducados.length} sesiones: sus tickets están esperando a que entres una vez en cada portal.`}
              </p>
            </div>
          )}

          <ul className="space-y-2">
            {filas.map((f) => {
              const p = PILDORA[f.estado];
              return (
                <li key={f.clave} className="py-1.5 border-b last:border-0"
                  style={{ borderColor: 'var(--line2)' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium truncate">{f.nombre}</div>
                      <div className="text-[11px]" style={{ color: 'var(--faint)' }}>
                        {leyenda(f)}
                      </div>
                      {f.motivo && f.estado !== 'vinculado' && (
                        <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>{f.motivo}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px]"
                        style={{ color: p.fg, background: p.bg }}>
                        <p.Icono width={11} height={11} strokeWidth={2} />
                        {p.rotulo}
                      </span>
                      {f.estado !== 'vinculado' && (
                        <a href={f.portal} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11.5px] underline"
                          style={{ color: 'var(--muted)' }}>
                          Vincular ahora <ExternalLink width={10} height={10} strokeWidth={2} />
                        </a>
                      )}
                    </div>
                  </div>
                  {/* La casilla del re-login va DEBAJO de cada portal y no en
                      un ajuste global: el permiso es por portal, porque una
                      flota puede querer que Likida reconecte sola en la
                      gasolinera de todos los días y no en el portal donde
                      guarda su facturación del año. */}
                  <ControlesRelogin
                    clave={f.clave} nombre={f.nombre} estado={f.relogin}
                    autorizar={autorizarRelogin} revocar={revocarRelogin}
                  />
                </li>
              );
            })}
          </ul>

          {/* LO QUE NO SE PROMETE. Vincular deja la sesión guardada solo cuando
              el login lo captura una sesión asistida (scripts/vincular-portal.mjs,
              en una máquina con pantalla): un servidor no tiene dónde enseñarte
              un navegador. Decirlo aquí es la diferencia entre un botón honesto
              y uno que parece no funcionar. */}
          <p className="text-[11px] mt-3 pt-2 border-t" style={{ color: 'var(--faint)', borderColor: 'var(--line2)' }}>
            «Vincular ahora» abre el portal para que entres tú. Para que el agente pueda reusar esa
            sesión hay que capturarla desde la sesión asistida de Likida — pídenosla y la corremos
            contigo; toma un minuto y no nos das ninguna contraseña. Un CAPTCHA en ese login lo
            resuelves tú: Likida no los resuelve ni los rodea.
          </p>
        </>
      )}
    </section>
  );
}

/** La línea de fecha. Nunca afirma una fecha que no exista. */
function leyenda(f: FilaPortal): string {
  if (f.estado === 'vinculado') {
    return f.vinculadaEn ? `Vinculado desde el ${fechaCorta(f.vinculadaEn)}` : 'Vinculado';
  }
  if (f.estado === 'caducada') {
    const cayo = f.caducadaEn ? `Se cayó el ${fechaCorta(f.caducadaEn)}` : 'Se cayó';
    return f.vinculadaEn ? `${cayo} · lo habías vinculado el ${fechaCorta(f.vinculadaEn)}` : cayo;
  }
  return 'Nadie ha entrado todavía — sus tickets van contigo';
}
