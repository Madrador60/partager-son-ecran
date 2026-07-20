# Madrador Remote V4

Application d’assistance à distance visible et autorisée, avec identité Madrador.

## Nouveautés

- logo `image.png` intégré dans l’interface et l’installateur Windows ;
- fenêtre lancée automatiquement maximisée ;
- interface sombre professionnelle inspirée des logiciels d’assistance modernes ;
- barre de connexion rapide en haut ;
- code temporaire à 9 chiffres ;
- écran d’autorisation détaillé avant chaque connexion ;
- permissions séparées pour clavier/souris, documents, presse-papiers et audio ;
- transfert de documents par sélection ou glisser-déposer ;
- demande d’acceptation avant la réception d’un document ;
- presse-papiers texte et images ;
- chat ;
- historique local ;
- multi-écran et sélection de fenêtre ;
- statistiques réseau et vidéo ;
- profils automatiques, 120 FPS cible, 1080p60, 1440p60 et 720p ;
- installateur Windows avec icône Madrador.

## Installation

1. Décompresser le ZIP.
2. Lancer `INSTALLER-MADRADOR-V4.bat`.
3. Lancer `LANCER-EN-TEST.bat`.
4. Pour produire le Setup Windows, lancer `INSTALLER-ET-CREER-EXE.bat`.

## Sécurité

La connexion distante nécessite toujours une acceptation visible. Les permissions sont
affichées séparément et peuvent être refusées. Aucun accès caché ou silencieux n’est inclus.

## Limites

La connexion par Internet hors réseau local exige encore un serveur public de signalisation
et un serveur TURN. Le 120 FPS est un objectif WebRTC et dépend du GPU, du réseau et de
l’écran ; il n’est pas garanti comme avec un moteur natif Direct3D/NVENC.