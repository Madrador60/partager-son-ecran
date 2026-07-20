# RemoteAssist Ultimate V3

Application d’assistance à distance visible avec consentement explicite.

## Fonctions intégrées

- code temporaire à 9 chiffres ;
- demande d’autorisation visible ;
- partage d’écran ou de fenêtre ;
- contrôle clavier/souris facultatif ;
- profils 720p60, 1080p60, 1080p120 cible et 1440p60 ;
- adaptation automatique au réseau ;
- statistiques FPS, ping, débit, pertes, codec et résolution ;
- chat ;
- presse-papiers autorisé séparément ;
- transfert de fichiers avec proposition et acceptation, limité à 25 Mo ;
- plusieurs écrans via le sélecteur de sources ;
- capture audio facultative selon la prise en charge Windows/Electron ;
- historique local ;
- expiration du code ;
- sauvegarde de l’ancien app.js pendant l’installation.

## Installation

1. Installer Node.js.
2. Lancer `INSTALLER-MISE-A-JOUR-TOTALE.bat`.
3. Lancer `LANCER-EN-TEST.bat`.
4. Pour créer l’installateur Windows : `INSTALLER-ET-CREER-EXE.bat`.

## Limites honnêtes

Cette version est une application Electron/WebRTC complète, mais ce n’est pas encore
un moteur natif équivalent à AnyDesk. Le vrai 120 FPS constant et la latence minimale
nécessitent un module Windows natif Direct3D avec NVENC, AMF ou Quick Sync, ainsi
qu’un serveur public de signalisation et TURN pour les connexions Internet hors LAN.

Aucun accès caché, aucune connexion silencieuse et aucun contournement des autorisations
Windows ne sont inclus.