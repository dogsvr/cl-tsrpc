import { BaseCL, AuthFuncType } from "@dogsvr/dogsvr/main_thread";
import * as path from "path";
import { WsServer } from "tsrpc";
import { serviceProto } from "./shared/protocols/serviceProto";

declare module 'tsrpc' {
    export interface BaseServer {
        authFunc: AuthFuncType;
    }
}

export class TsrpcCL extends BaseCL {
    server: WsServer;

    constructor(public port: number) {
        super();
        this.server = new WsServer(serviceProto, {
            port: this.port
        });
    }

    async startListen() {
        await this.server.autoImplementApi(path.resolve(__dirname, 'api'));
        await this.server.start();
    }

    setAuthFunc(authFunc: AuthFuncType): void {
        this.server.authFunc = authFunc;
    }
}
