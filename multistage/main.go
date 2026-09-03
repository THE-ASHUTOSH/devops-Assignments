package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	host, _ := os.Hostname()

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprintf(w, `<!doctype html>
<html>
  <head><title>Multi-stage build</title></head>
  <body>
    <h1>Hello World from Docker multi-stage build</h1>
    <p>container: %s</p>
  </body>
</html>`, host)
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "ok")
	})

	log.Println("listening on 8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
