# OpenAPI Generator für Node-RED (Frosch Work Edition)

Dieser Knoten generiert automatisch eine OpenAPI 3.1.0 Dokumentation für deine Node-RED HTTP-Endpunkte. Er basiert auf dem `node-red-openapi-generator`, wurde jedoch für das Frosch Work Projekt angepasst und auf den aktuellen OpenAPI 3.1.0 Standard aktualisiert.

## Features

- **OpenAPI 3.1.0 Unterstützung**: Generiert moderne API-Dokumentation im JSON-Format.
- **Integrierte Swagger UI**: Bietet eine visuelle Oberfläche zum Testen und Erkunden der API direkt in Node-RED.
- **Globale Konfiguration**: Zentrale Steuerung über die `settings.js` von Node-RED.
- **Komponenten-Management**: Einfache Definition von wiederverwendbaren Schemas und Security-Schemes.
- **Override-Funktion**: Möglichkeit, die automatisch generierte Dokumentation für einzelne Pfade durch eigenes JSON zu ersetzen.
- **Frosch Work Erweiterungen**: Zusätzliche Konfigurationsmöglichkeiten für die Integration in das Frosch Work Ökosystem.

## Installation

Der Knoten wird als Standard-Node-RED-Modul installiert. In der Frosch Work Umgebung ist er in der Regel bereits vorinstalliert.

## Konfiguration in `settings.js`

Die Konfiguration erfolgt über den Schlüssel `openapi` in der `settings.js` Datei deiner Node-RED Instanz.

```javascript
module.exports = {
    // ...
    openapi: {
        template: {
            openapi: "3.1.0",
            info: {
                title: "Meine API",
                version: "1.0.0",
                description: "API Beschreibung"
            },
            servers: [{ url: "http://localhost:1880/" }]
        },
        // Globale Parameter (verfügbar zur Auswahl im Editor)
        parameters: [
            {
                name: "X-API-Key",
                in: "header",
                required: false,
                type: "string",
                description: "Authentifizierungsschlüssel"
            }
        ],
        // Globale Komponenten (nur verfügbar zur Auswahl, nicht automatisch überall)
        components: {
            parameters: {
                parameterA: {
                    name: "parameterA",
                    in: "header",
                    required: false,
                    schema: { type: "string" },
                    description: "Ein optionaler Parameter zur manuellen Auswahl"
                }
            },
            schemas: {
                StandardError: {
                    type: "object",
                    properties: {
                        code: { type: "integer" },
                        message: { type: "string" }
                    }
                }
            },
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer"
                }
            }
        }
    }
}
```

## Parameter-Management

Alle in der `settings.js` unter `openapi.parameters` oder `openapi.components.parameters` definierten Parameter stehen im Node-RED Editor im Dropdown unter **Reference** zur Verfügung. 

**Hinweis**: Parameter werden **nur dann** in die Spezifikation eines Pfads aufgenommen, wenn sie im Node-RED Editor explizit hinzugefügt oder als Referenz ausgewählt werden. Es findet keine automatische Injektion von Parametern in alle Pfade statt.

## Verwendung

1. **Dokumentation erstellen**: Ziehe einen `openapi doc` Knoten in deinen Flow.
2. **Endpunkt verknüpfen**: Öffne einen `http in` Knoten und wähle unter dem Tab **Docs** den zuvor erstellten `openapi doc` Knoten aus.
3. **Details konfigurieren**: Im `openapi doc` Knoten kannst du Methoden, Zusammenfassungen, Tags, Parameter und Antwort-Schemas definieren.
4. **Override nutzen**: Falls die automatische Generierung nicht ausreicht, aktiviere im Tab **Override** die Option "Enable Override" und hinterlege dein eigenes OpenAPI-Path-Objekt als JSON.

## Zugriff

Die generierte Dokumentation ist über folgende URLs erreichbar:

- **JSON Spezifikation**: `/http-api/swagger.json`
- **Swagger UI**: `/swagger-ui/swagger-ui.html`

Zusätzlich findest du in der rechten Seitenleiste des Node-RED Editors den Tab **OpenAPI UI**, der dir eine direkte Vorschau bietet.

## Lizenz

Apache License 2.0
