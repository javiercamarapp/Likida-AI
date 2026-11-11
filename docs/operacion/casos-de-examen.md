# De falla real a caso de examen

Flujo (F14-B, sin migración):

1. Abre `/admin/escalaciones`. Cada renglón (escalación, corrida en fallo, liquidación en revisión, ticket, ARCO) trae el botón **Convertir en caso de examen**.
2. El botón descarga `caso-<id>.json` desde `/api/admin/caso-examen` (solo superadmin). El servidor vuelve a leer la cola, redacta y verifica.
3. **Redacción:** RFC, CURP, teléfonos, correos, UUID, CLABE o números largos, placas y el nombre que sigue a una etiqueta de persona se reemplazan por `[RFC]`, `[TELEFONO]`, etc.; la flota queda como `FLOTA_A`. Si tras redactar queda algo con forma de dato personal, no se entrega (422).
4. **Límite honesto:** los nombres propios sueltos no se detectan por reglas. Léelo antes de guardarlo.
5. Llena el campo `esperado` con el resultado correcto (el sistema no lo adivina).
6. Guarda el caso en el corpus **fuera de git** (no lo subas al repositorio). Para que entre a un examen dorado, súbelo por el flujo de cada examen (`scripts/evals/`); la compuerta por hash del prompt/modelo/corpus ya exige re-examinar cuando cambia.

Pendiente: una tabla de casos candidatos y la fuente «liquidación corregida por un humano» con su dato corregido requieren migración (ítem F12/D17).
