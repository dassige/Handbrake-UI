/**
 * release.config.cjs — project-specific settings for release.cjs
 *
 * Copy this file (and release.cjs) into another project and just
 * change the values below to reuse the release workflow there.
 */

'use strict';

module.exports = {
    // Friendly name shown in the script banner and release notes heading.
    PROJECT_NAME: 'EncForge',

    // Base GitHub repo URL (no trailing slash), used for compare links
    // and release URLs.
    GITHUB_REPO: 'https://github.com/dassige/encforge',

    // Only these tags count as earlier releases (git describe --match):
    // DGS AutoVersion also tags each package (server-v2.0.0, web-v2.0.0).
    TAG_PATTERN: 'v[0-9]*',
};
