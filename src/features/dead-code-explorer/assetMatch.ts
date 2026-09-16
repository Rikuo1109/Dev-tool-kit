export function isAssetReferenced(relativePath: string, urlFragments: Set<string>): boolean {
    const rel = relativePath.replace(/\\/g, '/');
    const withoutPublic = rel.replace(/^public\//, '');

    for (const frag of urlFragments) {
        const f = frag.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!f) {
            continue;
        }
        if (rel.includes(f) || withoutPublic.includes(f) || f.includes(withoutPublic)) {
            return true;
        }
        if (/tinymce/i.test(f) && /tinymce/i.test(rel)) {
            return true;
        }
        if (
            /service-worker|firebase-messaging-sw/i.test(f) &&
            /service-worker|firebase-messaging-sw/i.test(rel)
        ) {
            return true;
        }
    }
    return false;
}

/** ponytail: fixture-only asset ref matching. */
export function selfCheckAssetGraph(): void {
    const frags = new Set<string>(['service-worker.js', 'tinymce', 'assets/js/tinymce-5']);
    if (!isAssetReferenced('public/service-worker.js', frags)) {
        throw new Error('SW ref failed');
    }
    if (!isAssetReferenced('public/assets/js/tinymce-5/tinymce.min.js', frags)) {
        throw new Error('tinymce ref failed');
    }
    if (isAssetReferenced('src/hooks/useX.ts', frags)) {
        throw new Error('asset ref over-matched app file');
    }
}
