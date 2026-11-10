# Examen dorado del OCR (F17, primera mitad)

El OCR de comprobantes fija el importe; la guardia de cifras no puede
detectar una lectura equivocada porque esa lectura ES la fuente. Este examen
mide al lector con verdad conocida antes de que un modelo, prompt o esquema
llegue a producción.

## Piezas (`src/lib/evals/ocr-*.ts`)

| Archivo | Qué hace |
| --- | --- |
| `ocr-contrato.ts` | Verdad esperada, lectura, y la clasificación por campo: acierto, error, «no sé», invento, 0-por-null. |
| `ocr-corpus.ts` | Corpus SINTÉTICO generado con semilla (RFC `ZZ…` con DV válido, razones sociales «SINTETICO/EJEMPLO»). Nada real. |
| `ocr-metricas.ts` | Exactitud por campo (importe, fecha, RFC, tipo, litros), tasa de «no sé», calibración de la confianza contra el umbral 0.85 del motor, compuerta de regresión. |
| `ocr-doble.ts` | Lectores guionados (`fiel`, `realista`, `sabotaje`). Prueban el arnés, NO al modelo. |
| `ocr-congelado.ts` | Huella (prompt, modelo, esquema, corpus), `--check` de deriva y `compuertaModeloDinero`. |
| `ocr-corrida.ts` | Corredor con tope duro en USD e informe de calibración. |
| `ocr-real.ts` | Corrida real: APAGADA y declarada (D25); carga del corpus real redactado, fuera de git. |

`src/lib/evals/fixtures/ocr-congelado.json` es el congelado. Hoy su
`origen` es `doble`: detecta deriva pero no certifica a ningún modelo.

## Comandos

```
npx tsx scripts/evals/correr-ocr.ts --check            # deriva, sin red (CI lo corre vía vitest: ocr-dorado.test.ts)
npx tsx scripts/evals/correr-ocr.ts                    # doble realista + informe
npx tsx scripts/evals/correr-ocr.ts --sabotaje         # debe salir en FALLO
npx tsx scripts/evals/correr-ocr.ts --congelar-doble   # re-congela el doble tras cambiar prompt/modelo/esquema/corpus
npx tsx scripts/evals/correr-ocr.ts --real --max-usd N # APAGADA hasta que el dueño fije el tope (D25)
```

## Encender la corrida real (decisión del dueño, D25)

1. El dueño fija el tope en USD; se escribe en `CORRIDA_REAL_OCR.topeMaximoUsd`
   y `habilitada: true` en un commit revisado.
2. Cada corrida exige `--max-usd N` (N ≤ tope) y `LIKIDA_EVAL_OCR_REAL=1`.
3. Corpus real redactado: carpeta FUERA del repo con `manifest.json` y las
   imágenes, apuntada por `LIKIDA_OCR_CORPUS_REAL_DIR`. El cargador se niega
   si la carpeta está dentro del repo (público).
4. La corrida real sobre el corpus sintético re-congela con `origen: real`; solo
   entonces `compuertaModeloDinero` puede dar por vigente a un slug.

## Supuestos declarados (no son mediciones)

- Pisos de exactitud provisionales (`PISOS_PROVISIONALES`): importe 95 %, fecha, RFC y tipo 90 %.
- «Separa» = ningún error con confianza ≥ 0.85 y AUC ≥ 0.75; mínimo 5 lecturas de cada clase.
- Las cifras de un doble no son cifras del modelo. El informe imprime siempre el origen y la muestra.
