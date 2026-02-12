import { nativeFetch } from '@/utils/nativeFetch';
import { TTSOptions, TTSProvider } from './TTSInterface';

// 常量定义
const ENDPOINT_URL = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
const VOICES_LIST_URL = "https://eastus.api.speech.microsoft.com/cognitiveservices/voices/list";
const USER_AGENT = "okhttp/4.5.0";
const CLIENT_VERSION = "4.0.530a 5fe1dc6c";
const USER_ID = "0f04d16a175c411e";
const HOME_GEOGRAPHIC_REGION = "zh-Hans-CN";
const CLIENT_TRACE_ID = "aab069b9-70a7-4844-a734-96cd78d94be9";
const VOICE_DECODE_KEY = "oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==";
const DEFAULT_VOICE_NAME = "zh-CN-XiaoxiaoMultilingualNeural";
const DEFAULT_RATE = "0";
const DEFAULT_PITCH = "0";
const DEFAULT_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const DEFAULT_STYLE = "general";

interface AzureEndpoint {
    t: string; // token
    r: string; // region
}

export class AzureTTSService implements TTSProvider {
    id = 'azure';
    name = 'Azure TTS';

    private endpoint: AzureEndpoint | null = null;
    private expiredAt: number | null = null;
    private voiceListCache: any = null;

    private async sign(urlStr: string): Promise<string> {
        const u = urlStr.split("://")[1];
        const encodedUrl = encodeURIComponent(u);
        const uuidStr = crypto.randomUUID().replace(/-/g, "");

        // Format date: "a, d b Y H:M:S" lowercase + "gmt"
        const now = new Date();
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

        const formattedDate = `${days[now.getUTCDay()]}, ${String(now.getUTCDate()).padStart(2, '0')} ${months[now.getUTCMonth()]} ${now.getUTCFullYear()} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}gmt`;

        const stringToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
        const encoder = new TextEncoder();
        const dataToSign = encoder.encode(stringToSign);

        // Decode base64 key
        const binaryKey = Uint8Array.from(atob(VOICE_DECODE_KEY), c => c.charCodeAt(0));

        // HMAC-SHA256
        const cryptoKey = await crypto.subtle.importKey(
            "raw",
            binaryKey,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
        const signature = await crypto.subtle.sign("HMAC", cryptoKey, dataToSign);
        const signBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

        return `MSTranslatorAndroidApp::${signBase64}::${formattedDate}::${uuidStr}`;
    }

    private async getEndpoint(): Promise<AzureEndpoint> {
        const signature = await this.sign(ENDPOINT_URL);
        const headers = {
            "Accept-Language": "zh-Hans",
            "X-ClientVersion": CLIENT_VERSION,
            "X-UserId": USER_ID,
            "X-HomeGeographicRegion": HOME_GEOGRAPHIC_REGION,
            "X-ClientTraceId": CLIENT_TRACE_ID,
            "X-MT-Signature": signature,
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json; charset=utf-8"
        };

        const response = await nativeFetch(ENDPOINT_URL, {
            method: 'POST',
            headers
        });

        if (!response.ok) {
            throw new Error(`Failed to get endpoint: ${response.status}`);
        }

        return await response.json();
    }

    private getSSML(text: string, voiceName: string, rate: string, pitch: string, style: string): string {
        return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN">
<voice name="${voiceName}">
    <mstts:express-as style="${style}" styledegree="1.0" role="default">
        <prosody rate="${rate}%" pitch="${pitch}%">
            ${text}
        </prosody>
    </mstts:express-as>
</voice>
</speak>`;
    }

    async getVoice(text: string, options?: TTSOptions): Promise<ArrayBuffer> {
        const currentTime = Math.floor(Date.now() / 1000);

        if (!this.expiredAt || currentTime > this.expiredAt - 60) {
            this.endpoint = await this.getEndpoint();
            const jwt = this.endpoint.t.split('.')[1];
            // Base64 decode JWT payload
            const decodedJwt = JSON.parse(atob(jwt.replace(/-/g, '+').replace(/_/g, '/')));
            this.expiredAt = decodedJwt.exp;
        }

        if (!this.endpoint) {
            throw new Error("Failed to initialize endpoint");
        }

        const voiceName = options?.voiceName || DEFAULT_VOICE_NAME;
        const rate = options?.rate || DEFAULT_RATE;
        const pitch = options?.pitch || DEFAULT_PITCH;
        const outputFormat = options?.outputFormat || DEFAULT_OUTPUT_FORMAT;
        const style = options?.style || DEFAULT_STYLE;

        // The python code calls get_endpoint twice for some reason in get_voice, 
        // but the first one updates endpoint and expiredAt. 
        // I'll stick to updating if expired.

        const url = `https://${this.endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
        const headers = {
            "Authorization": this.endpoint.t,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": outputFormat,
        };

        const ssml = this.getSSML(text, voiceName, rate, pitch, style);

        const response = await nativeFetch(url, {
            method: 'POST',
            headers,
            body: ssml
        });

        if (!response.ok) {
            throw new Error(`TTS Request failed: ${response.status}`);
        }

        return await response.arrayBuffer();
    }

    async getVoiceList(): Promise<any> {
        if (this.voiceListCache) {
            return this.voiceListCache;
        }

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.26",
            "X-Ms-Useragent": "SpeechStudio/2021.05.001",
            "Content-Type": "application/json",
            "Origin": "https://azure.microsoft.com",
            "Referer": "https://azure.microsoft.com"
        };

        const response = await nativeFetch(VOICES_LIST_URL, {
            method: 'GET',
            headers
        });

        if (!response.ok) {
            throw new Error(`Failed to get voice list: ${response.status}`);
        }

        const result = await response.json();
        this.voiceListCache = result;
        return result;
    }
}

export const azureTTSService = new AzureTTSService();
