FROM golang:1.23-alpine AS build

WORKDIR /src
COPY go.mod .
COPY main.go .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/server main.go

FROM alpine:3.20

RUN adduser -D -u 10001 appuser
COPY --from=build /out/server /usr/local/bin/server

USER appuser
EXPOSE 8080
CMD ["server"]
