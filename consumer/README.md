# Domora Step 8 — API consumer

Minimal client that consumes the publicly deployed Domora API
(`https://domora-mu.vercel.app`) and displays verification requests with a
status filter and offset pagination.

## Run

```sh
# 1. Put a live session token for the deploy in consumer/.env.local (gitignored):
echo "CONSUMER_SESSION_TOKEN=<token>" > consumer/.env.local

# 2. Start the consumer (zero dependencies, Node 18+):
node consumer/server.mjs

# 3. Open http://localhost:8787
```

The page lists data, filters by `status`, and pages with Next/Prev. The
consumer server is the one that talks to the API (the Session cookie cannot be
set cross-site from a browser), and it always targets the public URL above —
never a localhost API.