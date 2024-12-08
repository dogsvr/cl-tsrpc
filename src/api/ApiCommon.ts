import { ApiCall } from 'tsrpc';
import { Msg, sendMsgToWorkerThread, traceLog, debugLog, infoLog, warnLog, errorLog } from '@dogsvr/dogsvr/main_thread';
import { ReqCommon, ResCommon } from '../shared/protocols/PtlCommon';

enum AuthStatus {
    PASSED = 1,
    FAILED = 2,
    DOING = 3,
}

declare module 'tsrpc' {
    export interface BaseConnection {
        dogAuthStatus: AuthStatus;
        connKey: string;
    }
}

export async function ApiCommon(call: ApiCall<ReqCommon, ResCommon>) {
    let reqMsg = new Msg(call.req.head, call.req.innerReq);

    debugLog('auth status', call.conn.id, call.conn.dogAuthStatus);
    if (!call.conn.dogAuthStatus) {
        let authFunc = call.conn.server.authFunc;
        if (authFunc) {
            call.conn.dogAuthStatus = AuthStatus.DOING;
            let authRet = await authFunc(reqMsg);
            if (!authRet) {
                warnLog('auth failed', call.conn.id);
                call.conn.dogAuthStatus = AuthStatus.FAILED;
                call.conn.close();
                return;
            }
            call.conn.dogAuthStatus = AuthStatus.PASSED;
        }
        else {
            warnLog('authFunc is not set, so auto passed', call.conn.id);
            call.conn.dogAuthStatus = AuthStatus.PASSED;
        }
    }
    else if (call.conn.dogAuthStatus != AuthStatus.PASSED) {
        warnLog('auth status is not passed', call.conn.id, call.conn.dogAuthStatus);
        return;
    }

    if (!call.conn.connKey && call.req.head.openId && call.req.head.zoneId) {
        call.conn.connKey = call.req.head.openId + "|" + call.req.head.zoneId;
    }

    let resMsg = await sendMsgToWorkerThread(reqMsg);
    call.succ({
        head: resMsg.head, innerRes: resMsg.body
    });
}
