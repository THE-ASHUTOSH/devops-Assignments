import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;

public class Main {
    public static void main(String[] args) throws Exception {
        int port = 8080;
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);

        server.createContext("/", exchange -> {
            String host = InetAddress.getLocalHost().getHostName();
            String body = "<!doctype html>\n<html>\n  <head><title>Java App</title></head>\n"
                    + "  <body>\n    <h1>Hello World from Java</h1>\n"
                    + "    <p>host: " + host + "</p>\n  </body>\n</html>";
            byte[] out = body.getBytes();
            exchange.getResponseHeaders().set("Content-Type", "text/html");
            exchange.sendResponseHeaders(200, out.length);
            OutputStream os = exchange.getResponseBody();
            os.write(out);
            os.close();
        });

        server.start();
        System.out.println("listening on " + port);
    }
}
