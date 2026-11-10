import { ExternalLink } from 'lucide-react';
import './facturas.css';
import { AvisoCompacto, Icono, StatusChip, Tarjeta, type TonoEstado } from '@/app/ui-v2/componentes';
import { fechaCorta } from '@/lib/formato';
import type { EstadoVinculo } from '@/lib/likida/facturacion/vinculo_portal';
import { ControlesRelogin, type AccionRelogin, type EstadoRelogin } from './relogin-controles';
import { VincularAsistida } from './vincular-asistida';

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

const PILDORA: Record<EstadoVinculo, { rotulo: string; tono: TonoEstado }> = {
  vinculado: { rotulo: 'Vinculado', tono: 'ok' },
  caducada: { rotulo: 'Sesión caducada', tono: 'warn' },
  sin_vincular: { rotulo: 'Sin vincular', tono: 'muted' },
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

export function SeccionPortales({ filas, vinculos, autorizarRelogin, revocarRelogin, flota = null }: {
  filas: FilaPortal[];
  /** `false` = la lectura del estado falló. NO es «ninguno vinculado». */
  vinculos: boolean;
  /** Server actions del permiso. Re-verifican sesión, rol y flota ADENTRO. */
  autorizarRelogin: AccionRelogin;
  revocarRelogin: AccionRelogin;
  /** MX-002: la flota pintada, firmada; viaja en los formularios de vincular. */
  flota?: string | null;
}) {
  const caducados = filas.filter((f) => f.estado === 'caducada');

  return (
    <Tarjeta titulo="Tus portales" estado={!vinculos ? 'error' : filas.length === 0 ? 'vacio' : 'ok'}
      mensaje={!vinculos ? 'No se pudo leer el estado de tus portales ahora mismo. No es que no tengas ninguno vinculado: es que esta pantalla está ciega. Recarga en un momento.' : 'Ningún portal por vincular'}
      detalle="Ninguno de los comercios de tus tickets pide cuenta de portal — no hay nada que vincular.">
      <div className="rv-fact__pila">
        <p className="rv-fact__nota">
          Portales que piden tu cuenta. Entras UNA vez y el agente factura solo hasta que el portal
          cierre la sesión — Likida nunca guarda ni teclea tu contraseña, solo la sesión que dejas abierta.
        </p>
        {caducados.length > 0 && (
          <AvisoCompacto tono="warn" resumen={caducados.length === 1
            ? `Se cayó la sesión de ${caducados[0].nombre}: sus tickets están esperando a que entres una vez.`
            : `Se cayeron ${caducados.length} sesiones: sus tickets están esperando a que entres una vez en cada portal.`} />
        )}

        <ul className="rv-fact__reglones">
          {filas.map((f) => {
            const p = PILDORA[f.estado];
            return (
              <li key={f.clave} className="rv-fact__portal">
                <div className="rv-fact__reglon">
                  <div className="rv-fact__dos">
                    <strong>{f.nombre}</strong>
                    <span className="rv-fact__sub">{leyenda(f)}</span>
                    {f.motivo && f.estado !== 'vinculado' && <span className="rv-fact__nota">{f.motivo}</span>}
                  </div>
                  <div className="rv-fact__linea">
                    <StatusChip tono={p.tono}>{p.rotulo}</StatusChip>
                    {f.estado !== 'vinculado' && (
                      <a href={f.portal} target="_blank" rel="noopener noreferrer" className="rv-fact__enlace">
                        Abrir el portal <Icono icono={ExternalLink} tam={14} />
                      </a>
                    )}
                  </div>
                </div>
                {/* 0540: el paso humano del CAPTCHA/MFA con código de un solo uso. También
                    con el portal vinculado: «re-vincular» antes de que la sesión caduque. */}
                <VincularAsistida clave={f.clave} nombre={f.nombre} flota={flota} />
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

        {/* LO QUE NO SE PROMETE. Un servidor no tiene pantalla donde enseñarte un navegador:
            «Vincular con código» te da un código de un solo uso y el comando que corres en TU
            computadora; ahí entras tú. Likida no resuelve ni rodea CAPTCHAs ni guarda tu contraseña. */}
        <p className="rv-fact__nota" data-tono="faint">
          «Vincular con código» te da un código de un solo uso (caduca en 15 minutos) y el comando
          que corres en tu computadora: se abre el portal, entras tú y resuelves el CAPTCHA o el
          código de dos pasos, y a Likida solo llegan las cookies de ese portal, cifradas — nunca tu
          contraseña. Si la sesión se cae, el portal aparece como «Sesión caducada» y vuelves a vincular.
        </p>
      </div>
    </Tarjeta>
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
