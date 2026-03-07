#!/usr/bin/env ts-node
/**
 * check-artifacts.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Compara los artifacts compilados localmente con los publicados en:
 *   • CDN        → https://circuits.orbinum.io/v1/
 *   • npm        → @orbinum/circuits (registro público de npm)
 *
 * Uso:
 *   npm run check-artifacts             # compara sin recompilar
 *   npm run check-artifacts -- --build  # compila todo primero, luego compara
 *
 * Para cada circuito muestra una tabla indicando si cada artifact está
 * actualizado (✓), desactualizado (✗) o ausente (—) en cada fuente.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as https from "node:https";
import * as http from "node:http";
import * as path from "node:path";
import * as os from "node:os";
import * as zlib from "node:zlib";
import { execSync } from "node:child_process";

// ─── Configuración ────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../../");
const CDN_BASE = "https://circuits.orbinum.io/v1";
const NPM_REGISTRY = "https://registry.npmjs.org/@orbinum%2Fcircuits/latest";
const NPM_PACKAGE = "@orbinum/circuits";

type CircuitName = "disclosure" | "transfer" | "unshield" | "private_link";

const CIRCUITS: CircuitName[] = ["disclosure", "transfer", "unshield", "private_link"];

/** Artifacts para cada circuito y sus rutas locales */
interface ArtifactDef {
    /** Nombre del archivo tal como aparece en CDN/npm */
    filename: string;
    /** Ruta local relativa al ROOT del repo */
    localPath: string;
}

function artifactsFor(circuit: CircuitName): ArtifactDef[] {
    return [
        {
            filename: `${circuit}.wasm`,
            localPath: `build/${circuit}_js/${circuit}.wasm`,
        },
        {
            filename: `${circuit}_pk.zkey`,
            localPath: `keys/${circuit}_pk.zkey`,
        },
        {
            filename: `${circuit}_pk.ark`,
            localPath: `keys/${circuit}_pk.ark`,
        },
        {
            filename: `verification_key_${circuit}.json`,
            localPath: `build/verification_key_${circuit}.json`,
        },
    ];
}

// ─── Colores ANSI ─────────────────────────────────────────────────────────────

const C = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    bgRed: "\x1b[41m",
    bgGreen: "\x1b[42m",
};

const ok = (s: string) => `${C.green}${s}${C.reset}`;
const warn = (s: string) => `${C.yellow}${s}${C.reset}`;
const err = (s: string) => `${C.red}${s}${C.reset}`;
const info = (s: string) => `${C.cyan}${s}${C.reset}`;
const bold = (s: string) => `${C.bold}${s}${C.reset}`;
const dim = (s: string) => `${C.dim}${s}${C.reset}`;

// ─── Utilidades HTTP ──────────────────────────────────────────────────────────

function fetchBuffer(url: string, redirects = 5): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const client = url.startsWith("https") ? https : http;
        const req = client.get(url, { timeout: 30_000 }, (res) => {
            if (
                res.statusCode &&
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location
            ) {
                if (redirects <= 0) return reject(new Error("Too many redirects"));
                return fetchBuffer(res.headers.location, redirects - 1)
                    .then(resolve)
                    .catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", reject);
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error(`Timeout: ${url}`));
        });
    });
}

function fetchJson<T>(url: string): Promise<T> {
    return fetchBuffer(url).then((buf) => JSON.parse(buf.toString("utf-8")) as T);
}

// ─── SHA-256 ──────────────────────────────────────────────────────────────────

function sha256Buffer(buf: Buffer): string {
    return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null;
    return sha256Buffer(fs.readFileSync(filePath));
}

// ─── npm tarball → mapa filename → hash ──────────────────────────────────────

async function fetchNpmHashes(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let tarballUrl: string;

    try {
        console.log(dim(`  Consultando npm registry: ${NPM_REGISTRY}`));
        const meta = await fetchJson<{ dist: { tarball: string }; version: string }>(NPM_REGISTRY);
        tarballUrl = meta.dist.tarball;
        console.log(dim(`  Versión publicada: ${meta.version} → ${tarballUrl}`));
    } catch (e) {
        console.log(warn(`  No se pudo contactar npm registry: ${(e as Error).message}`));
        return map;
    }

    let tarball: Buffer;
    try {
        tarball = await fetchBuffer(tarballUrl);
    } catch (e) {
        console.log(warn(`  No se pudo descargar el tarball npm: ${(e as Error).message}`));
        return map;
    }

    // Extraer el tarball (.tgz = gzip + tar) en directorio temporal
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbinum-circuits-npm-"));
    const tgzPath = path.join(tmpDir, "pkg.tgz");
    fs.writeFileSync(tgzPath, tarball);

    try {
        execSync(`tar -xzf "${tgzPath}" -C "${tmpDir}"`, { stdio: "pipe" });
    } catch (e) {
        console.log(warn(`  No se pudo extraer el tarball npm: ${(e as Error).message}`));
        return map;
    }

    // npm pack coloca los archivos en package/
    const pkgDir = path.join(tmpDir, "package");
    if (!fs.existsSync(pkgDir)) {
        console.log(warn(`  Estructura inesperada del tarball — no se encontró package/`));
        return map;
    }

    for (const file of fs.readdirSync(pkgDir)) {
        const fullPath = path.join(pkgDir, file);
        if (fs.statSync(fullPath).isFile()) {
            map.set(file, sha256Buffer(fs.readFileSync(fullPath)));
        }
    }

    // Limpiar temporal
    fs.rmSync(tmpDir, { recursive: true, force: true });

    return map;
}

// ─── CDN hashes ───────────────────────────────────────────────────────────────

async function fetchCdnHash(filename: string): Promise<string | null> {
    try {
        const buf = await fetchBuffer(`${CDN_BASE}/${filename}`);
        return sha256Buffer(buf);
    } catch {
        return null;
    }
}

// ─── Build opcional ───────────────────────────────────────────────────────────

function runBuildAll(): void {
    console.log(bold(`\n🔨 Compilando todos los circuitos...`));
    try {
        execSync("npm run build-all", { cwd: ROOT, stdio: "inherit" });
        console.log(ok(`✓ Build completo`));
    } catch (e) {
        console.error(err(`✗ Build falló: ${(e as Error).message}`));
        process.exit(1);
    }
}

// ─── Tabla de resultados ─────────────────────────────────────────────────────

interface RowResult {
    circuit: string;
    artifact: string;
    localHash: string | null;
    cdnHash: string | null;
    npmHash: string | null;
}

function statusCell(localHash: string | null, remoteHash: string | null): string {
    if (!localHash) return warn("  —local  ");
    if (!remoteHash) return dim("  —remote ");
    if (localHash === remoteHash) return ok("  ✓ sync  ");
    return err("  ✗ stale ");
}

function printTable(rows: RowResult[]): void {
    const colW = [26, 36, 12, 12];

    const header = [
        bold("Circuito / Artifact").padEnd(colW[0] + 5),
        bold("SHA-256 local (prefijo)").padEnd(colW[1]),
        bold("CDN").padEnd(10),
        bold("npm").padEnd(10),
    ].join("  ");

    const sep = "─".repeat(colW.reduce((a, b) => a + b, 0) + 8);

    console.log(`\n${sep}`);
    console.log(header);
    console.log(sep);

    let lastCircuit = "";
    for (const row of rows) {
        if (row.circuit !== lastCircuit) {
            if (lastCircuit !== "") console.log(dim(sep));
            console.log(`${bold(info(row.circuit))}`);
            lastCircuit = row.circuit;
        }

        const localPrefix = row.localHash
            ? dim(row.localHash.slice(0, 16) + "…")
            : dim("(no compilado)     ");
        const cdnCell = statusCell(row.localHash, row.cdnHash);
        const npmCell = statusCell(row.localHash, row.npmHash);

        console.log(
            `  ${row.artifact.padEnd(colW[0])}  ${localPrefix.padEnd(colW[1] + 10)}  ${cdnCell}  ${npmCell}`
        );
    }

    console.log(sep);
}

function printLegend(): void {
    console.log(`\n  ${ok("✓ sync")}     el hash local coincide con la fuente remota`);
    console.log(
        `  ${err("✗ stale")}    el artifact local difiere — la fuente remota está desactualizada`
    );
    console.log(`  ${warn("—local")}     el artifact no está compilado localmente`);
    console.log(`  ${dim("—remote")}    la fuente remota no tiene este archivo`);
}

function printSummary(rows: RowResult[]): void {
    const staleOnCdn = rows.filter((r) => r.localHash && r.cdnHash && r.localHash !== r.cdnHash);
    const staleOnNpm = rows.filter((r) => r.localHash && r.npmHash && r.localHash !== r.npmHash);
    const notBuilt = rows.filter((r) => !r.localHash);
    const cdnMissing = rows.filter((r) => r.localHash && !r.cdnHash);
    const npmMissing = rows.filter((r) => r.localHash && !r.npmHash);

    console.log(`\n${bold("── Resumen ─────────────────────────────────────────────")}`);

    if (notBuilt.length > 0) {
        console.log(warn(`  ⚠  ${notBuilt.length} artifact(s) no compilados localmente:`));
        for (const r of notBuilt) console.log(warn(`       • ${r.circuit}/${r.artifact}`));
    }

    if (staleOnCdn.length === 0 && staleOnNpm.length === 0 && notBuilt.length === 0) {
        console.log(ok(`  ✓  Todo sincronizado — CDN y npm están al día`));
    } else {
        if (staleOnCdn.length > 0) {
            console.log(err(`\n  ✗  CDN desactualizado (${staleOnCdn.length} archivo(s)):`));
            for (const r of staleOnCdn) console.log(err(`       • ${r.circuit}/${r.artifact}`));
            console.log(
                dim(`       → Para actualizar: git push a main para disparar el CI de release`)
            );
        }
        if (staleOnNpm.length > 0) {
            console.log(err(`\n  ✗  npm desactualizado (${staleOnNpm.length} archivo(s)):`));
            for (const r of staleOnNpm) console.log(err(`       • ${r.circuit}/${r.artifact}`));
            console.log(
                dim(`       → Para actualizar: bump de versión en package.json + push a main`)
            );
        }
        if (cdnMissing.length > 0) {
            console.log(warn(`\n  ⚠  CDN no tiene (${cdnMissing.length} archivo(s)):`));
            for (const r of cdnMissing) console.log(warn(`       • ${r.artifact}`));
        }
        if (npmMissing.length > 0) {
            console.log(warn(`\n  ⚠  npm no tiene (${npmMissing.length} archivo(s)):`));
            for (const r of npmMissing) console.log(warn(`       • ${r.artifact}`));
        }
    }

    console.log("");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const doBuild = args.includes("--build");
    const cdnOnly = args.includes("--cdn-only");
    const npmOnly = args.includes("--npm-only");

    console.log(`\n${bold(info("══════════════════════════════════════════════════════"))}`);
    console.log(`${bold(info("       Orbinum Circuits — Comparación de Artifacts     "))}`);
    console.log(`${bold(info("══════════════════════════════════════════════════════"))}`);
    console.log(dim(`\n  CDN  : ${CDN_BASE}`));
    console.log(dim(`  npm  : ${NPM_PACKAGE}`));
    console.log(dim(`  root : ${ROOT}`));

    // Paso 0 — build opcional
    if (doBuild) runBuildAll();

    // Paso 1 — hashes locales
    console.log(bold(`\n⏳ Leyendo artifacts locales...`));
    const allDefs: Array<ArtifactDef & { circuit: CircuitName }> = CIRCUITS.flatMap((c) =>
        artifactsFor(c).map((def) => ({ ...def, circuit: c }))
    );
    for (const def of allDefs) {
        const absPath = path.join(ROOT, def.localPath);
        const exists = fs.existsSync(absPath);
        const sym = exists ? ok("✓") : warn("—");
        console.log(
            `  ${sym} ${dim(def.circuit + "/")}${def.filename}${exists ? "" : warn(" (no encontrado)")}`
        );
    }

    // Paso 2 — hashes CDN (paralelo por circuito)
    let cdnHashes = new Map<string, string | null>();
    if (!npmOnly) {
        console.log(bold(`\n⏳ Descargando checksums del CDN...`));
        const cdnEntries = await Promise.all(
            allDefs.map(async (def) => {
                const hash = await fetchCdnHash(def.filename);
                if (hash) {
                    console.log(
                        `  ${ok("✓")} ${def.filename} ${dim("(" + hash.slice(0, 12) + "…)")}`
                    );
                } else {
                    console.log(`  ${warn("—")} ${def.filename} ${warn("(no encontrado en CDN)")}`);
                }
                return [def.filename, hash] as [string, string | null];
            })
        );
        cdnHashes = new Map(cdnEntries);
    }

    // Paso 3 — hashes npm
    let npmHashes = new Map<string, string>();
    if (!cdnOnly) {
        console.log(bold(`\n⏳ Descargando paquete npm ${NPM_PACKAGE}...`));
        npmHashes = await fetchNpmHashes();
        if (npmHashes.size > 0) {
            console.log(ok(`  ✓ ${npmHashes.size} archivos extraídos del tarball`));
        }
    }

    // Paso 4 — construir filas
    const rows: RowResult[] = allDefs.map((def) => {
        const localPath = path.join(ROOT, def.localPath);
        return {
            circuit: def.circuit,
            artifact: def.filename,
            localHash: sha256File(localPath),
            cdnHash: cdnHashes.get(def.filename) ?? null,
            npmHash: npmHashes.get(def.filename) ?? null,
        };
    });

    // Paso 5 — mostrar tabla y resumen
    printTable(rows);
    printLegend();
    printSummary(rows);

    // Exit code no-cero si hay desactualizados
    const hasStale = rows.some(
        (r) =>
            (r.localHash && r.cdnHash && r.localHash !== r.cdnHash) ||
            (r.localHash && r.npmHash && r.localHash !== r.npmHash)
    );
    process.exit(hasStale ? 1 : 0);
}

main().catch((e) => {
    console.error(err(`\n✗ Error inesperado: ${e.message}`));
    process.exit(1);
});
