# Changelog

## 6.3.0

### Aider un ami sur Internet

- serveur public par défaut (intégré à l’installeur) et serveur local en secours ;
- identifiants TURN fournis par le serveur public, mode TURN `static` pour les services hébergés ;
- bandeau « Mode local » quand aucun serveur public n’est configuré ;
- déploiement Render en un clic (`render.yaml`).

### Serveur intégré

- serveur Socket.IO/API intégré démarré automatiquement avec l’application ;
- empaquetage du serveur, du stockage de sessions et des fichiers web dans l’EXE ;

### Contrôle à distance

- Entrée, Échap, Retour arrière, flèches, raccourcis (Ctrl/Alt/Shift/Win), F1-F24, AltGr et accents ;
- clic molette corrigé, délai de 300 ms par touche supprimé ;
- entrées via DataChannels WebRTC et clics précis malgré les bandes noires.

### Sessions illimitées et stables

- serveur gardé éveillé, session maintenue si le serveur redémarre, renégociation ICE ;
- image plus nette pour le texte.

### Site et sécurité

- avertissement clair sur `/remote` sans serveur, lien de téléchargement de secours ;
- Electron 42, express 4.22.3 et correctifs de dépendances.

## 6.2.0

- validation centralisée de tous les handlers IPC Electron ;
- mode Disponible/Indisponible appliqué par le serveur ;
- jetons cryptographiques et période de grâce pour reprendre une session ;
- abstraction `SessionStore` avec implémentations mémoire et Redis ;
- identifiants TURN temporaires pour UDP, TCP et TLS ;
- diagnostics Electron anonymisables et métadonnées multi-écrans ;
- déploiement GitHub Pages avec serveur public configurable ;
- signature Windows facultative dans le workflow de Release ;
- réécriture du client Electron, du serveur et du site ;
- validation Zod partagée et durcissement Electron ;
- Helmet, CORS strict en production et CI ;
- documentation, audit et lanceur de site Windows.

## 6.0.0

- première version publique de Madrador Remote.
