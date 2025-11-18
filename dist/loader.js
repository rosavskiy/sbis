import { readFile } from 'fs/promises';
export async function loadDocumentForEdo(client, pathToDoc, meta) {
    const buffer = await readFile(pathToDoc);
    const fileName = pathToDoc.split(/[/\\]/).pop() || 'document.doc';
    const result = await client.uploadDraftDocument(meta, buffer, fileName);
    return {
        filePath: pathToDoc,
        fileName,
        sabyResult: result,
    };
}
