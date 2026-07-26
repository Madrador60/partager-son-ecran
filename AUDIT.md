# Audit de sécurité et de stabilité

Audit réalisé sur la branche `agent/rebuild-madrador-remote`. Les numéros de ligne peuvent évoluer ; les zones et symboles restent indiqués.

## Critique

| Zone | Risque | Correction | Statut |
| --- | --- | --- | --- |
| `server/index.js` — origine Socket.IO | Une configuration absente acceptait toutes les origines, y compris en production. | Refus de démarrage en production sans `PUBLIC_ORIGIN`, CORS explicite et Helmet. | Corrigé |
| `main.js` — IPC | Les objets du renderer atteignaient les API système sans schéma strict ni vérification de l’émetteur. | Schémas Zod partagés, origine locale obligatoire et erreurs IPC normalisées. | Corrigé |
| `server/index.js` — fichiers | Le fichier complet transite encore en mémoire et via Socket.IO. Risque de mémoire et de saturation. | Limites et validation conservées immédiatement ; migration vers DataChannel découpé planifiée en V6.2. | Ouvert |
| Sessions | Le code à neuf chiffres et `socket.id` restent trop centraux pour une exposition publique. | Le serveur ne doit pas être exposé publiquement avant jetons cryptographiques, reprise et anti-énumération. | Ouvert |

## Élevé

| Zone | Risque | Correction | Statut |
| --- | --- | --- | --- |
| Contrôle distant | Gestion clavier incomplète et possibilité de touches/boutons bloqués après coupure. | Validation renforcée ; gestion complète `keydown`/`keyup` et relâchement global restent en V6.1. | Partiel |
| Reconnexion | Une rupture WebRTC termine trop vite la session ; aucun jeton de reprise. | Machine à états et ICE restart documentés pour V6.1. | Ouvert |
| TURN | STUN seul ne traverse pas tous les NAT ; identifiants statiques côté application possibles. | Configuration publique interdite sans infrastructure ; endpoint TURN temporaire à réaliser en V6.3. | Ouvert |
| Transfert | Pas de reprise, SHA-256, progression fiable ni écriture progressive. | Ne pas dépasser la limite configurée ; remplacement complet prévu en V6.2. | Ouvert |

## Moyen

| Zone | Risque | Correction | Statut |
| --- | --- | --- | --- |
| Qualité vidéo | Capture fixe et adaptation réseau insuffisante. | Profils et contrôleur avec hystérésis à introduire en V6.2/V6.4. | Ouvert |
| Multi-écrans | Les limites sont associées à l’écran mais le changement pendant la session est incomplet. | Métadonnées d’écran disponibles ; navigation distante à compléter. | Partiel |
| Observabilité | Logs non structurés et diagnostic incomplet. | Aucun secret journalisé ; logger structuré et métriques à ajouter. | Ouvert |
| Interface | `confirm()` est encore utilisé pour les fichiers. | Remplacer par notifications/dialogues accessibles. | Ouvert |
| Dépendances | `npm audit` remonte des vulnérabilités transitives, notamment via la pile native/image. | Examiner remplacement ou mise à jour de `nut-js`; ne pas appliquer `--force` aveuglément. | Ouvert |

## Faible

| Zone | Risque | Correction | Statut |
| --- | --- | --- | --- |
| Documentation | Fonctionnalités expérimentales auparavant présentées comme terminées. | README sépare désormais disponible et expérimental. | Corrigé |
| Dépôt | Pas de licence explicite. | Aucun badge de licence ; décision réservée au propriétaire. | Ouvert |

## Conclusion

La base convient au développement local et aux essais contrôlés. Elle ne doit pas être annoncée comme équivalente à AnyDesk ni exposée comme service public avant résolution des éléments critiques encore ouverts, en particulier sessions cryptographiques, DataChannels, TURN temporaire et reconnexion.
