import { ApiCall } from 'tsrpc';
import { Msg, sendMsgToWorkerThread, log as rootLog } from '@dogsvr/dogsvr/main_thread';
import { ReqCommon, ResCommon } from '../shared/protocols/PtlCommon';

const log = rootLog.child({ module: "cl-tsrpc/api/ApiCommon" });

enum AuthStatus {
    PASSED = 1,
    FAILED = 2,
    DOING = 3,
}

declare module 'tsrpc' {
    export interface BaseConnection {
        dogAuthStatus: AuthStatus;
        dogOpenId?: string;
        dogZoneId?: number;
        dogGid: number;
    }
}

export async function ApiCommon(call: ApiCall<ReqCommon, ResCommon>) {
    let reqMsg = new Msg(call.req.head, call.req.innerReq);

    // 1. Auth check & first-request record. dogAuthStatus acts as the
    //    "first request" marker: when unset, run authFunc and snapshot the
    //    head's openId/zoneId (as-is, possibly undefined) onto the connection.
    //    Per-head validation (e.g. requiring openId/zoneId) is the business
    //    layer's responsibility and should live inside authFunc.
    log.debug({ connId: call.conn.id, status: call.conn.dogAuthStatus }, "auth status");
    if (!call.conn.dogAuthStatus) {
        let authFunc = call.conn.server.authFunc;
        if (authFunc) {
            call.conn.dogAuthStatus = AuthStatus.DOING;
            let authRet = await authFunc(reqMsg);
            if (!authRet) {
                log.warn({ connId: call.conn.id }, "auth failed");
                call.conn.dogAuthStatus = AuthStatus.FAILED;
                call.conn.close();
                return;
            }
            call.conn.dogAuthStatus = AuthStatus.PASSED;
        }
        else {
            log.warn({ connId: call.conn.id }, "authFunc is not set, so auto passed");
            call.conn.dogAuthStatus = AuthStatus.PASSED;
        }
        // First request passed auth: record head's openId/zoneId as-is.
        call.conn.dogOpenId = call.req.head.openId;
        call.conn.dogZoneId = call.req.head.zoneId;
    }
    else if (call.conn.dogAuthStatus !== AuthStatus.PASSED) {
        log.warn({ connId: call.conn.id, status: call.conn.dogAuthStatus }, "auth status is not passed");
        return;
    }
    else {
        // 2. Subsequent requests: head's openId/zoneId must match the snapshot
        //    taken on the first request (undefined matches undefined).
        if (call.conn.dogOpenId !== call.req.head.openId || call.conn.dogZoneId !== call.req.head.zoneId) {
            log.warn({
                connId: call.conn.id,
                snapshotOpenId: call.conn.dogOpenId,
                reqOpenId: call.req.head.openId,
                snapshotZoneId: call.conn.dogZoneId,
                reqZoneId: call.req.head.zoneId,
            }, "openId or zoneId mismatch");
            return;
        }
    }

    // 3. If gid recorded, fill into request head
    if (call.conn.dogGid) {
        reqMsg.head.gid = call.conn.dogGid;
    }

    // 4. Send to worker thread
    let resMsg = await sendMsgToWorkerThread(reqMsg);

    // 5. If gid not recorded yet, record from response
    if (!call.conn.dogGid && resMsg.head.gid) {
        call.conn.dogGid = resMsg.head.gid;
    }

    // 6. Return response
    call.succ({
        head: resMsg.head, innerRes: resMsg.body
    });
}
