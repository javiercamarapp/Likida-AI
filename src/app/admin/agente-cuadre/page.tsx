import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getCostoPorFaseModelo } from '@/lib/admin/negocio';
import { MarcoPagina, FilaTarjetas, Tarjeta } from '@/app/ui-v2/componentes';
import { TiraCifras, Columnas } from '@/app/ui-v2/graficas';
import { TarjetaFase } from '../tarjeta-fase';

export const dynamic = 'force-dynamic';

/**
 * Agente de Cuadre: la fase que compara los gastos ya capturados contra el anticipo y la política de la flota. Real: `llm_costo`
 * filtrado por la fase `cuadre` y `viaje` para el total de viajes procesados. Un cero aquí es MEDIDO: cero filas para la fase es
 * cero gasto real, no un relleno.
 */
export default async function AgenteCuadrePage() {
  await requireSuperadmin();
  const [r, porFaseModelo] = await Promise.all([getResumenNegocio(), getCostoPorFaseModelo().catch(() => [])]);
  const cuadre = r.porFase.find((f) => f.fase === 'cuadre');
  const modelos = porFaseModelo.filter((m) => m.fase === 'cuadre');

  return (
    <MarcoPagina
      area="Agentes"
      titulo="Agentes"
      apoyo="Cuadre: concilia gastos comprobados contra anticipo y política. Costo real, histórico."
    >
      <TiraCifras
        etiqueta="Cuadre"
        items={[
          { etiqueta: 'Gastado en Cuadre', valor: cuadre ? cuadre.costoUsd : 0, formato: 'usd', nota: 'Costo medido en llm_costo' },
          { etiqueta: 'Llamadas de Cuadre', valor: cuadre ? cuadre.n : 0, formato: 'entero' },
          { etiqueta: 'Viajes procesados', valor: r.viajesProcesados, formato: 'entero' },
        ]}
      />
      <FilaTarjetas variante="6-6">
        <TarjetaFase
          titulo="Costo por modelo, Cuadre"
          queHace="Compara los gastos ya capturados contra el anticipo y la política de la flota."
          datos={cuadre}
          modelos={modelos}
        />
        <Tarjeta
          titulo="Conciliación automática contra manual"
          estado="vacio"
          mensaje="Aún no se mide"
          detalle={`Likida sabe cuántos viajes se procesaron (${r.viajesProcesados}) y cuánto costó Cuadre, pero no guarda todavía si un viaje se cerró solo o si alguien tuvo que intervenir. Medirlo exige registrar esa intervención humana.`}
        />
      </FilaTarjetas>
      <Tarjeta titulo="Costo de IA por día, todas las fases" estado={r.porDia.length > 0 ? 'ok' : 'vacio'} mensaje="Sin actividad de IA" detalle="El costo por día no se separa por fase con los datos de hoy; esta gráfica suma todas.">
        <Columnas etiqueta="Costo de IA por día" datos={r.porDia.map((d) => ({ etiqueta: d.dia, valor: d.costoUsd }))} formato="usd" />
      </Tarjeta>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Cuadre' };
