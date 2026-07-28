# Audit de sécurité et de stabilité

Audit mis à jour sur la branche `codex/professional-hardening`. Les numéros de ligne peuvent évoluer ; les zones et symboles restent indiqués.

## Critique

| Zone | Risque | Correction | Statut |
| --- | --- | --- | --- |
| `server/index.js` — origine Socket.IO | Une configuration absente acceptait toutes les origines, y compris en production. | Refus de démarrage en production sans `PUBLIC_ORIGIN`, CORS explicite et Helmet. | Corrigé |
| `main.js` — IPC | Cinq handlers contournaient encore la vérification d’origine. | Tous les handlers passent obligatoirement par `createTrustedIpc`; test de refus ajouté. | Corrigé |
| `server/index.js` — fichiers | Le fichier complet transite encore en mémoire et via Socket.IO. Risque de mémoire et de saturation. | Limites et validation conservées immédiatement ; migration vers DataChannel découpé planifiée en V6.2. | Ouvert |
| Sessions | Le code à neuf chiffres et `socket.id` étaient trop centraux pour une exposition publique. | Identifiant UUID interne, jetons de reprise 256 bits, délai de grâce et `SessionStore` Memory/Redis. L’anti-énumération distribuée reste à renforcer. | Partiel |

## Élevé

| Zone | Risque | Correction | Statut |
| --- | --- | --- | --- |
| Contrôle distant | Gestion clavier incomplète et possibilité de touches/boutons bloqués après coupure. | Validation renforcée ; gestion complète `keydown`/`keyup` et relâchement global restent en V6.1. | Partiel |
| Reconnexion | Une rupture supprimait immédiatement la session. | Période de grâce, rattachement Socket.IO par jeton, conservation des permissions et `restartIce()`. Reprise de transfert reste ouverte. | Partiel |
| TURN | STUN seul ne traverse pas tous les NAT et le secret risquait d’être exposé. | `/api/ice` génère des identifiants HMAC temporaires pour les URL UDP/TCP/TLS. Le déploiement Coturn réel reste externe. | Partiel |
| Disponibilité | Le bouton ne changeait que l’interface. | Le serveur refuse création et demandes quand l’hôte est indisponible; tests d’intégration ajoutés. | Corrigé |
| Démarrage serveur | L’utilisateur devait lancer manuellement `npm run server`. | Electron démarre et arrête un serveur intégré, réutilise une instance locale existante et sélectionne un port libre en cas de conflit. | Corrigé |
| Transfert | Pas de reprise, SHA-256, progression fiable ni écriture progressive. | Ne pas dépasser la limite configurée ; remplacement complet prévu en V6.2. | Ouvert |

## Moyen

| Zone | Risque | Correction | Statut |
| --- | --- | --- | --- |
| Qualité vidéo | Capture fixe et adaptation réseau insuffisante. | Profils et contrôleur avec hystérésis à introduire en V6.2/V6.4. | Ouvert |
| Multi-écrans | Les limites sont associées à l’écran mais le changement pendant la session est incomplet. | Miniature, résolution, facteur d’échelle, rotation et écran principal sont exposés ; changement à chaud à compléter. | Partiel |
| Observabilité | Logs non structurés et diagnostic incomplet. | Export JSON anonymisé avec versions, système, GPU, Socket.IO, WebRTC et média; métriques réseau détaillées à compléter. | Partiel |
| Interface | `confirm()` est encore utilisé pour les fichiers. | Remplacer par notifications/dialogues accessibles. | Ouvert |
| Dépendances | `npm audit` remonte des vulnérabilités transitives, notamment via la pile native/image. | Examiner remplacement ou mise à jour de `nut-js`; ne pas appliquer `--force` aveuglément. | Ouvert |

## Faible

| Zone | Risque | Correction | Statut |
| --- | --- | --- | --- |
| Documentation | Fonctionnalités expérimentales auparavant présentées comme terminées. | README sépare désormais disponible et expérimental. | Corrigé |
| Dépôt | Pas de licence explicite. | Aucun badge de licence ; décision réservée au propriétaire. | Ouvert |

## Conclusion

La base est renforcée mais reste un produit en développement. Les validations sur deux
machines, plusieurs NAT/FAI, Coturn réel, Redis multi-instance, transferts repris et
contrôle clavier complet restent nécessaires avant toute comparaison commerciale.
