/**
 * One queue, and the calls that must not overlap on it.
 *
 * A read-modify-write — read a file, plan against what it says, write the
 * result back — is only correct if nothing else writes between the read
 * and the write. Two that overlap each plan against a file that no longer
 * exists by the time the second lands, and the first one's change is gone.
 * The protocol's hash check cannot catch it: re-apply faithfully applies
 * operations that were correct when they were computed.
 *
 * The queue belongs to the procedure that has the hazard, never to its
 * caller: a caller that has to remember to hold it is a caller that will
 * one day forget, and the failure that follows is a lost write, which
 * looks like nothing at all. So `serialised()` is called where the work
 * lives — beside the procedure at module scope, or inside the service that
 * owns it — and the procedure funnels itself through what it returns.
 *
 * Each call makes its own queue. Two procedures whose hazards are
 * unrelated — a link that rewrites one Question's `related`, a page write
 * that rewrites another file — should not be made to wait on each other.
 */
export function serialised(): <T>(work: () => Promise<T>) => Promise<T> {
  let previous: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    // Both arms are `work`: work that threw is still work that finished,
    // and the next in line must run either way. Each caller gets the
    // promise for its own work, so a rejection reaches that caller alone.
    const queued = previous.then(work, work);
    previous = queued;
    return queued;
  };
}
