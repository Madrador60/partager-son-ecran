# Changelog

## 6.4.2

- Si la connexion n’aboutit pas en 25 secondes, l’application et la version web expliquent pourquoi (réseau qui bloque la liaison directe) et quoi faire, au lieu de rester sur « Connexion… ».
- Relais TURN (Metered) activé sur le serveur public : les connexions en 4G ou derrière une box stricte passent désormais par le relais.

## 6.4.1

- **QR code** à côté du code : scannez-le avec un téléphone pour ouvrir la version web et se connecter directement.
- Lien `…/remote?code=123456789` : la page web se connecte toute seule.
- **Version web au doigt** : toucher = clic, appui long = clic droit, glisser = déplacer, bouton « Taper » pour le clavier du téléphone.
- **Correctif** : connexion qui restait bloquée entre deux PC sur la même box (adresses locales masquées par Chromium).
- **Correctif** : image noire sur téléphone (lecture automatique avec son refusée) ; l’image démarre sans son, un appui sur « Son » l’active.

## 6.4.0

### Nouveautés
- **Changer d’écran pendant la session** : l’aidant choisit l’écran 1 ou 2 de son ami depuis le menu « Écran » ; l’ami peut aussi cliquer sur « Changer d’écran ».
- **Son de l’ordinateur partagé** (option) : vidéos, alertes, musique ; bouton « Son » pour le couper chez l’aidant.
- **Gros fichiers jusqu’à 2 Go**, envoyés en direct entre les deux PC avec barre de progression, vitesse et temps restant ; écriture directe sur le disque et bouton « Afficher dans le dossier ».

### Corrections
- **Connexion bloquée sur « Connexion… »** : l’offre de l’hôte pouvait arriver avant que l’aidant soit prêt et était perdue. Elle est maintenant conservée puis rejouée.
- La validation sur `main` n’essaie plus de republier l’installeur.

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
