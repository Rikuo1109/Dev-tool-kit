export const isAssetReferenced = (relativePath: string, urlFragments: Set<string>): boolean => {
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
};
