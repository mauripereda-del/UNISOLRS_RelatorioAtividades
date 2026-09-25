/**
 * Copia o bundle ESM oficial do pacote `docx` para js/vendor/.
 * O frontend não tem bundler; o navegador importa esse arquivo local.
 * Não altera npm run build (gerar-env.js).
 */
const fs = require("fs");
const path = require("path");

const origem = path.join(__dirname, "..", "node_modules", "docx", "dist", "index.mjs");
const destinoDir = path.join(__dirname, "..", "js", "vendor");
const destino = path.join(destinoDir, "docx.mjs");

if (!fs.existsSync(origem)) {
  console.error("Pacote docx não encontrado. Execute npm install.");
  process.exit(1);
}

fs.mkdirSync(destinoDir, { recursive: true });
fs.copyFileSync(origem, destino);
console.log(`Vendor atualizado: ${path.relative(process.cwd(), destino)}`);
