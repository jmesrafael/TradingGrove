const fs = require('fs');
const path = require('path');

// Create public directory
if (!fs.existsSync('public')) {
  fs.mkdirSync('public', { recursive: true });
}

// Copy src directory to public
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const files = fs.readdirSync(src);
  files.forEach(file => {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

console.log('Copying src to public...');
copyDir('src', 'public');
console.log('Build complete!');
