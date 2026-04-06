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
        dogOpenId: string;
        dogZoneId: number;
        dogGid: number;
    }
}

export async function ApiCommon(call: ApiCall<ReqCommon, ResCommon>) {
    // 1. Validate openId and zoneId present in request head
    if (!call.req.head.openId || !call.req.head.zoneId) {
        warnLog('missing openId or zoneId in head', call.conn.id);
        return;
    }

    let reqMsg = new Msg(call.req.head, call.req.innerReq);

    // 2. Auth check
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

    // 3. Record or validate openId/zoneId
    if (!call.conn.dogOpenId) {
        call.conn.dogOpenId = call.req.head.openId!;
        call.conn.dogZoneId = call.req.head.zoneId!;
    }
    else if (call.conn.dogOpenId !== call.req.head.openId || call.conn.dogZoneId !== call.req.head.zoneId) {
        warnLog('openId or zoneId mismatch', call.conn.id,
            call.conn.dogOpenId, call.req.head.openId,
            call.conn.dogZoneId, call.req.head.zoneId);
        return;
    }

    // 4. If gid recorded, fill into request head
    if (call.conn.dogGid) {
        reqMsg.head.gid = call.conn.dogGid;
    }

    // 5. Send to worker thread
    let resMsg = await sendMsgToWorkerThread(reqMsg);

    // 6. If gid not recorded yet, record from response
    if (!call.conn.dogGid && resMsg.head.gid) {
        call.conn.dogGid = resMsg.head.gid;
    }

    // 7. Return response
    call.succ({
        head: resMsg.head, innerRes: resMsg.body
    });
}
