import { ImportIndex } from '../../shared/javascript/importGraph';
import {
    blockLineCount,
    exactNormalize,
    extractCodeBlocks,
    previewLines,
    scriptContent,
    structuralNormalize,
} from './sourceUtils';
import { CodeAnalyzeConfig, DuplicateGroup, DuplicateLocation } from './types';

interface IndexedBlock {
    kind: 'exact' | 'structural';
    key: string;
    lineCount: number;
    location: DuplicateLocation;
    preview: string;
}

export function findDuplicateCode(
    scopedFiles: string[],
    index: ImportIndex,
    config: CodeAnalyzeConfig,
): DuplicateGroup[] {
    const minLines = Math.max(3, config.duplicateMinLines);
    const buckets = new Map<string, IndexedBlock[]>();

    for (const filePath of scopedFiles) {
        const source = scriptContent(index.getContent(filePath), filePath);
        const blocks = extractCodeBlocks(source, filePath);

        for (const block of blocks) {
            const lineCount = blockLineCount(block);
            if (lineCount < minLines) {
                continue;
            }

            const location: DuplicateLocation = {
                relativePath: index.relativePath(filePath),
                absolutePath: filePath,
                startLine: block.startLine,
                endLine: block.endLine,
            };
            const preview = previewLines(block.text);

            addBlock(buckets, {
                kind: 'exact',
                key: exactNormalize(block.text, filePath),
                lineCount,
                location,
                preview,
            });

            const structuralKey = structuralNormalize(block.text, filePath);
            if (structuralKey !== exactNormalize(block.text, filePath)) {
                addBlock(buckets, {
                    kind: 'structural',
                    key: structuralKey,
                    lineCount,
                    location,
                    preview,
                });
            }
        }
    }

    const groups: DuplicateGroup[] = [];

    for (const blocks of buckets.values()) {
        if (blocks.length < 2) {
            continue;
        }

        const uniqueFiles = new Set(blocks.map((block) => block.location.absolutePath));
        if (uniqueFiles.size < 2 && !hasNonOverlappingSameFile(blocks)) {
            continue;
        }

        const kind = blocks[0].kind;
        const locations = dedupeLocations(blocks.map((block) => block.location));
        if (locations.length < 2) {
            continue;
        }

        groups.push({
            kind,
            lineCount: blocks[0].lineCount,
            locations,
            preview: blocks[0].preview,
            suggestion: suggestionFor(kind, blocks[0].lineCount),
        });
    }

    return groups.sort(
        (a, b) =>
            b.locations.length - a.locations.length ||
            b.lineCount - a.lineCount ||
            a.kind.localeCompare(b.kind),
    );
}

function addBlock(buckets: Map<string, IndexedBlock[]>, block: IndexedBlock): void {
    if (!block.key || block.key.length < 24) {
        return;
    }
    const bucketKey = `${block.kind}:${block.key}`;
    const list = buckets.get(bucketKey) ?? [];
    list.push(block);
    buckets.set(bucketKey, list);
}

function hasNonOverlappingSameFile(blocks: IndexedBlock[]): boolean {
    const byFile = new Map<string, IndexedBlock[]>();
    for (const block of blocks) {
        const list = byFile.get(block.location.absolutePath) ?? [];
        list.push(block);
        byFile.set(block.location.absolutePath, list);
    }

    for (const list of byFile.values()) {
        if (list.length < 2) {
            continue;
        }
        const sorted = [...list].sort((a, b) => a.location.startLine - b.location.startLine);
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].location.startLine > sorted[i - 1].location.endLine) {
                return true;
            }
        }
    }

    return false;
}

function dedupeLocations(locations: DuplicateLocation[]): DuplicateLocation[] {
    const seen = new Set<string>();
    const unique: DuplicateLocation[] = [];
    for (const location of locations) {
        const key = `${location.absolutePath}:${location.startLine}:${location.endLine}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push(location);
    }
    return unique.sort(
        (a, b) => a.relativePath.localeCompare(b.relativePath) || a.startLine - b.startLine,
    );
}

function suggestionFor(kind: DuplicateGroup['kind'], lineCount: number): string {
    if (kind === 'exact') {
        return `Extract ${lineCount} duplicated lines into a shared utility module and import it where needed.`;
    }
    return `Similar logic pattern (${lineCount} lines) — consider a shared helper or strategy function to reduce drift.`;
}
