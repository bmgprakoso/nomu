.PHONY: install dev build typecheck migrate \
	railway-login railway-init env-push deploy redeploy status logs

install:
	npm install

dev:
	npm run dev

build:
	npm run build

typecheck:
	npm run typecheck

migrate:
	npm run migrate

## --- Railway deployment ---
## First-time setup: make railway-login railway-init env-push deploy
## After a code change:  make deploy
## After an env var change: make env-push redeploy

railway-login:
	railway login

railway-init:
	railway init --name nomu
	railway service nomu

env-push:
	@while IFS='=' read -r key value; do \
		[ -z "$$key" ] && continue; \
		case "$$key" in \#*) continue;; esac; \
		echo "setting $$key"; \
		railway variable set "$$key=$$value" --skip-deploys >/dev/null; \
	done < .env
	@echo "vars pushed — run 'make redeploy' to apply them"

deploy:
	railway up --detach

redeploy:
	railway redeploy --yes

status:
	railway status

logs:
	railway logs --since 5m
