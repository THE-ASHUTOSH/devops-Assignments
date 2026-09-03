const http = require('http');

const port = process.env.PORT || 3000;

const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html>
<html>
  <head><title>Node App</title></head>
  <body>
    <h1>Hello World from Node.js</h1>
    <p>host: ${require('os').hostname()}</p>
  </body>
</html>`);
});

srv.listen(port, () => console.log(`listening on ${port}`));
