import fetch from 'node-fetch';
export class SabyClient {
    constructor(config) {
        this.config = config;
        this.token = null;
    }
    async authenticate() {
        if (this.token)
            return this.token;
        const res = await fetch(`${this.config.baseUrl}/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                login: this.config.login,
                password: this.config.password,
            }),
        });
        if (!res.ok) {
            throw new Error(`Saby auth failed: ${res.status} ${res.statusText}`);
        }
        const data = (await res.json());
        this.token = data.token;
        return this.token;
    }
    async uploadDraftDocument(meta, fileBuffer, fileName) {
        const token = await this.authenticate();
        const res = await fetch(`${this.config.baseUrl}/edo/send_doc`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                meta,
                // Реальный формат см. в доке Saby (часто base64 или отдельные поля)
                file: fileBuffer.toString('base64'),
                fileName,
                // ВАЖНО: не указываем флаг немедленной отправки, чтобы документ остался только загруженным.
            }),
        });
        if (!res.ok) {
            throw new Error(`Upload draft failed: ${res.status} ${res.statusText}`);
        }
        return res.json();
    }
}
