import express from 'express';
import type { Express } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import multer from 'multer';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

const DEFAULT_SERVICE_URL = 'https://online.sbis.ru/service/?srv=1';

type UploadedFile = Express.Multer.File;

interface ParticipantInput {
  inn?: string;
  kpp?: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  snils?: string;
}

interface UploadParams {
  sessionId?: string;
  docBaseUrl?: string;
  client: ParticipantInput;
  our: ParticipantInput;
  docType?: string;
  number?: string;
  date?: string;
  note?: string;
  file?: UploadedFile;
}

interface UploadResult {
  status: number;
  statusText: string;
  rawBody: string;
  jsonBody: any;
  documentId: string | null;
}

class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const decodeFilename = (name: string) => Buffer.from(name, 'latin1').toString('utf8');

const extractWeekDescription = (name: string): string | undefined => {
  const dateMatch = name.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!dateMatch) {
    return undefined;
  }

  const [, dayStr, monthStr, yearStr] = dateMatch;
  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = Number(yearStr);
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
    return undefined;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  const getIsoWeek = (d: Date) => {
    const target = new Date(d.getTime());
    const dayNum = (target.getUTCDay() || 7) as number;
    target.setUTCDate(target.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const diff = target.getTime() - yearStart.getTime();
    return Math.ceil(((diff / 86400000) + 1) / 7);
  };

  const week = getIsoWeek(date);
  return `Еженедельный отчет по выручке и наценке (${week} неделя)`;
};

const parseInnKppFromFilename = (name: string) => {
  const decoded = decodeFilename(name);
  const innMatch = decoded.match(/ИНН(\d{12}|\d{10})/i);
  const kppMatch = decoded.match(/КПП(\d{9})/i);
  return {
    inn: innMatch?.[1],
    kpp: kppMatch?.[1],
  };
};

const buildParticipant = (params: ParticipantInput) => {
  const { inn, kpp, lastName, firstName, middleName, snils } = params;
  if (!inn) {
    throw new HttpError(400, 'ИНН обязателен для формирования реквизитов');
  }

  const normalizedInn = inn.replace(/\s+/g, '');
  if (!/^\d+$/.test(normalizedInn)) {
    throw new HttpError(400, 'ИНН должен содержать только цифры');
  }

  if (normalizedInn.length === 10) {
    return {
      СвЮЛ: {
        ИНН: normalizedInn,
        ...(kpp ? { КПП: kpp.trim() } : {}),
      },
    };
  }

  if (normalizedInn.length === 12) {
    return {
      СвФЛ: {
        ИНН: normalizedInn,
        ...(lastName ? { Фамилия: lastName.trim() } : {}),
        ...(firstName ? { Имя: firstName.trim() } : {}),
        ...(middleName ? { Отчество: middleName.trim() } : {}),
        ...(snils ? { СНИЛС: snils.trim() } : {}),
      },
    };
  }

  throw new HttpError(400, 'ИНН должен содержать 10 или 12 цифр');
};

const performUpload = async (params: UploadParams): Promise<UploadResult> => {
  const { sessionId, docBaseUrl, client, our, docType, number, date, note, file } = params;

  if (!sessionId) {
    throw new HttpError(400, 'sessionId (X-SBISSessionID) обязателен');
  }

  if (!file) {
    throw new HttpError(400, 'Файл обязателен');
  }

  if (!client.inn || !our.inn) {
    throw new HttpError(400, 'clientInn и ourInn обязательны для загрузки');
  }

  const serviceUrl = docBaseUrl?.trim() || DEFAULT_SERVICE_URL;
  const fileNameUtf = decodeFilename(file.originalname || 'document.docx');
  const description = extractWeekDescription(fileNameUtf);
  const normalizedNote = note?.trim();
  const today = date || new Date().toISOString().slice(0, 10);

  const normalizedClientInn = client.inn.replace(/\s+/g, '');
  const effectiveClientKpp = client.kpp?.trim();

  if (normalizedClientInn.length === 10 && !effectiveClientKpp) {
    throw new HttpError(
      400,
      'Для ИНН с 10 цифрами необходимо указать КПП (например, добавьте его в имя файла).'
    );
  }

  const counterparty = buildParticipant({
    inn: normalizedClientInn,
    kpp: effectiveClientKpp,
    lastName: client.lastName,
    firstName: client.firstName,
    middleName: client.middleName,
    snils: client.snils,
  });

  const ourSide = buildParticipant({
    inn: our.inn,
    kpp: our.kpp,
    lastName: our.lastName,
    firstName: our.firstName,
    middleName: our.middleName,
    snils: our.snils,
  });

  const documentId = randomUUID();
  const attachmentId = randomUUID();
  const binaryBase64 = file.buffer.toString('base64');

  const body = {
    jsonrpc: '2.0',
    method: 'СБИС.ЗаписатьДокумент',
    params: {
      Документ: {
        Вложение: [
          {
            Идентификатор: attachmentId,
            Тип: 'Прочее',
            Подтип: 'Приложение',
            Название: fileNameUtf,
            Файл: {
              ДвоичныеДанные: binaryBase64,
              Имя: fileNameUtf,
            },
          },
        ],
        Дата: today.split('-').reverse().join('.'),
        Номер: number || '',
        Идентификатор: documentId,
        Контрагент: counterparty,
        НашаОрганизация: ourSide,
        Примечание: normalizedNote || description || '',
        Тип: docType || 'ДоговорИсх',
      },
    },
    id: 0,
  };

  const response = await fetch(serviceUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-SBISSessionID': sessionId,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  const result = json?.result;
  const createdDocumentId = result?.Документ?.Идентификатор || result?.Идентификатор || null;

  if (!response.ok) {
    const errorMessage = json?.error?.message || response.statusText;
    throw new HttpError(response.status, errorMessage);
  }

  return {
    status: response.status,
    statusText: response.statusText,
    rawBody: text,
    jsonBody: json,
    documentId: createdDocumentId,
  };
};

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.post('/api/auth', async (req, res) => {
  const { baseUrl, login, password } = req.body as {
    baseUrl?: string;
    login?: string;
    password?: string;
  };

  const url = baseUrl || 'https://online.sbis.ru/auth/service/';

  if (!login || !password) {
    return res.status(400).json({ error: 'baseUrl, login и password обязательны' });
  }

  const body = {
    jsonrpc: '2.0',
    method: 'СБИС.Аутентифицировать',
    params: {
      Параметр: {
        Логин: login,
        Пароль: password,
      },
    },
    id: 0,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();

    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // ignore
    }

    const result = (json as any)?.result ?? (json as any)?.answer;

    let ourOrgs: unknown = null;
    if (typeof result === 'string') {
      try {
        const orgBody = {
          jsonrpc: '2.0',
          method: 'СБИС.СписокНашихОрганизаций',
          params: { Фильтр: {} },
          id: 0,
        };

        const orgResponse = await fetch(DEFAULT_SERVICE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'X-SBISSessionID': result,
          },
          body: JSON.stringify(orgBody),
        });

        const orgText = await orgResponse.text();
        try {
          const orgJson = JSON.parse(orgText);
          ourOrgs = orgJson.result?.НашаОрганизация ?? null;
        } catch {
          // ignore unexpected structure
        }
      } catch {
        // ignore errors fetching orgs
      }
    }

    res.json({
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      rawBody: text,
      jsonBody: json,
      sessionId: typeof result === 'string' ? result : null,
      ourOrganizations: ourOrgs,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  const body = req.body as {
    docBaseUrl?: string;
    sessionId?: string;
    clientInn?: string;
    clientKpp?: string;
    clientLastName?: string;
    clientFirstName?: string;
    clientMiddleName?: string;
    clientSnils?: string;
    ourInn?: string;
    ourKpp?: string;
    ourLastName?: string;
    ourFirstName?: string;
    ourMiddleName?: string;
    ourSnils?: string;
    docType?: string;
    number?: string;
    date?: string;
    note?: string;
  };

  try {
    const result = await performUpload({
      sessionId: body.sessionId,
      docBaseUrl: body.docBaseUrl,
      client: {
        inn: body.clientInn,
        kpp: body.clientKpp,
        lastName: body.clientLastName,
        firstName: body.clientFirstName,
        middleName: body.clientMiddleName,
        snils: body.clientSnils,
      },
      our: {
        inn: body.ourInn,
        kpp: body.ourKpp,
        lastName: body.ourLastName,
        firstName: body.ourFirstName,
        middleName: body.ourMiddleName,
        snils: body.ourSnils,
      },
      docType: body.docType,
      number: body.number,
      date: body.date,
      note: body.note,
      file: req.file as UploadedFile,
    });

    res.json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.statusCode : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/upload/batch', upload.array('files'), async (req, res) => {
  const body = req.body as {
    docBaseUrl?: string;
    sessionId?: string;
    ourInn?: string;
    ourKpp?: string;
    ourLastName?: string;
    ourFirstName?: string;
    ourMiddleName?: string;
    ourSnils?: string;
    docType?: string;
    number?: string;
    date?: string;
    note?: string;
  };

  const files = (req.files as UploadedFile[]) || [];
  if (!files.length) {
    return res.status(400).json({ error: 'Выберите минимум один файл' });
  }

  const results: Array<{
    fileName: string;
    ok: boolean;
    documentId?: string | null;
    error?: string;
  }> = [];

  for (const file of files) {
    const parsed = parseInnKppFromFilename(file.originalname || '');
    if (!parsed.inn) {
      results.push({ fileName: file.originalname, ok: false, error: 'Не найден ИНН в названии файла' });
      continue;
    }

    try {
      const result = await performUpload({
        sessionId: body.sessionId,
        docBaseUrl: body.docBaseUrl,
        client: {
          inn: parsed.inn,
          kpp: parsed.kpp,
        },
        our: {
          inn: body.ourInn,
          kpp: body.ourKpp,
          lastName: body.ourLastName,
          firstName: body.ourFirstName,
          middleName: body.ourMiddleName,
          snils: body.ourSnils,
        },
        docType: body.docType,
        number: body.number,
        date: body.date,
        note: body.note,
        file: file,
      });

      results.push({ fileName: file.originalname, ok: true, documentId: result.documentId });
    } catch (error) {
      results.push({
        fileName: file.originalname,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  res.json({ total: files.length, results });
});

app.listen(port, () => {
  console.log(`Saby test UI server is running on http://localhost:${port}`);
});
