import { readFile } from 'fs/promises';
import { SabyClient, UploadMeta } from './sabyClient.js';

export async function loadDocumentForEdo(
  client: SabyClient,
  pathToDoc: string,
  meta: UploadMeta
) {
  const buffer = await readFile(pathToDoc);
  const fileName = pathToDoc.split(/[/\\]/).pop() || 'document.doc';

  const result = await client.uploadDraftDocument(meta, buffer, fileName);

  return {
    filePath: pathToDoc,
    fileName,
    sabyResult: result,
  };
}
