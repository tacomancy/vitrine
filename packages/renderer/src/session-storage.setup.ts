import { afterEach } from "vitest";

// A Scout form's draft is kept in session storage (`scout-draft.ts`), which
// outlives a test inside its file: one test's half-written form would open
// as the next test's.
afterEach(() => sessionStorage.clear());
