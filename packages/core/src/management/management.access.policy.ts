import { type AuthenticationSession, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { BasePolicyService, Policy, type PolicyContext, type PolicyEnvelope, type PolicyResult } from '@maroonedsoftware/policies';
import { DateTime } from 'luxon';

/** The one policy this core has. protocol.md § 10. */
export const MANAGEMENT_ACCESS_POLICY = 'management.access';

export interface ManagementAccessContext extends PolicyContext {
    /** The socket's peer address, as Fastify reports it. */
    ip: string;
    session: AuthenticationSession;
}

/**
 * Loopback callers, or a caller holding the management token. Nobody else.
 *
 * The server has no other authentication and binds every interface by default, and these routes
 * run pip. A management route open to the LAN is remote code execution for anyone on it, and the
 * default has to be safe for the operator who never reads this.
 */
export class ManagementAccessPolicy extends Policy<ManagementAccessContext> {
    async evaluate(context: ManagementAccessContext): Promise<PolicyResult> {
        if (isLoopback(context.ip)) return this.allow();
        if (context.session !== invalidAuthenticationSession) return this.allow();

        const reason = 'management routes answer loopback callers, or a caller presenting management.token as a bearer token';
        return this.deny(reason, { message: reason }, { ip: context.ip });
    }
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
