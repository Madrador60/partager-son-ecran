# Sécurité

Ne publiez pas une vulnérabilité dans une issue publique. Contactez directement le propriétaire du dépôt avec une description, les étapes de reproduction et l’impact estimé.

Le projet impose consentement visible, permissions de session, isolation Electron, sandbox Chromium, CSP, validation IPC et limites serveur. WebRTC chiffre les flux en transit, mais le code à neuf chiffres n’est pas suffisant comme unique secret pour un service public.

Ne commitez jamais `.env`, identifiants TURN, jetons, SDP complets ou contenu utilisateur. Une exposition Internet nécessite HTTPS, CORS strict, TURN temporaire, limitation distribuée et supervision.
