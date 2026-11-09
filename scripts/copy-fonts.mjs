// Copies the self-hosted Sora font files (same family as cobaltpinksoftware.com) into public/assets/fonts.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public/assets/fonts', { recursive: true });
for (const w of [400, 600, 700, 800]) {
  copyFileSync(`node_modules/@fontsource/sora/files/sora-latin-${w}-normal.woff2`, `public/assets/fonts/sora-${w}.woff2`);
}
console.log('Fonts copied.');
