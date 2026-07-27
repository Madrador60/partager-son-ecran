# Sécurité

Ne publiez pas une vulnérabilité dans une issue publique. Contactez directement le propriétaire du dépôt avec une description, les étapes de reproduction et l’impact estimé.

Le projet impose consentement visible, permissions de session, isolation Electron, sandbox Chromium, CSP, validation IPC et limites serveur. WebRTC chiffre les flux en transit, mais le code à neuf chiffres n’est pas suffisant comme unique secret pour un service public.

Ne commitez jamais `.env`, identifiants TURN, jetons, SDP complets ou contenu utilisateur. Une exposition Internet nécessite HTTPS, CORS strict, TURN temporaire, limitation distribuée et supervision.

Tous les handlers Electron passent par le middleware `createTrustedIpc`, qui refuse
les appels ne provenant pas de l’interface locale empaquetée. Les sessions disposent
de jetons de reprise aléatoires et d’une période de grâce configurable.

La signature Windows améliore l’identité de l’éditeur et réduit progressivement les
alertes SmartScreen, mais elle n’est pas obligatoire pour construire, publier ou
mettre à jour l’application. Une Release non signée reste fonctionnelle.
