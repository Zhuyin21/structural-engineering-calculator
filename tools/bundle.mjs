// Builds single-file versions of the beam calculator into dist/:
//   beam-calculator.html   open it straight from disk, no server or internet needed
//   beam-fragment.html     the same page without <html>/<head>/<body>, for embedding
// The hosted site does not need this step; it serves the source files directly.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const html = await readFile('index.html', 'utf8');
const css = await readFile('styles/app.css', 'utf8');
const body = html.slice(html.indexOf('<!--app:start-->') + 16, html.indexOf('<!--app:end-->')).trim();
const title = html.match(/<title>(.*?)<\/title>/)[1];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];

const out = await build({ entryPoints: ['src/beam/app.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2022', charset: 'utf8' });
const js = out.outputFiles[0].text.replaceAll('</script', '<\\/script');

const head = `<title>${title}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<style>\n${css}</style>`;
await mkdir('dist', { recursive: true });
await writeFile('dist/beam-fragment.html', `${head}\n${body}\n<script>\n${js}</script>\n`);
await writeFile('dist/beam-calculator.html',
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n<script>\n${js}</script>\n</body>\n</html>\n`);
console.log('dist/beam-calculator.html and dist/beam-fragment.html written');
