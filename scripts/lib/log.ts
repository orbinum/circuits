/**
 * Console output, in one place.
 *
 * Six scripts each declared their own ANSI colour block and no two agreed:
 * `compile.sh` and `lint-circom.sh` omitted `BLUE`, `full-pipeline.sh` skipped
 * the block entirely and hardcoded escape sequences inline. `compile.sh` then
 * used `${BLUE}` on four lines it had never defined, so those printed
 * uncoloured — a bug that existed only because the definition was copied rather
 * than shared.
 *
 * Colour is suppressed when stdout is not a TTY or when `NO_COLOR` is set, so
 * CI logs and piped output stay readable.
 */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const red = wrap("0;31");
export const green = wrap("0;32");
export const yellow = wrap("1;33");
export const blue = wrap("0;34");
export const dim = wrap("2");

export const info = (msg: string): void => console.log(msg);
export const step = (msg: string): void => console.log(blue(msg));
export const ok = (msg: string): void => console.log(`${green("✓")} ${msg}`);
export const warn = (msg: string): void => console.warn(`${yellow("⚠")} ${msg}`);
export const error = (msg: string): void => console.error(`${red("✗")} ${msg}`);

/** A banner, as the shell scripts drew around each phase. */
export function banner(title: string): void {
    const line = "═".repeat(Math.max(title.length + 4, 40));
    console.log(green(line));
    console.log(green(`  ${title}`));
    console.log(green(line));
}

/**
 * Report a fatal error and exit non-zero.
 *
 * Every script needs this and four of them defined their own; only
 * `release.sh` had it as a named function.
 */
export function die(msg: string): never {
    error(msg);
    process.exit(1);
}
