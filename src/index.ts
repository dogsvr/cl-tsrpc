import { BaseCL, Msg, errorLog, traceLog, registerCLFactory } from "@dogsvr/dogsvr/main_thread";
import * as path from "path";
import { WsServer, HttpServer } from "tsrpc";
import { serviceProto } from "./shared/protocols/serviceProto";

type AuthFuncType = (msg: Msg) => Promise<boolean>;
declare module 'tsrpc' {
    export interface BaseServer {
        authFunc: AuthFuncType;
    }
}

export class TsrpcCL extends BaseCL {
    server: WsServer | HttpServer;

    constructor(public svrType: "ws" | "http", public port: number) {
        super();
        if (svrType === 'ws') {
            this.server = new WsServer(serviceProto, {
                port: this.port
            });
        } else {
            this.server = new HttpServer(serviceProto, {
                port: this.port
            });
        }
    }

    async startListen() {
        await this.server.autoImplementApi(path.resolve(__dirname, 'api'));
        await this.server.start();
    }

    setAuthFunc(authFunc: AuthFuncType) {
        this.server.authFunc = authFunc;
    }

    async pushMsg(msg: Msg) {
        if (this.svrType === 'ws') {
            let gids = msg.head.clOptions!.gids;
            let conns = [];
            for (let i = 0; i < gids.length; ++i) {
                let conn = (this.server as WsServer).connections.find(v => v.dogGid === gids[i]);
                if (conn) {
                    conns.push(conn);
                }
            }
            if (conns.length == 0) {
                return;
            }
            let ret = await (this.server as WsServer).broadcastMsg("Common", { head: msg.head, innerMsg: msg.body }, conns);
            traceLog(`broadcastMsg ${msg.head.cmdId} ret:`, ret);
        }
        else {
            errorLog(`${this.svrType} server can not push msg`);
        }
    }
}

// Self-register factory when this module is imported
registerCLFactory('tsrpc', (params) => new TsrpcCL(params.svrType, params.port));
