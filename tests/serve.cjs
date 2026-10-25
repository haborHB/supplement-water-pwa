const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4181);
let report = null;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
};

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  if (url.pathname === "/__test_report") {
    if (request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      report = JSON.parse(Buffer.concat(chunks).toString());
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(report));
    return;
  }
  const filename = path.resolve(root, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
  if (!filename.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const data = await fs.readFile(filename);
    response.writeHead(200, {
      "Content-Type": types[path.extname(filename)] || "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Regression runner: http://127.0.0.1:${port}/tests/regression.html`);
});
