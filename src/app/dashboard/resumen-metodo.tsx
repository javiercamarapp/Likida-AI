// Píldoras de método de la portada («Cómo se calculó», «Fuentes y publicaciones»): cada una abre su explicación debajo, sin JavaScript
// (<details> nativo, teclado y lector de pantalla incluidos). El texto lo arma quien llama con cifras ya medidas; aquí no se inventa nada.
export function PildorasMetodo({ etiquetaComo, comoTexto, etiquetaFuentes, fuentesTexto }: {
  etiquetaComo: string; comoTexto: string; etiquetaFuentes: string; fuentesTexto: string;
}) {
  return (
    <span className="rv-res__metodo">
      <details className="rv-res__pildora"><summary>{etiquetaComo}</summary><span>{comoTexto}</span></details>
      <details className="rv-res__pildora"><summary>{etiquetaFuentes}</summary><span>{fuentesTexto}</span></details>
    </span>
  );
}
