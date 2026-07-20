# Madrador Remote V6

Application Windows d'assistance à distance visible et soumise à l'accord explicite du PC distant.

## Installation développeur

```bash
npm install
npm run verify
npm start
```

## Connexion entre deux PC

Les deux applications doivent utiliser le même serveur de signalisation. Dans **Paramètres > Serveur de connexion**, saisissez la même URL HTTPS sur les deux ordinateurs. Le serveur peut être lancé séparément avec :

```bash
PORT=3000 npm run server
```

Pour une connexion Internet fiable derrière certains routeurs, ajoutez aussi un serveur TURN dans la configuration WebRTC. Le STUN public seul ne garantit pas toutes les connexions.

## Créer et publier Windows

Sous Windows, lancez `PUBLICATION-TOTALE.bat`. Le script vérifie le code, crée l'installateur, publie le dépôt, puis tente de publier l'EXE dans une Release. Un échec de Release n'annule plus le build ni le push Git.

GitHub Actions reconstruit aussi automatiquement l'installateur à chaque push sur `main`.

## Sécurité

- validation manuelle obligatoire avant chaque session ;
- permissions séparées pour contrôle, presse-papiers, fichiers et audio ;
- contrôle désactivé par défaut ;
- contexte Electron isolé et Node désactivé dans la page ;
- codes temporaires et expiration automatique ;
- aucune fonction furtive ou connexion silencieuse.
