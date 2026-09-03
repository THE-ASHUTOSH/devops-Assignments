import os
import socket

from flask import Flask

app = Flask(__name__)


@app.route("/")
def home():
    return f"""<!doctype html>
<html>
  <head><title>Python App</title></head>
  <body>
    <h1>Hello World from Python</h1>
    <p>host: {socket.gethostname()}</p>
  </body>
</html>"""


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
