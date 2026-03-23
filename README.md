# BlindTest

Application de blindtest en temps réel pour soirées entre amis. Hébergeable gratuitement sur Render.

## Fonctionnalités

### Côté animateur
- Créer une partie et obtenir un **code à 6 caractères** à communiquer aux joueurs
- Voir les joueurs rejoindre en temps réel
- Créer des **équipes** colorées et y assigner les joueurs
- **Lecteur YouTube intégré** : charger une vidéo ou une playlist par URL
- **Synchronisation automatique** du lecteur vers tous les joueurs (play, pause, piste suivante/précédente)
- **Pause automatique** dès qu'un joueur buzze
- Valider ou invalider une réponse (attribution automatique du point)
- Modifier les scores manuellement (+1, −1, +5, −5)
- Gérer les manches
- Classement en temps réel

### Côté joueur
- Rejoindre avec le code de la partie + choisir un pseudo
- **Buzzer XXL** (toute la largeur, feedback haptique sur mobile)
- Dès que quelqu'un buzze : buzzer bloqué pour tout le monde, affichage de "X a buzzé !"
- Lecteur YouTube synchronisé (optionnel, affiché/masqué à la demande)
- Mini-classement en bas d'écran

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Serveur   | Node.js + Express |
| Temps réel | Socket.io |
| Frontend  | HTML/CSS/JS vanilla |
| Lecteur   | YouTube IFrame API |
| Hébergement | Render (free tier) |

Pas de base de données — tout est stocké en mémoire. Les parties disparaissent si le serveur redémarre (acceptable pour un usage entre amis).

## Installation locale

```bash
git clone <repo>
cd blindtest
npm install
npm start
# Ouvrir http://localhost:3000
```

Pour le développement avec rechargement automatique :

```bash
npm run dev
```

## Déploiement sur Render

1. Créer un dépôt Git et y pousser le projet
2. Sur [render.com](https://render.com) : **New → Web Service**
3. Connecter le dépôt
4. Render détecte automatiquement le `render.yaml` et configure le service

> **Note Render gratuit** : le serveur se met en veille après 15 min d'inactivité. La première connexion peut prendre ~30 secondes le temps du "cold start".

## Utilisation

### Lancer une partie

1. L'animateur ouvre `/host.html` (ou clique "Animateur" sur l'accueil)
2. Cliquer **Créer la partie** → un code à 6 lettres s'affiche
3. Communiquer le code aux joueurs (vocal, SMS, etc.)

### Rejoindre

1. Les joueurs ouvrent l'URL de l'app (ou `/player.html`)
2. Entrer le code + choisir un pseudo
3. Attendre que l'animateur démarre

### Déroulement d'une manche

1. L'animateur charge une URL YouTube (vidéo ou playlist) et appuie **Play** → la musique démarre pour tout le monde
2. Les joueurs appuient sur le **buzzer** dès qu'ils reconnaissent le morceau
3. Le premier à buzzer **pause automatiquement la musique** chez tout le monde
4. L'animateur valide (✅ +1 pt) ou invalide (❌) la réponse
5. Cliquer **Débloquer** pour remettre les buzzers actifs et reprendre la musique

### Équipes (optionnel)

1. Dans la colonne droite, cliquer **+ Équipe**, donner un nom et une couleur
2. Assigner les joueurs aux équipes via le menu déroulant
3. Les scores d'équipe sont gérables indépendamment (+/− dans la liste des équipes)

## Structure du projet

```
blindtest/
├── server.js              # Serveur Express + logique Socket.io
├── package.json
├── render.yaml            # Configuration déploiement Render
└── public/
    ├── index.html         # Page d'accueil
    ├── host.html          # Interface animateur
    ├── player.html        # Interface joueur
    ├── css/
    │   └── styles.css
    └── js/
        ├── host.js        # Logique animateur
        └── player.js      # Logique joueur
```

## Événements Socket.io

| Événement | Émetteur | Description |
|-----------|----------|-------------|
| `create-room` | Animateur | Crée une room, retourne le code |
| `join-room` | Joueur | Rejoint une room avec code + pseudo |
| `set-status` | Animateur | Change le statut (`lobby`, `playing`, `paused`, `finished`) |
| `buzz` | Joueur | Déclenche un buzz (bloque tous les autres) |
| `reset-buzz` | Animateur | Débloque les buzzers |
| `update-score` | Animateur | Modifie le score d'un joueur |
| `update-team-score` | Animateur | Modifie le score d'une équipe |
| `create-team` | Animateur | Crée une équipe |
| `assign-team` | Animateur | Assigne un joueur à une équipe |
| `kick-player` | Animateur | Exclut un joueur |
| `youtube-sync` | Animateur / Serveur | Synchronise le lecteur YouTube (play/pause/seek/load) |
| `update-round` | Animateur | Change le numéro de manche |

## Notes sur la synchronisation YouTube

Le lecteur YouTube est synchronisé via Socket.io :
- L'animateur contrôle la lecture depuis son interface
- Chaque action (play, pause, vidéo suivante) est diffusée à tous les joueurs
- **La musique se met en pause automatiquement** dès qu'un buzz est détecté

Les joueurs peuvent afficher ou masquer le lecteur avec le bouton "Afficher le lecteur". Par défaut, leur lecteur est muet (le son vient de l'animateur partagé via vocal Discord/Zoom/etc.).

Si YouTube bloque la lecture automatique dans certains navigateurs, l'animateur peut simplement partager son son via l'outil vocal de la soirée.
