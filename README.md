# Madrador Remote

Madrador Remote est une base d’assistance à distance pour Windows inspirée du fonctionnement d’AnyDesk, avec consentement visible à chaque session.

Le dépôt contient trois parties :

- `public/` : interface de l’application Electron ;
- `server/` : serveur de signalisation Socket.IO ;
- `website/` : site public de présentation et de téléchargement.

## Développement

Prérequis : Node.js 22 et Windows 10 ou 11.

```powershell
npm install
npm run verify
npm run server
npm start
```

Par défaut, l’application utilise `http://127.0.0.1:3000`. Pour deux ordinateurs sur Internet, déployez le serveur derrière HTTPS puis configurez la même adresse dans les paramètres des deux applications.

## Configuration

Copiez `.env.example` vers `.env` sur le serveur et configurez :

- `PORT` et `HOST` pour l’écoute HTTP ;
- `PUBLIC_ORIGIN` avec le domaine public autorisé ;
- `MAX_FILE_MB` pour la limite des fichiers ;
- `MADRADOR_SIGNAL_URL` dans l’environnement de l’application ;
- les variables `MADRADOR_TURN_*` pour un serveur TURN en production.

## Validation et distribution

```powershell
npm run verify
npm run build
```

Un tag Git `v*` déclenche la création de l’installeur Windows et d’une release GitHub compatible avec la mise à jour automatique.

## Limites actuelles

Cette version constitue un MVP fonctionnel, pas encore un remplacement complet d’AnyDesk. Une exploitation publique exige notamment un serveur TURN, TLS, une politique d’utilisation, de la supervision et des tests sur plusieurs réseaux et écrans.
