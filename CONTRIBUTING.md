# Contribution

Créez une branche courte, limitez chaque pull request à un sujet et décrivez le risque utilisateur. Avant publication :

```powershell
npm ci
npm run verify
npm run build
```

Toute modification des sessions, permissions, IPC, fichiers ou entrées distantes doit inclure des tests. Ne placez jamais de secrets ni de données de session dans les logs ou fixtures.
