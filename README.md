# RemoteAssist

Application Windows d’assistance à distance avec :

- identifiant de session ;
- mot de passe temporaire ;
- validation visible avant connexion ;
- choix manuel de l’écran ;
- partage vidéo jusqu’à 60 images/seconde selon la machine et le réseau ;
- contrôle clavier/souris désactivé par défaut ;
- bouton visible pour autoriser ou couper le contrôle ;
- installateur Windows `.exe`.

## Installation

1. Installe Node.js LTS.
2. Double-clique sur `INSTALLER-ET-CREER-EXE.bat`.
3. Récupère l’installateur dans le dossier `dist`.
4. Installe le même `.exe` sur les deux PC.

## Utilisation

### PC à contrôler

1. Ouvre RemoteAssist.
2. Clique sur **Créer une session**.
3. Clique sur **Choisir l’écran à partager**.
4. Transmets l’adresse locale, l’identifiant et le mot de passe.
5. Accepte la demande de connexion.
6. Coche **Autoriser clavier et souris** seulement si tu veux donner le contrôle.

### Deuxième PC

1. Ouvre RemoteAssist.
2. Entre l’adresse du premier PC.
3. Entre son identifiant et son mot de passe.
4. Clique sur **Demander la connexion**.
5. Attends que le premier PC accepte.

## Sécurité et limites

- Aucun fonctionnement caché.
- Aucun démarrage automatique silencieux.
- Aucun contournement des autorisations Windows ou de l’UAC.
- Le contrôle est visible et désactivé par défaut.
- Cette version est prévue d’abord pour le même réseau local.
- Pour fonctionner facilement par Internet, il faut ajouter un serveur public HTTPS et un relais TURN.
- Certaines touches spéciales et certains écrans administrateur Windows peuvent rester inaccessibles.
