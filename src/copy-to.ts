import fs from 'node:fs';

export const copyTo = (filesPath: string, fromBasePath: string, copyTo: string) => {
  const data = fs.readFileSync(filesPath, 'utf8');
  const filePaths = data.replace(/^.*\.o:\s*/, '').split(/\s[\\]?/).filter(path => path !== '');
  filePaths.forEach(source => {
    const destPath = source.replace(fromBasePath, '').replace(/^\//, '');
    fs.cpSync(source, `${copyTo}/${destPath}`, { recursive: true });
  });
}
