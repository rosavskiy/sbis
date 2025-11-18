#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { SabyClient } from './sabyClient.js';
import { loadDocumentForEdo } from './loader.js';
async function main() {
    const argv = (await yargs(hideBin(process.argv))
        .option('file', {
        type: 'string',
        describe: 'Путь к doc-файлу для загрузки в ЭДО Saby',
    })
        .option('dir', {
        type: 'string',
        describe: 'Папка с doc/docx файлами, которые нужно загрузить пачкой',
    })
        .option('baseUrl', {
        type: 'string',
        demandOption: true,
        describe: 'Базовый URL API Saby (например, https://online.sbis.ru/service)',
    })
        .option('login', {
        type: 'string',
        demandOption: true,
        describe: 'Логин пользователя/системного пользователя Saby',
    })
        .option('password', {
        type: 'string',
        demandOption: true,
        describe: 'Пароль пользователя Saby',
    })
        .option('meta', {
        type: 'string',
        describe: 'Дополнительные метаданные документа в формате JSON',
    })
        .check((argv) => {
        if (!argv.file && !argv.dir) {
            throw new Error('Нужно указать --file или --dir');
        }
        if (argv.file && argv.dir) {
            throw new Error('Укажите только один параметр: либо --file, либо --dir');
        }
        return true;
    })
        .help()
        .parse());
    const client = new SabyClient({
        baseUrl: argv.baseUrl,
        login: argv.login,
        password: argv.password,
    });
    const meta = argv.meta ? JSON.parse(argv.meta) : {};
    if (argv.dir) {
        const folderPath = path.resolve(argv.dir);
        const stats = await stat(folderPath);
        if (!stats.isDirectory()) {
            throw new Error(`Путь ${folderPath} не является папкой`);
        }
        const entries = await readdir(folderPath);
        const docFiles = entries
            .filter((name) => /\.(docx?)$/i.test(name))
            .map((name) => path.join(folderPath, name));
        if (docFiles.length === 0) {
            console.log('В папке нет файлов .doc/.docx для загрузки');
            return;
        }
        const results = [];
        for (const filePath of docFiles) {
            console.log(`\nЗагрузка файла ${path.basename(filePath)}...`);
            try {
                const uploadResult = await loadDocumentForEdo(client, filePath, meta);
                console.log('Успешно загрузили документ:');
                console.log(JSON.stringify(uploadResult, null, 2));
                results.push({ file: filePath, ok: true });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`Ошибка загрузки ${path.basename(filePath)}: ${message}`);
                results.push({ file: filePath, ok: false, error: message });
            }
        }
        console.log('\nИтоги пакетной загрузки:');
        results.forEach((item) => {
            if (item.ok) {
                console.log(`✔ ${item.file}`);
            }
            else {
                console.log(`✖ ${item.file} — ${item.error}`);
            }
        });
        const successCount = results.filter((r) => r.ok).length;
        console.log(`\nУспешно: ${successCount}/${results.length}`);
        return;
    }
    const result = await loadDocumentForEdo(client, path.resolve(argv.file), meta);
    console.log('Документ загружен в Saby (без отправки):');
    console.log(JSON.stringify(result, null, 2));
}
main().catch((err) => {
    console.error('Ошибка при загрузке документа в Saby:', err);
    process.exit(1);
});
