import { escapeRegExp } from '../../../shared/string';

function matchGlob(relativePath: string, pattern: string): boolean {
    const path = relativePath.replace(/\\/g, '/');
    const glob = pattern.replace(/\\/g, '/');
    return globToRegExp(glob).test(path);
}

export function matchAnyGlob(relativePath: string, patterns: string[]): boolean {
    return patterns.some((pattern) => matchGlob(relativePath, pattern));
}

function globToRegExp(glob: string): RegExp {
    let i = 0;
    let out = '^';
    while (i < glob.length) {
        const ch = glob[i];
        if (ch === '*') {
            if (glob[i + 1] === '*') {
                if (glob[i + 2] === '/') {
                    out += '(?:.*/)?';
                    i += 3;
                    continue;
                }
                out += '.*';
                i += 2;
                continue;
            }
            out += '[^/]*';
            i += 1;
            continue;
        }
        if (ch === '?') {
            out += '[^/]';
            i += 1;
            continue;
        }
        if (ch === '{') {
            const end = glob.indexOf('}', i);
            if (end > i) {
                const body = glob.slice(i + 1, end);
                const alts = body.split(',').map(escapeRegExp).join('|');
                out += `(?:${alts})`;
                i = end + 1;
                continue;
            }
        }
        if (ch === '.') {
            out += '\\.';
            i += 1;
            continue;
        }
        if ('+^$()|[]\\'.includes(ch)) {
            out += `\\${ch}`;
            i += 1;
            continue;
        }
        out += ch;
        i += 1;
    }
    out += '$';
    return new RegExp(out, 'i');
}
