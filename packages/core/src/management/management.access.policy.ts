import { type AuthenticationSession, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { BasePolicyService, Policy, type PolicyContext, type PolicyEnvelope, type PolicyResult } from '@maroonedsoftware/policies';
import { DateTime } from 'luxon';

/** The one policy this core has. protocol.md § 10. */
export const MANAGEMENT_ACCESS_POLICY = 'management.access';

export interface ManagementAccessContext extends PolicyContext {
    /** The socket's peer address, as Fastify reports it. */
    ip: string;
    /** `X-Forwarded-For`, when a proxy in front of the core set it. */
    forwardedFor?: string;
    /** The `Origin` a browser attached, absent from curl, the wizard, and a same-origin GET. */
    origin?: string;
    session: AuthenticationSession;
}

/**
 * A local caller, or one holding the management token, and never a web page that did not come from
 * this machine or from an origin the operator named.
 *
 * The server has no other authentication and binds every interface by default, and these routes
 * run pip. A management route open to the LAN is remote code execution for anyone on it, and the
 * default has to be safe for the operator who never reads this.
 *
 * Loopback alone was not enough, and was measured not to be: any web page the operator visits can
 * make their browser POST to localhost, and the browser is a loopback caller. A cross-site
 * `POST /engines/tone/install` from `Origin: https://evil.example` answered 202 and installed. A
 * browser always names the page's origin on a cross-site request and on every POST, and a page
 * cannot forge it, so refusing a foreign `Origin` closes that and DNS rebinding with it.
 */
export class ManagementAccessPolicy extends Policy<ManagementAccessContext> {
    constructor(private readonly allowedOrigins: readonly string[] = []) {
        super();
    }

    async evaluate(context: ManagementAccessContext): Promise<PolicyResult> {
        if (context.origin !== undefined && !this.originAllowed(context.origin)) {
            const reason = `management routes do not answer pages from ${context.origin}; add it to management.origins if it is yours`;
            return this.deny(reason, { message: reason }, { ip: context.ip, origin: context.origin });
        }
        if (isLocalCaller(context.ip, context.forwardedFor)) return this.allow();
        if (context.session !== invalidAuthenticationSession) return this.allow();

        const reason = 'management routes answer loopback callers, or a caller presenting management.token as a bearer token';
        return this.deny(reason, { message: reason }, { ip: context.ip, forwardedFor: context.forwardedFor });
    }

    private originAllowed(origin: string): boolean {
        return isLoopbackOrigin(origin) || this.allowedOrigins.includes(origin);
    }
}

/**
 * On this machine, including through a proxy that is also on this machine but only when the client
 * it forwarded for is too.
 *
 * A proxy in front of the core (the web app's dev server, or nginx) connects from loopback, so
 * without this every caller it forwarded would be local, and a web app served to the LAN would hand
 * the LAN the install routes. `X-Forwarded-For` is believed only from a loopback peer, and it can
 * only make a caller less trusted, never more: omitting it gains a local caller nothing it lacked.
 */
export function isLocalCaller(ip: string, forwardedFor?: string): boolean {
    if (!isLoopback(ip)) return false;
    if (forwardedFor === undefined || forwardedFor.trim() === '') return true;
    return forwardedFor.split(',').every(hop => isLoopback(hop.trim()));
}

/** `http://localhost:8081`, `http://127.0.0.1:3000`, `http://[::1]`: a page served from this machine. */
export function isLoopbackOrigin(origin: string): boolean {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        // Includes the literal `null` a sandboxed frame or a file:// page sends, which is nobody's.
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || isLoopback(host);
}

/**
 * 127.0.0.0/8 and ::1, including IPv4 loopback as an IPv6 socket reports it.
 *
 * The mapped form matters because the server binds `::` by default, and on a dual-stack socket a
 * connection to 127.0.0.1 arrives as `::ffff:127.0.0.1`. Checking only `127.` would refuse the
 * operator on their own machine.
 */
export function isLoopback(ip: string): boolean {
    const address = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
    return address === '::1' || /^127(\.\d{1,3}){3}$/.test(address);
}

type RhapsodePolicies = { [MANAGEMENT_ACCESS_POLICY]: ManagementAccessContext };

export class RhapsodePolicyService extends BasePolicyService<RhapsodePolicies> {
    protected async buildEnvelope(): Promise<PolicyEnvelope> {
        return { now: DateTime.utc() };
    }
}
