# POC for Vercel "Serverless Server" using Cloudflare Workers and lambda
## **This is just a POC, don't use it in production**

This is just a POC to recreate vercel serverless server only using serverless stuff.

### Issues - No particular order - Won't be fixed in this POC
- SST cannot deploy the worker-router, needs support for durable objects
- No proper error handling
- No acknowledgement of the message at all
- Websocket are not a good fit for this, but that's all we have on cloudflare until we get tcp input support
- Very slow on creating the websocket connection, about 1 to 2s every time it needs to recreate the connection
- Not secure at all, no auth, no encryption, no nothing
- Probably a lot more, that's why it's just a POC

### What it can do
- A single lambda can process multiple requests at the same time (By default 5)
- It could run things after the request is done like `next/after`, or vercel and cloudflare `waitUntil`
- That's about it, it's a POC

### How to run
You can change some of the command in the 
At the root run the following commands:
```bash
bun install
bun sst deploy
```

Inside the `packages/worker-router` run the following commands:
```bash
bunx wrangler secret put LAMBDA_URL
bunx wrangler deploy
```