import { ApiCall } from 'tsrpc';
import { Msg, sendMsgToWorkerThread, getSpanSink, log as rootLog } from '@dogsvr/dogsvr/main_thread';
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

    const sink = getSpanSink();
    const parentCtx = sink.extract(call.req.head as unknown as Record<string, string | undefined>);
    const span = sink.start(`tsrpc.${call.req.head.cmdId}`, parentCtx, {
        'rpc.system': 'tsrpc',
        'rpc.cmd_id': call.req.head.cmdId,
        'tsrpc.openId': call.req.head.openId ?? '',
    });

    return sink.withActive(span, async () => {
        let ok = false;
        try {
            log.debug({ connId: call.conn.id, status: call.conn.dogAuthStatus }, "auth status");
            if (!call.conn.dogAuthStatus) {
                // First request: dogAuthStatus unset (0/undefined) is the marker.
                // Snapshot openId/zoneId as-is (undefined is valid); per-field
                // validation (e.g. requiring openId) belongs inside authFunc.
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
                call.conn.dogOpenId = call.req.head.openId;
                call.conn.dogZoneId = call.req.head.zoneId;
            }
            else if (call.conn.dogAuthStatus !== AuthStatus.PASSED) {
                log.warn({ connId: call.conn.id, status: call.conn.dogAuthStatus }, "auth status is not passed");
                return;
            }
            else {
                // Subsequent requests: openId/zoneId must match the first-request
                // snapshot (undefined === undefined is intentional, not a bug).
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

            if (call.conn.dogGid) {
                reqMsg.head.gid = call.conn.dogGid;
            }

            let resMsg = await sendMsgToWorkerThread(reqMsg);

            if (!call.conn.dogGid && resMsg.head.gid) {
                call.conn.dogGid = resMsg.head.gid;
            }

            call.succ({
                head: resMsg.head, innerRes: resMsg.body
            });
            ok = true;
        } catch (err) {
            span.recordException(err);
            throw err;
        } finally {
            span.end(ok);
        }
    });
}
