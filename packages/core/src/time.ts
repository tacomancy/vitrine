/**
 * The one timestamp format the vault is written in (`docs/architecture.md`
 * § Vault layout): ISO 8601 at seconds precision with the local UTC offset,
 * never `Z`. Its own module because every Kind writes one — a Question's
 * `captured`, a promotion's `promoted`, a Revision's `at` — and none of
 * them should have to import another Kind to get it.
 */
export function localIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const hh = pad(Math.floor(Math.abs(offset) / 60));
  const mm = pad(Math.abs(offset) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${hh}:${mm}`
  );
}
