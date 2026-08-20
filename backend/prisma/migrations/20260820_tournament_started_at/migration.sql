-- Etappe B.8: expliziter Lock-Trigger für Turnier-Lebenszyklus.
-- NULL = „Bereit" (entweder draft oder generated, aber noch nicht offiziell
-- gestartet). Sobald ein Admin auf „Turnier starten" klickt, wird startedAt
-- gesetzt und die Bracket-validierenden Sperren greifen.
-- Bestehende Daten: alle startedAt = NULL (alter „Bereit"-Zustand).
ALTER TABLE "tournaments" ADD COLUMN "startedAt" TIMESTAMP(3);
