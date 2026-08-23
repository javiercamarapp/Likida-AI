# Reglas para corregir hallazgos de la auditoría "qué tira producción"
Reportes: /Users/javiercamaraportepetit/likida-aud18/docs/escala-50k/auditoria-prod/{escala,resiliencia,seguridad}.md
(lee los tuyos completos; cada ID trae archivo:línea y arreglo propuesto — verifica que siga vivo antes de tocar).
1. Prueba que reproduce → arreglo → verde. Un commit por hallazgo o cadena, en español, citando el ID, SIN [deploy],
   autor/committer javiercamaraportepetit@gmail.com.
2. Migraciones: SOLO el número asignado; idempotentes; bloque en verificaciones.sql con el número de bloque asignado;
   migraciones_verificadas.test.ts verde. NO apliques nada a producción.
3. Consultas nuevas en caminos calientes: acotada() + periodo. Sin `.limit(N>1000)`: PostgREST recorta a 1,000.
4. No toques archivos fuera de tu lista (otros 8 agentes editan en paralelo): analytics.ts, fiscal.ts, comercial.ts,
   clientes.ts, facturacion_clientes.ts, operacion.ts, admin/negocio.ts, admin/capacidad.ts, admin/pmf.ts,
   viajes_registro.ts, app/dashboard/viajes/**, admin/ui/kit.tsx están TOMADOS.
5. Al final: npm test completo + npm run typecheck + eslint de tus archivos. Reporte: tabla ID | estado | archivos | sha
   + salida real; cualquier env nueva o cambio de comportamiento visible para el cliente, explícito.
