# @dogsvr/cl-tsrpc

TSRPC connection layer for [`@dogsvr/dogsvr`](https://github.com/dogsvr/dogsvr) — inbound WebSocket and HTTP transport, with per-connection auth and identity binding (`openId` / `zoneId` / `gid`).

## Install

```sh
npm install @dogsvr/cl-tsrpc
```

**Node.js**: tested on **v24.13.0 on Linux (x86-64)**; other maintained LTS lines are expected to work but are not routinely exercised. File an issue if something breaks on your runtime.

## Usage

Importing the package in the main thread self-registers a `"tsrpc"` CL factory with `@dogsvr/dogsvr`:

```ts
import * as dogsvr from '@dogsvr/dogsvr/main_thread';
import '@dogsvr/cl-tsrpc';
dogsvr.startServer(__dirname + '/main_thread_config.json');
```

Add a CL entry to `main_thread_config.json`:

```jsonc
{
    "cl": {
        "tsrpc": { "type": "tsrpc", "svrType": "ws",   "port": 20000 }
        // or:    { "type": "tsrpc", "svrType": "http", "port": 10000 }
    }
}
```

The layer hooks `ApiCommon` on each incoming call: the first request must carry `openId` + `zoneId`; once authenticated, the identity is bound to the connection. `gid` is populated from the first worker response and auto-filled on subsequent messages.

### Regenerating TSRPC protos

This package owns the TSRPC proto used internally:

```sh
npm run protoc      # tsrpc-cli
```

## Role in dogsvr

One of several pluggable **connection layers** that plug into the dogsvr main thread. See the [dogsvr README](https://github.com/dogsvr/dogsvr) for how CL factories are registered and how worker threads consume the routed messages.

## See also

- [`example-proj`](https://github.com/dogsvr/example-proj) — three-server reference that uses this CL on `dir` (HTTP) and `zonesvr` (WS)
- [`@dogsvr/cl-grpc`](https://github.com/dogsvr/cl-grpc) — gRPC CL for server-to-server calls
