Bring deine GitHub-Arbeit an die Issues, um die es geht. Barynt verbindet sich über eine eigene GitHub App und liest, was GitHub meldet. **Du brauchst keinen eigenen Server**, und dieses Plugin zeigt es an.

## Auf dem Board

Jede Karte mit Pull Request zeigt eine Zeile: seine Nummer, seinen Stand (_Entwurf_, _Offen_, _Änderungen gewünscht_, _Freigegeben_, _Gemergt_) und, solange er offen ist, die Checks seines Branches. Ein ganzes Board kommt mit einer Anfrage an Barynt aus, nie einer an GitHub pro Karte, und aktualisiert sich von selbst, wenn GitHub meldet.

## Im Issue

Das Panel **Development** zeigt:

- den Branch — Namen kopieren oder auf GitHub öffnen
- die Pull Requests mit Stand, Checks, Umfang und Reviewern
- die Commits, die das Issue nennen

## Regeln

Wähle einen Status für _Pull Request geöffnet_ und _Pull Request gemergt_ — etwa _In Review_ und _Done_. Barynt setzt ihn als „GitHub (App)“ und kommentiert, warum, aber nur bei Issues, an denen der Pull Request wirklich arbeitet: der Schlüssel im Branch-Namen oder nach _Fixes_, _Closes_ oder _Resolves_.

## Aktionen

Im Menü eines Issues, auf einer Karte oder in der Befehlspalette: **Branch erstellen** (benannt nach dem Muster deines Projekts, z. B. `ada/web-42-fix-login`), **Branch-Namen kopieren** und **Pull Request öffnen**.

## Einrichten

1. Verbinde GitHub einmal für den Workspace (oder ein Projekt): Installiere die GitHub App von Barynt auf deiner Organisation und wähle die Repositories aus.
2. Schalte das Plugin im Projekt ein und hake die Repositories an, mit denen es arbeitet. Einen Webhook musst du nicht anlegen.
3. Optional: Jede Person hinterlegt ein Fine-grained-Token, damit ihr Login im Branch-Namen steht und sie die Reviewer sieht.

Tokens werden verschlüsselt gespeichert und nur an `api.github.com` geschickt.
