-- Grunddaten + Sport + Tischlabels für Turniere.
--
-- Vorher hatte das Turnier-Modell nur name, logoUrl, coverUrl, startsAt,
-- endsAt. Spec §1.2 verlangt Ort (Druckkopf), Spec §5.4 verlangt die
-- Sport-Steuerung der Spaltenbezeichnung („Becher" bei Bierpong statt
-- „Tore"). Tischnamen („Platte 1"–„Platte 4") gehören zum Turnier,
-- nicht zum Schedule — sie erscheinen auf Ausdruck und Beamer.
--
-- Bewusst NICHT in config: diese Felder sind Top-Level-Turnier-Eigenschaften,
-- nicht Engine-Konfiguration.

ALTER TABLE "tournaments"
    ADD COLUMN "location"    TEXT,
    ADD COLUMN "sport"       TEXT NOT NULL DEFAULT 'becher',
    ADD COLUMN "tableLabels" JSONB;