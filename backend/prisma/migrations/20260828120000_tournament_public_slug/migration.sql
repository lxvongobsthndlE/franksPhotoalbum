-- Sprechender Zuschauer-Link (28.08.2026).
--
-- Additiv: eine neue, nullbare Spalte plus ein eindeutiger Index. Nichts
-- wird umbenannt, nichts geloescht — bestehende Turniere behalten ihren
-- Zufalls-Token und haben publicSlug = NULL, also genau das Verhalten
-- von vorher.
--
-- Der Index ist bewusst GLOBAL und nicht auf die Gruppe eingeschraenkt:
-- die Adresse `/t/<slug>` traegt keinen Mandanten im Pfad, also muss der
-- Name ueber alle Turniere hinweg eindeutig sein. NULL kollidiert in
-- Postgres nicht mit NULL — beliebig viele Turniere duerfen also ohne
-- eigenen Namen bleiben.
ALTER TABLE "tournaments" ADD COLUMN "publicSlug" TEXT;

CREATE UNIQUE INDEX "tournaments_publicSlug_key" ON "tournaments"("publicSlug");
