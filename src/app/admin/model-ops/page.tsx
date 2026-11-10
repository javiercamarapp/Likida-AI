import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getCostoPorFaseModelo } from '@/lib/admin/negocio';
import { usd, numero } from '@/lib/formato';
import { MarcoPagina, FilaTarjetas, Tarjeta, Disclosure, BotonEnlace } from '@/app/ui-v2/componentes';
import { DonaMini, BarList } from '@/app/ui-v2/graficas';
import { TarjetaFase } from '../tarjeta-fase';

export const dynamic = 'force-dynamic';

const FASE_LABEL: Record<string, string> = { ocr: 'OCR', cuadre: 'Cuadre', whatsapp: 'WhatsApp' };

/** Las TRES fases del pipeline DEL VIAJE, en el orden en que corren. Esta pantalla gobierna solo ese camino; NO es el inventario de
 *  agentes de la compañía (eso es Agentes › Panel, con la matriz de roles de modelo en `agente_definicion.modelo_rol`). */
const FASES = [
  { fase: 'ocr', nombre: 'OCR', queHace: 'Lee la foto de un comprobante (diésel, caseta, factura) y extrae monto, folio y CFDI.' },
  { fase: 'cuadre', nombre: 'Cuadre', queHace: 'Compara los gastos ya capturados contra el anticipo y la política de la flota.' },
  { fase: 'whatsapp', nombre: 'WhatsApp', queHace: 'Lleva la conversación con el operador de principio a fin: recibe fotos, confirma y cierra la liquidación.' },
] as const;

/**
 * Modelos: el pipeline completo del viaje con su costo real por fase y por modelo. Todo sale de `llm_costo` (`getResumenNegocio` /
 * `getCostoPorFaseModelo`). No hay editor de prompts ni selector de modelo por fase: eso sería funcionalidad decorativa, y se
 * declara abajo. El rol de modelo de cada AGENTE del catálogo sí se cambia, desde Agentes › Panel › Configurar.
 */
export default async function ModelOpsPage() {
  await requireSuperadmin();
  const [r, porFaseModelo] = await Promise.all([getResumenNegocio(), getCostoPorFaseModelo()]);
  const porFase = new Map(r.porFase.map((f) => [f.fase, f]));

  return (
    <MarcoPagina
      area="Agentes"
      titulo="Agentes"
      apoyo="Modelos: las tres fases del pipeline del viaje y lo que cuestan, por fase y por modelo."
      acciones={<BotonEnlace href="/admin/agentes" variante="secondary" tamano="sm">Rol de modelo por agente</BotonEnlace>}
    >
      <FilaTarjetas variante="4-4-4">
        {FASES.map(({ fase, nombre, queHace }) => (
          <TarjetaFase key={fase} titulo={nombre} queHace={queHace} datos={porFase.get(fase)} modelos={porFaseModelo.filter((m) => m.fase === fase)} />
        ))}
      </FilaTarjetas>

      <FilaTarjetas variante="6-6">
        <Tarjeta titulo="Costo por fase" estado={r.porFase.length > 0 ? 'ok' : 'vacio'} mensaje="Sin actividad de IA" detalle="Todavía no hay actividad de IA registrada.">
          <DonaMini
            etiqueta="Costo por fase"
            formato="usd"
            gajos={r.porFase.map((f) => ({ etiqueta: FASE_LABEL[f.fase] ?? f.fase, valor: f.costoUsd }))}
            centro={usd(r.porFase.reduce((s, f) => s + f.costoUsd, 0))}
          />
        </Tarjeta>
        <Tarjeta titulo="Costo por modelo, todas las fases" estado={r.porModelo.length > 0 ? 'ok' : 'vacio'} mensaje="Sin llamadas" detalle="Sin llamadas registradas todavía.">
          <BarList
            etiqueta="Costo por modelo"
            items={r.porModelo.map((m) => ({ clave: m.modelo, etiqueta: m.modelo, valor: m.costoUsd, texto: `${usd(m.costoUsd)} · ${numero(m.n)} llamadas` }))}
          />
        </Tarjeta>
      </FilaTarjetas>

      <Disclosure titulo="Lo que no existe todavía" resumen="Versionado y selector de modelo">
        <p>
          Versionado de prompts, reversa y guardrails configurables: aún no existen. Hoy los prompts viven en el código, sin historial de versiones ni pantalla de edición.
          No existe tampoco un selector de modelo por fase ni tenant: cambiar de modelo en el pipeline del viaje es un cambio de código y un despliegue.
        </p>
      </Disclosure>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Modelos' };
