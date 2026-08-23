import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ClipboardList } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { CONECTORES } from '@/lib/likida/conectores/registro';
import type { CategoriaConector } from '@/lib/likida/conectores/tipos';
import {
  onboardingFiscalListo, umbralPeajeDeclarado, stackDeclarado,
  declararOnboarding, facilidad15Declarada,
} from '@/lib/likida/perfil/preguntas';
import { parseOnboarding } from '@/lib/likida/perfil/onboarding';
import { getPerfilCrudo, guardarPerfilPatch, actualizarFacilidad15 } from '@/lib/likida/repo';
import { subirPoliticaPerfil } from '@/lib/likida/perfil/documentos';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { sufijoTenant } from '../sufijo';
import { FormaOnboarding, type Opcion } from './forma';
import type { ResultadoAccion } from '../../admin/ui/forma';

export const dynamic = 'force-dynamic';

const EXTRA: Opcion[] = [
  { valor: '', texto: 'Elige una' },
  { valor: 'ninguno', texto: 'No usamos' },
];
const OTRO: Opcion = { valor: 'otro', texto: 'Otro (escríbelo abajo)' };

function opciones(cat: CategoriaConector): Opcion[] {
  return [
    ...EXTRA,
    ...CONECTORES.filter((c) => c.categoria === cat).map((c) => ({ valor: c.id, texto: c.nombre })),
    OTRO,
  ];
}

export default async function OnboardingFlotaPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
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
    const ses = await resolverTenantEfectivo('/dashboard/onboarding', sp);
    if (!puedeVerRuta(ses.rol, '/dashboard/onboarding')) {
      return { error: 'Tu rol no puede declarar el perfil de la flota.' };
    }
    const parsed = parseOnboarding(fd);
    if (!parsed.ok) return { error: parsed.error };

    const archivo = fd.get('politica');
    try {
      if (archivo instanceof File && archivo.size > 0) {
        parsed.datos.politicaDocumento = await subirPoliticaPerfil(ses.tenantId, archivo);
      }
      const patch = declararOnboarding(parsed.datos);
      await guardarPerfilPatch(ses.tenantId, patch, ses.userId);
      const f15 = facilidad15Declarada(patch);
      if (f15) {
        await actualizarFacilidad15(ses.tenantId, f15.dedicacionExclusivaCarga, f15.regimenElegible);
      }
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar el perfil') };
    }
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/onboarding');
    revalidatePath('/dashboard/contador');
    redirect(`/dashboard${sufijoTenant(sp)}`);
  }

  const gps = opciones('Rastreo GPS');
  const erp = opciones('ERP y contabilidad');
  const tag = opciones('Peaje y monederos').filter((o) => o.valor !== 'monedero_diesel' && o.valor !== 'powergas');
  const monedero = [
    ...EXTRA,
    ...CONECTORES.filter((c) => c.id === 'monedero_diesel' || c.id === 'powergas')
      .map((c) => ({ valor: c.id, texto: c.nombre })),
    OTRO,
  ];

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <ClipboardList width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Perfil de la flota</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {onboardingFiscalListo(perfil)
              ? 'Puedes corregir lo declarado. El motor usa esto en el próximo cuadre.'
              : 'Antes del primer cierre: cómo se maneja esta flota, con qué trabajan y sus políticas.'}
          </span>
        </div>
      </header>
      <div className="glass-panel px-5 py-5">
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
          }}
        />
      </div>
      <p className="text-xs px-1" style={{ color: 'var(--muted)' }}>
        Los topes numéricos (cuánto puede gastar un chofer en diésel, caseta, comida)
        se capturan en <a href={`/dashboard/politicas${sufijo}`} className="underline">Políticas de gasto</a>.
        Dedicación exclusiva y Red Nacional del estímulo de peaje siguen siendo
        responsabilidad de la flota: Likida no las verifica.
      </p>
    </div>
  );
}
