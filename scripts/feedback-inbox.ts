/** Loopback-only receiver for trying the branch. Reports are printed in this terminal. */
const inbox = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 4317),
  maxRequestBodySize: 4096,
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/reports")
      return new Response(null, { status: 404 });
    if (request.headers.get("origin") || request.headers.get("content-type") !== "application/json")
      return new Response(null, { status: 415 });
    try {
      console.log(JSON.stringify(await request.json()));
      return new Response(null, { status: 201 });
    } catch {
      return new Response(null, { status: 400 });
    }
  },
});
console.log(`Feedback inbox listening at http://127.0.0.1:${inbox.port}/reports`);
