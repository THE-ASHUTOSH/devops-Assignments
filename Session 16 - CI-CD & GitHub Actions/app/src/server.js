const http = require("http");
const { greet } = require("./app");

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok" }));
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(greet() + " from the CI/CD demo\n");
});

server.listen(port, () => console.log("listening on " + port));
