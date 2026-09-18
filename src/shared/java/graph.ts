import { stripJavaCommentsAndStrings } from '../code-parser';
import { escapeRegExp } from '../string';

const PACKAGE_RE = /^\s*package\s+([\w.]+)\s*;/m;
const TOP_LEVEL_TYPE_RE =
    /(?:^|\n)\s*(?:public\s+|protected\s+|private\s+)?(?:abstract\s+|final\s+|static\s+)*?(?:class|interface|enum|record)\s+(\w+)/m;
const IMPORT_RE = /^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;/gm;

export interface JavaTypeIndex {
    classToFile: Map<string, string>;
    packageToFiles: Map<string, Set<string>>;
    fileToPackage: Map<string, string>;
    fileToSimpleName: Map<string, string>;
}

export const buildJavaTypeIndex = (
    javaFiles: string[],
    readContent: (filePath: string) => string,
): JavaTypeIndex => {
    const classToFile = new Map<string, string>();
    const packageToFiles = new Map<string, Set<string>>();
    const fileToPackage = new Map<string, string>();
    const fileToSimpleName = new Map<string, string>();

    for (const filePath of javaFiles) {
        const content = readContent(filePath);
        const fqn = getJavaTopLevelTypeName(content, filePath);
        if (!fqn) {
            continue;
        }

        classToFile.set(fqn, filePath);

        const packageName = fqn.includes('.') ? fqn.slice(0, fqn.lastIndexOf('.')) : '';
        const simpleName = fqn.slice(fqn.lastIndexOf('.') + 1);

        fileToPackage.set(filePath, packageName);
        fileToSimpleName.set(filePath, simpleName);

        const packageFiles = packageToFiles.get(packageName) ?? new Set<string>();
        packageFiles.add(filePath);
        packageToFiles.set(packageName, packageFiles);
    }

    return {
        classToFile,
        packageToFiles,
        fileToPackage,
        fileToSimpleName,
    };
};

const getJavaTopLevelTypeName = (content: string, filePath: string) => {
    const packageName = content.match(PACKAGE_RE)?.[1];
    const typeName = content.match(TOP_LEVEL_TYPE_RE)?.[1] ?? getFallbackJavaTypeName(filePath);

    if (!typeName) {
        return null;
    }

    return packageName ? `${packageName}.${typeName}` : typeName;
};

const getFallbackJavaTypeName = (filePath: string): string | null => {
    const match = filePath.match(/\/([^/]+)\.java$/i);
    return match?.[1] ?? null;
};

interface JavaImportRef {
    kind: 'type' | 'wildcard';
    value: string;
}

const parseJavaImportRefs = (content: string): JavaImportRef[] => {
    const refs: JavaImportRef[] = [];

    IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMPORT_RE.exec(content)) !== null) {
        const specifier = match[1];
        if (specifier.endsWith('.*')) {
            refs.push({
                kind: 'wildcard',
                value: specifier.slice(0, -2),
            });
            continue;
        }
        refs.push({ kind: 'type', value: specifier });
    }

    return refs;
};

const resolveJavaImport = (specifier: string, index: JavaTypeIndex) => {
    const direct = index.classToFile.get(specifier);
    if (direct) {
        return direct;
    }

    const lastDot = specifier.lastIndexOf('.');
    if (lastDot <= 0) {
        return null;
    }

    return index.classToFile.get(specifier.slice(0, lastDot)) ?? null;
};

const resolveJavaWildcardImport = (packageName: string, index: JavaTypeIndex): string[] => {
    const files = index.packageToFiles.get(packageName);
    return files ? [...files] : [];
};

export const findJavaSamePackageDependencies = (
    content: string,
    fromFile: string,
    index: JavaTypeIndex,
): string[] => {
    const packageName = index.fileToPackage.get(fromFile);
    if (packageName === undefined) {
        return [];
    }

    const packageFiles = index.packageToFiles.get(packageName);
    if (!packageFiles) {
        return [];
    }

    const stripped = stripJavaCommentsAndStrings(content);
    const ownName = index.fileToSimpleName.get(fromFile);
    const deps = new Set<string>();

    for (const candidateFile of packageFiles) {
        if (candidateFile === fromFile) {
            continue;
        }

        const simpleName = index.fileToSimpleName.get(candidateFile);
        if (!simpleName || simpleName === ownName) {
            continue;
        }

        const re = new RegExp(`\\b${escapeRegExp(simpleName)}\\b`);
        if (re.test(stripped)) {
            deps.add(candidateFile);
        }
    }

    return [...deps];
};

export const parseJavaImports = (
    content: string,
    fromFile: string,
    index: JavaTypeIndex,
): string[] => {
    const resolved = new Set<string>();

    for (const ref of parseJavaImportRefs(content)) {
        if (ref.kind === 'wildcard') {
            for (const filePath of resolveJavaWildcardImport(ref.value, index)) {
                resolved.add(filePath);
            }
            continue;
        }

        const filePath = resolveJavaImport(ref.value, index);
        if (filePath) {
            resolved.add(filePath);
        }
    }

    for (const filePath of findJavaSamePackageDependencies(content, fromFile, index)) {
        resolved.add(filePath);
    }

    return [...resolved];
};
