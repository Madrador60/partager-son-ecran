# Changelog

## En développement

- réécriture du client Electron, du serveur et du site ;
- validation Zod partagée et durcissement Electron ;
- Helmet, CORS strict en production et CI ;
- documentation, audit et lanceur de site Windows.

## 6.0.0

- première version publique de Madrador Remote.
# Changements non publiés

- validation centralisée de tous les handlers IPC Electron ;
- mode Disponible/Indisponible appliqué par le serveur ;
- jetons cryptographiques et période de grâce pour reprendre une session ;
- abstraction `SessionStore` avec implémentations mémoire et Redis ;
- identifiants TURN temporaires pour UDP, TCP et TLS ;
- diagnostics Electron anonymisables et métadonnées multi-écrans ;
- déploiement GitHub Pages avec serveur public configurable ;
- signature Windows facultative dans le workflow de Release.
