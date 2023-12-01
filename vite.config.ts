import fs from 'node:fs/promises';
import path from 'node:path';
import child_process from 'node:child_process';
import { defineConfig, PackageData, createLogger, PluginOption } from 'vite';
import { glob } from 'glob';
import { fileURLToPath } from 'node:url'
import 'vitest/config';

const __PROJECT__ = process.cwd();

const blue = (str: string) => [`\x1b[34m`, str, `\x1b[39m`].join('');
const dim = (str: string) => [`\x1b[2m`, str, `\x1b[22m`].join('');
const parseProject = async () => {
  return fs
    .readFile(path.join(__PROJECT__, '/package.json'))
    .then<PackageData['data']>((buf) => JSON.parse(buf.toString()));
};

export default defineConfig(async () => {
  const project = await parseProject();
  const name = project.name.split('/')[1];
  const now = new Date();

  return {
    define: {
      __VERSION__: JSON.stringify(project.version),
      __BUILD_TIMESTAMP__: now.getTime(),
      'import.meta.vitest': 'void 0',
    },
    build: {
      lib: {
        entry: Object.fromEntries(glob.sync('lib/*.ts')
          .filter(path => !path.endsWith('.d.ts'))
          .map(file => [
            path.relative('lib', file.slice(0, file.length - path.extname(file).length)),
            fileURLToPath(new URL(file, import.meta.url))
          ])),
        name,
        formats: ['es']
      },
      sourcemap: false,
      minify: false,
      rollupOptions: {
        external: ['react'],
        output: {
          globals: {
            react: 'React',
          },
        },
      },
    },
    test: {
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.d.ts', 'lib/index.ts'],
      typecheck: {
        checker: 'tsc',
        include: ['lib/**/*.ts'],
      },
      environment: 'jsdom',
    },
    plugins: [
      {
        name: 'build-declarations',
        enforce: 'post',
        apply: 'build',
        generateBundle: async () => {
          // 生成.d.ts文件
          await new Promise<void>((resolve, reject) => {
            const result = child_process.spawn(
              path.join(__dirname, 'node_modules/.bin/tsc'),
              ['--project', path.join(__dirname, 'tsconfig.json')],
              {
                stdio: 'inherit',
                shell: true,
              }
            );
            result.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(
                  new Error(`Generate declaration failed with code ${code}`)
                );
              }
            });
          });
          // clean source map file
          await Promise.all(glob.sync('dist/*.ts.map')
            .map((file) => fs.rm(file)));
          await Promise.all(glob.sync('dist/*.d.ts').map(async file => {
            const content = await fs.readFile(file, {encoding: 'utf-8'});
            await fs.writeFile(file, content.replace(/^\/\/# sourceMappingURL=.+(?:\r\n|\r|\n)?$/gm, ''), {encoding: 'utf-8'});
          }));
        },
        closeBundle: async () => {
          const logger = createLogger();
          logger.info(`${dim('dist/')}${blue('index.d.ts')}`);
        },
      } satisfies PluginOption,
      {
        name: 'banner',
        writeBundle: async (_, bundle) => {
          const banner = [
            `${project.name} v${project.version}`,
            `@license ${project.license}`,
            `@date ${now.toISOString()}`,
            `@repository ${project.repository}`
          ].map(it => ` * ${it}`)
            .join("\n");
          for (const fileName of Object.entries(bundle)) {
            const file = fileName[0];
            const extRegex = new RegExp(/\.(css|js)$/i);
            const vendorRegex = new RegExp(/vendor/);
            if (extRegex.test(file) && !vendorRegex.test(file)) {
              let data = await fs.readFile('./dist/' + file, {
                encoding: 'utf8',
              });
              data = `/**\n${banner}\n */\n${data}`;
              await fs.writeFile('./dist/' + file, data);
            }
          }
        },
      } satisfies PluginOption,
    ],
  };
});
