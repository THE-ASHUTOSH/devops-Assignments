// pulled out of server.js so the tests can import it without starting a server
function greet(name) {
  if (!name) return "Hello World";
  return "Hello " + name;
}

function add(a, b) {
  return a + b;
}

module.exports = { greet, add };
