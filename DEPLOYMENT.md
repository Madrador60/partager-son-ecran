# Déploiement

Le serveur local est destiné au développement. En production :

1. définir `NODE_ENV=production` et une origine HTTPS exacte dans `PUBLIC_ORIGIN` ;
2. placer Node derrière un reverse proxy HTTPS compatible WebSocket ;
3. déployer Coturn en UDP/TCP/TLS, idéalement sur le port 443 en secours ;
4. conserver les secrets dans le gestionnaire de secrets de l’hébergeur ;
5. ajouter Redis avant tout déploiement multi-instance ;
6. surveiller `/api/health`, la mémoire, les erreurs et la disponibilité TURN.

Les hébergeurs qui mettent les services en veille peuvent interrompre les sessions. Aucun déploiement public ne doit être effectué avant l’ajout d’identifiants TURN temporaires et de jetons de reprise.
