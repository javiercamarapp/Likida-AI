import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { CONECTORES } from '@/lib/likida/conectores/registro';
import type { CategoriaConector } from '@/lib/likida/conectores/tipos';
import {
  onboardingFiscalListo, umbralPeajeDeclarado, stackDeclarado,
  declararOnboarding, formularioDeclarado, LLAVE_ONBOARDING_POSPUESTO,
} from '@/lib/likida/perfil/preguntas';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { parseOnboarding } from '@/lib/likida/perfil/onboarding';
import { getPerfilCrudo, guardarPerfilPatch } from '@/lib/likida/repo';
import { guardarPerfilFormulario, PerfilGuardadoParcial } from '@/lib/likida/perfil/guardar_forma';
import { subirPoliticaPerfil, borrarPoliticaPerfil } from '@/lib/likida/perfil/documentos';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { sufijoTenant } from '../sufijo';
import { FormaOnboarding, type Opcion } from './forma';
import { ChatEntrevista } from './chat';
import { estadoEntrevista, mensajeBienvenida, CATALOGO } from '@/lib/likida/perfil/entrevista';
import { Boton, Disclosure, MarcoPagina, StatusChip, type ResultadoAccion } from '@/app/ui-v2/componentes';
import './entrevista.css';
import { getT } from '@/lib/i18n/servidor';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

export const dynamic = 'force-dynamic';

const extra = (t: TResto = T_RESTO_ES): Opcion[] => ([
  { valor: '', texto: t('op.elige_una') },
  { valor: 'ninguno', texto: t('op.no_usamos') },
]);
const otroTr = (t: TResto = T_RESTO_ES): Opcion => ({ valor: 'otro', texto: t('op.otro_escribelo_abajo') });

function opciones(cat: CategoriaConector, t: TResto): Opcion[] {
  return [
    ...extra(t),
    ...CONECTORES.filter((c) => c.categoria === cat).map((c) => ({ valor: c.id, texto: c.nombre })),
    otroTr(t),
  ];
}

export default async function OnboardingFlotaPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const { t } = await getT('resto');
  const sp = await searchParams;
  const s = await resolverTenantEfectivo('/dashboard/onboarding', sp);
  if (!puedeVerRuta(s.rol, '/dashboard/onboarding')) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  let perfil: unknown = {};
  try { perfil = await getPerfilCrudo(s.tenantId); } catch { perfil = {}; }
  const umbral = umbralPeajeDeclarado(perfil);
  const stack = stackDeclarado(perfil);

  async function accion(_prev: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const ses = await resolverTenantAtadoOLanza('/dashboard/onboarding', sp, s.tenantId);
    if (!puedeVerRuta(ses.rol, '/dashboard/onboarding')) {
      return { error: t('op.tu_rol_no_puede_declarar_el') };
    }
    const parsed = parseOnboarding(fd);
    if (!parsed.ok) return { error: parsed.error };

    const archivo = fd.get('politica');
    let subida: string | null = null;
    try {
      if (archivo instanceof File && archivo.size > 0) {
        parsed.datos.politicaDocumento = await subirPoliticaPerfil(ses.tenantId, archivo);
        subida = parsed.datos.politicaDocumento.path;
      }
      const patch = declararOnboarding(parsed.datos);
      await guardarPerfilFormulario(ses.tenantId, patch, ses.userId);
    } catch (e) {
      // A37-S19-08: si el perfil NO se escribió, el documento recién subido queda huérfano:
      // se borra. Si el perfil SÍ se escribió (parcial), ya lo referencia y se conserva.
      if (subida && !(e instanceof PerfilGuardadoParcial)) await borrarPoliticaPerfil(ses.tenantId, subida);
      return { error: mensajeParaPantalla(e, 'guardar el perfil') };
    }
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/onboarding');
    revalidatePath('/dashboard/contador');
    redirect(`/dashboard${sufijoTenant(sp)}`);
  }

  /** «Lo confirmo con mi contador» (W2): deja el Resumen abierto con un aviso
   *  permanente. NO declara nada: el estímulo de peaje sigue en $0. Solo el dueño
   *  —el candado del Resumen es de él— y se vuelve a comprobar aquí adentro. */
  async function posponer(): Promise<void> {
    'use server';
    const ses = await resolverTenantAtadoOLanza('/dashboard/onboarding', sp, s.tenantId);
    if (!puedeVerRuta(ses.rol, '/dashboard/onboarding') || !puedeAdministrar(ses.rol)) return;
    try {
      await guardarPerfilPatch(ses.tenantId, { [LLAVE_ONBOARDING_POSPUESTO]: new Date().toISOString() }, ses.userId);
    } catch {
      return; // no se pudo guardar: se queda en esta pantalla, que sigue funcionando
    }
    revalidatePath('/dashboard');
    redirect(`/dashboard${sufijoTenant(sp)}`);
  }

  const gps = opciones('Rastreo GPS', t);
  const erp = opciones('ERP y contabilidad', t);
  const tag = opciones('Peaje y monederos', t).filter((o) => o.valor !== 'monedero_diesel' && o.valor !== 'powergas');
  const monedero = [
    ...extra(t),
    ...CONECTORES.filter((c) => c.id === 'monedero_diesel' || c.id === 'powergas')
      .map((c) => ({ valor: c.id, texto: c.nombre })),
    otroTr(t),
  ];

  const entrevista = estadoEntrevista(perfil);
  const bien = mensajeBienvenida(entrevista);
  const preguntaInicial = entrevista.siguiente?.pregunta ?? null;
  const formulario = (
    <Disclosure titulo={t('op.prefiero_el_formulario')} variante="linea">
      <p className="rv-ob__form-apoyo">{rico(t('op.las_mismas_declaraciones_sin_conversacion_vacio'), { e0: (c) => <a href={`/dashboard/politicas${sufijo}`} className="rv-ob__form-enlace">{c}</a> })}</p>
      <FormaOnboarding
        accion={accion}
        gps={gps} erp={erp} tag={tag} monedero={monedero}
        inicial={{
          ingresos: umbral.ingresosMenoresA300M === null ? '' : umbral.ingresosMenoresA300M ? 'menor' : 'mayor',
          parte: umbral.parteRelacionada === null ? '' : umbral.parteRelacionada ? 'si' : 'no',
          gps: stack.gps ?? '',
          erp: stack.erp ?? '',
          tag: stack.tag ?? '',
          monedero: stack.monedero ?? '',
          pagoOperador: stack.pagoOperador ?? '',
          ...formularioDeclarado(perfil),
        }}
      />
    </Disclosure>
  );

  return (
    <MarcoPagina titulo={t('op.perfil_de_la_flota')} apoyo={t('op.lo_que_likida_necesita_saber_de')}>
      <div className="rv-ob">
        {puedeAdministrar(s.rol) && !onboardingFiscalListo(perfil) && (
          <form action={posponer} className="rv-ob__pospuesto">{t('op.no_tienes_a_la_mano_tus')}{' '}<Boton type="submit" variante="ghost" tamano="sm">{t('op.lo_confirmo_con_mi_contador')}</Boton>{' '}{t('op.el_resumen_se_abre_con_un')}</form>
        )}
        {/* Indicador de avance (plantilla FL de Rovaq): cuántos datos del perfil ya están declarados, contados del perfil guardado, nunca estimados. */}
        <div className="rv-ob__avance" role="group" aria-label={t('op.ob.avance', { n: entrevista.declaradas.length, total: CATALOGO.length })}>
          <progress className="rv-ob__avance-barra" max={CATALOGO.length} value={entrevista.declaradas.length} aria-hidden="true" />
          <span className="rv-ob__avance-txt">{t('op.ob.avance', { n: entrevista.declaradas.length, total: CATALOGO.length })}</span>
        </div>
        {/* Pasos de la entrevista (plantilla FL): una tarjeta por dato del perfil con su chip de estado y el paso actual con borde. Todo sale del perfil guardado. */}
        <ol className="rv-ob__pasos-fl" aria-label={t('op.ob.pasos')}>
          {CATALOGO.map((p, i) => {
            const hecho = entrevista.declaradas.includes(p.id);
            const actual = entrevista.siguiente?.id === p.id;
            return (
              <li key={p.id} className="rv-ob__paso-fl" data-estado={hecho ? 'hecho' : actual ? 'actual' : 'pendiente'} aria-current={actual ? 'step' : undefined}>
                <span className="rv-ob__paso-fl-n">{i + 1}</span>
                <span className="rv-ob__paso-fl-t" title={p.titulo}>{p.titulo}</span>
                <StatusChip tono={hecho ? 'ok' : actual ? 'warn' : 'neutral'}>{hecho ? t('op.ob.paso.hecho') : actual ? t('op.ob.paso.actual') : t('op.ob.paso.pendiente')}</StatusChip>
              </li>
            );
          })}
        </ol>
        <ChatEntrevista
          preguntaInicial={preguntaInicial}
          preguntaIdInicial={entrevista.siguiente?.id ?? null}
          chipsIniciales={bien.chips}
          sustentoInicial={bien.sustento}
          perfilListoInicial={entrevista.perfilListo || onboardingFiscalListo(perfil)}
          sufijo={sufijo}
          formulario={formulario}
        />
      </div>
    </MarcoPagina>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('resto');
  return { title: t('op.configuracion_inicial') };
}
