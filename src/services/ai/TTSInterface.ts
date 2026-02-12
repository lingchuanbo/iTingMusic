export interface TTSOptions {
    voiceName?: string;
    rate?: string;
    pitch?: string;
    outputFormat?: string;
    style?: string;
}

export interface TTSProvider {
    id: string;
    name: string;
    getVoice(text: string, options?: TTSOptions): Promise<ArrayBuffer>;
    getVoiceList(): Promise<any>;
}
