-- BUCKET DE COMPROBANTES — la foto del ticket deja de tirarse.
--
-- Encontrado el 1-ago-2026 mirando la base: 22 gastos, 19 con `img_hash` y
-- CERO con `imagen_url`. La foto se descargaba de Meta, se le sacaba el hash, se
-- le pagaba la visión y se descartaba. `ocr.ts` ponía `imagenUrl: undefined` y
-- no había ningún sitio donde subirla: no era un bug, era una función que nunca
-- se construyó.
--
-- POR QUÉ IMPORTA, y no es cosmético:
--
--   • El CFF art. 30 obliga a conservar los comprobantes CINCO años. Un gasto
--     con monto y folio pero sin el papel es una fila en una tabla, no un
--     comprobante — y la liquidación se apoya en él.
--   • El contralor pide «déjame ver el ticket» en cuanto una cifra le extraña,
--     y hoy la respuesta es que no existe.
--   • Cuando el OCR lee mal —la fecha de este mismo día— la única forma de
--     dirimirlo es mirar el papel. Sin la foto, la palabra del sistema contra
--     la del operador, y la del operador está a 900 km.
--
-- PRIVADO. Un ticket trae RFC, domicilio, a veces el nombre del titular y —en
-- una farmacia— lo que se compró, que es dato sensible del art. 2 fr. VI de la
-- LFPDPPP. Se sirve por `createSignedUrl` con TTL, igual que los PDF: una URL
-- pública sería un expediente de gastos indexable por cualquiera que adivine el
-- nombre del archivo.
--
-- El aviso de privacidad ya declara «las fotos de comprobantes que envías por
-- aquí» dentro del catálogo del art. 15 fr. II, así que guardarlas no amplía la
-- finalidad de la que se le informó al operador.

insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

-- Sin policies: RLS de storage deniega a anon/authenticated por defecto y solo
-- el service-role (el pipeline) escribe y firma. Mismo criterio que la 0008.
