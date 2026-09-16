import * as fs from 'fs';
import * as path from 'path';
import { JavaTypeIndex } from './graph';

const POM_MAIN_CLASS_RE = /<mainClass>\s*([\w.]+)\s*<\/mainClass>/g;
const GRADLE_MAIN_CLASS_RE = /mainClass(?:Name)?\s*=?\s*['"]([\w.]+)['"]/g;

export function discoverJavaEntryPoints(
    workspaceRoot: string,
    javaFiles: string[],
    javaTypeIndex: JavaTypeIndex,
    getContent: (filePath: string) => string,
): string[] {
    const entries = new Set<string>();

    for (const fqn of findMainClassesFromBuildFiles(workspaceRoot)) {
        const filePath = javaTypeIndex.classToFile.get(fqn);
        if (filePath) {
            entries.add(filePath);
        }
    }

    for (const filePath of javaFiles) {
        const content = getContent(filePath);
        if (/@SpringBootApplication\b/.test(content)) {
            entries.add(filePath);
        }
    }

    return [...entries];
}

function findMainClassesFromBuildFiles(workspaceRoot: string): string[] {
    const classes = new Set<string>();

    for (const pomPath of findBuildFiles(workspaceRoot, 'pom.xml')) {
        readMainClassesFromText(readFileSafe(pomPath), POM_MAIN_CLASS_RE, classes);
    }

    for (const gradlePath of [
        ...findBuildFiles(workspaceRoot, 'build.gradle'),
        ...findBuildFiles(workspaceRoot, 'build.gradle.kts'),
    ]) {
        readMainClassesFromText(readFileSafe(gradlePath), GRADLE_MAIN_CLASS_RE, classes);
    }

    return [...classes];
}

function readMainClassesFromText(content: string, pattern: RegExp, classes: Set<string>): void {
    if (!content) {
        return;
    }

    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
        classes.add(match[1]);
    }
}

function findBuildFiles(workspaceRoot: string, fileName: string): string[] {
    const results: string[] = [];
    walkForFile(workspaceRoot, fileName, results, 0, 4);
    return results;
}

function walkForFile(
    dir: string,
    fileName: string,
    results: string[],
    depth: number,
    maxDepth: number,
): void {
    if (depth > maxDepth) {
        return;
    }

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === fileName) {
            results.push(fullPath);
            continue;
        }

        if (entry.isDirectory()) {
            walkForFile(fullPath, fileName, results, depth + 1, maxDepth);
        }
    }
}

function readFileSafe(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return '';
    }
}
