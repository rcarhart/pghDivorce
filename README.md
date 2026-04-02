# Pittsburgh Divorce

Standalone product project for the Pittsburgh Divorce lead-intake site.

## Current stack
- static `index.html`
- Nginx container
- Docker Compose for local run/deploy

## Run locally

```bash
docker compose up --build
```

The current container serves the site on port `8100`.

## Scope note

This project is intentionally separate from the homelab repo. It is a standalone product, not a homelab-operated service definition.