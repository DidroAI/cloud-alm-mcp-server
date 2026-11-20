# Try Cloud ALM cards in Claude or ChatGPT

Run this preview from a source checkout with Bun. It uses the synthetic
**Rollout Example** project and the server's read tools. Anyone who can
reach the endpoint can read the same example. SAP credentials, OAuth,
writes, and links to a live SAP tenant are outside this preview.

```sh
bun install --frozen-lockfile
bun scripts/hosted-preview.ts
```

The default MCP URL is `http://127.0.0.1:3334/mcp`. Check
`curl http://127.0.0.1:3334/health` for a JSON response identifying the
synthetic data. You can connect an MCP Inspector locally. For the web
clients, forward a tester-managed public HTTPS URL on port 443 to this
listener and keep the `/mcp` path. Set `PREVIEW_HOST` and `PREVIEW_PORT`
only if your proxy needs another listening address or port. The server
reads these two settings and uses its bundled fixtures for SAP API calls.

- **Claude** — Add a custom web connector, enter the HTTPS URL ending in
  `/mcp`, and choose **No sign in**. In managed workspaces an owner may
  need to add it first. [Claude connector setup](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- **ChatGPT** — In Plugins, choose **Add custom MCP server**, enter the same
  HTTPS URL, choose no authentication, then create and enable the plugin.
  Workspace policy controls access. [ChatGPT test instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt)

## Try the cards

1. Ask “Which project can I read? Answer in text.” Expect **Rollout Example**.
2. Ask “Show me the test cases in a card, two per page.” The assistant can
   read with `calm_list` and present it with `calm_show`. The card loads
   live fixture results. Expand it if offered, then choose **Load more**
   to see all four test cases.
3. Ask “Show me the steps and expected result for test case 8-1-2 in a
   card.” Look for **Open the worklist** and **The order is listed**.
4. Ask “Show test plan 8-3-1 as a card.” Expect two of three cases executed,
   one passed, and a table listing the cases, results and linked defect.
5. Inspect the tool list. It offers reads and `calm_show`. A client asking
   to write a task should find no write tool.

Stop the server with Ctrl-C and close your HTTPS forwarding session.

## Try agent friction reporting with the example project

In one terminal run `bun scripts/feedback-inbox.ts`. In another, start the
demo with `bun scripts/hosted-preview.ts --feedback`. This explicitly adds
`calm_report_feedback` and sends observations to the loopback inbox on port
4317. Anyone connected to this demo can submit an observation until it stops.
Use a private testing session for this exercise.

Ask the assistant to do a multi-step task such as “Group the failed test cases
by requirement.” Look for an observation if it encounters a concrete obstacle.
A smooth task may produce none. To test delivery separately from the model's
judgment, ask it to send a clearly labeled synthetic observation. Check for
the same receipt ID in the MCP result and inbox terminal. The terminal shows
the exact report.
