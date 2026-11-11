import { Building2, FlaskConical } from 'lucide-react';
import { AvisoCompacto, BarraFiltros, Boton, BotonEnlace, EstadoError, FiltroBusqueda, Icono, StatusChip, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { NavegacionFilas } from './navegacion-teclado';
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
  flotas, demoId, seleccionActual, next, error, errorLista, consulta = '',
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
  /** El texto del buscador (`?q=`): filtra por nombre o id. */
  consulta?: string;
  accionElegir: (formData: FormData) => Promise<void>;
  accionQuitar: () => Promise<void>;
}) {
  const q = consulta.trim().toLowerCase();
  const visibles = q ? flotas.filter((f) => f.nombre.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)) : flotas;
  const demo: FilaFlota = { id: demoId, nombre: 'Flota Javier Prueba', esDemo: true };
  const filas: FilaFlota[] = [...visibles.map((f) => ({ ...f, esDemo: false })), ...(q && !demo.nombre.toLowerCase().includes(q) ? [] : [demo])];

  const columnas: ColumnaBase<FilaFlota>[] = [
    {
      id: 'flota', titulo: 'Flota', principal: true,
      celda: (f) => (
        <span className="adm-res-fila" data-activa={seleccionActual === f.id ? '' : undefined}>
          <Icono icono={f.esDemo ? FlaskConical : Building2} />
          <span className="adm-res-fila__texto">
            <span className="adm-res-fila__titulo">{f.nombre}</span>
            <span className="adm-flota-id">{f.esDemo ? 'Datos de demostración — no es un cliente' : f.id}</span>
          </span>
          {seleccionActual === f.id ? <StatusChip tono="ok">Activa</StatusChip> : null}
        </span>
      ),
    },
    {
      id: 'elegir', titulo: '', alinear: 'der',
      celda: (f) => {
        const activa = seleccionActual === f.id;
        return (
          <form action={accionElegir} className="adm-flota-form">
            <input type="hidden" name="flota" value={f.esDemo ? 'demo' : f.id} />
            <input type="hidden" name="next" value={next} />
            <Boton type="submit" tamano="sm" variante={activa ? 'ghost' : 'secondary'}>{activa ? 'Volver a elegirla' : 'Elegir'}</Boton>
          </form>
        );
      },
    },
  ];

  return (
    <EsqueletoTablaMaestra
      area="Cuenta" titulo="Elegir flota"
      apoyo="El panel del cliente apunta a UNA flota elegida; la selección dura una jornada y queda en la bitácora."
      acciones={<BotonEnlace variante="ghost" href="/admin">Volver al Resumen</BotonEnlace>}
      filtros={(
        // Buscador de 32 px con la lupa DENTRO del campo (Rovaq): la barra de filtros GET conserva `next` y limpia con un enlace.
        <BarraFiltros accion="/admin/elegir-flota" enLinea buscar etiqueta="Buscar flota" ocultos={{ next }} nActivos={consulta ? 1 : 0}
          limpiarHref={`/admin/elegir-flota?next=${encodeURIComponent(next)}`}>
          <FiltroBusqueda nombre="q" valor={consulta} placeholder="Buscar flota…" etiqueta="Buscar flota" />
        </BarraFiltros>
      )}
      avisos={error ? (
        <AvisoCompacto tono="error" resumen={error === 'firma'
          ? 'No se pudo guardar la selección (falta la llave de firma en el ambiente) — revisa la configuración.'
          : 'Esa flota no existe o no se pudo verificar — elige una de la lista.'} />
      ) : null}
      pie={errorLista ? undefined : `${filas.length} de ${flotas.length + 1}`}
    >
      {errorLista ? (
        <EstadoError reintentar>No se pudo leer la lista de flotas. La demostración sigue disponible.</EstadoError>
      ) : null}
      <NavegacionFilas>
        <TablaBase
          etiqueta="Flotas" columnas={columnas} filas={errorLista ? [demo] : filas} idFila={(f) => f.id} tarjetaMovil altoMaximo={false}
          vacio={{ titulo: 'Sin flotas de clientes', texto: 'Aparecen aquí cuando se da de alta la primera flota.' }}
        />
      </NavegacionFilas>
      {seleccionActual && (
        <form action={accionQuitar}>
          <Boton type="submit" variante="secondary">Quitar la selección y volver al modo global</Boton>
        </form>
      )}
    </EsqueletoTablaMaestra>
  );
}

interface FilaFlota extends FlotaElegible { esDemo: boolean }
