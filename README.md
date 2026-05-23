# Multiplayer Quiz MVP

Socle technique TypeScript pour une application web de quiz multijoueur en rooms.

## Architecture

- `apps/web` : frontend Next.js App Router.
- `apps/api` : backend NestJS, Socket.IO, Prisma.
- `packages/shared` : types communs et payloads Socket.IO.
- `packages/game-core` : interfaces de moteur, registre de modes, `ClassicMode`, `GameEngine`.
- `docker-compose.yml` : PostgreSQL et Redis.

## Concepts métier

- `Room` : lobby rejoint via un code court.
- `GameSession` : partie lancée depuis une room.
- `GameMode` : règles d'un mode de jeu.
- `GameEngine` : orchestration générique, sans règles spécifiques au mode.
- `ClassicMode` : premier mode implémenté.

Le serveur est autoritaire pour les réponses, les scores et les timers. L'état live des sessions est stocké dans Redis via `LiveStateService`; PostgreSQL garde les entités durables.

## Installation

Sur macOS, ouvre un terminal puis place-toi d'abord dans le dossier du projet :

```bash
cd "/Users/clemcoop/Documents/Codex/2026-05-21/je-veux-d-marrer-une-application"
```

Les commandes suivantes doivent être lancées depuis ce dossier. Si tu restes dans `~`, la commande `cp .env.example .env` échouera parce que le fichier appartient au projet.

Si `npm`, `pnpm` ou `cp` affichent `EPERM: operation not permitted, uv_cwd` ou `Operation not permitted`, le terminal n'a probablement pas accès au dossier `Documents`. Dans macOS, ouvre `Réglages Système > Confidentialité et sécurité > Accès complet au disque`, ajoute `Terminal` ou ton application de terminal, puis ferme et rouvre le terminal.

```bash
pnpm --version
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

Si `pnpm --version` affiche `command not found`, installe pnpm une seule fois :

```bash
npm install -g pnpm
```

Si Prisma affiche `ENOSPC: no space left on device`, libère un peu d'espace disque puis relance la génération. Sur macOS, commence par ces commandes non destructrices pour les projets :

```bash
pnpm store prune
rm -rf ~/node_modules ~/pnpm-lock.yaml ~/package.json
```

La deuxième commande enlève seulement les fichiers créés par erreur dans ton dossier personnel si tu avais lancé `pnpm install` depuis `~`.

## Lancer PostgreSQL et Redis

Sur macOS, la commande `docker` est disponible seulement si Docker Desktop est installé et lancé.

Si `docker compose up -d` affiche `zsh: command not found: docker`, installe Docker Desktop depuis [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/), ouvre l'application une première fois, puis relance ton terminal.

```bash
docker compose up -d
docker compose exec postgres pg_isready -U quiz -d quiz
```

Si `pg_isready` répond `no response`, attends quelques secondes puis relance la même commande. Quand il répond `accepting connections`, tu peux lancer les migrations.

Sur Mac Apple Silicon, si les logs PostgreSQL affichent `exec format error`, supprime l'image Docker PostgreSQL locale puis retélécharge-la :

```bash
docker compose down
docker image rm postgres:16
docker compose pull postgres
docker compose up -d
```

## Migrer la base

```bash
pnpm db:generate
pnpm db:migrate
```

Après une modification du schéma Prisma, relance `pnpm db:migrate` avant de redémarrer l'API.

## Lancer le projet

```bash
pnpm dev
```

Par défaut :

- Web : `http://localhost:3000`
- API : `http://localhost:4000`
- PostgreSQL : `localhost:5433`
- Redis : `localhost:6379`

## Tester une partie locale

1. Ouvrir `http://localhost:3000/quiz/new`.
2. Créer le quiz de démonstration.
3. La page redirige vers `/room/[code]`.
4. Ouvrir la même URL dans une deuxième fenêtre ou un autre navigateur.
5. Dans chaque fenêtre, entrer un nom et cliquer sur `Rejoindre`.
6. Cliquer sur `Lancer`.
7. Chaque joueur répond aux questions.
8. Les scores finaux sont affichés à la fin de la partie.

## Tests

Les tests unitaires ciblent le coeur métier :

```bash
pnpm --filter @quiz/game-core test
```

## Mise en ligne gratuite pour MVP

Pour 2 ou 3 utilisateurs de test, tu peux normalement rester sur des offres gratuites. Le coût initial peut être de `0 €`, avec ces limites :

- l'API gratuite Render peut se mettre en veille après environ 15 minutes sans trafic ;
- le premier accès après veille peut prendre une minute ;
- les quotas gratuits de base de données/cache restent suffisants pour un petit MVP, mais pas pour une vraie production.

Stack recommandée pour démarrer sans payer :

- Web Next.js : Vercel Hobby.
- API NestJS + Socket.IO : Render Free Web Service.
- PostgreSQL : Neon Free.
- Redis : Upstash Redis Free.

### Préparer le code

Le projet doit être dans un dépôt GitHub. Une fois le dépôt créé, pousse cette version :

```bash
git init
git add .
git commit -m "Prepare MVP deployment"
git branch -M main
git remote add origin <URL_DU_REPO_GITHUB>
git push -u origin main
```

### Créer les services externes

1. Crée une base PostgreSQL sur Neon.
2. Copie la connection string PostgreSQL. Elle ressemble à `postgresql://...neon.tech/...?...sslmode=require`.
3. Crée une base Redis sur Upstash.
4. Copie le `Redis URL` TCP, pas l'URL REST. Il ressemble à `rediss://default:...@...upstash.io:6379`.

### Déployer l'API sur Render

Dans Render :

1. Crée un nouveau `Blueprint` depuis le repo GitHub, ou un `Web Service` Node.js.
2. Si tu utilises le blueprint, Render lit le fichier `render.yaml`.
3. Renseigne les variables d'environnement :

```bash
DATABASE_URL=<URL_POSTGRES_NEON>
REDIS_URL=<URL_REDIS_UPSTASH>
WEB_ORIGIN=<URL_DU_SITE_VERCEL>
NODE_ENV=production
```

Au premier déploiement, `WEB_ORIGIN` peut être provisoirement `http://localhost:3000`, puis tu le remplaceras par l'URL Vercel quand elle existera.

Commandes Render prévues par `render.yaml` :

```bash
corepack enable && corepack prepare pnpm@9.15.4 --activate && pnpm install --frozen-lockfile && pnpm --filter @quiz/shared build && pnpm --filter @quiz/game-core build && pnpm --filter @quiz/api prisma:generate && pnpm --filter @quiz/api build
pnpm --filter @quiz/api start
```

Après la création de l'API, vérifie :

```bash
https://TON-API.onrender.com/health
```

### Migrer la base de production

Depuis ton terminal local, lance les migrations contre Neon :

```bash
DATABASE_URL="<URL_POSTGRES_NEON>" pnpm db:deploy
```

Cette commande utilise `prisma migrate deploy`, adaptée à la production.

### Déployer le web sur Vercel

Dans Vercel :

1. Importe le repo GitHub.
2. Mets `apps/web` comme `Root Directory`.
3. Vercel peut utiliser `apps/web/vercel.json`.
4. Ajoute les variables d'environnement :

```bash
NEXT_PUBLIC_API_URL=https://TON-API.onrender.com
NEXT_PUBLIC_SOCKET_URL=https://TON-API.onrender.com
```

Après le premier déploiement Vercel, retourne dans Render et remplace `WEB_ORIGIN` par l'URL Vercel :

```bash
WEB_ORIGIN=https://TON-SITE.vercel.app
```

Redéploie ensuite l'API Render.

### Continuer à améliorer depuis ici

Le workflow reste le même :

1. on modifie le code localement ;
2. on teste en local ;
3. tu pousses sur GitHub ;
4. Vercel et Render redéploient automatiquement.

## Notes et TODO

- `auth` est volontairement minimal : il faudra ajouter une vraie stratégie avant de gérer des quiz privés.
- Les timers sont autoritaires côté serveur, mais planifiés par `setTimeout` dans la gateway. Pour plusieurs instances serveur, remplacer par une queue ou un scheduler distribué.
- Les réponses sont persistées dès réception avec `pointsAwarded = 0`; le calcul de score live est fait par le moteur et répercuté sur `Player.score`.
- L'UI est volontairement sobre : l'objectif actuel est le flux technique maintenable.
