# Déploiement

## Pourquoi un serveur public ?

Le serveur intégré à l’application écoute uniquement sur `127.0.0.1` : il permet de
tester sur un seul PC, mais **un ami sur une autre connexion Internet ne peut pas le
joindre**. Pour aider quelqu’un à distance, les deux applications doivent utiliser le
même serveur public. Ce serveur ne sert qu’à se retrouver (code, demande, échange
SDP/ICE) : l’image et le contrôle passent ensuite directement entre les deux PC via
WebRTC chiffré.

Il n’y a **aucune limite de durée** : avec « Illimitée » (valeur par défaut), la session
reste ouverte tant que l’un des deux ne l’arrête pas.

## 1. Héberger le serveur gratuitement sur Render

1. Créer un compte sur <https://render.com> (connexion avec GitHub).
2. **New › Blueprint**, choisir le dépôt `partager-son-ecran` : Render lit `render.yaml`.
3. Valider. Après le build, Render donne une adresse du type
   `https://madrador-signal.onrender.com`.
4. Vérifier que `https://…onrender.com/api/health` répond `{"ok":true,...}`.

Le plan gratuit met le service en veille après 15 minutes sans requête HTTP. Quand
un code est actif, l’application envoie un signal toutes les 4 minutes pour l’en
empêcher. Le tout premier démarrage après une veille peut prendre environ 50 secondes.
Si le serveur redémarre pendant une session, l’écran et le contrôle continuent (la
liaison est directe). Seuls le chat et les fichiers attendent la session suivante.

## 2. Ajouter un relais TURN (fortement conseillé)

Sans TURN, environ 1 connexion sur 5 échoue : 4G, box en NAT strict, réseaux
d’entreprise. Option gratuite : créer un compte « Open Relay » sur
<https://www.metered.ca/stun-turn>, puis renseigner dans Render (Environment) :

| Variable | Valeur |
| --- | --- |
| `MADRADOR_TURN_MODE` | `static` |
| `MADRADOR_TURN_URL` | les URL fournies, séparées par des virgules (`turn:…:80,turn:…:443,turns:…:443?transport=tcp`) |
| `MADRADOR_TURN_USERNAME` | identifiant fourni |
| `MADRADOR_TURN_CREDENTIAL` | mot de passe fourni |

Avec votre propre Coturn (`use-auth-secret`), utilisez `MADRADOR_TURN_MODE=hmac` :
le serveur génère alors des identifiants temporaires et le secret n’est jamais exposé.

## 3. Intégrer l’adresse dans l’application

**Tout de suite, sans nouvelle version** : dans l’application, sur les deux PC,
ouvrir Paramètres › Connexion, coller l’adresse Render puis cliquer sur
« Enregistrer et redémarrer ».

**Pour tous les futurs installeurs** : dans GitHub › Settings › Secrets and variables ›
Actions › Variables, créer :

- `MADRADOR_SIGNAL_URL` = `https://madrador-signal.onrender.com`
- `MADRADOR_PUBLIC_API_URL` = la même adresse

Le workflow Release l’écrit dans `package.json` (`madrador.signalUrl`) avant le build.
Les amis n’ont alors plus rien à configurer : ils installent, donnent leur code, et
c’est tout. Le site GitHub Pages utilise aussi ces variables.

## Production avancée

1. définir `NODE_ENV=production` et une origine HTTPS exacte dans `PUBLIC_ORIGIN` ;
2. placer Node derrière un reverse proxy HTTPS compatible WebSocket (`trust proxy` est
   activé automatiquement en production) ;
3. définir `REDIS_URL` pour utiliser `RedisSessionStore` ; sinon `MemorySessionStore` ;
4. surveiller `/api/health`, la mémoire, les erreurs et la disponibilité TURN.

La signature Authenticode est recommandée mais facultative. Si `WIN_CSC_LINK` et
`WIN_CSC_KEY_PASSWORD` existent, Electron Builder signe la Release. Sinon le build
continue avec un avertissement et SmartScreen peut afficher « Éditeur inconnu ».
