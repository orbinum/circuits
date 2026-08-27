// @ts-check
/**
 * Lint rules for the TypeScript in this repository.
 *
 * There was no ESLint config before — and yet four `eslint-disable` comments
 * sat in the source, suppressing `@typescript-eslint` rules that nothing
 * enforced. A disable directive for a linter that does not run is worse than
 * no linter: it reads as "this was considered and allowed" when nothing
 * considered it.
 *
 * The rules here are deliberately few. A config that fires on style is a config
 * that gets `--no-verify`'d; these catch things that are usually mistakes.
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        // Generated, vendored, or not ours.
        ignores: [
            "build/**",
            "keys/**",
            "ptau/**",
            "dist/**",
            "pkg/**",
            "release/**",
            "node_modules/**",
            "fixtures/**",
            // The published package's entry point: hand-written CommonJS,
            // outside the TypeScript project, so the type-aware rules cannot
            // run on it. It is 60 lines and ships as-is.
            "npm/**",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parserOptions: { project: "./tsconfig.json" },
        },
        rules: {
            // circomlibjs ships no types, and its Poseidon returns an opaque
            // field element. `any` at that boundary is honest; `any` elsewhere
            // is usually someone silencing a real question, so it warns rather
            // than errors.
            "@typescript-eslint/no-explicit-any": "warn",

            // An unused variable is either a leftover or a bug. `_`-prefixed
            // names are the escape hatch for a deliberately ignored binding.
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],

            // A floating promise in a build script means the process can exit
            // before the work finishes — silently, with status 0.
            "@typescript-eslint/no-floating-promises": "error",

            // `require()` in a TypeScript file usually means an import that was
            // never converted. The tests use it deliberately in a few places to
            // dodge circom_tester's module shape, so it warns.
            "@typescript-eslint/no-require-imports": "warn",
        },
    },
    {
        // Tests assert on values whose types circomlibjs does not describe.
        files: ["test/**/*.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-expressions": "off",
        },
    }
);
