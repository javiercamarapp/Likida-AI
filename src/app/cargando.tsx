import { Logo } from './logo';

/**
 * La pantalla de carga de TODO el producto: el logo respirando.
 *
 * Sustituye a los esqueletos (recuadros grises sin texto). Un esqueleto sirve
 * cuando el hueco que llena es corto y la forma final es predecible —una lista
 * de filas iguales—; aquí las páginas son distintas entre sí, así que el
 * esqueleto no anticipaba nada y se veía como una interfaz rota a medio
 * dibujar. El logo dice "estoy trabajando" sin prometer una forma que no
 * conoce.
 *
 * Sin `animate-pulse` de Tailwind: esa curva parpadea. Ésta es la misma
 * easeOutQuint que usan los paneles al expandirse, así que el producto entero
 * se mueve igual.
 */
export default function Cargando() {
  return (
    <div className="flex-1 min-h-[60dvh] flex items-center justify-center" role="status" aria-label="Cargando">
      <Logo alto="h-[42px]" className="likida-respira" />
    </div>
  );
}
