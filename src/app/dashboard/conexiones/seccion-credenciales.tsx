import { TriangleAlert } from 'lucide-react';
import { Icono, Tarjeta } from '@/app/ui-v2/componentes';
import './conexiones.css';
import { fechaCorta } from '@/lib/formato';
import { CONECTORES, conectorPorId } from '@/lib/likida/conectores/registro';
import { CATEGORIAS } from '@/lib/likida/conectores/tipos';
import { conectorPermitidoEnPerfil, type PerfilTenant } from '@/lib/auth/visibilidad';
import {
  FormaCredenciales, FormaDesactivar, FormaProbar,
  type GrupoCaptura, type AccionCredencial,
} from './credenciales-controles';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// "CREDENCIALES DE TUS SISTEMAS" (C2, auditoría 4) — la sección que llena la
// tabla `conector_credencial` de la 0094.
//
// El cofre (`cofre.ts`) y la tabla existían; lo que no existía era una sola
// pantalla que escribiera. Esta sección vive en /dashboard/conexiones porque
// es ahí donde el dueño ya mira qué tiene conectado y qué le falta.
//
// La regla de la pantalla: GUARDADA NO ES CONECTADA. Una credencial recién
// capturada dice "sin probar contra el sistema real" — pintarla verde
// prometería una conexión que nadie verificó (no hay una sola instancia real
// todavía; ver el encabezado de `conectores/tipos.ts`).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LOS CONECTORES QUE SE CAPTURAN AQUÍ: TODOS los que piden credenciales. Lo
 * único que se excluye son los que no piden nada (los `por_archivo` y los sin
 * API), porque ofrecerles captura fingiría una conexión que ese camino no usa.
 * Agrupado en el orden de `CATEGORIAS`, que es una decisión de venta escrita,
 * no el orden de import.
 *
 * ── POR QUÉ YA NO SE FILTRA POR `claveAlmacen` (arreglo de agosto-2026) ────
 *
 * El filtro decía `claveAlmacen === null`, y los 5 conectores de GPS son los
 * ÚNICOS con ese campo no nulo: quedaban fuera del único formulario de
 * captura que existe. La justificación escrita —«los GPS guardan en
 * `rastreo_credencial` con su propio flujo»— era falsa en los dos tramos:
 * `rastreo_credencial` (0050) no tiene un solo escritor en `src/`, y ese
 * «flujo propio» nunca se construyó. Mientras tanto el poller de posiciones
 * (`sincronizar_gps.ts`) lee `conector_credencial` —la tabla que ESTA
 * pantalla llena, y cuyo comentario de la 0094 dice «SAP, GPS, monederos»—,
 * así que el GPS era literalmente inalcanzable: el cron de cada 5 minutos, la
 * ingesta y la asistencia por cámara estaban escritos y nadie podía darles un
 * token.
 *
 * `claveAlmacen` sigue existiendo en la ficha porque describe el valor de
 * `rastreo_credencial.proveedor`; lo que ya no hace es decidir quién se puede
 * capturar. Los campos que cada GPS necesita ya los declara su propia ficha
 * (token de Samsara, servidor + token de Wialon, base/usuario/contraseña de
 * Geotab…), así que no hace falta inventarle ninguno aquí.
 *
 * Al cliente viaja SOLO la forma de cada campo (prop serializable): el
 * catálogo es puro, pero sus fichas enteras no tienen nada que hacer en el
 * bundle del navegador.
 */
export function catalogoParaCaptura(perfil: PerfilTenant | null = null): GrupoCaptura[] {
  // Sin perfil: el catálogo completo, igual que siempre. Con perfil: solo la lista cerrada (el resto es stand-by).
  const capturables = CONECTORES.filter((c) => c.credenciales.length > 0
    && (perfil === null || conectorPermitidoEnPerfil(perfil, c.id)));
  return CATEGORIAS
    .map((categoria) => ({
      categoria: categoria as string,
      conectores: capturables
        .filter((c) => c.categoria === categoria)
        .map((c) => ({
          id: c.id,
          nombre: c.nombre,
          campos: c.credenciales.map((k) => ({
            clave: k.clave, rotulo: k.rotulo, forma: k.forma,
            requerida: k.requerida, ayuda: k.ayuda, ejemplo: k.ejemplo,
          })),
        })),
    }))
    .filter((g) => g.conectores.length > 0);
}

/** Las pistas con su rótulo humano, resuelto contra el catálogo. Un conector
 *  que ya no exista en él enseña la clave cruda — la fila no se esconde. */
export function pistasConRotulo(conectorId: string, pistas: Record<string, string>): Array<{ rotulo: string; valor: string }> {
  const c = conectorPorId(conectorId);
  return Object.entries(pistas).map(([clave, valor]) => ({
    rotulo: c?.credenciales.find((k) => k.clave === clave)?.rotulo ?? clave,
    valor,
  }));
}

/**
 * EL ESTADO DE UNA CREDENCIAL, en tres casos y no en dos.
 *
 * Los dos campos de la 0094 se leen JUNTOS porque solos mienten:
 *
 *   · `probadaEn` con fecha → alguien la probó contra el sistema real y pasó.
 *   · `probadaEn` en null CON `ultimoError` → SÍ se probó, y la rechazaron.
 *     Antes esto se pintaba «sin probar», que manda a apretar un botón que ya
 *     se apretó en vez de a arreglar la credencial.
 *   · Los dos en null → nadie la ha probado nunca. `null` no es cero.
 *
 * `marcarProbada` es quien mantiene esa invariante: una prueba fallida BORRA
 * la `probada_en` anterior, para que una conexión muerta no siga en verde.
 */
export function estadoDePrueba(c: { activo: boolean; probadaEn: string | null; ultimoError: string | null }, t: TResto = T_RESTO_ES): {
  texto: string;
  tono: 'ok' | 'bad' | 'warn' | 'faint';
} {
  if (!c.activo) return { texto: 'desactivada', tono: 'faint' };
  if (c.probadaEn) return { texto: `probada el ${fechaCorta(c.probadaEn)}`, tono: 'ok' };
  if (c.ultimoError) return { texto: t('cfg.la_ultima_prueba_fallo'), tono: 'bad' };
  return { texto: t('cfg.guardada_sin_probar_contra_el_sistema'), tono: 'warn' };
}

export interface CredencialPantalla {
  conectorId: string;
  /** El nombre del catálogo, o el id crudo si el conector ya no está en él —
   *  se enseña tal cual, no se esconde la fila. */
  nombre: string;
  /** Pistas con su rótulo humano ya resuelto (el server las casa contra el
   *  catálogo). Solo no-secretos y recortes — ver `pistasDe`. */
  pistas: Array<{ rotulo: string; valor: string }>;
  activo: boolean;
  probadaEn: string | null;
  ultimoError: string | null;
  creadaEn: string;
}

/** Exportada para poder probar su gateo por render (patrón
 *  `tablero-operacion.test.tsx`). */
export function SeccionCredenciales({ cofreListo, puedeAdministrarCofre, guardadas, grupos, acciones, ipSalida, t = T_RESTO_ES }: {
  /** IP de salida estática del hosting, SOLO si está contratada y confirmada
   *  (T-TMS-14). Ausente = no se promete ninguna IP. */
  ipSalida?: string | null;
  /** ¿Hay `LIKIDA_COFRE_LLAVE`? Sin ella no se cifra y no se ofrece capturar. */
  cofreListo: boolean;
  /** Capturar/desactivar es CONTROL (`puedeAdministrar`) — mismo criterio que
   *  la RLS `administra_flota` de la 0094. La server action re-comprueba. */
  puedeAdministrarCofre: boolean;
  /** `null` = la lectura falló; se dice, no se pinta una lista vacía. */
  guardadas: CredencialPantalla[] | null;
  grupos: GrupoCaptura[];
  acciones: { guardar: AccionCredencial; desactivar: AccionCredencial; probar: AccionCredencial }; t?: TResto;
}) {
  return (
    <Tarjeta titulo={t('cfg.credenciales_de_tus_sistemas')}>
      <p className="rv-cx__apoyo">{rico(t('cfg.los_accesos_de_tu_erp_tu'), { strong: (c) => <strong>{c}</strong> })}</p>
      {ipSalida && (
        <p className="rv-cx__apoyo">{t('cfg.si_tu_area_de_sistemas_usa')}{' '}<span className="cifra-mono">{ipSalida}</span>.
        </p>
      )}

      {guardadas === null ? (
        // Lectura caída ≠ "no tienes credenciales": pintarlo vacío invitaría a
        // capturar de nuevo encima de lo que sí existe.
        <p className="rv-cx__texto" data-tono="bad">{t('cfg.no_se_pudieron_leer_las_credenciales')}</p>
      ) : (
        <div className="rv-cx__stack">
          {guardadas.length === 0 ? (
            <p className="rv-cx__texto" data-tono="faint">{t('cfg.aun_no_hay_credenciales_guardadas')}</p>
          ) : (
            <ul className="rv-cx__lista rv-cx__stack">
              {guardadas.map((c) => {
                const estado = estadoDePrueba(c, t);
                return (
                  <li key={c.conectorId} className="rv-cx__cred">
                    <div className="rv-cx__cred-cab">
                      <div className="rv-cx__cred-info">
                        <div className="rv-cx__cred-nombre">
                          <span>{c.nombre}</span>
                          <span className="rv-cx__estado" data-tono={estado.tono}>{estado.texto}</span>
                        </div>
                        {c.pistas.map((p) => (
                          <p key={p.rotulo} className="rv-cx__pista">
                            {p.rotulo}: <span className="cifra-mono">{p.valor}</span>
                          </p>
                        ))}
                        <p className="rv-cx__nota">{t('cfg.capturada_el')}{' '}{fechaCorta(c.creadaEn)}</p>
                        {c.ultimoError && (
                          <p className="rv-cx__error">
                            <Icono icono={TriangleAlert} tam={14} />
                            {c.ultimoError}
                          </p>
                        )}
                      </div>
                      {c.activo && puedeAdministrarCofre && (
                        // Probar y desactivar son las dos acciones del dueño sobre
                        // una credencial viva. Probar va primero porque es la que
                        // se aprieta seguido; desactivar sigue detrás de su
                        // confirmación de dos pasos.
                        <div className="rv-cx__acciones">
                          <FormaProbar conectorId={c.conectorId} probar={acciones.probar} />
                          <FormaDesactivar conectorId={c.conectorId} nombre={c.nombre} desactivar={acciones.desactivar} />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!cofreListo ? (
            // Sin la llave del cofre NO se ofrece el formulario: aceptaría un
            // secreto que va a tronar al guardar (y guardarlo en claro no es
            // una opción). Se dice qué falta, que es configuración del
            // sistema, no de la flota.
            <p className="rv-cx__texto" data-tono="warn">{t('cfg.el_cofre_de_credenciales_no_esta_2')}</p>
          ) : puedeAdministrarCofre ? (
            <FormaCredenciales grupos={grupos} guardar={acciones.guardar} />
          ) : (
            <p className="rv-cx__texto" data-tono="faint">{t('cfg.capturar_accesos_es_una_accion_del')}</p>
          )}
        </div>
      )}
    </Tarjeta>
  );
}
