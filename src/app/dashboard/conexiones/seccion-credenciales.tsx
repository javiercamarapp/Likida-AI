import { Vault, TriangleAlert } from 'lucide-react';
import { fechaCorta } from '@/lib/formato';
import { CONECTORES, conectorPorId } from '@/lib/likida/conectores/registro';
import { CATEGORIAS } from '@/lib/likida/conectores/tipos';
import {
  FormaCredenciales, FormaDesactivar, FormaProbar,
  type GrupoCaptura, type AccionCredencial,
} from './credenciales-controles';

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
export function catalogoParaCaptura(): GrupoCaptura[] {
  const capturables = CONECTORES.filter((c) => c.credenciales.length > 0);
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
export function estadoDePrueba(c: { activo: boolean; probadaEn: string | null; ultimoError: string | null }): {
  texto: string;
  tono: 'ok' | 'bad' | 'warn' | 'faint';
} {
  if (!c.activo) return { texto: 'desactivada', tono: 'faint' };
  if (c.probadaEn) return { texto: `probada el ${fechaCorta(c.probadaEn)}`, tono: 'ok' };
  if (c.ultimoError) return { texto: 'la última prueba FALLÓ', tono: 'bad' };
  return { texto: 'guardada — sin probar contra el sistema real', tono: 'warn' };
}

const TONO_ESTADO: Record<'ok' | 'bad' | 'warn' | 'faint', string> = {
  ok: 'var(--ok)', bad: 'var(--bad)', warn: 'var(--warn)', faint: 'var(--faint)',
};

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
export function SeccionCredenciales({ cofreListo, puedeAdministrarCofre, guardadas, grupos, acciones }: {
  /** ¿Hay `LIKIDA_COFRE_LLAVE`? Sin ella no se cifra y no se ofrece capturar. */
  cofreListo: boolean;
  /** Capturar/desactivar es CONTROL (`puedeAdministrar`) — mismo criterio que
   *  la RLS `administra_flota` de la 0094. La server action re-comprueba. */
  puedeAdministrarCofre: boolean;
  /** `null` = la lectura falló; se dice, no se pinta una lista vacía. */
  guardadas: CredencialPantalla[] | null;
  grupos: GrupoCaptura[];
  acciones: { guardar: AccionCredencial; desactivar: AccionCredencial; probar: AccionCredencial };
}) {
  return (
    <section className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Vault width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
        <h2 className="font-display text-[14px] font-semibold">Credenciales de tus sistemas</h2>
      </div>
      <p className="text-[12px] mb-3 max-w-2xl" style={{ color: 'var(--faint)' }}>
        Los accesos de tu ERP, tu GPS y tus monederos se guardan cifrados en el servidor — al
        panel solo vuelven pistas (los últimos 4 de cada secreto). Guardar una credencial NO la
        conecta todavía: hay que apretar <strong>Probar conexión</strong>, que llama de verdad al
        sistema y sella aquí lo que contestó.
      </p>

      {guardadas === null ? (
        // Lectura caída ≠ "no tienes credenciales": pintarlo vacío invitaría a
        // capturar de nuevo encima de lo que sí existe.
        <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>
          No se pudieron leer las credenciales guardadas ahora mismo. Recarga la página; si se
          repite, avísale a Likida.
        </p>
      ) : (
        <>
          {guardadas.length === 0 ? (
            <p className="text-[12px] mb-3" style={{ color: 'var(--faint)' }}>
              Aún no hay credenciales guardadas.
            </p>
          ) : (
            <ul className="space-y-2 mb-3">
              {guardadas.map((c) => {
                const estado = estadoDePrueba(c);
                return (
                <li key={c.conectorId} className="rounded-lg hairline p-3" style={{ background: 'var(--surface)' }}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium">{c.nombre}</span>
                        <span className="text-[11px]" style={{ color: TONO_ESTADO[estado.tono] }}>
                          {estado.texto}
                        </span>
                      </div>
                      {c.pistas.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {c.pistas.map((p) => (
                            <div key={p.rotulo} className="text-[12px]" style={{ color: 'var(--muted)' }}>
                              {p.rotulo}: <span className="cifra-mono">{p.valor}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                        Capturada el {fechaCorta(c.creadaEn)}
                      </p>
                      {c.ultimoError && (
                        <p className="text-[12px] mt-1 flex items-start gap-1.5" style={{ color: 'var(--warn)' }}>
                          <TriangleAlert width={12} height={12} strokeWidth={2} className="mt-0.5 shrink-0" />
                          {c.ultimoError}
                        </p>
                      )}
                    </div>
                    {c.activo && puedeAdministrarCofre && (
                      // Probar y desactivar son las dos acciones del dueño sobre
                      // una credencial viva. Probar va primero porque es la que
                      // se aprieta seguido; desactivar sigue detrás de su
                      // confirmación de dos pasos.
                      <div className="shrink-0 space-y-2">
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
            <p className="text-[12.5px] max-w-xl" style={{ color: 'var(--warn)' }}>
              El cofre de credenciales no está configurado en este entorno
              (falta <code className="cifra-mono">LIKIDA_COFRE_LLAVE</code>): la captura está
              deshabilitada hasta que exista. Es configuración del sistema, no de tu flota.
            </p>
          ) : puedeAdministrarCofre ? (
            <FormaCredenciales grupos={grupos} guardar={acciones.guardar} />
          ) : (
            <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
              Capturar accesos es una acción del dueño de la flota — pídesela a tu administrador.
            </p>
          )}
        </>
      )}
    </section>
  );
}
