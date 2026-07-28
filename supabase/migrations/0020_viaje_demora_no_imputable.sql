-- LFT art. 263 fr. I — el dato sin el cual la obligación no se puede aplicar.
--
--   "En los transportes foráneos pagar los gastos de hospedaje y alimentación de
--    los trabajadores, cuando se prolongue o retarde el viaje por causa que no
--    sea imputable a éstos"
--
-- Cuando el viaje se alarga por causa ajena al operador —aduana, cliente,
-- bloqueo carretero, falla de la unidad— el hospedaje y la comida SE DEBEN
-- aunque rompan la política de la flota y aunque parte no sea deducible.
--
-- Sin este campo el motor no puede distinguir ese caso, y por defecto trataría
-- un gasto sobre política como discutible cuando la ley lo tiene por obligación
-- del patrón.
--
-- NULL a propósito, y no `false`: significa "nadie lo ha dicho todavía", que es
-- distinto de "la demora sí era imputable al operador". El motor manda a la
-- bandeja lo que no sabe en vez de decidir en contra de nadie.
alter table viaje add column if not exists demora_no_imputable boolean;

comment on column viaje.demora_no_imputable is
  'LFT 263-I: true = el viaje se prolongó por causa ajena al operador, así que hospedaje y alimentación se deben aunque rompan política. NULL = sin determinar, va a la bandeja.';
