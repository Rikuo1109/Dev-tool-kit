import * as fs from 'fs';
import * as path from 'path';
import { JavaTypeIndex } from './graph';
import { readFileSafe, walkForFile } from '../fs';
import { stripJavaCommentsAndStrings } from '../code-parser';

const POM_MAIN_CLASS_RE = /<mainClass>\s*([\w.]+)\s*<\/mainClass>/g;
const GRADLE_MAIN_CLASS_RE = /mainClass(?:Name)?\s*=?\s*['"]([\w.]+)['"]/g;

/**
 * Annotations that make a class framework-managed (Spring, JAX-RS, Micronaut, Quarkus/CDI): the
 * container instantiates it by classpath scanning, so nothing has to import it. Method-level ones
 * (`@Bean`, `@Scheduled`, listeners) mark the declaring class the same way.
 */
export const DEFAULT_JAVA_ENTRY_ANNOTATIONS = [
    'SpringBootApplication',
    'RestController',
    'Controller',
    'ControllerAdvice',
    'RestControllerAdvice',
    'Configuration',
    'Component',
    'Service',
    'Repository',
    'Aspect',
    'SpringBootTest',
    'WebMvcTest',
    'Bean',
    'Scheduled',
    'EventListener',
    'KafkaListener',
    'RabbitListener',
    'JmsListener',
    'Path',
    'Singleton',
    'ApplicationScoped',
];

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds a matcher for `@Name` / `@pkg.Name` outside comments and strings. Names may be given
 * with or without the leading `@`; `@SpringBootApplication` is always included.
 */
export const createJavaEntryAnnotationMatcher = (
    annotations: readonly string[] = DEFAULT_JAVA_ENTRY_ANNOTATIONS,
): ((content: string) => string | undefined) => {
    const names = new Set(['SpringBootApplication']);
    for (const raw of annotations) {
        const name = raw.trim().replace(/^@/, '');
        if (/^[\w.$]+$/.test(name)) {
            names.add(name.slice(name.lastIndexOf('.') + 1));
        }
    }
    const pattern = new RegExp(
        `@(?:[\\w$]+\\s*\\.\\s*)*(${[...names].map(escapeRegExp).join('|')})(?![\\w$])`,
    );
    return (content) => pattern.exec(stripJavaCommentsAndStrings(content))?.[1];
};

export const discoverJavaEntryPoints = (
    workspaceRoot: string,
    javaFiles: string[],
    javaTypeIndex: JavaTypeIndex,
    getContent: (filePath: string) => string,
    entryAnnotations: readonly string[] = DEFAULT_JAVA_ENTRY_ANNOTATIONS,
): string[] => {
    const findEntryAnnotation = createJavaEntryAnnotationMatcher(entryAnnotations);
    const entries = new Set<string>();

    for (const fqn of findMainClassesFromBuildFiles(workspaceRoot)) {
        const filePath = javaTypeIndex.classToFile.get(fqn);
        if (filePath) {
            entries.add(filePath);
        }
    }

    for (const filePath of javaFiles) {
        if (findEntryAnnotation(getContent(filePath))) {
            entries.add(filePath);
        }
    }

    return [...entries];
};

const findMainClassesFromBuildFiles = (workspaceRoot: string): string[] => {
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
};

const readMainClassesFromText = (content: string, pattern: RegExp, classes: Set<string>): void => {
    if (!content) {
        return;
    }

    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
        classes.add(match[1]);
    }
};

const findBuildFiles = (workspaceRoot: string, fileName: string): string[] => {
    const results: string[] = [];
    walkForFile(workspaceRoot, fileName, results, 0, 4);
    return results;
};
