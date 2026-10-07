const http = require("http");
const { recordVisit, health } = require("./app");

const port = process.env.PORT || 3000;
const appName = process.env.APP_NAME || "visitor-app";

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/ready") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(health()));
  }

  const count = recordVisit();
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(appName + " - visit number " + count + "\n");
});

server.listen(port, () => console.log(appName + " listening on " + port));
