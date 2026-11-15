# Using it as a library

Back to the [README](../README.md).


The Cloud ALM client is exported too:

```ts
import { CloudAlm, serviceKeyGrants, formatTasks, createServer, createHttpHandler } from "cloud-alm-mcp-server";

const calm = new CloudAlm(serviceKeyGrants(serviceKey));          // from a service key
const calm2 = new CloudAlm(async () => myBroker.grant("cloud-alm")); // from your own token source
console.log(formatTasks(await calm.listTasks({ type: "defect", limit: 20 })));
```

A grant is `{ accessToken, baseUrl, expiresAt? }`; a callback is called once
per operation. The library never reads environment variables or files.
`CloudAlm` (typed reads of every Cloud ALM area), `CloudAlmWriter` (the
allow-listed writes) and the `format*` helpers are public API; the MCP tools
are built on the same client.
