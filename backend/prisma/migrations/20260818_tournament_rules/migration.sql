-- Regelwerk-Tab (Spec §8.4 Info-Seite).
--
-- User-Punkt 5: Menu-Item „Regeln" zwischen Teams und Drucken, admin-
-- editierbar, members read-only, Paragraphs only (kein HTML, kein
-- Markdown — das Frontend wandelt Zeilenumbrüche in <p>-Tags).
--
-- Bewusst Top-Level statt in config: ein freier Info-Text, nicht
-- Engine-Konfiguration. NULL = noch nicht gepflegt → Frontend zeigt
-- einen leeren Tab mit Hinweis „Noch keine Regeln hinterlegt".
--
-- Sanitization passiert im Backend-Route-Handler (trim + max length),
-- NICHT per DB-Constraint — der App-Layer ist die richtige Stelle für
-- User-Input-Validierung, und wir wollen keinen 500 wenn jemand 100 KB
-- reinpumpt, sondern ein 400 mit klarer Meldung.

ALTER TABLE "tournaments"
    ADD COLUMN "rules" TEXT;
