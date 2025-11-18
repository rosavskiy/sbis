#!/usr/bin/env node
import fetch from 'node-fetch';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
async function main() {
    const argv = (await yargs(hideBin(process.argv))
        .option('baseUrl', {
        type: 'string',
        default: 'https://online.sbis.ru/auth/service/',
        describe: 'URL сервиса Saby (по умолчанию https://online.sbis.ru/auth/service/)',
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
        .help()
        .parse());
    const body = {
        jsonrpc: '2.0',
        method: 'СБИС.Аутентифицировать',
        params: {
            Параметр: {
                Логин: argv.login,
                Пароль: argv.password,
            },
        },
        id: 0,
    };
    const res = await fetch(argv.baseUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(body),
    });
    console.log('HTTP статус:', res.status, res.statusText);
    console.log('Заголовки ответа:');
    res.headers.forEach((value, key) => {
        console.log(`  ${key}: ${value}`);
    });
    const text = await res.text();
    console.log('Тело ответа (как текст):');
    console.log(text);
    try {
        const json = JSON.parse(text);
        console.log('Тело ответа (как JSON):');
        console.log(JSON.stringify(json, null, 2));
        const result = json.result ?? json.answer;
        if (typeof result === 'string') {
            console.log('Идентификатор сессии (строка):');
            console.log(result);
        }
    }
    catch {
        console.log('Ответ не является корректным JSON или имеет иной формат.');
    }
}
main().catch((err) => {
    console.error('Ошибка при запросе авторизации в Saby:', err);
    process.exit(1);
});
