import { redirect } from 'next/navigation';
import { exigirStepUpAccion } from '@/lib/auth/stepup';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoAccion, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { fechaMx } from '@/lib/formato';
import {
  crearLlaveApi, revocarLlaveApi, listarLlavesApi, llaveVencida, AREAS_DE_LLAVE, VIGENCIAS_DE_LLAVE,
  VIGENCIA_DEFAULT, type LlaveListada,
} from '@/lib/auth/llave-api-escritura';
import { FormaEmision, type ResultadoForma } from './forma';
import { ListaLlaves } from './vista';
import { AvisoCompacto, EstadoError } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { CajonEmitirLlave } from './cajon-emitir';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
import { rico } from '@/lib/i18n/rico';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('resto');
  return { title: t('llaves.llaves_de_api') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/llaves-api';

/**
 * LLAVES DE API — la emisión y revocación que la 0093 dejó prometida.
 *
 * El openapi de /v1 dice textualmente que la llave "se emite desde el panel,
 * se enseña UNA vez y se guarda solo su hash". Hasta esta pantalla (hallazgo
 * A6, auditoría 4) esa frase era mentira: `tenant_api_key` no tenía un solo
 * INSERT en src/, y el POST de /v1 —que exige área `administracion`— era
 * inalcanzable para todo el mundo.
 *
 * ── LAS DOS PUERTAS COINCIDEN AQUÍ, Y NO ES CASUAL ────────────────────────
 * VER es área `administracion` (`puedeVerRuta`) y ESCRIBIR es
 * `puedeAdministrar`: hoy los dos conjuntos son {superadmin, flota_admin},
 * el mismo criterio que la RLS `administra_flota()` de la 0093 — una llave
 * es CONTROL, no dato, y ni el contador ni el encargado la ven. Se comprueban
 * LAS DOS dentro de cada server action de todas formas: el `rol` del render
 * es el del momento en que se pintó, y una server action es un endpoint
 * alcanzable por POST directo. El `tenantId` va por CLOSURE desde la sesión
 * re-resuelta: nada del formulario decide de quién es la llave.
 */
export default async function PaginaLlavesApi({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; abrir?: string }>;
}) {
  const { t, idioma } = await getT('resto');
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // El catch NO finge que no hay llaves: una base caída pintada como "no
  // tienes llaves" invitaría a emitir duplicados de todas. Se pinta el error.
  let llaves: LlaveListada[] | null;
  try {
    llaves = await listarLlavesApi(tenantId);
  } catch {
    llaves = null;
  }

  async function emitirLlave(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: t('llaves.solo_el_dueno_de_la_flota') };
    }
    const pasoMfa = await exigirStepUpAccion(s.rol, 'llave_api', { tenantId: s.tenantId, userId: s.userId });
    if (pasoMfa) return { ok: false, error: pasoMfa };

    try {
      const llave = await crearLlaveApi(s.tenantId, {
        nombre: String(fd.get('nombre') ?? ''),
        area: String(fd.get('area') ?? ''),
        // SEG-8: si el POST no la trae, `crearLlaveApi` aplica el default de
        // un año — no «sin caducidad».
        vigencia: String(fd.get('vigencia') ?? ''),
      }, s.userId);

      revalidatePath(RUTA);
      return {
        ok: true,
        mensaje: llave.expiraEn
          ? t('llaves.llave_emitida_deja_de_valer_el', { fechaMx: fechaMx(llave.expiraEn, idioma) })
          : t('llaves.llave_emitida_sin_caducidad_va_a'),
        // El ÚNICO viaje del secreto: del motor a esta respuesta y a la
        // pantalla. No se guarda en ningún lado — ver `SecretoUnaVez`.
        secreto: { enClaro: llave.enClaro, prefijo: llave.prefijo },
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'emitir la llave') };
    }
  }

  async function revocarLlave(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: t('llaves.solo_el_dueno_de_la_flota_2') };
    }
    const pasoMfa = await exigirStepUpAccion(s.rol, 'llave_api', { tenantId: s.tenantId, userId: s.userId });
    if (pasoMfa) return { ok: false, error: pasoMfa };

    try {
      await revocarLlaveApi(s.tenantId, String(fd.get('id') ?? '').trim(), s.userId);
      revalidatePath(RUTA);
      return { ok: true, mensaje: t('llaves.llave_revocada') };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'revocar la llave') };
    }
  }

  // Cifras de las mismas filas que la tabla; con la lectura caída no hay cifras (nunca «0 llaves»).
  const vigentes = llaves === null ? 0 : llaves.filter((l) => l.revocadaEn === null && !llaveVencida(l.expiraEn)).length;
  const sinCaducidad = llaves === null ? 0 : llaves.filter((l) => l.revocadaEn === null && l.expiraEn === null).length;
  const muertas = llaves === null ? 0 : llaves.filter((l) => l.revocadaEn !== null || llaveVencida(l.expiraEn)).length;
  const cifras = llaves === null ? undefined : [
    { etiqueta: t('e26.llaves_vigentes'), valor: vigentes, nota: t('e26b.llaves_vigentes_nota'), segmentos: llaves.length > 0 ? [{ etiqueta: t('e26.llaves_vigentes'), valor: vigentes }, { etiqueta: t('e26.llaves_revocadas_vencidas'), valor: muertas }] : undefined },
    { etiqueta: t('e26.llaves_sin_caducidad'), valor: sinCaducidad, nota: t('e26b.llaves_sin_caducidad_nota') },
    { etiqueta: t('e26.llaves_revocadas_vencidas'), valor: muertas, nota: t('e26b.llaves_muertas_nota') },
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={t('llaves.llaves_de_api')} apoyo={t('llaves.con_una_llave_un_sistema_tuyo')}
      avisos={<AvisoCompacto tono="info"
        resumen={t('llaves.con_una_llave_un_sistema_tuyo_2')}
        mas={<p>{rico(t('llaves.la_llave_se_manda_como_e0'), { e0: (c) => <code className="cifra-mono">{c}</code>, e1: (c) => <code className="cifra-mono">{c}</code> })}</p>} />}
      cifras={cifras} etiquetaCifras={t('llaves.llaves_de_api')}
      acciones={llaves === null ? undefined : (
        <CajonEmitirLlave titulo={t('llaves.emitir_una_llave')} disparador={t('llaves.emitir_llave')} abiertoInicial={sp.abrir === 'emitir-llave'}>
          <FormaEmision accion={emitirLlave} areas={AREAS_DE_LLAVE}
            vigencias={VIGENCIAS_DE_LLAVE} vigenciaDefault={VIGENCIA_DEFAULT} />
        </CajonEmitirLlave>
      )}
    >
      {llaves === null ? (
        <EstadoError reintentar>{t('llaves.no_pude_leer_las_llaves_de')}</EstadoError>
      ) : (
        <ListaLlaves t={t} llaves={llaves} revocarLlave={revocarLlave} />
      )}
    </EsqueletoTablaMaestra>
  );
}
