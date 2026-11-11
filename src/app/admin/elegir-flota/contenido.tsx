import { Building2, FlaskConical } from 'lucide-react';
import { AvisoCompacto, Boton, BotonEnlace, Icono, MarcoPagina, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import '../resumen.css';

// ═══════════════════════════════════════════════════════════════════════════
// EL SELECTOR DE FLOTA — la pantalla que mató al tenant implícito.
//
// Un superadmin que entra a /dashboard sin "ver como" (`?tenant=`/`?vista=`)
// y sin selección previa aterriza AQUÍ en vez de caer a la demo en silencio
// (hallazgo #1 de la auditoría externa). La demo SIGUE existiendo — como
// opción EXPLÍCITA, con su nombre y su naturaleza a la vista, jamás como
// default que nadie pidió.
//
// Server Component puro y separado del gateo (convención inicio-contenido):
// el preview headless lo monta sin sesión para VERIFICAR MIRANDO.
// ═══════════════════════════════════════════════════════════════════════════

export interface FlotaElegible {
  id: string;
  nombre: string;
}

export function ElegirFlotaContenido({
  flotas, demoId, seleccionActual, next, error, errorLista,
  accionElegir, accionQuitar,
}: {
  /** Las flotas reales (la demo NO va aquí — tiene su tarjeta propia). */
  flotas: FlotaElegible[];
  demoId: string;
  /** La selección vigente de la cookie, para marcarla — null sin selección. */
  seleccionActual: string | null;
  /** A dónde volver después de elegir (ya validado por `destinoSeguro`). */
  next: string;
  /** Error del intento anterior (`?error=`): flota inválida o firma caída. */
  error: string | null;
  /** `true` si la LISTA no se pudo leer — se dice, no se enseña vacía. */
  errorLista: boolean;
  accionElegir: (formData: FormData) => Promise<void>;
  accionQuitar: () => Promise<void>;
}) {
  const fila = (f: FlotaElegible, esDemo: boolean) => {
    const activa = seleccionActual === f.id;
    return (
      <li key={f.id} className="adm-res-fila">
        <Icono icono={esDemo ? FlaskConical : Building2} />
        <div className="adm-res-fila__texto">
          <span className="adm-res-fila__titulo">{f.nombre}</span>
          <span className="adm-flota-id">{esDemo ? 'Datos de demostración — no es un cliente' : f.id}</span>
        </div>
        {activa ? <StatusChip tono="ok">Activa</StatusChip> : null}
        <form action={accionElegir} className="adm-flota-form">
          <input type="hidden" name="flota" value={esDemo ? 'demo' : f.id} />
          <input type="hidden" name="next" value={next} />
          <Boton type="submit" tamano="sm" variante={activa ? 'secondary' : 'primary'}>{activa ? 'Volver a elegirla' : 'Elegir'}</Boton>
        </form>
      </li>
    );
  };

  return (
    <MarcoPagina
      area="Cuenta" titulo="Elegir flota" ancho="lectura"
      apoyo="El panel del cliente apunta a UNA flota elegida; la selección dura una jornada y queda en la bitácora."
      acciones={<BotonEnlace variante="ghost" href="/admin">Volver al Resumen</BotonEnlace>}
    >
      {error && (
        <AvisoCompacto tono="error" resumen={error === 'firma'
          ? 'No se pudo guardar la selección (falta la llave de firma en el ambiente) — revisa la configuración.'
          : 'Esa flota no existe o no se pudo verificar — elige una de la lista.'} />
      )}

      {errorLista ? (
        <Tarjeta titulo="Flotas de clientes" estado="error" mensaje="No se pudo leer la lista de flotas. La demostración sigue disponible." reintentar />
      ) : flotas.length === 0 ? (
        <Tarjeta titulo="Flotas de clientes" estado="vacio" mensaje="Sin flotas de clientes" detalle="Aparecen aquí cuando se da de alta la primera flota." />
      ) : (
        <Tarjeta titulo="Flotas de clientes"><ul className="adm-res-lista">{flotas.map((f) => fila(f, false))}</ul></Tarjeta>
      )}

      <Tarjeta titulo="Demostración">
        <ul className="adm-res-lista">{fila({ id: demoId, nombre: 'Flota Javier Prueba' }, true)}</ul>
      </Tarjeta>

      {seleccionActual && (
        <form action={accionQuitar}>
          <Boton type="submit" variante="secondary">Quitar la selección y volver al modo global</Boton>
        </form>
      )}
    </MarcoPagina>
  );
}
