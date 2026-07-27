# Déploiement

Le serveur local est destiné au développement. En production :

1. définir `NODE_ENV=production` et une origine HTTPS exacte dans `PUBLIC_ORIGIN` ;
2. placer Node derrière un reverse proxy HTTPS compatible WebSocket ;
3. déployer Coturn en UDP/TCP/TLS, idéalement sur le port 443 en secours ;
4. conserver les secrets dans le gestionnaire de secrets de l’hébergeur ;
5. définir `REDIS_URL` pour utiliser `RedisSessionStore` en production ; sans cette variable, `MemorySessionStore` est utilisé ;
6. surveiller `/api/health`, la mémoire, les erreurs et la disponibilité TURN.

Les identifiants TURN retournés par `/api/ice` sont temporaires : le serveur transforme
`MADRADOR_TURN_CREDENTIAL` en mot de passe HMAC à durée courte et ne l’expose jamais.
Configurez les URL UDP, TCP et TLS dans `MADRADOR_TURN_URL`.

Pour GitHub Pages, créez les variables de dépôt `MADRADOR_PUBLIC_API_URL` et
`MADRADOR_SIGNAL_URL`, puis autorisez exactement `https://madrador60.github.io`
dans `PUBLIC_ORIGIN` sur Render.

La signature Authenticode est recommandée mais facultative. Si `WIN_CSC_LINK` et
`WIN_CSC_KEY_PASSWORD` existent, Electron Builder signe la Release. Sinon le build
continue avec un avertissement et SmartScreen peut afficher « Éditeur inconnu ».
