# Madrador Remote

[![Validation](https://github.com/Madrador60/partager-son-ecran/actions/workflows/ci.yml/badge.svg)](https://github.com/Madrador60/partager-son-ecran/actions/workflows/ci.yml)
[![Dernière version](https://img.shields.io/github/v/release/Madrador60/partager-son-ecran)](https://github.com/Madrador60/partager-son-ecran/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-2161f5)](https://github.com/Madrador60/partager-son-ecran/releases/latest)

Application Windows d’assistance à distance visible et consentie. Madrador Remote permet de partager un écran, contrôler un poste autorisé, discuter et échanger des fichiers ou du texte.

> Madrador Remote est actuellement un MVP. Il ne remplace pas encore un service commercial comme AnyDesk et ne doit pas être utilisé pour un accès furtif ou sans consentement.

## Télécharger

Téléchargez l’installeur depuis la page [Dernière version](https://github.com/Madrador60/partager-son-ecran/releases/latest).

## Fonctionnalités

- code temporaire à neuf chiffres ;
- approbation obligatoire sur le PC partagé ;
- choix de l’écran ou de la fenêtre ;
- contrôle clavier et souris révocable ;
- prise en charge des écrans secondaires ;
- discussion, presse-papiers texte et fichiers jusqu’à 25 Mo ;
- permissions séparées pour chaque session ;
- arrêt immédiat depuis les deux ordinateurs.

## Structure du dépôt

| Dossier | Rôle |
| --- | --- |
| `public/` | Interface de l’application Electron |
| `server/` | Serveur de signalisation Socket.IO |
| `website/` | Site public de présentation |
| `scripts/` | Tests, sécurité et diagnostic |

## Lancer le site localement

Sous Windows, double-cliquez sur `LANCER-LE-SITE.bat`. Le script installe les dépendances si nécessaire, ouvre `http://127.0.0.1:3000` et garde le serveur actif jusqu’à la fermeture de la fenêtre.

## Développement

Prérequis : Node.js 22, npm et Windows 10 ou 11.

```powershell
npm install
npm run verify
```

Utilisez ensuite deux terminaux.

Terminal 1 — serveur et site :

```powershell
npm run server
```

Terminal 2 — application :

```powershell
npm start
```

L’application utilise `http://127.0.0.1:3000` par défaut.

## Configuration Internet

Copiez `.env.example` vers `.env`. Le fichier est chargé automatiquement au démarrage et reste exclu de Git.

```powershell
Copy-Item .env.example .env
```

Variables principales :

| Variable | Utilisation |
| --- | --- |
| `PORT`, `HOST` | Adresse d’écoute du serveur |
| `PUBLIC_ORIGIN` | Domaine HTTPS autorisé |
| `MAX_FILE_MB` | Taille maximale d’un fichier |
| `MADRADOR_SIGNAL_URL` | URL HTTPS du serveur utilisée par l’application |
| `MADRADOR_TURN_URL` | Adresse du serveur TURN |
| `MADRADOR_TURN_USERNAME` | Identifiant TURN |
| `MADRADOR_TURN_CREDENTIAL` | Secret TURN |

Pour une utilisation entre deux réseaux différents, configurez impérativement HTTPS et un serveur TURN. Un serveur STUN seul ne garantit pas la connexion.

## Tests et création de l’installeur

```powershell
npm run verify
npm run build
```

La validation contrôle la syntaxe, le serveur, la création et l’approbation d’une session, les fichiers indispensables au packaging et les protections Electron. Un tag Git `v*` crée automatiquement une release et son installeur Windows.

## Sécurité

- aucune connexion silencieuse ;
- isolation et sandbox du renderer Electron ;
- API système limitée au preload ;
- validation de l’appartenance à chaque session ;
- expiration automatique des codes ;
- contrôle désactivé à l’arrêt ;
- taille des échanges limitée ;
- secrets exclus du dépôt.

## Limites connues

- aucun serveur public ou TURN n’est fourni par ce dépôt ;
- l’application n’est pas encore signée avec un certificat public ;
- les environnements multi-écrans et multi-réseaux doivent encore être testés à grande échelle ;
- aucune licence open source n’est accordée tant qu’un fichier `LICENSE` n’a pas été choisi par le propriétaire.

## Liens

- [Dépôt GitHub](https://github.com/Madrador60/partager-son-ecran)
- [Pull requests](https://github.com/Madrador60/partager-son-ecran/pulls)
- [Releases](https://github.com/Madrador60/partager-son-ecran/releases)
- [Rapporter un problème](https://github.com/Madrador60/partager-son-ecran/issues/new)
