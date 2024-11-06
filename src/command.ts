import fs from 'node:fs';
import sha512Half from '@transia/xrpl/dist/npm/utils/hashes/sha512Half';
import { execSync } from 'node:child_process';
import { Command } from 'commander';
import { copyTo } from './copy-to';
import { buildFile } from "@tequ/c2wasm-cli";

const basePath = `${__dirname}/..`
const includePath = `${basePath}/clang/includes`

const parseGithubUrl = (url: string) => {
  const regex = /https:\/\/github\.com\/([^\/]+\/[^\/]+)\/(?:blob|tree)\/([^\/]+)\/(.+)/;
  const match = url.match(regex);

  if (!match) {
    throw new Error('Invalid GitHub URL');
  }

  const [, repo, ref, filePath] = match;
  return [`https://github.com/${repo}`, ref, filePath];
}

const escapeShell = (cmd: string) => {
  return cmd.replace(/(["'$`\\\/])/g, '\\$1'); 1
};

const fetchRepo = (repoName: string, url: string, ref: string) => {
  execSync(`git -C ${repoName} init`);
  execSync(`git -C ${repoName} remote add origin ${url}`);
  execSync(`git -C ${repoName} fetch -q --depth 1 origin ${ref}`);
  execSync(`git -C ${repoName} checkout FETCH_HEAD -q`);
};

const getCommitHashFromRef = (repoName: string) => {
  return execSync(`git -C ${repoName} show --format='%H' --no-patch`).toString().trim();
}

const build = async (sourcePath: string, wasmFilePath: string) => {
  try {
    const preprocessedPath = wasmFilePath.replace(/.wasm$/, '.c')
    execSync(`gcc -E -P ${sourcePath} -o ${preprocessedPath} -I${includePath} -w`)
    const wasmFileDir = preprocessedPath.replace(/\/.*?.c$/, '')
    await buildFile(preprocessedPath, wasmFileDir)
    execSync(`rm ${preprocessedPath}`)
  } catch (e: any) {
    console.error(e.message);
    throw e
  }
}

const generateHookHash = (wasmFilePath: string) => {
  const fileContent = fs.readFileSync(wasmFilePath, 'hex');
  const hash = sha512Half(fileContent);
  console.log(`Hookhash: ${hash}`);
  return hash;
}

const generateJson = ({ repo, commitHash, path, hookHash }: { repo: string, commitHash: string, path: string, hookHash: string }, buildDir: string) => {
  const json = {
    repo,
    commitHash,
    path,
    hookHash,
  }
  fs.writeFileSync(`${buildDir}/hook-verify.json`, JSON.stringify(json, null, 2));
  return json;
}

export const main = async () => {
  const program = new Command();
  program
    .name('hook-verify')
    .description('Verify the hook hash of a c file')
    .version('0.1.0')
    .argument('<url>', 'GitHub URL')
    .option('-o, --output <path>', 'output directory', 'build')
    .helpOption('-h, --help', 'display help for command')
    .action(async (url, options) => {
      const repoName = 'repo'
      const buildDir = options.output.replace(/\\$/, '')

      const [githubUrl, ref, path] = parseGithubUrl(url)

      fs.rmSync(repoName, { recursive: true, force: true });
      fs.mkdirSync(repoName, { recursive: true });

      fetchRepo(repoName, githubUrl, ref);
      const commitHash = getCommitHashFromRef(repoName)

      // prepare build dir
      const linkFilePath = `${buildDir}/linkFiles.txt`
      execSync(`rm -rf ${buildDir}`);
      execSync(`mkdir ${buildDir}`);
      execSync(`gcc -E -MM ${repoName}/${path} -MF ${linkFilePath} -I${includePath}`);

      const searchPattern = escapeShell(__dirname + '/../')
      const replacePattern = ''
      execSync(`sed -i '' "s/${searchPattern}/${replacePattern}/" ${linkFilePath}`);
      const sourceFilesDir = `${buildDir}/contracts`
      copyTo(linkFilePath, repoName, sourceFilesDir);
      fs.rmSync(linkFilePath);

      // build
      const sourcePath = `${sourceFilesDir}/${path}`
      const wasmFilePath = `${buildDir}/index.wasm`;
      await build(sourcePath, wasmFilePath);

      // hookHash
      const hookHash = generateHookHash(wasmFilePath);
      // generate json
      generateJson({ repo: githubUrl, commitHash, path, hookHash }, buildDir);
    });

  program.parse(process.argv)

  const NO_COMMAND_SPECIFIED = program.args.length === 0;
  if (NO_COMMAND_SPECIFIED) {
    program.help();
  }
}
